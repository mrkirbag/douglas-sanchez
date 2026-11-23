import { db } from '../db';
import { verificarToken } from '@/utils/auth';
import { executeInTx, withTransaction } from '@/utils/dbTransaction';
import {
    parsearItemVenta,
    verificarProductoDisponible,
    descontarStock,
    insertarDetalleVenta,
    normalizarId,
} from '@/utils/ventaValidaciones';
import { formatearMoneda, obtenerMonedaBase } from '@/utils/helpers/tasas.js';
import { validarPagosVenta } from '@/utils/helpers/metodosPago.js';
import { ACCIONES, registrarBitacoraEnTx } from '@/utils/bitacora.js';
import { fechaHoraVenezuela } from '@/utils/helpers/formateoFecha.js';
import { ensureFiscalSchema } from '@/utils/ensureFiscalSchema.js';

const jsonHeaders = { 'Content-Type': 'application/json' };

async function tasasDelDia() {
    const result = await db.execute('SELECT * FROM tasa WHERE id = 1');
    const row = result.rows?.[0];
    return {
        cop: Number(row?.valor) || 0,
        bs: Number(row?.bs) || 0,
        iva_porcentaje: row?.iva_porcentaje !== undefined ? Number(row.iva_porcentaje) : 16,
        retencion_iva_porcentaje: row?.retencion_iva_porcentaje !== undefined ? Number(row.retencion_iva_porcentaje) : 75,
    };
}

function idClienteValido(valor) {
    if (!valor) return null;
    return String(valor).trim() || null;
}

export async function POST({ request }) {
    const usuario = verificarToken(request);
    if (!usuario) {
        return new Response(JSON.stringify({ error: 'No autorizado' }), { status: 401, headers: jsonHeaders });
    }

    try {
        await ensureFiscalSchema(db);

        // Validar que exista una caja abierta en el turno
        const cajaAbiertaRes = await db.execute(
            "SELECT id FROM cajas WHERE estado = 'abierta' ORDER BY fecha_apertura DESC, hora_apertura DESC LIMIT 1"
        );
        const cajaAbierta = cajaAbiertaRes.rows?.[0];
        if (!cajaAbierta) {
            return new Response(
                JSON.stringify({
                    error: 'No hay una caja abierta actualmente. Debes realizar la Apertura de Caja antes de facturar ventas.',
                    requiereAperturaCaja: true,
                }),
                { status: 409, headers: jsonHeaders }
            );
        }

        const body = await request.json();
        const {
            fecha,
            tipoPago,
            productos,
            pagos,
            retencion_iva_porcentaje: retencionBody,
            comprobante_retencion = '',
            tiene_flete = false,
            flete_monto: fleteBody = 0,
        } = body;
        const tipoDocumento = body.tipo_documento === 'nota_entrega' ? 'nota_entrega' : 'factura';
        const esNotaEntrega = tipoDocumento === 'nota_entrega';
        const clienteId = idClienteValido(body.clienteId);

        const fleteParseado = Number(String(fleteBody ?? 0).replace(',', '.'));
        if (tiene_flete && (!Number.isFinite(fleteParseado) || fleteParseado <= 0)) {
            return new Response(
                JSON.stringify({ error: 'Si marcas el campo de flete, debes ingresar un monto válido mayor a 0.' }),
                { status: 400, headers: jsonHeaders }
            );
        }
        const fleteFinal = tiene_flete ? +(fleteParseado.toFixed(4)) : (Number.isFinite(fleteParseado) && fleteParseado > 0 ? +(fleteParseado.toFixed(4)) : 0);

        if (!fecha || !clienteId || !tipoPago) {
            return new Response(JSON.stringify({ error: 'Faltan datos de la venta' }), { status: 400, headers: jsonHeaders });
        }

        if (!Array.isArray(productos) || productos.length === 0) {
            return new Response(JSON.stringify({ error: 'La venta debe incluir al menos un producto' }), { status: 400, headers: jsonHeaders });
        }

        if (tipoPago !== 'credito' && tipoPago !== 'contado') {
            return new Response(JSON.stringify({ error: 'Tipo de pago inválido' }), { status: 400, headers: jsonHeaders });
        }

        const tasas = await tasasDelDia();
        const ivaPorcentaje = esNotaEntrega
            ? 0
            : (body.iva_porcentaje !== undefined ? Number(body.iva_porcentaje) : tasas.iva_porcentaje);
        const retencionIvaPorcentaje = esNotaEntrega
            ? 0
            : Math.max(0, Math.min(100, Number(retencionBody) || 0));

        const itemsParseados = [];
        let subtotalBase = 0;
        let subtotalExento = 0;
        let totalDivisas = 0;

        for (const producto of productos) {
            const parsed = parsearItemVenta(producto, ivaPorcentaje);
            if (!parsed.ok) {
                return new Response(JSON.stringify({ error: parsed.error }), { status: 400, headers: jsonHeaders });
            }
            const it = parsed.item;
            const cant = parseFloat(it.cantidad);
            const pBcv = parseFloat(it.precio);
            const pDiv = parseFloat(it.precio_divisas);

            if (esNotaEntrega) {
                // En Nota de Entrega (Divisas): se calcula según precio_divisas sin IVA ni retenciones
                it.precio = +pDiv.toFixed(4);
                it.exento_iva = 0;
                it.alicuota_iva = 0;
                it.monto_iva = 0;
                subtotalBase += pDiv * cant;
                totalDivisas += pDiv * cant;
            } else {
                // En Factura Fiscal (Bs / BCV): se calcula según precio_bcv + IVA
                if (it.exento_iva) {
                    subtotalExento += pBcv * cant;
                } else {
                    subtotalBase += pBcv * cant;
                }
                totalDivisas += pDiv * cant;
            }
            itemsParseados.push(it);
        }

        subtotalBase = +(subtotalBase.toFixed(4));
        subtotalExento = +(subtotalExento.toFixed(4));
        totalDivisas = +(totalDivisas.toFixed(4));

        const ivaMonto = esNotaEntrega ? 0 : +(subtotalBase * (ivaPorcentaje / 100)).toFixed(4);
        const retencionIvaMonto = esNotaEntrega ? 0 : +(ivaMonto * (retencionIvaPorcentaje / 100)).toFixed(4);
        const totalCalculado = esNotaEntrega
            ? totalDivisas
            : +(subtotalBase + subtotalExento + ivaMonto - retencionIvaMonto).toFixed(4);

        if (totalCalculado <= 0) {
            return new Response(JSON.stringify({ error: 'El total de la venta debe ser mayor a cero' }), { status: 400, headers: jsonHeaders });
        }

        const monedaBaseVenta = obtenerMonedaBase() === 'COP'
            ? (esNotaEntrega ? 'COP' : 'BS')
            : 'USD';

        const pagosValidados = validarPagosVenta({
            tipoPago,
            pagos,
            totalBase: totalCalculado,
            monedaBase: monedaBaseVenta,
            tasas,
            soloDivisas: esNotaEntrega,
        });

        if (!pagosValidados.ok) {
            return new Response(JSON.stringify({ error: pagosValidados.error }), { status: 400, headers: jsonHeaders });
        }

        const resultadoTx = await withTransaction(db, async (tx) => {
            const cliente = await executeInTx(
                tx,
                `SELECT id, estatus FROM clientes WHERE id = ?`,
                [clienteId]
            );

            const filaCliente = cliente.rows?.[0];
            if (!filaCliente) {
                throw Object.assign(new Error('Cliente no encontrado o inactivo'), { status: 404 });
            }

            const estatus = String(filaCliente.estatus || 'activo').toLowerCase();
            if (estatus === 'inactivo') {
                await executeInTx(
                    tx,
                    'UPDATE clientes SET estatus = ? WHERE id = ?',
                    ['activo', clienteId]
                );
            }

            const stockPorCodigo = new Map();
            for (const item of itemsParseados) {
                const acumulado = (stockPorCodigo.get(item.codigo) ?? 0) + parseFloat(item.cantidad);
                stockPorCodigo.set(item.codigo, acumulado);
            }

            for (const [codigo, cantidadTotal] of stockPorCodigo) {
                const disponible = await verificarProductoDisponible(tx, codigo, cantidadTotal);
                if (!disponible.ok) {
                    throw Object.assign(new Error(disponible.error), { status: 409 });
                }
            }

            let nroFactura = null;
            let nroNotaEntrega = null;
            let etiquetaDoc = '';

            if (esNotaEntrega) {
                const proxNotaRes = await executeInTx(
                    tx,
                    'SELECT COALESCE(MAX(nro_nota_entrega), 0) + 1 AS prox FROM ventas',
                    []
                );
                nroNotaEntrega = Number(proxNotaRes.rows?.[0]?.prox) || 1;
                etiquetaDoc = `Nota de Entrega #NE-${String(nroNotaEntrega).padStart(6, '0')}`;
            } else {
                const proxFactRes = await executeInTx(
                    tx,
                    'SELECT COALESCE(MAX(nro_factura), 0) + 1 AS prox FROM ventas',
                    []
                );
                nroFactura = Number(proxFactRes.rows?.[0]?.prox) || 1;
                etiquetaDoc = `Factura Fiscal #${String(nroFactura).padStart(6, '0')}`;
            }

            const estado = tipoPago === 'credito' ? 'pendiente' : 'completado';

            const ventaResult = await executeInTx(
                tx,
                `INSERT INTO ventas (
                    tipo_documento, nro_factura, nro_nota_entrega, caja_id, fecha, cliente_id,
                    subtotal_base, subtotal_exento, iva_porcentaje, iva_monto,
                    retencion_iva_porcentaje, retencion_iva_monto, comprobante_retencion,
                    total_divisas, tasa_bcv, tasa_cop, total, flete_monto, estado, tipo_pago
                ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?) RETURNING id`,
                [
                    tipoDocumento,
                    nroFactura,
                    nroNotaEntrega,
                    cajaAbierta.id,
                    fecha,
                    clienteId,
                    subtotalBase,
                    subtotalExento,
                    ivaPorcentaje,
                    ivaMonto,
                    retencionIvaPorcentaje,
                    retencionIvaMonto,
                    esNotaEntrega ? '' : String(comprobante_retencion || '').trim(),
                    totalDivisas,
                    tasas.bs,
                    tasas.cop,
                    totalCalculado,
                    fleteFinal,
                    estado,
                    tipoPago,
                ]
            );

            const idVenta = normalizarId(ventaResult.rows[0].id);

            if (tipoPago === 'credito') {
                await executeInTx(
                    tx,
                    'INSERT INTO creditos (id_venta, saldo_pendiente) VALUES (?, ?)',
                    [idVenta, totalCalculado]
                );
            }

            for (const pago of pagosValidados.pagos) {
                await executeInTx(
                    tx,
                    `INSERT INTO pagos_venta
                        (id_venta, moneda, metodo, monto, monto_base, moneda_base, tasa_cop, tasa_bs)
                        VALUES (?, ?, ?, ?, ?, ?, ?, ?)`,
                    [
                        idVenta,
                        pago.moneda,
                        pago.metodo,
                        pago.monto,
                        pago.monto_base,
                        pago.moneda_base,
                        pago.tasa_cop,
                        pago.tasa_bs,
                    ]
                );

                if (pago.metodo === 'nota_credito') {
                    let restante = pago.monto_base;
                    const notasResult = await executeInTx(
                        tx,
                        `SELECT id, saldo_disponible
                         FROM devoluciones
                         WHERE cliente_id = ?
                           AND tipo_resolucion = 'NOTA_CREDITO'
                           AND saldo_disponible > 0
                         ORDER BY fecha_creacion ASC`,
                        [clienteId]
                    );

                    for (const nota of (notasResult.rows || [])) {
                        if (restante <= 0) break;
                        const saldoNota = Number(nota.saldo_disponible);
                        const consumir = Math.min(saldoNota, restante);
                        const nuevoSaldo = +(saldoNota - consumir).toFixed(4);
                        
                        await executeInTx(
                            tx,
                            'UPDATE devoluciones SET saldo_disponible = ? WHERE id = ?',
                            [nuevoSaldo, nota.id]
                        );
                        restante = +(restante - consumir).toFixed(4);
                    }

                    if (restante > 0.01) {
                        throw Object.assign(new Error(`El cliente no tiene saldo suficiente en notas de crédito (faltan ${restante.toFixed(4)} USD)`), { status: 400 });
                    }
                }
            }

            const { fecha: fechaMov, hora: horaMov } = fechaHoraVenezuela();
            const usuarioNombre = usuario.nombre || usuario.usuario || 'Usuario';

            for (const item of itemsParseados) {
                await insertarDetalleVenta(tx, idVenta, item);
                const { stockAntes, stockDespues } = await descontarStock(tx, item.codigo, item.cantidad);

                await executeInTx(
                    tx,
                    `INSERT INTO movimientos_inventario (
                        producto_id, codigo_producto, nombre_producto, tipo, cantidad,
                        stock_antes, stock_despues, motivo, usuario_id, usuario_nombre, fecha, hora
                    ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
                    [
                        item.productoId,
                        item.codigo,
                        item.nombre,
                        'salida',
                        item.cantidad,
                        stockAntes,
                        stockDespues,
                        `${etiquetaDoc} (Venta #${idVenta})`,
                        usuario.id,
                        usuarioNombre,
                        fechaMov,
                        horaMov,
                    ]
                );
                
                if (item.seriales && item.seriales.length > 0) {
                    for (const serial of item.seriales) {
                        await executeInTx(tx, 
                            `UPDATE seriales SET estado = 'vendido', id_venta = ? WHERE serial = ? AND producto_id = ?`,
                            [idVenta, serial, item.productoId]
                        );
                    }
                }
            }

            const monedaBitacora = esNotaEntrega
                ? obtenerMonedaBase()
                : (obtenerMonedaBase() === 'COP' ? 'BS' : 'USD');
            await registrarBitacoraEnTx(tx, {
                usuario,
                accion: tipoPago === 'credito' ? ACCIONES.CREDITO : ACCIONES.VENTA,
                entidad: 'ventas',
                entidadId: idVenta,
                detalle: esNotaEntrega
                    ? `${etiquetaDoc} (Sin IVA) · ${tipoPago} · Total ${formatearMoneda(totalCalculado, monedaBitacora)}`
                    : `${etiquetaDoc} (Fiscal) · ${tipoPago} · Base ${formatearMoneda(subtotalBase, monedaBitacora)} · IVA ${formatearMoneda(ivaMonto, monedaBitacora)} · Total ${formatearMoneda(totalCalculado, monedaBitacora)}`,
            });

            return { ventaId: idVenta, nroFactura, nroNotaEntrega, tipoDocumento };
        });

        return new Response(
            JSON.stringify({
                message: esNotaEntrega
                    ? 'Nota de Entrega registrada exitosamente'
                    : 'Factura Fiscal registrada exitosamente',
                ventaId: resultadoTx.ventaId,
                nroFactura: resultadoTx.nroFactura,
                nroNotaEntrega: resultadoTx.nroNotaEntrega,
                tipoDocumento: resultadoTx.tipoDocumento,
            }),
            { status: 201, headers: jsonHeaders }
        );
    } catch (error) {
        const status = error.status ?? 500;
        const message = status === 500 ? 'Error al registrar la venta' : error.message;

        if (status === 500) {
            console.error('Error registrando venta completa:', error);
        }

        return new Response(JSON.stringify({ error: message }), { status, headers: jsonHeaders });
    }
}
