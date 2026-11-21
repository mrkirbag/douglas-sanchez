import { db } from '../db';
import { verificarToken } from '@/utils/auth';
import { ensureFiscalSchema } from '@/utils/ensureFiscalSchema.js';

export async function GET({ request }) {
    const usuario = await verificarToken(request);
    if (!usuario) {
        return new Response(JSON.stringify({ error: 'No autorizado' }), {
            status: 401,
            headers: { 'Content-Type': 'application/json' }
        });
    }
    if (usuario.rol !== 'admin') {
        return new Response(JSON.stringify({ error: 'Acceso denegado' }), {
            status: 403,
            headers: { 'Content-Type': 'application/json' }
        });
    }

    const url = new URL(request.url);
    const desde = url.searchParams.get('desde');
    const hasta = url.searchParams.get('hasta');

    if (!desde || !hasta) {
        return new Response(JSON.stringify({ error: 'Fechas inválidas' }), {
            status: 400,
            headers: { 'Content-Type': 'application/json' }
        });
    }

    if (hasta < desde) {
        return new Response(JSON.stringify({ error: 'Rango de fechas inválido' }), {
            status: 400,
            headers: { 'Content-Type': 'application/json' }
        });
    }

    try {
        await ensureFiscalSchema(db);

        const cierres = await db.execute({
            sql: `
                SELECT
                    id,
                    nro_reporte_z,
                    fecha_apertura,
                    hora_apertura,
                    fecha_cierre,
                    hora_cierre,
                    usuario_apertura_nombre,
                    usuario_cierre_nombre,
                    tasa_bcv_cierre,
                    tasa_cop_cierre,
                    total_ventas_contado,
                    total_ventas_credito,
                    base_imponible_usd,
                    base_imponible_bs,
                    exento_usd,
                    exento_bs,
                    iva_usd,
                    iva_bs,
                    retencion_iva_usd,
                    retencion_iva_bs,
                    total_facturado_usd,
                    total_facturado_bs,
                    total_devoluciones_usd,
                    total_devoluciones_bs,
                    cantidad_facturas,
                    primera_factura,
                    ultima_factura,
                    observaciones
                FROM cajas
                WHERE estado = 'cerrada'
                  AND DATE(COALESCE(fecha_cierre, fecha_apertura)) BETWEEN ? AND ?
                ORDER BY nro_reporte_z DESC, fecha_cierre DESC, hora_cierre DESC
            `,
            args: [desde, hasta]
        });

        return new Response(JSON.stringify(cierres.rows || []), {
            status: 200,
            headers: { 'Content-Type': 'application/json' }
        });
    } catch (err) {
        console.error('Error en reportesZ:', err);
        return new Response(JSON.stringify({ error: 'Error interno del servidor' }), {
            status: 500,
            headers: { 'Content-Type': 'application/json' }
        });
    }
}

