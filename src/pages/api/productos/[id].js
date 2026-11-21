import { db } from '../db';
import { verificarToken } from '@/utils/auth';
import { ensureFiscalSchema } from '@/utils/ensureFiscalSchema.js';

export async function GET({ request, params }) {
    const usuario = await verificarToken(request);
    if (!usuario) {
        return new Response('No autorizado', { status: 401 });
    }

    try {
        await ensureFiscalSchema(db);
        const { id } = params;
        const producto = await db.execute('SELECT * FROM productos WHERE id = ?', [id]);

        if (!producto || !producto.rows || producto.rows.length === 0) {
            return new Response(JSON.stringify({ message: 'No hay producto con ese ID' }), {
                headers: { 'Content-Type': 'application/json' },
                status: 404
            });
        }

        const raw = producto.rows[0];
        const ventaBase = Number(raw.venta) || 0;
        const precioDivisas = Number(raw.precio_divisas) > 0 ? Number(raw.precio_divisas) : ventaBase;
        const precioBcv = Number(raw.precio_bcv) > 0 ? Number(raw.precio_bcv) : ventaBase;

        const data = {
            ...raw,
            costo: Number(raw.costo) || 0,
            venta: precioBcv,
            precio_divisas: precioDivisas,
            precio_bcv: precioBcv,
            exento_iva: Number(raw.exento_iva) ? 1 : 0,
        };

        const seriales = await db.execute("SELECT serial FROM seriales WHERE producto_id = ? AND estado = 'disponible'", [id]);
        data.serialesDisponibles = seriales.rows ? seriales.rows.map(r => r.serial) : [];

        const usaSerialesRes = await db.execute('SELECT 1 FROM seriales WHERE producto_id = ? LIMIT 1', [id]);
        data.usaSeriales = (usaSerialesRes.rows && usaSerialesRes.rows.length > 0);

        return new Response(JSON.stringify(data), {
            headers: { 'Content-Type': 'application/json' },
            status: 200
        });
    } catch (error) {
        console.error('Error fetching producto:', error);
        return new Response('Error fetching producto', { status: 500 });
    }
}
