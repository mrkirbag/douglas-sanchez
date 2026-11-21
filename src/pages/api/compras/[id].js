import { db } from '../db';
import { verificarToken } from '@/utils/auth';
import { ensureFiscalSchema } from '@/utils/ensureFiscalSchema.js';
import { withTransaction, executeInTx } from '@/utils/dbTransaction';
import { registrarBitacoraEnTx } from '@/utils/bitacora';

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

        const compra = await db.execute(`SELECT * FROM compras WHERE id = ?`, [id]);

        if (compra.rows.length === 0) {
            return new Response(JSON.stringify({ message: 'Compra no encontrada' }), {
                status: 204,
                headers: jsonHeaders
            });
        }

        const detalleCompra = await db.execute(`SELECT * FROM detalle_compra WHERE id_compra = ? ORDER BY codigo_producto ASC`, [id]);
        
        // Load serials
        const seriales = await db.execute(`SELECT * FROM seriales WHERE id_compra = ?`, [id]);

        // Merge serials into details
        const detallesConSeriales = detalleCompra.rows.map(detalle => {
            const serialesDelProducto = seriales.rows
                .filter(s => String(s.producto_id) === String(detalle.producto_id))
                .map(s => s.serial);
            
            return {
                ...detalle,
                seriales: serialesDelProducto
            };
        });

        const c = compra.rows[0];
        const result = {
            id: c.id,
            fecha: c.fecha,
            proveedor: c.proveedor,
            proveedor_id: c.proveedor_id || '',
            proveedor_rif: c.proveedor_rif || '',
            nro_factura: c.nro_factura || '',
            nro_control: c.nro_control || '',
            tipo_documento: c.tipo_documento || 'factura',
            tipo_pago: c.tipo_pago || 'contado',
            monto_abonado: Number(c.monto_abonado) || 0,
            estado_pago: c.estado_pago || 'pagada',
            moneda: c.moneda || 'USD',
            tasa_bcv: Number(c.tasa_bcv) || 0,
            subtotal_base: Number(c.subtotal_base) || 0,
            subtotal_exento: Number(c.subtotal_exento) || 0,
            iva_porcentaje: c.iva_porcentaje !== undefined ? Number(c.iva_porcentaje) : 16,
            iva_monto: Number(c.iva_monto) || 0,
            retencion_iva_porcentaje: Number(c.retencion_iva_porcentaje) || 0,
            retencion_iva_monto: Number(c.retencion_iva_monto) || 0,
            comprobante_retencion: c.comprobante_retencion || '',
            flete_monto: Number(c.flete_monto) || 0,
            monto_total: Number(c.monto_total) || 0,
            detalles: detallesConSeriales
        };

        return new Response(JSON.stringify(result), { headers: jsonHeaders });

    } catch (error) {
        console.error('Error interno al consultar compra:', error);
        return new Response(JSON.stringify({ error: 'Error interno del servidor' }), {
            status: 500,
            headers: jsonHeaders
        });
    }
}

export async function PUT({ request, params }) {
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
        const body = await request.json();

        const fecha = String(body.fecha || '').trim();
        const proveedor = String(body.proveedor || '').trim();
        const proveedorRif = String(body.proveedor_rif || '').trim().toUpperCase();
        const nroFactura = String(body.nro_factura || '').trim();
        const nroControl = String(body.nro_control || '').trim();
        const comprobanteRetencion = String(body.comprobante_retencion || '').trim();
        const tipoPagoNuevo = body.tipo_pago === 'credito' ? 'credito' : 'contado';

        if (!fecha || !proveedor) {
            return new Response(JSON.stringify({ error: 'La fecha y el proveedor son obligatorios' }), {
                status: 400,
                headers: jsonHeaders,
            });
        }

        const resultado = await withTransaction(db, async (tx) => {
            const actualRes = await executeInTx(tx, `SELECT * FROM compras WHERE id = ?`, [id]);
            const actual = actualRes.rows?.[0];
            if (!actual) {
                throw Object.assign(new Error('Compra no encontrada'), { status: 404 });
            }

            if (actual.tipo_documento === 'factura' && !nroFactura) {
                throw Object.assign(new Error('El N° de Factura es obligatorio en compras fiscales'), { status: 400 });
            }

            const montoTotal = Number(actual.monto_total) || 0;
            let montoAbonadoNuevo = Number(actual.monto_abonado) || 0;
            let estadoPagoNuevo = actual.estado_pago || 'pagada';

            if (actual.tipo_pago !== tipoPagoNuevo) {
                if (tipoPagoNuevo === 'credito') {
                    // Contado -> Crédito: pasa a cuentas por pagar pendiente
                    montoAbonadoNuevo = 0;
                    estadoPagoNuevo = montoTotal > 0.01 ? 'pendiente' : 'pagada';
                } else {
                    // Crédito -> Contado: solo si no tiene abonos registrados
                    const abonosRes = await executeInTx(tx, `SELECT COUNT(*) AS total FROM abonos_compra WHERE id_compra = ?`, [id]);
                    if (Number(abonosRes.rows?.[0]?.total || 0) > 0) {
                        throw Object.assign(
                            new Error('Esta compra ya tiene abonos registrados en Cuentas por Pagar; no puede pasarse a Contado.'),
                            { status: 409 }
                        );
                    }
                    montoAbonadoNuevo = montoTotal;
                    estadoPagoNuevo = 'pagada';
                }
            }

            // Resolver o crear proveedor_id
            let provIdFinal = String(body.proveedor_id || '').trim() || null;
            if (!provIdFinal) {
                let encontrado = null;
                if (proveedorRif) {
                    const r1 = await executeInTx(tx, `SELECT id FROM proveedores WHERE UPPER(TRIM(rif)) = ? LIMIT 1`, [proveedorRif]);
                    encontrado = r1.rows?.[0] || null;
                }
                if (!encontrado) {
                    const r2 = await executeInTx(tx, `SELECT id FROM proveedores WHERE UPPER(TRIM(nombre)) = ? LIMIT 1`, [proveedor.toUpperCase()]);
                    encontrado = r2.rows?.[0] || null;
                }
                if (encontrado) {
                    provIdFinal = encontrado.id;
                    await executeInTx(tx, `UPDATE proveedores SET estatus = 'activo' WHERE id = ?`, [provIdFinal]);
                } else {
                    const ins = await executeInTx(
                        tx,
                        `INSERT INTO proveedores (nombre, rif, estatus) VALUES (?, ?, 'activo') RETURNING id`,
                        [proveedor, proveedorRif]
                    );
                    provIdFinal = ins.rows?.[0]?.id || null;
                }
            }

            await executeInTx(
                tx,
                `UPDATE compras
                 SET fecha = ?, proveedor = ?, proveedor_id = ?, proveedor_rif = ?,
                     nro_factura = ?, nro_control = ?, comprobante_retencion = ?,
                     tipo_pago = ?, monto_abonado = ?, estado_pago = ?
                 WHERE id = ?`,
                [
                    fecha,
                    proveedor,
                    provIdFinal,
                    proveedorRif,
                    nroFactura,
                    nroControl,
                    actual.tipo_documento === 'nota_entrega' ? '' : comprobanteRetencion,
                    tipoPagoNuevo,
                    montoAbonadoNuevo,
                    estadoPagoNuevo,
                    id,
                ]
            );

            await registrarBitacoraEnTx(tx, {
                usuario,
                accion: 'COMPRA_EDITAR',
                entidad: 'compras',
                entidadId: id,
                detalle: `Compra #${id} editada (${proveedor}, fecha ${fecha}, ${tipoPagoNuevo})`,
            });

            return { id, tipo_pago: tipoPagoNuevo, estado_pago: estadoPagoNuevo };
        });

        return new Response(
            JSON.stringify({ message: 'Compra actualizada correctamente', ...resultado }),
            { status: 200, headers: jsonHeaders }
        );
    } catch (error) {
        const status = error.status || 500;
        console.error('Error al actualizar compra:', error);
        return new Response(JSON.stringify({ error: error.message || 'Error al actualizar compra' }), {
            status,
            headers: jsonHeaders,
        });
    }
}
