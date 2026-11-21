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

    try {
        await ensureFiscalSchema(db);

        const tasaRes = await db.execute('SELECT valor, bs FROM tasa WHERE id = 1');
        const tasaRow = tasaRes.rows?.[0] || {};
        const tasaCopActual = Number(tasaRow.valor) || 0;
        const tasaBcvActual = Number(tasaRow.bs) || 0;

        const ventasContado = await db.execute(
            `SELECT COUNT(*) AS ventas_contado,
                    COALESCE(SUM(total), 0) AS total_contado,
                    COALESCE(SUM(COALESCE(subtotal_base, total)), 0) AS base_imponible,
                    COALESCE(SUM(COALESCE(subtotal_exento, 0)), 0) AS monto_exento,
                    COALESCE(SUM(COALESCE(iva_monto, 0)), 0) AS monto_iva,
                    COALESCE(SUM(COALESCE(retencion_iva_monto, 0)), 0) AS monto_retencion_iva
                FROM ventas
                WHERE tipo_pago = 'contado'
                AND estado IN ('completado', 'devuelto')
                AND nota_entrega_origen_id IS NULL
                AND DATE(fecha) BETWEEN ? AND ?
            `, [desde, hasta]
        );

        const ventasCredito = await db.execute(
            `SELECT COUNT(*) AS ventas_credito, COALESCE(SUM(total), 0) AS total_credito
                FROM ventas
                WHERE tipo_pago = 'credito'
                AND estado IN ('completado', 'pendiente')
                AND nota_entrega_origen_id IS NULL
                AND DATE(fecha) BETWEEN ? AND ?
            `, [desde, hasta]
        );

        const abonos = await db.execute(
            `SELECT COUNT(*) AS abonos_realizados, COALESCE(SUM(monto), 0) AS total_abonos
                FROM abonos_credito
                WHERE DATE(fecha) BETWEEN ? AND ?
            `, [desde, hasta]
        );

        const ganancia = await db.execute(
            `SELECT COALESCE(SUM((dv.precio_unitario - p.costo) * dv.cantidad), 0) AS ganancia_neta
                FROM detalle_venta dv
                JOIN productos p ON p.codigo = dv.codigo_producto
                JOIN ventas v ON v.id = dv.id_venta
                WHERE v.tipo_pago = 'contado'
                AND v.estado IN ('completado', 'devuelto')
                AND v.nota_entrega_origen_id IS NULL
                AND DATE(v.fecha) BETWEEN ? AND ?
            `, [desde, hasta]
        );

        const devoluciones = await db.execute(
            `SELECT COALESCE(SUM(monto_total), 0) AS salidas_efectivo
                FROM devoluciones
                WHERE tipo_resolucion = 'EFECTIVO'
                AND DATE(fecha_creacion) BETWEEN ? AND ?
            `, [desde, hasta]
        );

        const fletesRes = await db.execute(
            `SELECT
                COALESCE(SUM(COALESCE(flete_monto, 0)), 0) AS total_fletes,
                COALESCE(SUM(CASE WHEN tipo_pago = 'contado' THEN COALESCE(flete_monto, 0) ELSE 0 END), 0) AS total_fletes_contado
             FROM ventas
             WHERE estado IN ('completado', 'devuelto', 'pendiente')
               AND nota_entrega_origen_id IS NULL
               AND DATE(fecha) BETWEEN ? AND ?`,
            [desde, hasta]
        );

        const notasUsadas = await db.execute(
            `SELECT COALESCE(SUM(pv.monto_base), 0) AS total_notas
                FROM pagos_venta pv
                JOIN ventas v ON v.id = pv.id_venta
                WHERE pv.metodo = 'nota_credito'
                AND DATE(v.fecha) BETWEEN ? AND ?
            `, [desde, hasta]
        );

        const fiscalResumen = await db.execute(
            `SELECT
                COALESCE(SUM(CASE WHEN COALESCE(tipo_documento, 'factura') = 'factura' THEN 1 ELSE 0 END), 0) AS facturas_bs_count,
                COALESCE(SUM(CASE WHEN tipo_documento = 'nota_entrega' THEN 1 ELSE 0 END), 0) AS notas_entrega_count,
                COALESCE(SUM(CASE WHEN COALESCE(tipo_documento, 'factura') = 'factura' THEN COALESCE(subtotal_base, total) ELSE 0 END), 0) AS base_imponible_usd,
                COALESCE(SUM(CASE WHEN COALESCE(tipo_documento, 'factura') = 'factura' THEN ROUND(COALESCE(subtotal_base, total) * (CASE WHEN tasa_bcv > 0 THEN tasa_bcv ELSE ? END), 2) ELSE 0 END), 0) AS base_imponible_bs,
                COALESCE(SUM(CASE WHEN COALESCE(tipo_documento, 'factura') = 'factura' THEN COALESCE(subtotal_exento, 0) ELSE 0 END), 0) AS exento_usd,
                COALESCE(SUM(CASE WHEN COALESCE(tipo_documento, 'factura') = 'factura' THEN ROUND(COALESCE(subtotal_exento, 0) * (CASE WHEN tasa_bcv > 0 THEN tasa_bcv ELSE ? END), 2) ELSE 0 END), 0) AS exento_bs,
                COALESCE(SUM(CASE WHEN COALESCE(tipo_documento, 'factura') = 'factura' THEN COALESCE(iva_monto, 0) ELSE 0 END), 0) AS iva_usd,
                COALESCE(SUM(CASE WHEN COALESCE(tipo_documento, 'factura') = 'factura' THEN ROUND(COALESCE(iva_monto, 0) * (CASE WHEN tasa_bcv > 0 THEN tasa_bcv ELSE ? END), 2) ELSE 0 END), 0) AS iva_bs,
                COALESCE(SUM(CASE WHEN COALESCE(tipo_documento, 'factura') = 'factura' THEN COALESCE(retencion_iva_monto, 0) ELSE 0 END), 0) AS retencion_iva_usd,
                COALESCE(SUM(CASE WHEN COALESCE(tipo_documento, 'factura') = 'factura' THEN ROUND(COALESCE(retencion_iva_monto, 0) * (CASE WHEN tasa_bcv > 0 THEN tasa_bcv ELSE ? END), 2) ELSE 0 END), 0) AS retencion_iva_bs,
                COALESCE(SUM(CASE WHEN COALESCE(tipo_documento, 'factura') = 'factura' THEN total ELSE 0 END), 0) AS total_facturado_bcv_usd,
                COALESCE(SUM(CASE WHEN COALESCE(tipo_documento, 'factura') = 'factura' THEN ROUND(total * (CASE WHEN tasa_bcv > 0 THEN tasa_bcv ELSE ? END), 2) ELSE 0 END), 0) AS total_facturado_bs,
                COALESCE(SUM(CASE WHEN tipo_documento = 'nota_entrega' THEN total ELSE 0 END), 0) AS total_notas_entrega_usd,
                COALESCE(SUM(CASE WHEN tipo_documento = 'nota_entrega' THEN ROUND(total * (CASE WHEN tasa_cop > 0 THEN tasa_cop ELSE ? END), 0) ELSE 0 END), 0) AS total_notas_entrega_cop
             FROM ventas
             WHERE estado IN ('completado', 'devuelto', 'pendiente')
               AND DATE(fecha) BETWEEN ? AND ?`,
            [tasaBcvActual, tasaBcvActual, tasaBcvActual, tasaBcvActual, tasaBcvActual, tasaCopActual, desde, hasta]
        );

        // Respuesta estructurada
        const ventasContadoRow = ventasContado.rows[0] || {};
        const ventasCreditoRow = ventasCredito.rows[0] || {};
        const abonosRow = abonos.rows[0] || {};
        const gananciaRow = ganancia.rows[0] || {};
        const devolucionesRow = devoluciones.rows[0] || {};
        const notasUsadasRow = notasUsadas.rows[0] || {};
        const fiscalRow = fiscalResumen.rows[0] || {};
        const fletesRow = fletesRes.rows[0] || {};

        const total_fletes = Number(fletesRow.total_fletes) || 0;
        const total_fletes_contado = Number(fletesRow.total_fletes_contado) || 0;
        const notas_usadas = Number(notasUsadasRow?.total_notas) || 0;
        const total_ventas_contado = (Number(ventasContadoRow?.total_contado) || 0) - notas_usadas;
        const total_ventas_credito = Number(ventasCreditoRow?.total_credito) || 0;
        const total_abonos_realizados = Number(abonosRow?.total_abonos) || 0;
        const salidas_efectivo = Number(devolucionesRow?.salidas_efectivo) || 0;
        const total_en_caja = (total_ventas_contado + total_abonos_realizados) - salidas_efectivo - total_fletes_contado;
        const margen_ganancia = (Number(gananciaRow?.ganancia_neta) || 0) - total_fletes;

        return new Response(JSON.stringify({
            resumen: {
                ventas_contado: Number(ventasContadoRow?.ventas_contado) || 0,
                total_ventas_contado,
                margen_ganancia,
                total_fletes,
                total_fletes_contado,
                ventas_credito: Number(ventasCreditoRow?.ventas_credito) || 0,
                total_ventas_credito,
                abonos_realizados: Number(abonosRow?.abonos_realizados) || 0,
                total_abonos_realizados,
                salidas_efectivo,
                notas_usadas,
                total_en_caja,
                facturas_bs_count: Number(fiscalRow.facturas_bs_count) || 0,
                notas_entrega_count: Number(fiscalRow.notas_entrega_count) || 0,
                base_imponible_usd: Number(fiscalRow.base_imponible_usd) || 0,
                base_imponible_bs: Number(fiscalRow.base_imponible_bs) || 0,
                exento_usd: Number(fiscalRow.exento_usd) || 0,
                exento_bs: Number(fiscalRow.exento_bs) || 0,
                iva_usd: Number(fiscalRow.iva_usd) || 0,
                iva_bs: Number(fiscalRow.iva_bs) || 0,
                retencion_iva_usd: Number(fiscalRow.retencion_iva_usd) || 0,
                retencion_iva_bs: Number(fiscalRow.retencion_iva_bs) || 0,
                total_facturado_bcv_usd: Number(fiscalRow.total_facturado_bcv_usd) || 0,
                total_facturado_bs: Number(fiscalRow.total_facturado_bs) || 0,
                total_notas_entrega_usd: Number(fiscalRow.total_notas_entrega_usd) || 0,
                total_notas_entrega_cop: Number(fiscalRow.total_notas_entrega_cop) || 0,
            }
        }), {
            status: 200,
            headers: { 'Content-Type': 'application/json' }
        });

    } catch (err) {
        console.error('Error en resumen de caja:', err);
        return new Response(JSON.stringify({ error: 'Error interno del servidor' }), { status: 500 });
    }
}
