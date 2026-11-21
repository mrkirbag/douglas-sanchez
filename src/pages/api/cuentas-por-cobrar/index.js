import { db } from '../db';
import { verificarToken } from '@/utils/auth';
import { withTransaction, executeInTx } from '@/utils/dbTransaction';
import { obtenerMonedaBase } from '@/utils/helpers/tasas.js';
import { parsearLineaPago } from '@/utils/helpers/metodosPago.js';
import { ACCIONES, registrarBitacoraEnTx } from '@/utils/bitacora.js';
import { fechaHoraVenezuela } from '@/utils/helpers/formateoFecha.js';

const jsonHeaders = { 'Content-Type': 'application/json' };

async function tasasDelDia() {
    const result = await db.execute('SELECT valor, bs FROM tasa WHERE id = 1');
    const row = result.rows?.[0];
    return {
        cop: Number(row?.valor) || 0,
        bs: Number(row?.bs) || 0,
    };
}

export async function GET({ request }) {
    const usuario = verificarToken(request);
    if (!usuario) {
        return new Response(JSON.stringify({ error: 'No autorizado' }), { status: 401, headers: jsonHeaders });
    }

    try {
        const creditosRes = await db.execute(
            `SELECT
                c.id AS id_credito,
                c.saldo_pendiente,
                v.id AS id_venta,
                v.fecha,
                v.total,
                v.estado,
                v.tipo_documento,
                v.nro_factura,
                v.nro_nota_entrega,
                cli.id AS id_cliente,
                cli.nombre,
                cli.cedula,
                cli.telefono
             FROM creditos c
             JOIN ventas v ON c.id_venta = v.id
             JOIN clientes cli ON v.cliente_id = cli.id
             WHERE v.estado != 'anulada'
             ORDER BY v.fecha ASC, v.id ASC`
        );

        const abonosRes = await db.execute(
            `SELECT
                a.id,
                a.id_credito,
                a.fecha,
                a.monto,
                a.moneda,
                a.metodo,
                a.monto_recibido,
                v.cliente_id AS id_cliente,
                v.tipo_documento,
                v.nro_factura,
                v.nro_nota_entrega
             FROM abonos_credito a
             JOIN creditos c ON a.id_credito = c.id
             JOIN ventas v ON c.id_venta = v.id
             ORDER BY a.fecha DESC, a.id DESC`
        );

        const mapa = new Map();

        for (const row of creditosRes.rows || []) {
            const cid = String(row.id_cliente);
            const total = Number(row.total) || 0;
            const saldo = row.estado === 'pagado' ? 0 : Math.max(0, +(Number(row.saldo_pendiente) || 0).toFixed(4));
            const abonado = Math.max(0, +(total - saldo).toFixed(4));
            const pendiente = saldo > 0.01 && row.estado === 'pendiente';

            if (!mapa.has(cid)) {
                mapa.set(cid, {
                    id_cliente: cid,
                    nombre: String(row.nombre || '').trim(),
                    cedula: String(row.cedula || '').trim(),
                    telefono: String(row.telefono || '').trim(),
                    total_ventas: 0,
                    ventas_pendientes: 0,
                    total_deuda_usd: 0,
                    total_abonado_usd: 0,
                    saldo_pendiente_usd: 0,
                    ventas: [],
                    abonos: [],
                });
            }

            const grupo = mapa.get(cid);
            grupo.total_ventas += 1;
            if (pendiente) grupo.ventas_pendientes += 1;
            grupo.total_deuda_usd = +(grupo.total_deuda_usd + total).toFixed(4);
            grupo.total_abonado_usd = +(grupo.total_abonado_usd + abonado).toFixed(4);
            grupo.saldo_pendiente_usd = +(grupo.saldo_pendiente_usd + saldo).toFixed(4);
            grupo.ventas.push({
                id_credito: row.id_credito,
                id_venta: row.id_venta,
                fecha: row.fecha,
                tipo_documento: row.tipo_documento || 'factura',
                nro_factura: row.nro_factura,
                nro_nota_entrega: row.nro_nota_entrega,
                total,
                abonado,
                saldo_pendiente: saldo,
                estado: pendiente ? 'pendiente' : 'pagado',
            });
        }

        for (const a of abonosRes.rows || []) {
            const grupo = mapa.get(String(a.id_cliente));
            if (grupo) {
                grupo.abonos.push({
                    id: a.id,
                    id_credito: a.id_credito,
                    fecha: a.fecha,
                    monto: Number(a.monto) || 0,
                    moneda: a.moneda || 'USD',
                    metodo: a.metodo || '',
                    monto_recibido: Number(a.monto_recibido) || 0,
                    tipo_documento: a.tipo_documento || 'factura',
                    nro_factura: a.nro_factura,
                    nro_nota_entrega: a.nro_nota_entrega,
                });
            }
        }

        const clientes = Array.from(mapa.values()).sort((a, b) => {
            if (b.saldo_pendiente_usd !== a.saldo_pendiente_usd) {
                return b.saldo_pendiente_usd - a.saldo_pendiente_usd;
            }
            return a.nombre.localeCompare(b.nombre);
        });

        return new Response(JSON.stringify(clientes), { status: 200, headers: jsonHeaders });
    } catch (error) {
        console.error('Error al cargar cuentas por cobrar:', error);
        return new Response(JSON.stringify({ error: 'Error al cargar cuentas por cobrar' }), { status: 500, headers: jsonHeaders });
    }
}

export async function POST({ request }) {
    const usuario = verificarToken(request);
    if (!usuario) {
        return new Response(JSON.stringify({ error: 'No autorizado' }), { status: 401, headers: jsonHeaders });
    }

    try {
        const body = await request.json();
        const {
            id_cliente,
            id_credito = '',
            monto,
            moneda = 'USD',
            metodo = 'Efectivo',
            fecha,
        } = body;

        if (!id_cliente && !id_credito) {
            return new Response(JSON.stringify({ error: 'Falta el cliente o crédito' }), { status: 400, headers: jsonHeaders });
        }

        const tasas = await tasasDelDia();
        const monedaBase = obtenerMonedaBase();
        const linea = parsearLineaPago({
            moneda: moneda || 'USD',
            metodo,
            monto,
        }, monedaBase, tasas);

        if (!linea.ok) {
            return new Response(JSON.stringify({ error: linea.error }), { status: 400, headers: jsonHeaders });
        }

        const pago = linea.pago;
        const montoUsdTotal = +(Number(pago.monto_base).toFixed(4));
        const fechaFinal = String(fecha || '').trim() || fechaHoraVenezuela().fecha;

        const resultado = await withTransaction(db, async (tx) => {
            const creditosRes = await executeInTx(
                tx,
                `SELECT c.id AS id_credito, c.saldo_pendiente, v.id AS id_venta, v.fecha, cli.nombre AS cliente_nombre
                 FROM creditos c
                 JOIN ventas v ON c.id_venta = v.id
                 JOIN clientes cli ON v.cliente_id = cli.id
                 WHERE v.estado = 'pendiente' AND c.saldo_pendiente > 0.01
                   AND ${id_credito ? 'c.id = ?' : 'v.cliente_id = ?'}
                 ORDER BY v.fecha ASC, v.id ASC`,
                [id_credito || id_cliente]
            );

            const objetivos = creditosRes.rows || [];
            if (objetivos.length === 0) {
                throw Object.assign(new Error('No hay créditos pendientes para aplicar el abono.'), { status: 404 });
            }

            const saldoTotalDisponible = +objetivos.reduce((acc, c) => acc + (Number(c.saldo_pendiente) || 0), 0).toFixed(4);
            if (montoUsdTotal > saldoTotalDisponible + 0.51) {
                throw Object.assign(
                    new Error(`El abono ($${montoUsdTotal.toFixed(4)}) excede el saldo pendiente ($${saldoTotalDisponible.toFixed(4)}).`),
                    { status: 409 }
                );
            }

            let restante = Math.min(montoUsdTotal, saldoTotalDisponible);
            const afectados = [];

            for (const c of objetivos) {
                if (restante <= 0.005) break;
                const saldoActual = Number(c.saldo_pendiente) || 0;
                if (saldoActual <= 0.005) continue;

                const aplicar = +Math.min(restante, saldoActual).toFixed(4);
                const nuevoSaldo = Math.max(0, +(saldoActual - aplicar).toFixed(4));
                const proporcion = montoUsdTotal > 0 ? aplicar / montoUsdTotal : 1;
                const recibidoParte = +(Number(pago.monto) * proporcion).toFixed(4);

                await executeInTx(
                    tx,
                    `INSERT INTO abonos_credito
                        (id_credito, fecha, monto, moneda, metodo, monto_recibido, moneda_base, tasa_cop, tasa_bs)
                     VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)`,
                    [
                        c.id_credito,
                        fechaFinal,
                        aplicar,
                        pago.moneda,
                        pago.metodo,
                        recibidoParte,
                        pago.moneda_base,
                        pago.tasa_cop,
                        pago.tasa_bs,
                    ]
                );

                await executeInTx(
                    tx,
                    `INSERT INTO pagos_venta
                        (id_venta, moneda, metodo, monto, monto_base, moneda_base, tasa_cop, tasa_bs)
                     VALUES (?, ?, ?, ?, ?, ?, ?, ?)`,
                    [
                        c.id_venta,
                        pago.moneda,
                        pago.metodo,
                        recibidoParte,
                        aplicar,
                        pago.moneda_base,
                        pago.tasa_cop,
                        pago.tasa_bs,
                    ]
                );

                await executeInTx(
                    tx,
                    'UPDATE creditos SET saldo_pendiente = ? WHERE id = ?',
                    [nuevoSaldo, c.id_credito]
                );

                let estadoVenta = 'pendiente';
                if (nuevoSaldo <= 0.01) {
                    estadoVenta = 'pagado';
                    await executeInTx(
                        tx,
                        "UPDATE ventas SET estado = 'pagado' WHERE id = ?",
                        [c.id_venta]
                    );
                }

                restante = +(restante - aplicar).toFixed(4);
                afectados.push({ id_credito: c.id_credito, id_venta: c.id_venta, aplicado: aplicar, estado: estadoVenta });
            }

            await registrarBitacoraEnTx(tx, {
                usuario,
                accion: ACCIONES.ABONO,
                entidad: 'creditos',
                entidadId: afectados[0]?.id_credito || '',
                detalle: `Abono $${montoUsdTotal.toFixed(4)} USD (${pago.moneda} - ${pago.metodo}) de cliente ${objetivos[0].cliente_nombre}`,
            });

            return { montoUsd: montoUsdTotal, afectados };
        });

        return new Response(
            JSON.stringify({ message: 'Abono registrado correctamente', ...resultado }),
            { status: 201, headers: jsonHeaders }
        );
    } catch (error) {
        const status = error.status || 500;
        console.error('Error al registrar abono en cuentas por cobrar:', error);
        return new Response(JSON.stringify({ error: error.message || 'Error al registrar abono' }), {
            status,
            headers: jsonHeaders,
        });
    }
}
