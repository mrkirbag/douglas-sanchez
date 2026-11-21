import { db } from '../db';
import { verificarToken } from '@/utils/auth';
import { ACCIONES, registrarBitacora } from '@/utils/bitacora.js';
import { ensureFiscalSchema } from '@/utils/ensureFiscalSchema.js';
import { obtenerMonedaBase } from '@/utils/helpers/tasas.js';

function payloadTasa(row) {
    const cop = Number(row?.valor) || 0;
    const bs = Number(row?.bs) || 0;
    const copABs = Number(row?.cop_a_bs) || 3;
    const ivaPorcentaje = row?.iva_porcentaje !== undefined && row?.iva_porcentaje !== null
        ? Number(row.iva_porcentaje)
        : 16;
    const retencionIvaPorcentaje = row?.retencion_iva_porcentaje !== undefined && row?.retencion_iva_porcentaje !== null
        ? Number(row.retencion_iva_porcentaje)
        : 75;

    return {
        id: row?.id ?? 1,
        valor: cop,
        cop,
        tasa_cop: cop,
        bs,
        tasa_bcv: bs,
        cop_a_bs: copABs,
        tasa_cop_bs: copABs,
        iva_porcentaje: Number.isFinite(ivaPorcentaje) ? ivaPorcentaje : 16,
        retencion_iva_porcentaje: Number.isFinite(retencionIvaPorcentaje) ? retencionIvaPorcentaje : 75,
    };
}

export async function GET({ request }) {
    const usuario = await verificarToken(request);
    if (!usuario) {
        return new Response(JSON.stringify({ error: 'No autorizado' }), { status: 401 });
    }

    try {
        await ensureFiscalSchema(db);
        const tasa = await db.execute('SELECT * FROM tasa WHERE id = 1');

        if (!tasa || !tasa.rows || tasa.rows.length === 0) {
            return new Response(JSON.stringify({ message: 'No hay tasa registrada' }), {
                headers: { 'Content-Type': 'application/json' },
                status: 204
            });
        }

        return new Response(JSON.stringify(payloadTasa(tasa.rows[0])), {
            headers: { 'Content-Type': 'application/json' },
            status: 200
        });
    } catch (error) {
        console.error('Error fetching tasa:', error);
        return new Response('Error fetching tasa', { status: 500 });
    }
}

export async function PUT({ request }) {
    const usuario = await verificarToken(request);
    if (!usuario) {
        return new Response(JSON.stringify({ error: 'No autorizado' }), { status: 401 });
    }

    try {
        await ensureFiscalSchema(db);
        const body = await request.json();
        const cop = Number(body.tasa_cop ?? body.cop ?? body.tasa);
        const bs = Number(body.tasa_bcv ?? body.bs);
        const copABs = Number(body.tasa_cop_bs ?? body.cop_a_bs ?? 3);
        const ivaPorcentaje = body.iva_porcentaje !== undefined ? Number(body.iva_porcentaje) : 16;
        const retencionIvaPorcentaje = body.retencion_iva_porcentaje !== undefined ? Number(body.retencion_iva_porcentaje) : 75;

        if (!Number.isFinite(cop) || cop <= 0) {
            return new Response(JSON.stringify({ error: 'La tasa COP debe ser un número mayor a 0' }), {
                headers: { 'Content-Type': 'application/json' },
                status: 400
            });
        }

        if (!Number.isFinite(bs) || bs <= 0) {
            return new Response(JSON.stringify({ error: 'La tasa BCV (Bs) debe ser un número mayor a 0' }), {
                headers: { 'Content-Type': 'application/json' },
                status: 400
            });
        }

        if (!Number.isFinite(copABs) || copABs <= 0) {
            return new Response(JSON.stringify({ error: 'La tasa COP a Bs debe ser un número mayor a 0' }), {
                headers: { 'Content-Type': 'application/json' },
                status: 400
            });
        }

        if (!Number.isFinite(ivaPorcentaje) || ivaPorcentaje < 0 || ivaPorcentaje > 100) {
            return new Response(JSON.stringify({ error: 'El porcentaje de IVA debe estar entre 0 y 100' }), {
                headers: { 'Content-Type': 'application/json' },
                status: 400
            });
        }

        if (!Number.isFinite(retencionIvaPorcentaje) || retencionIvaPorcentaje < 0 || retencionIvaPorcentaje > 100) {
            return new Response(JSON.stringify({ error: 'El porcentaje de retención de IVA debe estar entre 0 y 100' }), {
                headers: { 'Content-Type': 'application/json' },
                status: 400
            });
        }

        await db.execute({
            sql: `
                INSERT INTO tasa (id, valor, bs, cop_a_bs, iva_porcentaje, retencion_iva_porcentaje)
                VALUES (1, ?, ?, ?, ?, ?)
                ON CONFLICT(id) DO UPDATE SET
                    valor = excluded.valor,
                    bs = excluded.bs,
                    cop_a_bs = excluded.cop_a_bs,
                    iva_porcentaje = excluded.iva_porcentaje,
                    retencion_iva_porcentaje = excluded.retencion_iva_porcentaje
            `,
            args: [cop, bs, copABs, ivaPorcentaje, retencionIvaPorcentaje],
        });

        let productosActualizados = 0;
        if (obtenerMonedaBase() === 'COP' && copABs > 0) {
            const upd = await db.execute({
                sql: "UPDATE productos SET precio_bcv = ROUND(precio_divisas / ?, 2) WHERE estatus = 'activo' AND precio_divisas > 0",
                args: [copABs],
            });
            productosActualizados = upd.rowsAffected ?? 0;
        }

        await registrarBitacora(db, {
            usuario,
            accion: ACCIONES.TASA,
            entidad: 'tasa',
            entidadId: 1,
            detalle: `Tasa COP ${cop} · Tasa BCV ${bs} Bs · Tasa COP→Bs ${copABs} · IVA ${ivaPorcentaje}% · Ret. IVA ${retencionIvaPorcentaje}% · Productos BCV actualizados: ${productosActualizados}`,
        });

        return new Response(JSON.stringify({
            message: `Tasas actualizadas exitosamente${productosActualizados > 0 ? ` (${productosActualizados} productos recalculados en Bs)` : ''}`,
            productosActualizados,
        }), {
            headers: { 'Content-Type': 'application/json' },
            status: 200
        });
    } catch (error) {
        console.error('Error updating tasa:', error);
        return new Response(JSON.stringify({ error: 'Error al actualizar tasas y retenciones' }), {
            headers: { 'Content-Type': 'application/json' },
            status: 500
        });
    }
}
