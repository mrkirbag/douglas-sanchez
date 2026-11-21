import { db } from '../db';
import { verificarToken } from '@/utils/auth';
import { withTransaction, executeInTx } from '@/utils/dbTransaction';
import { ensureFiscalSchema } from '@/utils/ensureFiscalSchema.js';
import { registrarBitacoraEnTx } from '@/utils/bitacora';
import { fechaHoraVenezuela } from '@/utils/helpers/formateoFecha.js';
import { convertirAMonedaBase, obtenerMonedaBase, toleranciaPago } from '@/utils/helpers/tasas.js';

const jsonHeaders = { 'Content-Type': 'application/json' };

function normalizarProveedorKey(proveedor, rif) {
    const rifClean = String(rif || '').trim().toUpperCase();
    if (rifClean) return `RIF:${rifClean}`;
    return `NOM:${String(proveedor || '').trim().toUpperCase()}`;
}

async function obtenerTasas() {
    const res = await db.execute('SELECT valor, bs FROM tasa WHERE id = 1');
    const row = res.rows?.[0] || {};
    return {
        cop: Number(row.valor) || 0,
        bs: Number(row.bs) || 0,
    };
}

export async function GET({ request }) {
    const usuario = verificarToken(request);
    if (!usuario) {
        return new Response(JSON.stringify({ error: 'No autorizado' }), { status: 401, headers: jsonHeaders });
    }
    if (usuario.rol !== 'admin') {
        return new Response(JSON.stringify({ error: 'Acceso denegado' }), { status: 403, headers: jsonHeaders });
    }

    try {
        await ensureFiscalSchema(db);

        const comprasRes = await db.execute(
            `SELECT id, fecha, proveedor, proveedor_rif, tipo_documento, nro_factura, nro_control,
                    monto_total, monto_abonado, estado_pago, tipo_pago
             FROM compras
             WHERE tipo_pago = 'credito'
             ORDER BY fecha ASC, id ASC`
        );

        const abonosRes = await db.execute(
            `SELECT a.*, c.proveedor, c.proveedor_rif, c.nro_factura, c.tipo_documento
             FROM abonos_compra a
             JOIN compras c ON c.id = a.id_compra
             ORDER BY a.fecha DESC, a.id DESC`
        );

        const mapa = new Map();

        for (const c of comprasRes.rows || []) {
            const key = normalizarProveedorKey(c.proveedor, c.proveedor_rif);
            const total = Number(c.monto_total) || 0;
            const abonado = Number(c.monto_abonado) || 0;
            const saldo = Math.max(0, +(total - abonado).toFixed(4));
            const pendiente = saldo > 0.01 && c.estado_pago !== 'pagada';

            if (!mapa.has(key)) {
                mapa.set(key, {
                    key,
                    proveedor: String(c.proveedor || '').trim(),
                    proveedor_rif: String(c.proveedor_rif || '').trim(),
                    total_compras: 0,
                    compras_pendientes: 0,
                    total_deuda_usd: 0,
                    total_abonado_usd: 0,
                    saldo_pendiente_usd: 0,
                    compras: [],
                    abonos: [],
                });
            }

            const grupo = mapa.get(key);
            if (!grupo.proveedor_rif && c.proveedor_rif) {
                grupo.proveedor_rif = String(c.proveedor_rif).trim();
            }
            grupo.total_compras += 1;
            if (pendiente) grupo.compras_pendientes += 1;
            grupo.total_deuda_usd = +(grupo.total_deuda_usd + total).toFixed(4);
            grupo.total_abonado_usd = +(grupo.total_abonado_usd + abonado).toFixed(4);
            grupo.saldo_pendiente_usd = +(grupo.saldo_pendiente_usd + saldo).toFixed(4);
            grupo.compras.push({
                id: c.id,
                fecha: c.fecha,
                tipo_documento: c.tipo_documento,
                nro_factura: c.nro_factura,
                nro_control: c.nro_control,
                monto_total: total,
                monto_abonado: abonado,
                saldo_pendiente: saldo,
                estado_pago: pendiente ? 'pendiente' : 'pagada',
            });
        }

        for (const a of abonosRes.rows || []) {
            const key = normalizarProveedorKey(a.proveedor, a.proveedor_rif);
            const grupo = mapa.get(key);
            if (grupo) {
                grupo.abonos.push({
                    id: a.id,
                    id_compra: a.id_compra,
                    fecha: a.fecha,
                    monto: Number(a.monto) || 0,
                    moneda: a.moneda || 'USD',
                    metodo: a.metodo || '',
                    monto_recibido: Number(a.monto_recibido) || 0,
                    observacion: a.observacion || '',
                    usuario_nombre: a.usuario_nombre || '',
                    nro_factura: a.nro_factura || '',
                    tipo_documento: a.tipo_documento || 'factura',
                });
            }
        }

        const proveedores = Array.from(mapa.values()).sort((a, b) => {
            if (b.saldo_pendiente_usd !== a.saldo_pendiente_usd) {
                return b.saldo_pendiente_usd - a.saldo_pendiente_usd;
            }
            return a.proveedor.localeCompare(b.proveedor);
        });

        return new Response(JSON.stringify(proveedores), { status: 200, headers: jsonHeaders });
    } catch (error) {
        console.error('Error al cargar cuentas por pagar:', error);
        return new Response(JSON.stringify({ error: 'Error al cargar cuentas por pagar' }), { status: 500, headers: jsonHeaders });
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
        const body = await request.json();
        const {
            proveedorKey,
            id_compra = '',
            monto,
            moneda = 'USD',
            metodo = 'Efectivo',
            fecha,
            observacion = '',
        } = body;

        const montoIngresado = Number(String(monto ?? '').replace(',', '.'));
        if (!Number.isFinite(montoIngresado) || montoIngresado <= 0) {
            return new Response(JSON.stringify({ error: 'El monto del abono debe ser mayor a 0' }), { status: 400, headers: jsonHeaders });
        }

        const tasas = await obtenerTasas();
        const monedaBase = obtenerMonedaBase();
        const monedaNorm = String(moneda || 'USD').toUpperCase();

        if (monedaNorm === 'COP' && tasas.cop <= 0) {
            return new Response(JSON.stringify({ error: 'No hay tasa COP configurada' }), { status: 400, headers: jsonHeaders });
        }
        if (monedaNorm === 'BS' && tasas.bs <= 0) {
            return new Response(JSON.stringify({ error: 'No hay tasa BCV configurada' }), { status: 400, headers: jsonHeaders });
        }

        const montoUsd = +(convertirAMonedaBase(montoIngresado, monedaNorm, monedaBase, tasas).toFixed(4));

        if (montoUsd <= 0) {
            return new Response(JSON.stringify({ error: `El monto convertido a ${monedaBase} debe ser mayor a 0` }), { status: 400, headers: jsonHeaders });
        }

        const fechaFinal = String(fecha || '').trim() || fechaHoraVenezuela().fecha;

        const resultado = await withTransaction(db, async (tx) => {
            const todasRes = await executeInTx(
                tx,
                `SELECT id, fecha, proveedor, proveedor_rif, monto_total, monto_abonado, estado_pago
                 FROM compras
                 WHERE tipo_pago = 'credito' AND estado_pago = 'pendiente'
                 ORDER BY fecha ASC, id ASC`
            );

            let objetivos = (todasRes.rows || []).filter((c) => {
                if (id_compra) return String(c.id) === String(id_compra);
                return normalizarProveedorKey(c.proveedor, c.proveedor_rif) === proveedorKey;
            });

            if (objetivos.length === 0) {
                const err = new Error('No hay compras pendientes para aplicar el abono.');
                err.status = 404;
                throw err;
            }

            const saldoTotalDisponible = +objetivos.reduce((acc, c) => {
                return acc + Math.max(0, (Number(c.monto_total) || 0) - (Number(c.monto_abonado) || 0));
            }, 0).toFixed(4);

            if (montoUsd > saldoTotalDisponible + toleranciaPago(monedaBase)) {
                const err = new Error(`El abono (${montoUsd.toFixed(2)} ${monedaBase}) supera el saldo pendiente (${saldoTotalDisponible.toFixed(2)} ${monedaBase}).`);
                err.status = 400;
                throw err;
            }

            let restante = montoUsd;
            const comprasAfectadas = [];

            for (const c of objetivos) {
                if (restante <= 0.005) break;
                const total = Number(c.monto_total) || 0;
                const abonadoActual = Number(c.monto_abonado) || 0;
                const saldoCompra = Math.max(0, +(total - abonadoActual).toFixed(4));
                if (saldoCompra <= 0.005) continue;

                const aplicar = +Math.min(restante, saldoCompra).toFixed(4);
                const nuevoAbonado = +(abonadoActual + aplicar).toFixed(4);
                const nuevoEstado = total - nuevoAbonado <= 0.01 ? 'pagada' : 'pendiente';

                await executeInTx(
                    tx,
                    `UPDATE compras SET monto_abonado = ?, estado_pago = ? WHERE id = ?`,
                    [nuevoAbonado, nuevoEstado, c.id]
                );

                const proporcion = aplicar / montoUsd;
                const recibidoParte = +(montoIngresado * proporcion).toFixed(4);

                await executeInTx(
                    tx,
                    `INSERT INTO abonos_compra (id_compra, fecha, monto, moneda, metodo, monto_recibido, tasa_cop, tasa_bs, observacion, usuario_id, usuario_nombre)
                     VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
                    [
                        c.id,
                        fechaFinal,
                        aplicar,
                        monedaNorm,
                        String(metodo || 'Efectivo').trim(),
                        recibidoParte,
                        tasas.cop,
                        tasas.bs,
                        String(observacion || '').trim(),
                        usuario.id,
                        usuario.nombre || usuario.usuario || 'Admin',
                    ]
                );

                restante = +(restante - aplicar).toFixed(4);
                comprasAfectadas.push({ id: c.id, aplicado: aplicar, estado: nuevoEstado });
            }

            const nombreProv = objetivos[0].proveedor;
            await registrarBitacoraEnTx(tx, {
                usuario,
                accion: 'COMPRA_ABONO',
                entidad: 'compras',
                entidadId: comprasAfectadas[0]?.id || '',
                detalle: `Abono $${montoUsd.toFixed(4)} USD (${monedaNorm} - ${metodo}) a proveedor ${nombreProv}`,
            });

            return { montoUsd, comprasAfectadas };
        });

        return new Response(
            JSON.stringify({ message: 'Abono registrado correctamente', ...resultado }),
            { status: 201, headers: jsonHeaders }
        );
    } catch (error) {
        const status = error.status || 500;
        console.error('Error al registrar abono de compra:', error);
        return new Response(JSON.stringify({ error: error.message || 'Error al registrar abono' }), {
            status,
            headers: jsonHeaders,
        });
    }
}
