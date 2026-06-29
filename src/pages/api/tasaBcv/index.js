import { db } from '../db';
import { verificarToken } from '@/utils/auth';
import { ensureBcvSchema } from '@/utils/db/ensureBcvSchema';

export async function GET({ request }) {
    const usuario = await verificarToken(request);
    if (!usuario) {
        return new Response(JSON.stringify({ error: 'No autorizado' }), { status: 401 });
    }

    try {
        await ensureBcvSchema();
        const tasa = await db.execute('SELECT * FROM tasaBcv WHERE id = 1');

        if (!tasa?.rows?.length) {
            return new Response(JSON.stringify({ message: 'No hay tasa BCV registrada' }), {
                headers: { 'Content-Type': 'application/json' },
                status: 204,
            });
        }

        return new Response(JSON.stringify(tasa.rows[0]), {
            headers: { 'Content-Type': 'application/json' },
            status: 200,
        });
    } catch (error) {
        console.error('Error fetching tasa BCV:', error);
        return new Response('Error fetching tasa BCV', { status: 500 });
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
        const { tasaBcv } = body;

        if (!tasaBcv || Number(tasaBcv) <= 0) {
            return new Response('Tasa BCV inválida', { status: 400 });
        }

        const existe = await db.execute('SELECT 1 FROM tasaBcv WHERE id = 1');
        if (existe.rows.length === 0) {
            await db.execute('INSERT INTO tasaBcv (id, valor) VALUES (1, ?)', [tasaBcv]);
        } else {
            await db.execute('UPDATE tasaBcv SET valor = ? WHERE id = 1', [tasaBcv]);
        }

        return new Response(
            JSON.stringify({ message: 'Tasa BCV actualizada exitosamente' }),
            { status: 200 }
        );
    } catch (error) {
        console.error('Error updating tasa BCV:', error);
        return new Response('Error updating tasa BCV', { status: 500 });
    }
}
