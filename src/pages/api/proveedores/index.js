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

    try {
        await ensureFiscalSchema(db);

        const url = new URL(request.url);
        const search = (url.searchParams.get('search') || '').trim().toLowerCase();

        const provRes = await db.execute(
            `SELECT
                p.id,
                p.nombre,
                p.rif,
                p.telefono,
                p.direccion,
                p.email,
                p.fecha_creacion,
                COUNT(c.id) AS total_compras,
                COALESCE(SUM(c.monto_total), 0) AS total_comprado_usd,
                COALESCE(SUM(
                    CASE
                        WHEN c.tipo_pago = 'credito' AND c.estado_pago = 'pendiente'
                        THEN MAX(0, c.monto_total - c.monto_abonado)
                        ELSE 0
                    END
                ), 0) AS deuda_pendiente_usd,
                MAX(c.fecha) AS ultima_compra
             FROM proveedores p
             LEFT JOIN compras c ON c.proveedor_id = p.id
             WHERE IFNULL(p.estatus, 'activo') = 'activo'
             GROUP BY p.id
             ORDER BY p.nombre COLLATE NOCASE ASC`
        );

        let filas = (provRes.rows || []).map((r) => ({
            id: r.id,
            nombre: String(r.nombre || ''),
            rif: String(r.rif || ''),
            telefono: String(r.telefono || ''),
            direccion: String(r.direccion || ''),
            email: String(r.email || ''),
            fecha_creacion: r.fecha_creacion || '',
            total_compras: Number(r.total_compras) || 0,
            total_comprado_usd: +(Number(r.total_comprado_usd) || 0).toFixed(4),
            deuda_pendiente_usd: +(Number(r.deuda_pendiente_usd) || 0).toFixed(4),
            ultima_compra: r.ultima_compra || null,
        }));

        if (search) {
            filas = filas.filter(
                (p) =>
                    p.nombre.toLowerCase().includes(search) ||
                    p.rif.toLowerCase().includes(search) ||
                    p.telefono.toLowerCase().includes(search)
            );
        }

        return new Response(JSON.stringify(filas), { status: 200, headers: jsonHeaders });
    } catch (error) {
        console.error('Error al obtener proveedores:', error);
        return new Response(JSON.stringify({ error: 'Error al obtener proveedores' }), { status: 500, headers: jsonHeaders });
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
        const nombre = String(body.nombre || '').trim();
        const rif = String(body.rif || '').trim().toUpperCase();
        const telefono = String(body.telefono || '').trim();
        const direccion = String(body.direccion || '').trim();
        const email = String(body.email || '').trim();

        if (!nombre) {
            return new Response(JSON.stringify({ error: 'El nombre del proveedor es obligatorio' }), { status: 400, headers: jsonHeaders });
        }

        if (rif) {
            const dup = await db.execute(
                `SELECT id, estatus FROM proveedores WHERE UPPER(TRIM(rif)) = ?`,
                [rif]
            );
            const existente = dup.rows?.[0];
            if (existente) {
                if (existente.estatus === 'activo') {
                    return new Response(JSON.stringify({ error: `Ya existe un proveedor activo con el RIF ${rif}` }), { status: 409, headers: jsonHeaders });
                }
                await db.execute(
                    `UPDATE proveedores SET nombre = ?, telefono = ?, direccion = ?, email = ?, estatus = 'activo' WHERE id = ?`,
                    [nombre, telefono, direccion, email, existente.id]
                );
                return new Response(JSON.stringify({ message: 'Proveedor reactivado exitosamente', id: existente.id }), { status: 201, headers: jsonHeaders });
            }
        }

        const ins = await db.execute(
            `INSERT INTO proveedores (nombre, rif, telefono, direccion, email, estatus)
             VALUES (?, ?, ?, ?, ?, 'activo') RETURNING id`,
            [nombre, rif, telefono, direccion, email]
        );

        return new Response(
            JSON.stringify({ message: 'Proveedor registrado exitosamente', id: ins.rows?.[0]?.id }),
            { status: 201, headers: jsonHeaders }
        );
    } catch (error) {
        console.error('Error al crear proveedor:', error);
        return new Response(JSON.stringify({ error: 'Error al crear proveedor' }), { status: 500, headers: jsonHeaders });
    }
}

export async function PUT({ request }) {
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
        const id = String(body.id || '').trim();
        const nombre = String(body.nombre || '').trim();
        const rif = String(body.rif || '').trim().toUpperCase();
        const telefono = String(body.telefono || '').trim();
        const direccion = String(body.direccion || '').trim();
        const email = String(body.email || '').trim();

        if (!id || !nombre) {
            return new Response(JSON.stringify({ error: 'Faltan datos obligatorios del proveedor' }), { status: 400, headers: jsonHeaders });
        }

        if (rif) {
            const dup = await db.execute(
                `SELECT id FROM proveedores WHERE UPPER(TRIM(rif)) = ? AND id != ? AND IFNULL(estatus, 'activo') = 'activo'`,
                [rif, id]
            );
            if (dup.rows?.length) {
                return new Response(JSON.stringify({ error: `Ya existe otro proveedor activo con el RIF ${rif}` }), { status: 409, headers: jsonHeaders });
            }
        }

        const res = await db.execute(
            `UPDATE proveedores SET nombre = ?, rif = ?, telefono = ?, direccion = ?, email = ? WHERE id = ?`,
            [nombre, rif, telefono, direccion, email, id]
        );

        if ((res.rowsAffected ?? res.affectedRows ?? 0) === 0) {
            return new Response(JSON.stringify({ error: 'Proveedor no encontrado' }), { status: 404, headers: jsonHeaders });
        }

        // Sincronizar nombre y RIF en compras vinculadas para mantener consistencia en reportes y Cuentas por Pagar
        await db.execute(
            `UPDATE compras SET proveedor = ?, proveedor_rif = ? WHERE proveedor_id = ?`,
            [nombre, rif, id]
        );

        return new Response(JSON.stringify({ message: 'Proveedor actualizado exitosamente' }), { status: 200, headers: jsonHeaders });
    } catch (error) {
        console.error('Error al actualizar proveedor:', error);
        return new Response(JSON.stringify({ error: 'Error al actualizar proveedor' }), { status: 500, headers: jsonHeaders });
    }
}

export async function DELETE({ request }) {
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
        const id = String(body.id || '').trim();

        if (!id) {
            return new Response(JSON.stringify({ error: 'Falta el ID del proveedor' }), { status: 400, headers: jsonHeaders });
        }

        const pendientes = await db.execute(
            `SELECT COUNT(*) AS total FROM compras WHERE proveedor_id = ? AND tipo_pago = 'credito' AND estado_pago = 'pendiente'`,
            [id]
        );

        if (Number(pendientes.rows?.[0]?.total || 0) > 0) {
            return new Response(
                JSON.stringify({ error: 'No se puede eliminar el proveedor porque tiene cuentas por pagar pendientes.' }),
                { status: 409, headers: jsonHeaders }
            );
        }

        const res = await db.execute(
            `UPDATE proveedores SET estatus = 'inactivo' WHERE id = ?`,
            [id]
        );

        if ((res.rowsAffected ?? res.affectedRows ?? 0) === 0) {
            return new Response(JSON.stringify({ error: 'Proveedor no encontrado' }), { status: 404, headers: jsonHeaders });
        }

        return new Response(JSON.stringify({ message: 'Proveedor eliminado exitosamente' }), { status: 200, headers: jsonHeaders });
    } catch (error) {
        console.error('Error al eliminar proveedor:', error);
        return new Response(JSON.stringify({ error: 'Error al eliminar proveedor' }), { status: 500, headers: jsonHeaders });
    }
}
