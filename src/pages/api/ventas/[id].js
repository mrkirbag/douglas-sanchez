import { db } from '../db';
import { verificarToken } from '@/utils/auth';
import { ensureFiscalSchema } from '@/utils/ensureFiscalSchema.js';

export async function GET({ request, params }) {
    const usuario = verificarToken(request);
    if (!usuario) {
        return new Response('Unauthorized', { status: 401 });
    }
    
    try {
        await ensureFiscalSchema(db);
        const { id } = params;

        const ventaResult = await db.execute(`
            SELECT
                c.nombre AS nombre_cliente,
                c.cedula AS cedula_cliente,
                c.telefono AS telefono_cliente,
                v.tipo_documento,
                v.nro_factura,
                v.nro_nota_entrega,
                v.caja_id,
                v.fecha,
                v.subtotal_base,
                v.subtotal_exento,
                v.iva_porcentaje,
                v.iva_monto,
                v.retencion_iva_porcentaje,
                v.retencion_iva_monto,
                v.comprobante_retencion,
                v.total_divisas,
                v.tasa_bcv,
                v.tasa_cop,
                v.total AS total_usd,
                v.flete_monto,
                v.tipo_pago,
                v.estado,
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
            WHERE v.id = ?
        `, [id]);

        if (ventaResult.rows.length === 0) {
            return new Response(JSON.stringify({ message: 'Venta no encontrada' }), {
                headers: { 'Content-Type': 'application/json' },
                status: 202
            });
        }

        const ventaData = ventaResult.rows[0];

        const productosResult = await db.execute(`
            SELECT
                producto_id,
                codigo_producto,
                nombre_producto,
                precio_unitario,
                precio_divisas,
                exento_iva,
                alicuota_iva,
                monto_iva,
                cantidad,
                subtotal
            FROM detalle_venta
            WHERE id_venta = ?
            ORDER BY nombre_producto ASC
        `, [id]);

        if (productosResult.rows.length === 0) {
            return new Response(JSON.stringify({ message: 'Venta sin productos' }), {
                headers: { 'Content-Type': 'application/json' },
                status: 202
            });
        }

        let pagosResult = { rows: [] };
        try {
            pagosResult = await db.execute(`
                SELECT moneda, metodo, monto, monto_base, moneda_base, tasa_cop, tasa_bs
                FROM pagos_venta
                WHERE id_venta = ?
                ORDER BY id ASC
            `, [id]);
        } catch (error) {
            console.warn('No se pudieron leer los pagos de la venta:', error);
        }

        let serialesResult = { rows: [] };
        try {
            serialesResult = await db.execute(`
                SELECT serial, producto_id
                FROM seriales
                WHERE id_venta = ?
            `, [id]);
        } catch (error) {
            console.warn('No se pudieron leer los seriales de la venta:', error);
        }

        const productosFinales = productosResult.rows.map(prod => {
            const serialesAsociados = serialesResult.rows
                .filter(s => s.producto_id === prod.producto_id)
                .map(s => s.serial);
            return {
                ...prod,
                precio_divisas: Number(prod.precio_divisas) > 0 ? Number(prod.precio_divisas) : Number(prod.precio_unitario),
                exento_iva: Number(prod.exento_iva) ? 1 : 0,
                alicuota_iva: prod.alicuota_iva !== undefined ? Number(prod.alicuota_iva) : 16,
                monto_iva: Number(prod.monto_iva) || 0,
                seriales: serialesAsociados
            };
        });

        const totalUsd = Number(ventaData.total_usd) || 0;
        const subtotalBase = Number(ventaData.subtotal_base) > 0 || Number(ventaData.subtotal_exento) > 0
            ? Number(ventaData.subtotal_base)
            : totalUsd;

        const result = {
            cliente: {
                nombre: ventaData.nombre_cliente,
                cedula: ventaData.cedula_cliente,
                telefono: ventaData.telefono_cliente
            },
            venta: {
                tipo_documento: ventaData.tipo_documento || 'factura',
                nro_factura: ventaData.nro_factura,
                nro_nota_entrega: ventaData.nro_nota_entrega,
                caja_id: ventaData.caja_id,
                fecha: ventaData.fecha,
                subtotal_base: subtotalBase,
                subtotal_exento: Number(ventaData.subtotal_exento) || 0,
                iva_porcentaje: ventaData.iva_porcentaje !== undefined ? Number(ventaData.iva_porcentaje) : 16,
                iva_monto: Number(ventaData.iva_monto) || 0,
                retencion_iva_porcentaje: Number(ventaData.retencion_iva_porcentaje) || 0,
                retencion_iva_monto: Number(ventaData.retencion_iva_monto) || 0,
                comprobante_retencion: ventaData.comprobante_retencion || '',
                total_divisas: Number(ventaData.total_divisas) > 0 ? Number(ventaData.total_divisas) : totalUsd,
                tasa_bcv: Number(ventaData.tasa_bcv) || 0,
                tasa_cop: Number(ventaData.tasa_cop) || 0,
                monto_total: totalUsd,
                flete_monto: Number(ventaData.flete_monto) || 0,
                ganancia_aproximada: Number(ventaData.ganancia_aproximada) || 0,
                tipo_pago: ventaData.tipo_pago,
                estado: ventaData.estado,
                facturada_en_venta_id: ventaData.facturada_en_venta_id || null,
                nota_entrega_origen_id: ventaData.nota_entrega_origen_id || null
            },
            productos: productosFinales,
            pagos: pagosResult.rows || []
        };

        return new Response(JSON.stringify(result), { headers: { 'Content-Type': 'application/json' }});
    } catch (error) {
        console.error('Error interno al consultar venta:', error);
        return new Response(JSON.stringify({ error: 'Error interno del servidor' }), {
            headers: { 'Content-Type': 'application/json' },
            status: 500
        });
    }
}

export async function DELETE() {
    return new Response(
        JSON.stringify({
            error: 'Por normativa del SENIAT, las facturas y documentos numerados no pueden ser eliminados ni cancelados. Utilice una Nota de Crédito / Devolución.',
        }),
        { status: 403, headers: { 'Content-Type': 'application/json' } }
    );
}

export async function PATCH() {
    return new Response(
        JSON.stringify({
            error: 'Por normativa del SENIAT, las facturas numeradas no pueden ser anuladas ni canceladas.',
        }),
        { status: 403, headers: { 'Content-Type': 'application/json' } }
    );
}

export async function PUT() {
    return new Response(
        JSON.stringify({
            error: 'Por normativa del SENIAT, las facturas numeradas son inmutables y no pueden modificarse ni cancelarse.',
        }),
        { status: 403, headers: { 'Content-Type': 'application/json' } }
    );
}
