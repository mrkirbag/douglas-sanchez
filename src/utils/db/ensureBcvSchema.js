import { db } from '@/pages/api/db';

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

let migracionLista = false;

/** Aplica migración BCV idempotente en la primera llamada */
export async function ensureBcvSchema() {
    if (migracionLista) return;

    if (!(await columnExists('productos', 'pventa_bcv'))) {
        await db.execute('ALTER TABLE productos ADD COLUMN pventa_bcv REAL');
    }

    if (!(await tableExists('config_precios'))) {
        await db.execute(`
            CREATE TABLE config_precios (
                id INTEGER PRIMARY KEY,
                recargo_bcv REAL NOT NULL DEFAULT 35
            )
        `);
        await db.execute('INSERT INTO config_precios (id, recargo_bcv) VALUES (1, 35)');
    }

    if (!(await tableExists('tasaBcv'))) {
        await db.execute(`
            CREATE TABLE tasaBcv (
                id INTEGER PRIMARY KEY,
                valor REAL NOT NULL
            )
        `);
        let valorInicial = 1;
        if (await tableExists('tasaBs')) {
            const tasaBs = await db.execute('SELECT valor FROM tasaBs WHERE id = 1');
            if (tasaBs.rows[0]?.valor) {
                valorInicial = Number(tasaBs.rows[0].valor);
            }
        }
        await db.execute('INSERT INTO tasaBcv (id, valor) VALUES (1, ?)', [valorInicial]);
    }

    const tasa = await db.execute('SELECT valor FROM tasa WHERE id = 1');
    const recargo = await db.execute('SELECT recargo_bcv FROM config_precios WHERE id = 1');
    const tasaCopUsd = Number(tasa.rows[0]?.valor) || 0;
    const recargoBcv = Number(recargo.rows[0]?.recargo_bcv ?? 35);

    if (tasaCopUsd > 0) {
        await db.execute(
            `UPDATE productos
             SET pventa_bcv = (venta / ?) * (1 + ? / 100.0)
             WHERE estatus = 'activo' AND (pventa_bcv IS NULL OR pventa_bcv = 0)`,
            [tasaCopUsd, recargoBcv]
        );
    }

    migracionLista = true;
}
