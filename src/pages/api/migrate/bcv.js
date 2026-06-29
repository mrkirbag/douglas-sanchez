import { db } from '../db';
import { verificarToken } from '@/utils/auth';
import { recalcularPventaBcvTodos } from '@/utils/db/preciosDb';

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

export async function POST({ request }) {
    const usuario = await verificarToken(request);
    if (!usuario || usuario.rol !== 'admin') {
        return new Response(JSON.stringify({ error: 'No autorizado' }), { status: 401 });
    }

    try {
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

        const recalc = await recalcularPventaBcvTodos();

        return new Response(
            JSON.stringify({ message: 'Migración BCV aplicada', ...recalc }),
            { status: 200, headers: { 'Content-Type': 'application/json' } }
        );
    } catch (error) {
        console.error('Error en migración BCV:', error);
        return new Response(JSON.stringify({ error: 'Error en migración' }), { status: 500 });
    }
}
