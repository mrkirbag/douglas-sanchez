import { db } from '../db';
import { verificarToken } from '@/utils/auth';
import { withTransaction, executeInTx } from '@/utils/dbTransaction';
import { ACCIONES, registrarBitacoraEnTx } from '@/utils/bitacora';
import { ensureFiscalSchema } from '@/utils/ensureFiscalSchema.js';

const jsonHeaders = { 'Content-Type': 'application/json' };

export async function GET({ request }) {
    const usuario = verificarToken(request);
    if (!usuario) {
        return new Response(JSON.stringify({ error: 'No autorizado' }), { status: 401, headers: jsonHeaders });
    }

    try {
        await ensureFiscalSchema(db);
        const query = 'SELECT * FROM compras ORDER BY fecha DESC, id DESC';
        const compras = await db.execute(query);

        if (!compras || !compras.rows || compras.rows.length === 0) {
            return new Response(JSON.stringify({ message: 'No hay compras registradas' }), {
                status: 202,
                headers: jsonHeaders
            });
        }
        
        return new Response(JSON.stringify(compras.rows), { headers: jsonHeaders });
    } catch (error) {
        console.error('Error fetching compras:', error);
        return new Response(JSON.stringify({ error: 'Error interno del servidor' }), { status: 500, headers: jsonHeaders });
    }
}

export async function POST({ request }) {
    const usuario = verificarToken(request);
    if (!usuario) {
        return new Response(JSON.stringify({ error: 'No autorizado' }), { status: 401, headers: jsonHeaders });
    }
    if (usuario.rol !== 'admin') {
        return new Response(JSON.stringify({ error: 'Acceso denegado' }), { status: 403, headers: jsonHeaders });
    }

    try {
        await ensureFiscalSchema(db);

        const userCheck = await db.execute('SELECT id FROM usuarios WHERE id = ?', [usuario.id]);
        if (userCheck.rows.length === 0) {
            return new Response(JSON.stringify({ error: 'Usuario inválido o sesión expirada' }), { status: 401, headers: jsonHeaders });
        }

        const body = await request.json();
        const {
            fecha,
            proveedor,
            proveedor_id = '',
            proveedor_rif = '',
            nro_factura = '',
            nro_control = '',
            tipo_documento = 'factura',
            moneda = 'USD',
            retencion_iva_porcentaje: retencionBody = 0,
            comprobante_retencion = '',
            tipo_pago: tipoPagoBody = 'contado',
            abono_inicial: abonoInicialBody = 0,
            tiene_flete = false,
            flete_monto: fleteBody = 0,
            monto_total,
            productos
        } = body;

        const fleteParseado = Number(String(fleteBody ?? 0).replace(',', '.'));
        if (tiene_flete && (!Number.isFinite(fleteParseado) || fleteParseado <= 0)) {
            return new Response(
                JSON.stringify({ error: 'Si marcas el campo de flete, debes ingresar un monto válido mayor a 0.' }),
                { status: 400, headers: jsonHeaders }
            );
        }
        const fleteFinal = tiene_flete
            ? +(fleteParseado.toFixed(4))
            : (Number.isFinite(fleteParseado) && fleteParseado > 0 ? +(fleteParseado.toFixed(4)) : 0);

        const tipoPago = tipoPagoBody === 'credito' ? 'credito' : 'contado';
        const abonoInicialRaw = Math.max(0, Number(abonoInicialBody) || 0);
        const abonoInicial = tipoPago === 'credito'
            ? +Math.min(abonoInicialRaw, monto_total).toFixed(4)
            : +monto_total.toFixed(4);
        const estadoPago = tipoPago === 'credito' && abonoInicial < monto_total - 0.01
            ? 'pendiente'
            : 'pagada';

        if (!fecha || !proveedor || typeof monto_total !== 'number') {
            return new Response(JSON.stringify({ error: 'Datos incompletos de la cabecera' }), { status: 400, headers: jsonHeaders });
        }

        const esNotaEntrega = tipo_documento === 'nota_entrega';
        if (!esNotaEntrega && !String(nro_factura || '').trim()) {
            return new Response(JSON.stringify({ error: 'El N° de Factura del proveedor es obligatorio para compras fiscales' }), { status: 400, headers: jsonHeaders });
        }

        if (!Array.isArray(productos) || productos.length === 0) {
            return new Response(JSON.stringify({ error: 'Debe agregar al menos un producto' }), { status: 400, headers: jsonHeaders });
        }

        const tasaRes = await db.execute('SELECT bs, iva_porcentaje FROM tasa WHERE id = 1');
        const tasaRow = tasaRes.rows?.[0] || {};
        const tasaBcv = Number(tasaRow.bs) || 0;
        const ivaPorcentaje = esNotaEntrega
            ? 0
            : (body.iva_porcentaje !== undefined ? Number(body.iva_porcentaje) : (tasaRow.iva_porcentaje !== undefined ? Number(tasaRow.iva_porcentaje) : 16));
        const retencionIvaPorcentaje = esNotaEntrega
            ? 0
            : Math.max(0, Math.min(100, Number(retencionBody) || 0));

        let subtotalBase = 0;
        let subtotalExento = 0;
        for (const p of productos) {
            const cant = Number(p.cantidad) || 0;
            const costo = Number(p.costo) || 0;
            const exento = !esNotaEntrega && (p.exento_iva === 1 || p.exento_iva === true || p.exento_iva === '1');
            if (exento) {
                subtotalExento += costo * cant;
            } else {
                subtotalBase += costo * cant;
            }
            if (p.seriales && Array.isArray(p.seriales) && p.seriales.length > 0) {
                if (p.seriales.length !== p.cantidad) {
                    return new Response(JSON.stringify({ error: `La cantidad de seriales del producto ${p.codigo} no coincide con la cantidad ingresada.` }), { status: 400, headers: jsonHeaders });
                }
            }
        }

        subtotalBase = +(subtotalBase.toFixed(4));
        subtotalExento = +(subtotalExento.toFixed(4));
        const ivaMonto = esNotaEntrega ? 0 : +(subtotalBase * (ivaPorcentaje / 100)).toFixed(4);
        const retencionIvaMonto = esNotaEntrega ? 0 : +(ivaMonto * (retencionIvaPorcentaje / 100)).toFixed(4);
        const totalCalculado = +(subtotalBase + subtotalExento + ivaMonto - retencionIvaMonto).toFixed(4);

        if (Math.abs(totalCalculado - monto_total) > 0.05) {
            return new Response(JSON.stringify({
                error: `El monto total (${monto_total.toFixed(4)}) no coincide con el cálculo fiscal (${totalCalculado.toFixed(4)})`
            }), { status: 400, headers: jsonHeaders });
        }

        await withTransaction(db, async (tx) => {
            // 0. Resolver o crear proveedor automáticamente desde la cabecera
            const nombreProv = String(proveedor).trim();
            const rifProv = String(proveedor_rif || '').trim().toUpperCase();
            let provIdFinal = String(proveedor_id || '').trim() || null;

            if (provIdFinal) {
                const checkProv = await executeInTx(tx, `SELECT id, rif FROM proveedores WHERE id = ?`, [provIdFinal]);
                if (!checkProv.rows?.length) {
                    provIdFinal = null;
                } else if (rifProv && !checkProv.rows[0].rif) {
                    await executeInTx(tx, `UPDATE proveedores SET rif = ?, estatus = 'activo' WHERE id = ?`, [rifProv, provIdFinal]);
                }
            }

            if (!provIdFinal) {
                let encontrado = null;
                if (rifProv) {
                    const porRif = await executeInTx(tx, `SELECT id FROM proveedores WHERE UPPER(TRIM(rif)) = ? LIMIT 1`, [rifProv]);
                    encontrado = porRif.rows?.[0] || null;
                }
                if (!encontrado) {
                    const porNom = await executeInTx(tx, `SELECT id, rif FROM proveedores WHERE UPPER(TRIM(nombre)) = ? LIMIT 1`, [nombreProv.toUpperCase()]);
                    encontrado = porNom.rows?.[0] || null;
                    if (encontrado && rifProv && !encontrado.rif) {
                        await executeInTx(tx, `UPDATE proveedores SET rif = ?, estatus = 'activo' WHERE id = ?`, [rifProv, encontrado.id]);
                    }
                }
                if (encontrado) {
                    provIdFinal = encontrado.id;
                    await executeInTx(tx, `UPDATE proveedores SET estatus = 'activo' WHERE id = ?`, [provIdFinal]);
                } else {
                    const nuevoProv = await executeInTx(
                        tx,
                        `INSERT INTO proveedores (nombre, rif, estatus) VALUES (?, ?, 'activo') RETURNING id`,
                        [nombreProv, rifProv]
                    );
                    provIdFinal = nuevoProv.rows?.[0]?.id || null;
                }
            }

            // 1. Insert Compra Fiscal
            const resCompra = await executeInTx(tx,
                `INSERT INTO compras (
                    fecha, proveedor, proveedor_id, proveedor_rif, nro_factura, nro_control, tipo_documento,
                    moneda, tasa_bcv, subtotal_base, subtotal_exento, iva_porcentaje, iva_monto,
                    retencion_iva_porcentaje, retencion_iva_monto, comprobante_retencion, flete_monto, monto_total,
                    tipo_pago, monto_abonado, estado_pago
                ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?) RETURNING id`,
                [
                    fecha,
                    nombreProv,
                    provIdFinal,
                    rifProv,
                    String(nro_factura || '').trim(),
                    String(nro_control || '').trim(),
                    esNotaEntrega ? 'nota_entrega' : 'factura',
                    moneda === 'BS' ? 'BS' : 'USD',
                    tasaBcv,
                    subtotalBase,
                    subtotalExento,
                    ivaPorcentaje,
                    ivaMonto,
                    retencionIvaPorcentaje,
                    retencionIvaMonto,
                    esNotaEntrega ? '' : String(comprobante_retencion || '').trim(),
                    fleteFinal,
                    monto_total,
                    tipoPago,
                    abonoInicial,
                    estadoPago,
                ]
            );
            const idCompra = resCompra.rows[0].id;

            if (tipoPago === 'credito' && abonoInicial > 0) {
                await executeInTx(tx,
                    `INSERT INTO abonos_compra (id_compra, fecha, monto, moneda, metodo, monto_recibido, tasa_cop, tasa_bs, observacion, usuario_id, usuario_nombre)
                     VALUES (?, ?, ?, 'USD', 'Inicial', ?, 0, ?, 'Abono inicial al registrar compra', ?, ?)`,
                    [idCompra, fecha, abonoInicial, abonoInicial, tasaBcv, usuario.id, usuario.nombre || usuario.usuario || 'Admin']
                );
            }

            // 2. Process Products
            const horaHora = new Date().toLocaleTimeString('en-US', { hour12: false, timeZone: 'America/Caracas' });
            
            for (const p of productos) {
                let productoId = p.id;
                let stockAntes = 0;

                if (!productoId) {
                    // Check if it exists by codigo just in case
                    const resExist = await executeInTx(tx, `SELECT id, stock FROM productos WHERE codigo = ?`, [p.codigo]);
                    if (resExist.rows.length > 0) {
                        productoId = resExist.rows[0].id;
                        stockAntes = Number(resExist.rows[0].stock);
                        
                        // Update stock and cost
                        await executeInTx(tx, 
                            `UPDATE productos SET stock = stock + ?, costo = ? WHERE id = ?`,
                            [p.cantidad, p.costo, productoId]
                        );
                    } else {
                        // Create new product
                        const precioDivisas = Number(p.precio_divisas ?? p.venta) || 0;
                        const precioBcv = Number(p.precio_bcv ?? p.venta ?? precioDivisas) || 0;
                        const exentoNew = p.exento_iva === 1 || p.exento_iva === true || p.exento_iva === '1' ? 1 : 0;
                        const resNewProd = await executeInTx(tx, 
                            `INSERT INTO productos (codigo, nombre, costo, venta, precio_divisas, precio_bcv, exento_iva, stock, unidad_medida) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?) RETURNING id`,
                            [p.codigo, p.nombre, p.costo, precioBcv, precioDivisas, precioBcv, exentoNew, p.cantidad, p.unidad_medida || 'UNIDAD']
                        );
                        productoId = resNewProd.rows[0].id;
                    }
                } else {
                    // Product explicitly provided with ID
                    const resExist = await executeInTx(tx, `SELECT stock FROM productos WHERE id = ?`, [productoId]);
                    if (resExist.rows.length === 0) {
                        throw new Error(`Producto ID ${productoId} no existe`);
                    }
                    stockAntes = Number(resExist.rows[0].stock);

                    await executeInTx(tx, 
                        `UPDATE productos SET stock = stock + ?, costo = ? WHERE id = ?`,
                        [p.cantidad, p.costo, productoId]
                    );
                }

                // Insert into detalle_compra
                const itemExento = !esNotaEntrega && (p.exento_iva === 1 || p.exento_iva === true || p.exento_iva === '1') ? 1 : 0;
                const itemAlicuota = (esNotaEntrega || itemExento) ? 0 : ivaPorcentaje;
                const itemMontoIva = itemAlicuota > 0 ? +((Number(p.costo) * Number(p.cantidad)) * (itemAlicuota / 100)).toFixed(4) : 0;
                await executeInTx(tx, 
                    `INSERT INTO detalle_compra (id_compra, producto_id, codigo_producto, nombre_producto, costo, cantidad, exento_iva, alicuota_iva, monto_iva) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)`,
                    [idCompra, productoId, p.codigo, p.nombre, p.costo, p.cantidad, itemExento, itemAlicuota, itemMontoIva]
                );

                // Insert into movimientos_inventario
                await executeInTx(tx, 
                    `INSERT INTO movimientos_inventario (producto_id, codigo_producto, nombre_producto, tipo, cantidad, stock_antes, stock_despues, motivo, usuario_id, usuario_nombre, fecha, hora) 
                     VALUES (?, ?, ?, 'entrada', ?, ?, ?, ?, ?, ?, ?, ?)`,
                    [
                        productoId, p.codigo, p.nombre, p.cantidad, stockAntes, stockAntes + p.cantidad, 
                        `Compra a proveedor ${proveedor}`, usuario.id, usuario.nombre, fecha, horaHora
                    ]
                );

                // Process Serials
                if (p.seriales && Array.isArray(p.seriales)) {
                    for (const serial of p.seriales) {
                        await executeInTx(tx, 
                            `INSERT INTO seriales (producto_id, serial, estado, id_compra) VALUES (?, ?, 'disponible', ?)`,
                            [productoId, serial, idCompra]
                        );
                    }
                }
            }

            // Bitacora
            await registrarBitacoraEnTx(tx, {
                usuario,
                accion: 'REGISTRAR',
                entidad: 'compras',
                entidadId: idCompra,
                detalle: `${esNotaEntrega ? 'Nota de Entrega' : `Factura #${nro_factura}`} · Proveedor: ${proveedor}${proveedor_rif ? ` (${proveedor_rif})` : ''} · Total: $${monto_total.toFixed(4)} · IVA: $${ivaMonto.toFixed(4)}`
            });

        });

        return new Response(JSON.stringify({ message: 'Compra registrada exitosamente' }), { status: 201, headers: jsonHeaders });

    } catch (error) {
        console.error('Error al procesar compra:', error);
        
        // Return clear error if serial is duplicate
        if (error.message.includes('UNIQUE constraint failed: seriales.serial')) {
            return new Response(JSON.stringify({ error: 'Uno o más seriales ingresados ya existen en el sistema.' }), { status: 400, headers: jsonHeaders });
        }
        
        return new Response(JSON.stringify({ error: error.message || 'Error interno al registrar la compra' }), { status: 500, headers: jsonHeaders });
    }
}
