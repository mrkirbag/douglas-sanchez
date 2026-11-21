import { db } from '../db';
import { verificarToken } from '@/utils/auth';
import { ensureFiscalSchema } from '@/utils/ensureFiscalSchema.js';

export async function GET({ request }) {
    const usuario = verificarToken(request);
    if (!usuario) {
        return new Response('Unauthorized', { status: 401 });
    }

    try {
        await ensureFiscalSchema(db);
        const url = new URL(request.url);
        const fecha = url.searchParams.get('fecha');

        const result = await db.execute(
            `SELECT
                v.id,
                v.tipo_documento,
                v.nro_factura,
                v.nro_nota_entrega,
                v.caja_id,
                v.fecha,
                v.cliente_id,
                c.nombre AS cliente,
                c.cedula AS cedula_cliente,
                v.subtotal_base,
                v.subtotal_exento,
                v.iva_porcentaje,
                v.iva_monto,
                v.retencion_iva_porcentaje,
                v.retencion_iva_monto,
                v.total_divisas,
                v.tasa_bcv,
                v.tasa_cop,
                v.total,
                v.estado,
                v.tipo_pago,
                v.facturada_en_venta_id,
                v.nota_entrega_origen_id,
                COALESCE((
                    SELECT SUM((
                        (CASE WHEN v.tipo_documento = 'nota_entrega' THEN COALESCE(NULLIF(dv.precio_divisas, 0), dv.precio_unitario) ELSE dv.precio_unitario END)
                        - COALESCE(p.costo, 0)
                    ) * dv.cantidad)
                    FROM detalle_venta dv
                    LEFT JOIN productos p ON p.id = dv.producto_id
                    WHERE dv.id_venta = v.id
                ), 0) AS ganancia_aproximada
             FROM ventas v
             JOIN clientes c ON v.cliente_id = c.id
             WHERE v.fecha = ?
               AND v.estado != 'cancelado'
               AND v.tipo_pago != 'pendiente de seleccion'
             ORDER BY COALESCE(v.nro_factura, v.nro_nota_entrega, 0) DESC, c.nombre ASC`,
            [fecha]
        );

        if (!result || !result.rows || result.rows.length === 0) {
            return new Response(JSON.stringify({ message: 'No hay ventas registradas para esa fecha' }), {
                headers: { 'Content-Type': 'application/json' },
                status: 202
            });
        }

        return new Response(JSON.stringify(result.rows), {
            headers: { 'Content-Type': 'application/json' },
        });
    } catch (error) {
        console.error('Error fetching ventas:', error);
        return new Response('Error fetching ventas', { status: 500 });
    }
}

export async function DELETE() {
    return new Response(
        JSON.stringify({
            error: 'Por disposición del SENIAT, las facturas y documentos numerados no pueden ser eliminados ni cancelados. Utilice una Devolución / Nota de Crédito.',
        }),
        { status: 403, headers: { 'Content-Type': 'application/json' } }
    );
}

export async function PATCH() {
    return new Response(
        JSON.stringify({
            error: 'Por disposición del SENIAT, las facturas numeradas no pueden ser anuladas ni canceladas.',
        }),
        { status: 403, headers: { 'Content-Type': 'application/json' } }
    );
}
