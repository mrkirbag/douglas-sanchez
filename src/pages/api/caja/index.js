import { db } from '../db';
import { verificarToken } from '@/utils/auth';
import { ensureFiscalSchema } from '@/utils/ensureFiscalSchema.js';
import { fechaHoraVenezuela } from '@/utils/helpers/formateoFecha.js';
import { ACCIONES, registrarBitacora } from '@/utils/bitacora.js';
import { etiquetaPago } from '@/utils/helpers/metodosPago.js';
import { obtenerMonedaBase } from '@/utils/helpers/tasas.js';

const jsonHeaders = { 'Content-Type': 'application/json' };

async function obtenerTasasActuales() {
    const res = await db.execute('SELECT * FROM tasa WHERE id = 1');
    const row = res.rows?.[0] || {};
    return {
        cop: Number(row.valor) || 0,
        bs: Number(row.bs) || 0,
        cop_a_bs: Number(row.cop_a_bs) || 3,
        iva_porcentaje: row.iva_porcentaje !== undefined ? Number(row.iva_porcentaje) : 16,
        retencion_iva_porcentaje: row.retencion_iva_porcentaje !== undefined ? Number(row.retencion_iva_porcentaje) : 75,
    };
}

/**
 * Calcula las métricas fiscales y financieras de una sesión de caja (Corte X o Cierre Z).
 */
export async function calcularMetricasCaja(caja, tasas) {
    const cajaId = caja.id;
    const fechaApertura = caja.fecha_apertura;
    const tasaBcv = Number(caja.tasa_bcv_cierre) > 0 ? Number(caja.tasa_bcv_cierre) : (Number(tasas.bs) || 0);
    const tasaCop = Number(caja.tasa_cop_cierre) > 0 ? Number(caja.tasa_cop_cierre) : (Number(tasas.cop) || 0);

    // Ventas vinculadas a la caja (o del día de apertura si no tenían caja_id asignado aún)
    const ventasRes = await db.execute({
        sql: `
            SELECT
                id, tipo_documento, nro_factura, nro_nota_entrega, fecha, total, estado, tipo_pago,
                subtotal_base, subtotal_exento, iva_porcentaje, iva_monto,
                retencion_iva_porcentaje, retencion_iva_monto, total_divisas,
                tasa_bcv, tasa_cop, facturada_en_venta_id
            FROM ventas
            WHERE (caja_id = ? OR (caja_id IS NULL AND fecha = ?))
              AND LOWER(estado) NOT IN ('anulado', 'anulada', 'cancelado')
            ORDER BY COALESCE(nro_factura, nro_nota_entrega, 0) ASC, id ASC
        `,
        args: [cajaId, fechaApertura],
    });

    const ventas = ventasRes.rows || [];

    let cantidadFacturas = 0;
    let primeraFactura = null;
    let ultimaFactura = null;

    let cantidadNotasEntrega = 0;
    let notasEntregaPendientes = 0;
    let primeraNotaEntrega = null;
    let ultimaNotaEntrega = null;
    let totalNotasEntregaUsd = 0;
    let totalNotasEntregaCop = 0;

    let totalVentasContado = 0;
    let totalVentasCredito = 0;
    let totalVentasContadoBs = 0;
    let totalVentasCreditoBs = 0;
    let baseImponibleUsd = 0;
    let baseImponibleBs = 0;
    let exentoUsd = 0;
    let exentoBs = 0;
    let ivaUsd = 0;
    let ivaBs = 0;
    let retencionIvaUsd = 0;
    let retencionIvaBs = 0;
    let totalFacturadoUsd = 0;
    let totalFacturadoBs = 0;
    let totalDivisasReferencia = 0;
    let totalFletesUsd = 0;

    const esBaseCop = obtenerMonedaBase() === 'COP';

    for (const v of ventas) {
        const esNota = v.tipo_documento === 'nota_entrega';
        const tBcvVenta = Number(v.tasa_bcv) > 0 ? Number(v.tasa_bcv) : tasaBcv;
        const tCopVenta = Number(v.tasa_cop) > 0 ? Number(v.tasa_cop) : tasaCop;
        const totalVenta = Number(v.total) || 0;
        if (!v.nota_entrega_origen_id) {
            const flete = Number(v.flete_monto) || 0;
            totalFletesUsd += esBaseCop && tCopVenta > 0 ? (flete / tCopVenta) : flete;
        }

        // Las Notas de Entrega son documentos no fiscales: se contabilizan aparte y no suman al Reporte Z fiscal
        if (esNota) {
            cantidadNotasEntrega += 1;
            if (!v.facturada_en_venta_id && String(v.estado).toLowerCase() !== 'devuelto') {
                notasEntregaPendientes += 1;
            }
            const nroNe = Number(v.nro_nota_entrega) || null;
            if (nroNe !== null) {
                if (primeraNotaEntrega === null || nroNe < primeraNotaEntrega) primeraNotaEntrega = nroNe;
                if (ultimaNotaEntrega === null || nroNe > ultimaNotaEntrega) ultimaNotaEntrega = nroNe;
            }
            if (esBaseCop) {
                const neUsd = tCopVenta > 0 ? totalVenta / tCopVenta : 0;
                totalNotasEntregaUsd += neUsd;
                totalNotasEntregaCop += totalVenta;
                totalDivisasReferencia += neUsd;
            } else {
                totalNotasEntregaUsd += totalVenta;
                totalNotasEntregaCop += Math.ceil(totalVenta * tCopVenta);
                totalDivisasReferencia += totalVenta;
            }
            continue;
        }

        const totalVentaUsd = esBaseCop ? (tBcvVenta > 0 ? totalVenta / tBcvVenta : 0) : totalVenta;
        const totalVentaBs = esBaseCop ? totalVenta : totalVenta * tBcvVenta;
        if (String(v.tipo_pago).toLowerCase() === 'credito') {
            totalVentasCredito += totalVentaUsd;
            totalVentasCreditoBs += totalVentaBs;
        } else {
            totalVentasContado += totalVentaUsd;
            totalVentasContadoBs += totalVentaBs;
        }

        cantidadFacturas += 1;
        const nro = Number(v.nro_factura) || null;
        if (nro !== null) {
            if (primeraFactura === null || nro < primeraFactura) primeraFactura = nro;
            if (ultimaFactura === null || nro > ultimaFactura) ultimaFactura = nro;
        }

        const subBase = Number(v.subtotal_base) > 0 || Number(v.subtotal_exento) > 0
            ? Number(v.subtotal_base)
            : totalVenta;
        const subExento = Number(v.subtotal_exento) || 0;
        const mIva = Number(v.iva_monto) || 0;
        const mRet = Number(v.retencion_iva_monto) || 0;
        const mDiv = Number(v.total_divisas) > 0 ? Number(v.total_divisas) : totalVenta;

        if (esBaseCop) {
            baseImponibleBs += subBase;
            baseImponibleUsd += tBcvVenta > 0 ? subBase / tBcvVenta : 0;
            exentoBs += subExento;
            exentoUsd += tBcvVenta > 0 ? subExento / tBcvVenta : 0;
            ivaBs += mIva;
            ivaUsd += tBcvVenta > 0 ? mIva / tBcvVenta : 0;
            retencionIvaBs += mRet;
            retencionIvaUsd += tBcvVenta > 0 ? mRet / tBcvVenta : 0;
            totalFacturadoBs += totalVenta;
            totalFacturadoUsd += tBcvVenta > 0 ? totalVenta / tBcvVenta : 0;
            totalDivisasReferencia += tCopVenta > 0 ? mDiv / tCopVenta : 0;
        } else {
            baseImponibleUsd += subBase;
            baseImponibleBs += subBase * tBcvVenta;
            exentoUsd += subExento;
            exentoBs += subExento * tBcvVenta;
            ivaUsd += mIva;
            ivaBs += mIva * tBcvVenta;
            retencionIvaUsd += mRet;
            retencionIvaBs += mRet * tBcvVenta;
            totalFacturadoUsd += totalVenta;
            totalFacturadoBs += totalVenta * tBcvVenta;
            totalDivisasReferencia += mDiv;
        }
    }

    // Devoluciones asociadas a las ventas de esta caja o creadas en la fecha de apertura
    const devolucionesRes = await db.execute({
        sql: `
            SELECT d.id, d.id_venta, d.monto_total, d.tipo_resolucion, v.tasa_bcv, v.tasa_cop, v.tipo_documento
            FROM devoluciones d
            LEFT JOIN ventas v ON d.id_venta = v.id
            WHERE v.caja_id = ? OR date(d.fecha_creacion) = ?
        `,
        args: [cajaId, fechaApertura],
    });

    let totalDevolucionesUsd = 0;
    let totalDevolucionesBs = 0;
    let salidasEfectivoUsd = 0;
    let notasCreditoEmitidasUsd = 0;

    for (const d of (devolucionesRes.rows || [])) {
        const monto = Number(d.monto_total) || 0;
        const tBcv = Number(d.tasa_bcv) > 0 ? Number(d.tasa_bcv) : tasaBcv;
        const tCop = Number(d.tasa_cop) > 0 ? Number(d.tasa_cop) : tasaCop;
        let montoUsd = monto;
        let montoBs = monto * tBcv;
        if (esBaseCop) {
            if (d.tipo_documento === 'nota_entrega') {
                montoUsd = tCop > 0 ? monto / tCop : 0;
                montoBs = montoUsd * tBcv;
            } else {
                montoBs = monto;
                montoUsd = tBcv > 0 ? monto / tBcv : 0;
            }
        }
        totalDevolucionesUsd += montoUsd;
        totalDevolucionesBs += montoBs;
        if (d.tipo_resolucion === 'EFECTIVO') {
            salidasEfectivoUsd += montoUsd;
        } else {
            notasCreditoEmitidasUsd += montoUsd;
        }
    }

    // Desglose por métodos de pago de las ventas de la sesión
    const pagosRes = await db.execute({
        sql: `
            SELECT pv.moneda, pv.metodo, pv.monto, pv.monto_base, v.tasa_cop, v.tasa_bcv
            FROM pagos_venta pv
            JOIN ventas v ON pv.id_venta = v.id
            WHERE (v.caja_id = ? OR (v.caja_id IS NULL AND v.fecha = ?))
              AND LOWER(v.estado) NOT IN ('anulado', 'anulada', 'cancelado')
            ORDER BY pv.moneda ASC, pv.metodo ASC
        `,
        args: [cajaId, fechaApertura],
    });

    const copABs = Number(tasas?.cop_a_bs) || 3;
    const mapaPagos = new Map();
    for (const p of (pagosRes.rows || [])) {
        const moneda = String(p.moneda || 'COP').toUpperCase();
        const metodo = String(p.metodo || 'efectivo');
        const key = `${moneda}::${metodo}`;
        const monto = Number(p.monto) || 0;
        const tCop = Number(p.tasa_cop) > 0 ? Number(p.tasa_cop) : tasaCop;
        const tBcv = Number(p.tasa_bcv) > 0 ? Number(p.tasa_bcv) : tasaBcv;

        let usd = 0;
        let cop = 0;
        if (moneda === 'USD') {
            usd = monto;
            cop = tCop > 0 ? monto * tCop : 0;
        } else if (moneda === 'COP') {
            cop = monto;
            usd = tCop > 0 ? monto / tCop : 0;
        } else if (moneda === 'BS') {
            usd = tBcv > 0 ? monto / tBcv : 0;
            cop = copABs > 0 ? monto * copABs : (tCop > 0 ? usd * tCop : 0);
        }

        const actual = mapaPagos.get(key) || {
            moneda,
            metodo,
            etiqueta: etiquetaPago(moneda, metodo),
            operaciones: 0,
            total_moneda: 0,
            total_usd: 0,
            total_cop: 0,
        };
        actual.operaciones += 1;
        actual.total_moneda += monto;
        actual.total_usd += usd;
        actual.total_cop += cop;
        mapaPagos.set(key, actual);
    }

    const desglosePagos = Array.from(mapaPagos.values()).map((p) => ({
        ...p,
        total_moneda: +(p.total_moneda.toFixed(2)),
        total_usd: +(p.total_usd.toFixed(2)),
        total_cop: Math.round(p.total_cop),
    }));

    // Abonos de créditos recibidos en la fecha de la caja
    const abonosRes = await db.execute({
        sql: `
            SELECT monto, moneda, monto_recibido, moneda_base, tasa_cop, tasa_bs
            FROM abonos_credito
            WHERE fecha = ?
        `,
        args: [fechaApertura],
    });

    const abonosRows = abonosRes.rows || [];
    const abonosCantidad = abonosRows.length;
    let abonosTotalUsd = 0;
    let abonosTotalCop = 0;
    for (const a of abonosRows) {
        const mon = String(a.moneda || a.moneda_base || (esBaseCop ? 'COP' : 'USD')).toUpperCase();
        const monBase = String(a.moneda_base || (esBaseCop ? 'COP' : 'USD')).toUpperCase();
        const mRec = Number(a.monto_recibido) > 0 ? Number(a.monto_recibido) : (Number(a.monto) || 0);
        const tCop = Number(a.tasa_cop) > 0 ? Number(a.tasa_cop) : tasaCop;
        const tBs = Number(a.tasa_bs) > 0 ? Number(a.tasa_bs) : tasaBcv;
        if (mon === 'USD') {
            abonosTotalUsd += mRec;
            abonosTotalCop += tCop > 0 ? mRec * tCop : 0;
        } else if (mon === 'COP') {
            abonosTotalCop += mRec;
            abonosTotalUsd += tCop > 0 ? mRec / tCop : 0;
        } else if (mon === 'BS') {
            const usdA = tBs > 0 ? mRec / tBs : 0;
            abonosTotalUsd += usdA;
            abonosTotalCop += copABs > 0 ? mRec * copABs : (tCop > 0 ? usdA * tCop : 0);
        } else if (monBase === 'COP') {
            abonosTotalCop += Number(a.monto) || 0;
            abonosTotalUsd += tCop > 0 ? (Number(a.monto) || 0) / tCop : 0;
        } else {
            abonosTotalUsd += Number(a.monto) || 0;
            abonosTotalCop += tCop > 0 ? (Number(a.monto) || 0) * tCop : 0;
        }
    }

    return {
        cantidad_facturas: cantidadFacturas,
        primera_factura: primeraFactura,
        ultima_factura: ultimaFactura,
        cantidad_notas_entrega: cantidadNotasEntrega,
        notas_entrega_pendientes_facturar: notasEntregaPendientes,
        primera_nota_entrega: primeraNotaEntrega,
        ultima_nota_entrega: ultimaNotaEntrega,
        total_notas_entrega_usd: +(totalNotasEntregaUsd.toFixed(2)),
        total_notas_entrega_cop: Math.round(totalNotasEntregaCop),
        total_ventas_contado: +(totalVentasContado.toFixed(2)),
        total_ventas_credito: +(totalVentasCredito.toFixed(2)),
        total_ventas_contado_bs: +(totalVentasContadoBs.toFixed(2)),
        total_ventas_credito_bs: +(totalVentasCreditoBs.toFixed(2)),
        base_imponible_usd: +(baseImponibleUsd.toFixed(2)),
        base_imponible_bs: +(baseImponibleBs.toFixed(2)),
        exento_usd: +(exentoUsd.toFixed(2)),
        exento_bs: +(exentoBs.toFixed(2)),
        iva_usd: +(ivaUsd.toFixed(2)),
        iva_bs: +(ivaBs.toFixed(2)),
        retencion_iva_usd: +(retencionIvaUsd.toFixed(2)),
        retencion_iva_bs: +(retencionIvaBs.toFixed(2)),
        total_facturado_usd: +(totalFacturadoUsd.toFixed(2)),
        total_facturado_bs: +(totalFacturadoBs.toFixed(2)),
        total_divisas_referencia: +(totalDivisasReferencia.toFixed(2)),
        total_fletes_usd: +(totalFletesUsd.toFixed(2)),
        total_devoluciones_usd: +(totalDevolucionesUsd.toFixed(2)),
        total_devoluciones_bs: +(totalDevolucionesBs.toFixed(2)),
        salidas_efectivo_usd: +(salidasEfectivoUsd.toFixed(2)),
        notas_credito_emitidas_usd: +(notasCreditoEmitidasUsd.toFixed(2)),
        abonos_cantidad: abonosCantidad,
        abonos_total_usd: +(abonosTotalUsd.toFixed(2)),
        abonos_total_cop: Math.round(abonosTotalCop),
        tasa_bcv: tasaBcv,
        tasa_cop: tasaCop,
        desglose_pagos: desglosePagos,
    };
}

export async function GET({ request }) {
    const usuario = verificarToken(request);
    if (!usuario) {
        return new Response(JSON.stringify({ error: 'No autorizado' }), { status: 401, headers: jsonHeaders });
    }

    try {
        await ensureFiscalSchema(db);
        const url = new URL(request.url);
        const cajaIdParam = url.searchParams.get('id');

        const tasas = await obtenerTasasActuales();

        // Si piden el detalle de una caja específica (para ver/imprimir su Reporte Z)
        if (cajaIdParam) {
            const espRes = await db.execute('SELECT * FROM cajas WHERE id = ?', [cajaIdParam]);
            if (!espRes.rows?.length) {
                return new Response(JSON.stringify({ error: 'Caja o Reporte Z no encontrado' }), { status: 404, headers: jsonHeaders });
            }
            const cajaEsp = espRes.rows[0];
            const metricas = await calcularMetricasCaja(cajaEsp, tasas);
            return new Response(JSON.stringify({ caja: cajaEsp, metricas, tasas }), { status: 200, headers: jsonHeaders });
        }

        // Buscar si hay una caja abierta actualmente
        const abiertaRes = await db.execute("SELECT * FROM cajas WHERE estado = 'abierta' ORDER BY fecha_apertura DESC, hora_apertura DESC LIMIT 1");
        const cajaAbierta = abiertaRes.rows?.[0] || null;
        let corteX = null;

        if (cajaAbierta) {
            corteX = await calcularMetricasCaja(cajaAbierta, tasas);
        }

        // Historial de cierres Z
        const historialRes = await db.execute(
            "SELECT * FROM cajas WHERE estado = 'cerrada' ORDER BY nro_reporte_z DESC, fecha_cierre DESC, hora_cierre DESC LIMIT 30"
        );

        return new Response(
            JSON.stringify({
                abierta: Boolean(cajaAbierta),
                cajaAbierta,
                corteX,
                historialZ: historialRes.rows || [],
                tasas,
            }),
            { status: 200, headers: jsonHeaders }
        );
    } catch (error) {
        console.error('Error consultando estado de caja:', error);
        return new Response(JSON.stringify({ error: 'Error al consultar la caja' }), { status: 500, headers: jsonHeaders });
    }
}

export async function POST({ request }) {
    const usuario = verificarToken(request);
    if (!usuario) {
        return new Response(JSON.stringify({ error: 'No autorizado' }), { status: 401, headers: jsonHeaders });
    }

    try {
        await ensureFiscalSchema(db);
        const body = await request.json();
        const accion = String(body.accion || '').toLowerCase();
        const { fecha, hora } = fechaHoraVenezuela();
        const usuarioNombre = usuario.nombre || usuario.usuario || 'Usuario';
        const tasas = await obtenerTasasActuales();

        if (accion === 'abrir') {
            const abiertaRes = await db.execute("SELECT id FROM cajas WHERE estado = 'abierta' LIMIT 1");
            if (abiertaRes.rows?.length > 0) {
                return new Response(JSON.stringify({ error: 'Ya existe una caja abierta actualmente.' }), { status: 409, headers: jsonHeaders });
            }

            const montoUsd = Math.max(0, Number(String(body.monto_apertura_usd ?? 0).replace(',', '.')) || 0);
            const montoCop = Math.max(0, Number(String(body.monto_apertura_cop ?? 0).replace(',', '.')) || 0);
            const montoBs = Math.max(0, Number(String(body.monto_apertura_bs ?? 0).replace(',', '.')) || 0);
            const observaciones = String(body.observaciones || '').trim();

            const insertRes = await db.execute({
                sql: `
                    INSERT INTO cajas (
                        fecha_apertura, hora_apertura, usuario_apertura_id, usuario_apertura_nombre,
                        monto_apertura_usd, monto_apertura_cop, monto_apertura_bs, observaciones, estado
                    ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, 'abierta')
                    RETURNING *
                `,
                args: [fecha, hora, String(usuario.id), usuarioNombre, montoUsd, montoCop, montoBs, observaciones],
            });

            const nuevaCaja = insertRes.rows[0];

            // Vincular ventas del día de hoy que no tuvieran caja asignada
            await db.execute({
                sql: `UPDATE ventas SET caja_id = ? WHERE caja_id IS NULL AND fecha = ?`,
                args: [nuevaCaja.id, fecha],
            });

            await registrarBitacora(db, {
                usuario,
                accion: ACCIONES.CAJA_APERTURA,
                entidad: 'cajas',
                entidadId: nuevaCaja.id,
                detalle: `Apertura de caja · Fondo USD $${montoUsd.toFixed(2)} · COP ${montoCop} · Bs ${montoBs.toFixed(2)}`,
            });

            return new Response(
                JSON.stringify({
                    message: 'Caja abierta exitosamente',
                    caja: nuevaCaja,
                }),
                { status: 201, headers: jsonHeaders }
            );
        }

        if (accion === 'cerrar') {
            const abiertaRes = await db.execute("SELECT * FROM cajas WHERE estado = 'abierta' ORDER BY fecha_apertura DESC, hora_apertura DESC LIMIT 1");
            if (!abiertaRes.rows?.length) {
                return new Response(JSON.stringify({ error: 'No hay ninguna caja abierta para cerrar.' }), { status: 400, headers: jsonHeaders });
            }

            const cajaActual = abiertaRes.rows[0];
            const metricas = await calcularMetricasCaja(cajaActual, tasas);

            const maxZRes = await db.execute('SELECT COALESCE(MAX(nro_reporte_z), 0) AS max_z FROM cajas');
            const nroReporteZ = (Number(maxZRes.rows?.[0]?.max_z) || 0) + 1;
            const observacionesCierre = body.observaciones
                ? `${cajaActual.observaciones ? cajaActual.observaciones + ' | ' : ''}${String(body.observaciones).trim()}`
                : (cajaActual.observaciones || '');

            await db.execute({
                sql: `
                    UPDATE cajas SET
                        nro_reporte_z = ?,
                        fecha_cierre = ?,
                        hora_cierre = ?,
                        usuario_cierre_id = ?,
                        usuario_cierre_nombre = ?,
                        tasa_bcv_cierre = ?,
                        tasa_cop_cierre = ?,
                        total_ventas_contado = ?,
                        total_ventas_credito = ?,
                        base_imponible_usd = ?,
                        base_imponible_bs = ?,
                        exento_usd = ?,
                        exento_bs = ?,
                        iva_usd = ?,
                        iva_bs = ?,
                        retencion_iva_usd = ?,
                        retencion_iva_bs = ?,
                        total_facturado_usd = ?,
                        total_facturado_bs = ?,
                        total_devoluciones_usd = ?,
                        total_devoluciones_bs = ?,
                        cantidad_facturas = ?,
                        primera_factura = ?,
                        ultima_factura = ?,
                        cantidad_notas_entrega = ?,
                        total_notas_entrega_usd = ?,
                        observaciones = ?,
                        estado = 'cerrada'
                    WHERE id = ?
                `,
                args: [
                    nroReporteZ,
                    fecha,
                    hora,
                    String(usuario.id),
                    usuarioNombre,
                    metricas.tasa_bcv,
                    metricas.tasa_cop,
                    metricas.total_ventas_contado,
                    metricas.total_ventas_credito,
                    metricas.base_imponible_usd,
                    metricas.base_imponible_bs,
                    metricas.exento_usd,
                    metricas.exento_bs,
                    metricas.iva_usd,
                    metricas.iva_bs,
                    metricas.retencion_iva_usd,
                    metricas.retencion_iva_bs,
                    metricas.total_facturado_usd,
                    metricas.total_facturado_bs,
                    metricas.total_devoluciones_usd,
                    metricas.total_devoluciones_bs,
                    metricas.cantidad_facturas,
                    metricas.primera_factura,
                    metricas.ultima_factura,
                    metricas.cantidad_notas_entrega,
                    metricas.total_notas_entrega_usd,
                    observacionesCierre,
                    cajaActual.id,
                ],
            });

            const cerradaRes = await db.execute('SELECT * FROM cajas WHERE id = ?', [cajaActual.id]);
            const cajaCerrada = cerradaRes.rows?.[0];

            await registrarBitacora(db, {
                usuario,
                accion: ACCIONES.CAJA_CIERRE,
                entidad: 'cajas',
                entidadId: cajaActual.id,
                detalle: `Cierre de caja · Reporte Z #${String(nroReporteZ).padStart(4, '0')} · Facturas: ${metricas.cantidad_facturas} · Total Bs ${metricas.total_facturado_bs.toFixed(2)} ($${metricas.total_facturado_usd.toFixed(2)})`,
            });

            return new Response(
                JSON.stringify({
                    message: `Caja cerrada. Reporte Z #${String(nroReporteZ).padStart(4, '0')} generado.`,
                    caja: cajaCerrada,
                    metricas,
                    tasas,
                }),
                { status: 200, headers: jsonHeaders }
            );
        }

        return new Response(JSON.stringify({ error: 'Acción de caja no válida' }), { status: 400, headers: jsonHeaders });
    } catch (error) {
        console.error('Error procesando operación de caja:', error);
        return new Response(JSON.stringify({ error: 'Error al procesar operación de caja' }), { status: 500, headers: jsonHeaders });
    }
}

