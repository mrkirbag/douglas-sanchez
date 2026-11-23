import { db } from '../db';
import { verificarToken } from '@/utils/auth';
import { executeInTx, withTransaction } from '@/utils/dbTransaction';
import { insertarDetalleVenta, normalizarId } from '@/utils/ventaValidaciones';
import { ACCIONES, registrarBitacoraEnTx } from '@/utils/bitacora.js';
import { fechaHoraVenezuela } from '@/utils/helpers/formateoFecha.js';
import { ensureFiscalSchema } from '@/utils/ensureFiscalSchema.js';
import { formatearMoneda, obtenerMonedaBase } from '@/utils/helpers/tasas.js';

const jsonHeaders = { 'Content-Type': 'application/json' };

/**
 * Convierte una Nota de Entrega existente en Factura Fiscal sin volver a descontar stock
 * ni duplicar ingresos en caja/créditos.
 */
export async function POST({ request }) {
    const usuario = verificarToken(request);
    if (!usuario) {
        return new Response(JSON.stringify({ error: 'No autorizado' }), { status: 401, headers: jsonHeaders });
    }

    try {
        await ensureFiscalSchema(db);

        const cajaAbiertaRes = await db.execute(
            "SELECT id FROM cajas WHERE estado = 'abierta' ORDER BY fecha_apertura DESC, hora_apertura DESC LIMIT 1"
        );
        const cajaAbierta = cajaAbiertaRes.rows?.[0];
        if (!cajaAbierta) {
            return new Response(
                JSON.stringify({
                    error: 'No hay una caja abierta actualmente. Debes abrir la caja antes de emitir la factura fiscal.',
                    requiereAperturaCaja: true,
                }),
                { status: 409, headers: jsonHeaders }
            );
        }

        const body = await request.json();
        const notaEntregaId = body?.notaEntregaId ? String(body.notaEntregaId).trim() : '';
        if (!notaEntregaId) {
            return new Response(JSON.stringify({ error: 'Falta el ID de la nota de entrega' }), { status: 400, headers: jsonHeaders });
        }

        const retencionIvaPorcentaje = Math.max(0, Math.min(100, Number(body.retencion_iva_porcentaje) || 0));
        const comprobanteRetencion = String(body.comprobante_retencion || '').trim();

        const tasaRow = (await db.execute('SELECT * FROM tasa WHERE id = 1')).rows?.[0] || {};
        const tasaBcv = Number(tasaRow.bs) || 0;
        const tasaCop = Number(tasaRow.valor) || 0;
        const tasaCopBs = Number(tasaRow.cop_a_bs) || 3;
        const ivaPorcentaje = tasaRow.iva_porcentaje !== undefined ? Number(tasaRow.iva_porcentaje) : 16;
        const { fecha: fechaHoy } = fechaHoraVenezuela();

        const resultado = await withTransaction(db, async (tx) => {
            const notaRes = await executeInTx(
                tx,
                `SELECT * FROM ventas WHERE id = ?`,
                [notaEntregaId]
            );
            const nota = notaRes.rows?.[0];
            if (!nota) {
                throw Object.assign(new Error('Nota de entrega no encontrada'), { status: 404 });
            }
            if (nota.tipo_documento !== 'nota_entrega') {
                throw Object.assign(new Error('El documento seleccionado ya es una factura fiscal'), { status: 400 });
            }
            if (nota.facturada_en_venta_id) {
                throw Object.assign(new Error('Esta nota de entrega ya fue convertida a factura fiscal'), { status: 409 });
            }
            const estadoNorm = String(nota.estado || '').toLowerCase();
            if (['anulado', 'anulada', 'cancelado', 'cancelada', 'devuelto'].includes(estadoNorm)) {
                throw Object.assign(new Error(`No se puede facturar una nota de entrega en estado "${nota.estado}"`), { status: 409 });
            }

            const detallesRes = await executeInTx(
                tx,
                `SELECT dv.*, p.precio_bcv AS prod_precio_bcv, p.venta AS prod_venta, p.exento_iva AS prod_exento
                 FROM detalle_venta dv
                 LEFT JOIN productos p ON p.id = dv.producto_id
                 WHERE dv.id_venta = ?`,
                [notaEntregaId]
            );
            const detalles = detallesRes.rows || [];
            if (detalles.length === 0) {
                throw Object.assign(new Error('La nota de entrega no tiene productos asociados'), { status: 400 });
            }

            let subtotalBase = 0;
            let subtotalExento = 0;
            let totalDivisas = 0;
            const itemsFactura = [];

            for (const d of detalles) {
                const cantidad = Number(d.cantidad) || 0;
                const precioDiv = Number(d.precio_divisas) > 0 ? Number(d.precio_divisas) : Number(d.precio_unitario) || 0;
                const fallbackBcv = obtenerMonedaBase() === 'COP' && tasaCopBs > 0
                    ? +(precioDiv / tasaCopBs).toFixed(2)
                    : precioDiv;
                const precioBcv = Number(d.prod_precio_bcv) > 0
                    ? Number(d.prod_precio_bcv)
                    : (Number(d.prod_venta) > 0 && obtenerMonedaBase() !== 'COP' ? Number(d.prod_venta) : fallbackBcv);
                const exentoIva = Number(d.prod_exento) === 1 ? 1 : 0;
                const alicuota = exentoIva ? 0 : ivaPorcentaje;
                const montoIvaItem = exentoIva ? 0 : +((precioBcv * cantidad) * (ivaPorcentaje / 100)).toFixed(4);

                if (exentoIva) {
                    subtotalExento += precioBcv * cantidad;
                } else {
                    subtotalBase += precioBcv * cantidad;
                }
                totalDivisas += precioDiv * cantidad;

                itemsFactura.push({
                    productoId: d.producto_id,
                    codigo: d.codigo_producto,
                    nombre: d.nombre_producto,
                    precio: precioBcv.toFixed(4),
                    precio_divisas: precioDiv.toFixed(4),
                    exento_iva: exentoIva,
                    alicuota_iva: alicuota,
                    monto_iva: montoIvaItem,
                    cantidad,
                });
            }

            subtotalBase = +(subtotalBase.toFixed(4));
            subtotalExento = +(subtotalExento.toFixed(4));
            totalDivisas = +(totalDivisas.toFixed(4));

            const ivaMonto = +(subtotalBase * (ivaPorcentaje / 100)).toFixed(4);
            const retencionIvaMonto = +(ivaMonto * (retencionIvaPorcentaje / 100)).toFixed(4);
            const totalCalculado = +(subtotalBase + subtotalExento + ivaMonto - retencionIvaMonto).toFixed(4);

            const proxFactRes = await executeInTx(
                tx,
                'SELECT COALESCE(MAX(nro_factura), 0) + 1 AS prox FROM ventas',
                []
            );
            const nroFactura = Number(proxFactRes.rows?.[0]?.prox) || 1;

            const insertRes = await executeInTx(
                tx,
                `INSERT INTO ventas (
                    tipo_documento, nro_factura, nro_nota_entrega, caja_id, fecha, cliente_id,
                    subtotal_base, subtotal_exento, iva_porcentaje, iva_monto,
                    retencion_iva_porcentaje, retencion_iva_monto, comprobante_retencion,
                    total_divisas, tasa_bcv, tasa_cop, total, estado, tipo_pago, nota_entrega_origen_id
                ) VALUES ('factura', ?, NULL, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?) RETURNING id`,
                [
                    nroFactura,
                    cajaAbierta.id,
                    fechaHoy,
                    nota.cliente_id,
                    subtotalBase,
                    subtotalExento,
                    ivaPorcentaje,
                    ivaMonto,
                    retencionIvaPorcentaje,
                    retencionIvaMonto,
                    comprobanteRetencion,
                    totalDivisas,
                    tasaBcv,
                    tasaCop,
                    totalCalculado,
                    nota.estado,
                    nota.tipo_pago,
                    notaEntregaId,
                ]
            );

            const facturaId = normalizarId(insertRes.rows[0].id);

            for (const item of itemsFactura) {
                await insertarDetalleVenta(tx, facturaId, item);
            }

            await executeInTx(
                tx,
                `UPDATE ventas SET facturada_en_venta_id = ? WHERE id = ?`,
                [facturaId, notaEntregaId]
            );

            const etiquetaNe = `NE-${String(nota.nro_nota_entrega || 1).padStart(6, '0')}`;
            const etiquetaFact = `#${String(nroFactura).padStart(6, '0')}`;

            const monedaBitacora = obtenerMonedaBase() === 'COP' ? 'BS' : 'USD';
            await registrarBitacoraEnTx(tx, {
                usuario,
                accion: ACCIONES.VENTA_CREAR,
                entidad: 'ventas',
                entidadId: facturaId,
                detalle: `Facturación de Nota de Entrega ${etiquetaNe} → Factura Fiscal ${etiquetaFact} · Total: ${formatearMoneda(totalCalculado, monedaBitacora)} (sin descuento de stock)`,
            });

            return {
                facturaId,
                nroFactura,
                nroNotaEntrega: nota.nro_nota_entrega,
                total: totalCalculado,
            };
        });

        return new Response(
            JSON.stringify({
                ok: true,
                message: `Factura Fiscal #${String(resultado.nroFactura).padStart(6, '0')} generada desde Nota de Entrega.`,
                ...resultado,
            }),
            { status: 201, headers: jsonHeaders }
        );
    } catch (error) {
        console.error('Error facturando nota de entrega:', error);
        const status = error?.status || 500;
        return new Response(
            JSON.stringify({ error: error?.message || 'Error al convertir la nota de entrega en factura' }),
            { status, headers: jsonHeaders }
        );
    }
}

