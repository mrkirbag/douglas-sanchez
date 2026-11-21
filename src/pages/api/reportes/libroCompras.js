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

        const res = await db.execute({
            sql: `
                SELECT
                    id,
                    fecha,
                    proveedor,
                    proveedor_rif,
                    nro_factura,
                    nro_control,
                    tipo_documento,
                    moneda,
                    tasa_bcv,
                    subtotal_base,
                    subtotal_exento,
                    iva_porcentaje,
                    iva_monto,
                    retencion_iva_porcentaje,
                    retencion_iva_monto,
                    comprobante_retencion,
                    monto_total
                FROM compras
                WHERE DATE(fecha) BETWEEN ? AND ?
                ORDER BY fecha ASC, id ASC
            `,
            args: [desde, hasta]
        });

        return new Response(JSON.stringify(res.rows || []), {
            status: 200,
            headers: { 'Content-Type': 'application/json' }
        });
    } catch (err) {
        console.error('Error en libroCompras:', err);
        return new Response(JSON.stringify({ error: 'Error interno del servidor' }), {
            status: 500,
            headers: { 'Content-Type': 'application/json' }
        });
    }
}

