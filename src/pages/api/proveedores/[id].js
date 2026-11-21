import { db } from '../db';
import { verificarToken } from '@/utils/auth';
import { ensureFiscalSchema } from '@/utils/ensureFiscalSchema.js';

const jsonHeaders = { 'Content-Type': 'application/json' };

export async function GET({ request, params }) {
    const usuario = verificarToken(request);
    if (!usuario) {
        return new Response(JSON.stringify({ error: 'No autorizado' }), { status: 401, headers: jsonHeaders });
    }
    if (usuario.rol !== 'admin') {
        return new Response(JSON.stringify({ error: 'Acceso denegado' }), { status: 403, headers: jsonHeaders });
    }

    try {
        await ensureFiscalSchema(db);
        const { id } = params;

        const provRes = await db.execute(`SELECT * FROM proveedores WHERE id = ?`, [id]);
        if (!provRes.rows?.length) {
            return new Response(JSON.stringify({ error: 'Proveedor no encontrado' }), { status: 404, headers: jsonHeaders });
        }

        const comprasRes = await db.execute(
            `SELECT id, fecha, tipo_documento, nro_factura, nro_control, monto_total, tipo_pago, monto_abonado, estado_pago
             FROM compras
             WHERE proveedor_id = ?
             ORDER BY fecha DESC, id DESC`,
            [id]
        );

        return new Response(
            JSON.stringify({
                proveedor: provRes.rows[0],
                compras: comprasRes.rows || [],
            }),
            { status: 200, headers: jsonHeaders }
        );
    } catch (error) {
        console.error('Error al obtener proveedor:', error);
        return new Response(JSON.stringify({ error: 'Error al obtener proveedor' }), { status: 500, headers: jsonHeaders });
    }
}
