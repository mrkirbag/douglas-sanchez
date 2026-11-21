import { db } from '../db';
import { verificarToken } from '@/utils/auth';
import { ensureFiscalSchema } from '@/utils/ensureFiscalSchema.js';

export async function GET({ request }) {

    const usuario = await verificarToken(request);
    if (!usuario) {
        return new Response(JSON.stringify({ error: 'No autorizado' }), { status: 401 });
    }
    if (usuario.rol !== 'admin') {
        return new Response(JSON.stringify({ error: 'Acceso denegado' }), { status: 403 }); 
    }

    const url = new URL(request.url);
    const desde = url.searchParams.get('desde');
    const hasta = url.searchParams.get('hasta');

    if (!desde || !hasta) {
        return new Response(JSON.stringify({ error: 'Fechas inválidas' }), { status: 400 });
    }

    if (hasta < desde) {
        return new Response(JSON.stringify({ error: 'Rango de fechas inválido' }), { status: 400 });
    }

    const query = `
                    SELECT 
                    v.id,
                    v.tipo_documento,
                    v.nro_factura,
                    v.nro_nota_entrega,
                    v.fecha AS fecha_venta,
                    c.nombre AS nombre_cliente,
                    c.cedula AS cedula_cliente,
                    v.subtotal_base,
                    v.subtotal_exento,
                    v.iva_monto,
                    v.retencion_iva_monto,
                    v.tasa_bcv,
                    v.tasa_cop,
                    v.total AS total_usd,
                    v.tipo_pago,
                    v.estado,
                    v.facturada_en_venta_id,
                    v.nota_entrega_origen_id
                    FROM ventas v
                    JOIN clientes c ON c.id = v.cliente_id
                    WHERE DATE(v.fecha) BETWEEN ? AND ?
                    AND v.estado IN ('completado', 'devuelto', 'pendiente')
                    AND v.tipo_pago IN ('contado', 'credito')
                    ORDER BY v.fecha ASC, COALESCE(v.nro_factura, v.nro_nota_entrega, 0) ASC;
                `;

    try {
        await ensureFiscalSchema(db);
        const ventas = await db.execute(query, [desde, hasta]);

        return new Response(JSON.stringify(ventas.rows), {
            status: 200,
            headers: { 'Content-Type': 'application/json' }
        });

    } catch (err) {
        console.error('Error en ventasTotales:', err);
        return new Response(JSON.stringify({ error: 'Error interno del servidor' }), { status: 500 });
    }
}