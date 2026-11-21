import { db } from '../db';
import { verificarToken } from '@/utils/auth';
import { withTransaction, executeInTx } from '@/utils/dbTransaction';
import { ensureFiscalSchema } from '@/utils/ensureFiscalSchema.js';
import { fechaHoraVenezuela } from '@/utils/helpers/formateoFecha.js';
import { ACCIONES, registrarBitacoraEnTx } from '@/utils/bitacora.js';
import xlsx from 'xlsx';

const jsonHeaders = { 'Content-Type': 'application/json' };

function normalizarClave(clave) {
    return String(clave || '')
        .normalize('NFD')
        .replace(/[\u0300-\u036f]/g, '')
        .toLowerCase()
        .replace(/[^a-z0-9]+/g, '_')
        .replace(/^_+|_+$/g, '');
}

function normalizarFila(filaRaw) {
    const out = {};
    for (const [k, v] of Object.entries(filaRaw || {})) {
        const nk = normalizarClave(k);
        if (nk) out[nk] = v;
    }
    return out;
}

function tomarValor(fila, claves, fallback = undefined) {
    for (const c of claves) {
        if (fila[c] !== undefined && fila[c] !== null && String(fila[c]).trim() !== '') {
            return fila[c];
        }
    }
    return fallback;
}

function parsearNumero(val, fallback = 0) {
    if (typeof val === 'number') return Number.isFinite(val) ? val : fallback;
    const limpio = String(val ?? '')
        .replace(/\s+/g, '')
        .replace(/,/g, '.');
    const n = Number(limpio);
    return Number.isFinite(n) ? n : fallback;
}

function parsearExento(val) {
    if (typeof val === 'boolean') return val ? 1 : 0;
    if (typeof val === 'number') return val === 1 ? 1 : 0;
    const txt = String(val ?? '')
        .normalize('NFD')
        .replace(/[\u0300-\u036f]/g, '')
        .trim()
        .toUpperCase();
    return ['SI', 'S', '1', 'TRUE', 'EXENTO', 'E', 'YES'].includes(txt) ? 1 : 0;
}

export async function POST({ request }) {
    const usuario = await verificarToken(request);
    if (!usuario) {
        return new Response(JSON.stringify({ error: 'No autorizado' }), { status: 401, headers: jsonHeaders });
    }
    if (usuario.rol !== 'admin') {
        return new Response(JSON.stringify({ error: 'Acceso denegado' }), { status: 403, headers: jsonHeaders });
    }

    try {
        await ensureFiscalSchema(db);

        const formData = await request.formData();
        const archivo = formData.get('archivo');
        const proveedor = String(formData.get('proveedor') || '').trim() || 'Carga Masiva Excel';
        const proveedorRif = String(formData.get('proveedor_rif') || '').trim().toUpperCase();
        const tipoDocumento = formData.get('tipo_documento') === 'factura' ? 'factura' : 'nota_entrega';
        const esNotaEntrega = tipoDocumento === 'nota_entrega';
        const nroFactura = String(formData.get('nro_factura') || '').trim();
        const nroControl = String(formData.get('nro_control') || '').trim();
        const retencionPorc = esNotaEntrega
            ? 0
            : Math.max(0, Math.min(100, Number(formData.get('retencion_iva_porcentaje')) || 0));
        const comprobanteRetencion = esNotaEntrega ? '' : String(formData.get('comprobante_retencion') || '').trim();

        if (!esNotaEntrega && !nroFactura) {
            return new Response(
                JSON.stringify({ error: 'El N° de Factura es obligatorio cuando se importa como Factura Fiscal' }),
                { status: 400, headers: jsonHeaders }
            );
        }

        if (!archivo || typeof archivo === 'string') {
            return new Response(JSON.stringify({ error: 'Archivo Excel no recibido' }), { status: 400, headers: jsonHeaders });
        }

        const buffer = await archivo.arrayBuffer();
        const workbook = xlsx.read(buffer);
        const primeraHoja = workbook.SheetNames?.[0];
        if (!primeraHoja) {
            return new Response(JSON.stringify({ error: 'El archivo Excel no contiene hojas' }), { status: 400, headers: jsonHeaders });
        }

        const sheet = workbook.Sheets[primeraHoja];
        const filasRaw = xlsx.utils.sheet_to_json(sheet, { defval: '' });
        if (!Array.isArray(filasRaw) || filasRaw.length === 0) {
            return new Response(JSON.stringify({ error: 'La hoja de Excel está vacía' }), { status: 400, headers: jsonHeaders });
        }

        const tasaRes = await db.execute('SELECT bs, iva_porcentaje FROM tasa WHERE id = 1');
        const tasaRow = tasaRes.rows?.[0] || {};
        const tasaBcv = Number(tasaRow.bs) || 0;
        const ivaPorcentaje = esNotaEntrega
            ? 0
            : (tasaRow.iva_porcentaje !== undefined ? Number(tasaRow.iva_porcentaje) : 16);

        const { fecha, hora } = fechaHoraVenezuela();

        const itemsParseados = [];
        let omitidos = 0;

        for (const raw of filasRaw) {
            const fila = normalizarFila(raw);
            const codigoRaw = tomarValor(fila, ['codigo', 'cod', 'sku', 'codigo_producto']);
            const nombreRaw = tomarValor(fila, ['nombre', 'descripcion', 'producto', 'nombre_producto']);

            const codigo = codigoRaw !== undefined ? String(codigoRaw).trim().toUpperCase() : '';
            const nombre = nombreRaw !== undefined ? String(nombreRaw).trim() : '';

            if (!codigo || !nombre) {
                omitidos += 1;
                continue;
            }

            const cantidad = parsearNumero(tomarValor(fila, ['cantidad', 'stock', 'cant', 'unidades'], 0), 0);
            const costo = parsearNumero(tomarValor(fila, ['costo_usd', 'costo', 'costo_unitario', 'precio_costo'], 0), 0);
            const precioDivisas = parsearNumero(
                tomarValor(fila, ['precio_divisas_usd', 'precio_divisas', 'divisas', 'precio_usd', 'venta'], 0),
                0
            );
            const precioBcv = parsearNumero(
                tomarValor(fila, ['precio_bcv_usd', 'precio_bcv', 'bcv', 'venta'], precioDivisas),
                precioDivisas
            );
            const unidadMedida = String(tomarValor(fila, ['unidad_medida', 'unidad', 'um'], 'UNIDAD')).trim().toUpperCase() || 'UNIDAD';
            const exentoIva = parsearExento(tomarValor(fila, ['exento_iva', 'exento', 'iva_exento'], 0));

            if (cantidad <= 0) {
                omitidos += 1;
                continue;
            }

            itemsParseados.push({
                codigo,
                nombre,
                cantidad,
                costo: Math.max(0, +(costo.toFixed(4))),
                precioDivisas: Math.max(0, +(precioDivisas.toFixed(4))),
                precioBcv: Math.max(0, +(precioBcv.toFixed(4))),
                unidadMedida,
                exentoIva,
            });
        }

        if (itemsParseados.length === 0) {
            return new Response(
                JSON.stringify({
                    error: 'No se encontraron filas válidas. Verifica que existan las columnas: codigo, nombre, cantidad (o stock) > 0, costo_usd, precio_divisas_usd, precio_bcv_usd.',
                }),
                { status: 400, headers: jsonHeaders }
            );
        }

        const resumenTx = await withTransaction(db, async (tx) => {
            let subtotalBase = 0;
            let subtotalExento = 0;
            let productosNuevos = 0;
            let productosActualizados = 0;

            const resCompra = await executeInTx(
                tx,
                `INSERT INTO compras (
                    fecha, proveedor, proveedor_rif, nro_factura, nro_control, tipo_documento,
                    moneda, tasa_bcv, subtotal_base, subtotal_exento, iva_porcentaje, iva_monto,
                    retencion_iva_porcentaje, retencion_iva_monto, comprobante_retencion, monto_total
                ) VALUES (?, ?, ?, ?, ?, ?, 'USD', ?, 0, 0, ?, 0, ?, 0, ?, 0) RETURNING id`,
                [
                    fecha,
                    proveedor,
                    proveedorRif,
                    nroFactura,
                    nroControl,
                    tipoDocumento,
                    tasaBcv,
                    ivaPorcentaje,
                    retencionPorc,
                    comprobanteRetencion,
                ]
            );
            const idCompra = resCompra.rows[0].id;

            for (const item of itemsParseados) {
                const existente = await executeInTx(
                    tx,
                    'SELECT id, stock, costo, precio_divisas, precio_bcv, exento_iva FROM productos WHERE codigo = ?',
                    [item.codigo]
                );

                let productoId = null;
                let stockAntes = 0;

                if (existente.rows.length > 0) {
                    const row = existente.rows[0];
                    productoId = row.id;
                    const stockViejo = Number(row.stock) || 0;
                    const costoViejo = Number(row.costo) || 0;
                    stockAntes = stockViejo;

                    const nuevoStock = stockViejo + item.cantidad;
                    const costoPromedio = nuevoStock > 0
                        ? +((((stockViejo * costoViejo) + (item.cantidad * item.costo)) / nuevoStock).toFixed(4))
                        : item.costo;

                    const pDivFinal = item.precioDivisas > 0 ? item.precioDivisas : (Number(row.precio_divisas) || 0);
                    const pBcvFinal = item.precioBcv > 0 ? item.precioBcv : (Number(row.precio_bcv) || pDivFinal);

                    await executeInTx(
                        tx,
                        `UPDATE productos
                         SET stock = ?, costo = ?, venta = ?, precio_divisas = ?, precio_bcv = ?,
                             unidad_medida = ?, exento_iva = ?, estatus = 'activo'
                         WHERE id = ?`,
                        [
                            nuevoStock,
                            costoPromedio,
                            pBcvFinal,
                            pDivFinal,
                            pBcvFinal,
                            item.unidadMedida,
                            item.exentoIva,
                            productoId,
                        ]
                    );
                    productosActualizados += 1;
                } else {
                    const pBcvFinal = item.precioBcv > 0 ? item.precioBcv : item.precioDivisas;
                    const resNew = await executeInTx(
                        tx,
                        `INSERT INTO productos (
                            codigo, nombre, stock, costo, venta, precio_divisas, precio_bcv,
                            exento_iva, unidad_medida, estatus
                        ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, 'activo') RETURNING id`,
                        [
                            item.codigo,
                            item.nombre,
                            item.cantidad,
                            item.costo,
                            pBcvFinal,
                            item.precioDivisas,
                            pBcvFinal,
                            item.exentoIva,
                            item.unidadMedida,
                        ]
                    );
                    productoId = resNew.rows[0].id;
                    productosNuevos += 1;
                }

                const subItem = +(item.costo * item.cantidad).toFixed(4);
                const itemExento = !esNotaEntrega && item.exentoIva === 1 ? 1 : 0;
                if (itemExento) {
                    subtotalExento += subItem;
                } else {
                    subtotalBase += subItem;
                }

                const itemAlicuota = (esNotaEntrega || itemExento) ? 0 : ivaPorcentaje;
                const itemMontoIva = itemAlicuota > 0 ? +(subItem * (itemAlicuota / 100)).toFixed(4) : 0;

                await executeInTx(
                    tx,
                    `INSERT INTO detalle_compra (
                        id_compra, producto_id, codigo_producto, nombre_producto,
                        costo, cantidad, exento_iva, alicuota_iva, monto_iva
                    ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)`,
                    [
                        idCompra,
                        productoId,
                        item.codigo,
                        item.nombre,
                        item.costo,
                        item.cantidad,
                        itemExento,
                        itemAlicuota,
                        itemMontoIva,
                    ]
                );

                await executeInTx(
                    tx,
                    `INSERT INTO movimientos_inventario (
                        producto_id, codigo_producto, nombre_producto, tipo, cantidad,
                        stock_antes, stock_despues, motivo, usuario_id, usuario_nombre, fecha, hora
                    ) VALUES (?, ?, ?, 'entrada', ?, ?, ?, ?, ?, ?, ?, ?)`,
                    [
                        productoId,
                        item.codigo,
                        item.nombre,
                        item.cantidad,
                        stockAntes,
                        stockAntes + item.cantidad,
                        `Compra Masiva (Excel) a ${proveedor}`,
                        usuario.id,
                        usuario.nombre || usuario.usuario || 'Admin',
                        fecha,
                        hora,
                    ]
                );
            }

            subtotalBase = +(subtotalBase.toFixed(4));
            subtotalExento = +(subtotalExento.toFixed(4));
            const ivaMonto = esNotaEntrega ? 0 : +(subtotalBase * (ivaPorcentaje / 100)).toFixed(4);
            const retencionMonto = esNotaEntrega ? 0 : +(ivaMonto * (retencionPorc / 100)).toFixed(4);
            const montoTotal = +(subtotalBase + subtotalExento + ivaMonto - retencionMonto).toFixed(4);

            await executeInTx(
                tx,
                `UPDATE compras
                 SET subtotal_base = ?, subtotal_exento = ?, iva_monto = ?,
                     retencion_iva_monto = ?, monto_total = ?
                 WHERE id = ?`,
                [subtotalBase, subtotalExento, ivaMonto, retencionMonto, montoTotal, idCompra]
            );

            await registrarBitacoraEnTx(tx, {
                usuario,
                accion: ACCIONES.CARGA_MASIVA,
                entidad: 'compras',
                entidadId: idCompra,
                detalle: `Excel ${esNotaEntrega ? 'Nota Entrega' : `Factura #${nroFactura}`} · ${proveedor} · ${itemsParseados.length} ítems (${productosNuevos} nuevos, ${productosActualizados} act.) · Total $${montoTotal.toFixed(4)}`,
            });

            return {
                idCompra,
                procesados: itemsParseados.length,
                nuevos: productosNuevos,
                actualizados: productosActualizados,
                omitidos,
                montoTotal,
                ivaMonto,
            };
        });

        return new Response(
            JSON.stringify({
                ok: true,
                message: `Importación completada: ${resumenTx.procesados} producto(s) procesado(s) (${resumenTx.nuevos} nuevos, ${resumenTx.actualizados} actualizados).`,
                ...resumenTx,
            }),
            { status: 200, headers: jsonHeaders }
        );
    } catch (error) {
        console.error('Error en importación Excel de compras:', error);
        return new Response(
            JSON.stringify({ error: error?.message || 'Error al procesar el archivo Excel' }),
            { status: 500, headers: jsonHeaders }
        );
    }
}
