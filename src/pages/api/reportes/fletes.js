import { db } from '../db';
import { verificarToken } from '@/utils/auth';
import { ensureFiscalSchema } from '@/utils/ensureFiscalSchema.js';

const jsonHeaders = { 'Content-Type': 'application/json' };

export async function GET({ request }) {
    const usuario = verificarToken(request);
    if (!usuario) {
        return new Response(JSON.stringify({ error: 'No autorizado' }), { status: 401, headers: jsonHeaders });
    }
    if (usuario.rol !== 'admin') {
        return new Response(JSON.stringify({ error: 'Acceso denegado' }), { status: 403, headers: jsonHeaders });
    }

    const url = new URL(request.url);
    const desde = url.searchParams.get('desde');
    const hasta = url.searchParams.get('hasta');

    if (!desde || !hasta) {
        return new Response(JSON.stringify({ error: 'Fechas inválidas' }), { status: 400, headers: jsonHeaders });
    }
    if (hasta < desde) {
        return new Response(JSON.stringify({ error: 'Rango de fechas inválido' }), { status: 400, headers: jsonHeaders });
    }

    try {
        await ensureFiscalSchema(db);

        const [ventasRes, comprasRes] = await Promise.all([
            db.execute({
                sql: `
                    SELECT
                        v.id,
                        v.fecha,
                        v.tipo_documento,
                        v.nro_factura,
                        v.nro_nota_entrega,
                        v.tipo_pago,
                        v.estado,
                        v.total AS total_operacion,
                        COALESCE(v.flete_monto, 0) AS flete_monto,
                        COALESCE(c.nombre, 'Cliente') AS contraparte_nombre,
                        COALESCE(c.cedula, '') AS contraparte_doc
                    FROM ventas v
                    LEFT JOIN clientes c ON c.id = v.cliente_id
                    WHERE COALESCE(v.flete_monto, 0) > 0
                      AND v.estado IN ('completado', 'devuelto', 'pendiente')
                      AND v.nota_entrega_origen_id IS NULL
                      AND DATE(v.fecha) BETWEEN ? AND ?
                    ORDER BY v.fecha DESC, v.id DESC
                `,
                args: [desde, hasta],
            }),
            db.execute({
                sql: `
                    SELECT
                        id,
                        fecha,
                        tipo_documento,
                        nro_factura,
                        tipo_pago,
                        estado_pago AS estado,
                        monto_total AS total_operacion,
                        COALESCE(flete_monto, 0) AS flete_monto,
                        COALESCE(proveedor, 'Proveedor') AS contraparte_nombre,
                        COALESCE(proveedor_rif, '') AS contraparte_doc
                    FROM compras
                    WHERE COALESCE(flete_monto, 0) > 0
                      AND DATE(fecha) BETWEEN ? AND ?
                    ORDER BY fecha DESC, id DESC
                `,
                args: [desde, hasta],
            }),
        ]);

        const ventasMovs = (ventasRes.rows || []).map((r) => {
            const esNota = r.tipo_documento === 'nota_entrega';
            const nroDoc = esNota
                ? (r.nro_nota_entrega ? `NE-${String(r.nro_nota_entrega).padStart(6, '0')}` : 'Nota Entrega')
                : (r.nro_factura ? `FAC-${String(r.nro_factura).padStart(6, '0')}` : 'Factura');
            return {
                origen: 'Venta',
                id_transaccion: r.id,
                fecha: r.fecha,
                documento: nroDoc,
                contraparte: r.contraparte_nombre,
                contraparte_doc: r.contraparte_doc,
                tipo_pago: r.tipo_pago || 'contado',
                estado: r.estado || 'completado',
                flete_monto: +(Number(r.flete_monto || 0).toFixed(4)),
                total_operacion: +(Number(r.total_operacion || 0).toFixed(4)),
                url_detalle: `/ventas/${r.id}`,
            };
        });

        const comprasMovs = (comprasRes.rows || []).map((r) => {
            const esNota = r.tipo_documento === 'nota_entrega';
            const nroDoc = `${esNota ? 'NE' : 'FAC'}-${r.nro_factura || r.id}`;
            return {
                origen: 'Compra',
                id_transaccion: r.id,
                fecha: r.fecha,
                documento: nroDoc,
                contraparte: r.contraparte_nombre,
                contraparte_doc: r.contraparte_doc,
                tipo_pago: r.tipo_pago || 'contado',
                estado: r.estado || 'pagada',
                flete_monto: +(Number(r.flete_monto || 0).toFixed(4)),
                total_operacion: +(Number(r.total_operacion || 0).toFixed(4)),
                url_detalle: `/compras/${r.id}`,
            };
        });

        const movimientos = [...ventasMovs, ...comprasMovs].sort((a, b) =>
            String(b.fecha || '').localeCompare(String(a.fecha || ''))
        );

        const totalFletesVentas = +(ventasMovs.reduce((acc, m) => acc + m.flete_monto, 0).toFixed(4));
        const totalFletesCompras = +(comprasMovs.reduce((acc, m) => acc + m.flete_monto, 0).toFixed(4));
        const totalFletesGeneral = +(totalFletesVentas + totalFletesCompras).toFixed(4);

        return new Response(
            JSON.stringify({
                resumen: {
                    total_fletes_ventas: totalFletesVentas,
                    total_fletes_compras: totalFletesCompras,
                    total_fletes_general: totalFletesGeneral,
                    cantidad_ventas: ventasMovs.length,
                    cantidad_compras: comprasMovs.length,
                    cantidad_total: movimientos.length,
                },
                movimientos,
            }),
            { status: 200, headers: jsonHeaders }
        );
    } catch (error) {
        console.error('Error al generar reporte de fletes:', error);
        return new Response(JSON.stringify({ error: 'Error al generar reporte de fletes' }), { status: 500, headers: jsonHeaders });
    }
}
