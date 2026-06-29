/**
 * Migración: precios BCV (pventa_bcv, tasaBcv, config_precios)
 * Ejecutar: node scripts/migrate-bcv.mjs
 */
import 'dotenv/config';
import { createClient } from '@libsql/client';

const db = createClient({
    url: process.env.DATABASE_URL,
    authToken: process.env.DATABASE_AUTH_TOKEN,
});

async function columnExists(table, column) {
    const info = await db.execute(`PRAGMA table_info(${table})`);
    return info.rows.some((row) => row.name === column);
}

async function tableExists(name) {
    const info = await db.execute(
        `SELECT name FROM sqlite_master WHERE type='table' AND name=?`,
        [name]
    );
    return info.rows.length > 0;
}

async function migrate() {
    console.log('Iniciando migración BCV...');

    if (!(await columnExists('productos', 'pventa_bcv'))) {
        await db.execute('ALTER TABLE productos ADD COLUMN pventa_bcv REAL');
        console.log('✓ Columna productos.pventa_bcv agregada');
    } else {
        console.log('· Columna productos.pventa_bcv ya existe');
    }

    if (!(await tableExists('config_precios'))) {
        await db.execute(`
            CREATE TABLE config_precios (
                id INTEGER PRIMARY KEY,
                recargo_bcv REAL NOT NULL DEFAULT 35
            )
        `);
        await db.execute('INSERT INTO config_precios (id, recargo_bcv) VALUES (1, 35)');
        console.log('✓ Tabla config_precios creada');
    } else {
        console.log('· Tabla config_precios ya existe');
    }

    if (!(await tableExists('tasaBcv'))) {
        await db.execute(`
            CREATE TABLE tasaBcv (
                id INTEGER PRIMARY KEY,
                valor REAL NOT NULL
            )
        `);
        // Valor inicial: copiar tasaBs si existe, sino 1
        let valorInicial = 1;
        if (await tableExists('tasaBs')) {
            const tasaBs = await db.execute('SELECT valor FROM tasaBs WHERE id = 1');
            if (tasaBs.rows[0]?.valor) {
                valorInicial = Number(tasaBs.rows[0].valor);
            }
        }
        await db.execute('INSERT INTO tasaBcv (id, valor) VALUES (1, ?)', [valorInicial]);
        console.log(`✓ Tabla tasaBcv creada (valor inicial: ${valorInicial})`);
    } else {
        console.log('· Tabla tasaBcv ya existe');
    }

    const tasa = await db.execute('SELECT valor FROM tasa WHERE id = 1');
    const recargo = await db.execute('SELECT recargo_bcv FROM config_precios WHERE id = 1');
    const tasaCopUsd = Number(tasa.rows[0]?.valor) || 0;
    const recargoBcv = Number(recargo.rows[0]?.recargo_bcv ?? 35);

    if (tasaCopUsd > 0) {
        const result = await db.execute(
            `UPDATE productos
             SET pventa_bcv = (venta / ?) * (1 + ? / 100.0)
             WHERE estatus = 'activo'`,
            [tasaCopUsd, recargoBcv]
        );
        console.log(`✓ pventa_bcv recalculado en ${result.rowsAffected ?? 0} productos`);
    } else {
        console.log('⚠ Tasa COP/USD no configurada; omitiendo recálculo de pventa_bcv');
    }

    console.log('Migración completada.');
}

migrate().catch((err) => {
    console.error('Error en migración:', err);
    process.exit(1);
});
