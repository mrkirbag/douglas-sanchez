import { db } from '../db';
import { verificarToken } from '@/utils/auth';
import { recalcularPventaBcvTodos } from '@/utils/db/preciosDb';
import { RECARGO_BCV_DEFAULT } from '@/utils/helpers/precios';
import { ensureBcvSchema } from '@/utils/db/ensureBcvSchema';

export async function GET({ request }) {
    const usuario = await verificarToken(request);
    if (!usuario) {
        return new Response(JSON.stringify({ error: 'No autorizado' }), { status: 401 });
    }

    try {
        await ensureBcvSchema();
        const config = await db.execute('SELECT recargo_bcv FROM config_precios WHERE id = 1');

        if (!config?.rows?.length) {
            return new Response(JSON.stringify({ recargo_bcv: RECARGO_BCV_DEFAULT }), {
                headers: { 'Content-Type': 'application/json' },
                status: 200,
            });
        }

        return new Response(JSON.stringify(config.rows[0]), {
            headers: { 'Content-Type': 'application/json' },
            status: 200,
        });
    } catch (error) {
        return new Response(JSON.stringify({ recargo_bcv: RECARGO_BCV_DEFAULT }), {
            headers: { 'Content-Type': 'application/json' },
            status: 200,
        });
    }
}

export async function PUT({ request }) {
    const usuario = await verificarToken(request);
    if (!usuario) {
        return new Response(JSON.stringify({ error: 'No autorizado' }), { status: 401 });
    }

    try {
        await ensureBcvSchema();
        const body = await request.json();
        const recargo = Number(body.recargo_bcv);

        if (!Number.isFinite(recargo) || recargo < 0) {
            return new Response('Recargo BCV inválido', { status: 400 });
        }

        const existe = await db.execute('SELECT 1 FROM config_precios WHERE id = 1');
        if (existe.rows.length === 0) {
            await db.execute('INSERT INTO config_precios (id, recargo_bcv) VALUES (1, ?)', [recargo]);
        } else {
            await db.execute('UPDATE config_precios SET recargo_bcv = ? WHERE id = 1', [recargo]);
        }

        await recalcularPventaBcvTodos();

        return new Response(
            JSON.stringify({ message: 'Recargo BCV actualizado y precios recalculados' }),
            { status: 200 }
        );
    } catch (error) {
        console.error('Error updating recargo BCV:', error);
        return new Response('Error updating recargo BCV', { status: 500 });
    }
}
