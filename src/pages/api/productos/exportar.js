import { db } from '../db';
import { verificarToken } from '@/utils/auth';
import { ensureFiscalSchema } from '@/utils/ensureFiscalSchema.js';
import xlsx from 'xlsx';

export async function GET({ request }) {
    const usuario = await verificarToken(request);
    if (!usuario) {
        return new Response(JSON.stringify({ error: 'No autorizado' }), { status: 401 });
    }
    if (usuario.rol !== 'admin') {
        return new Response(JSON.stringify({ error: 'Acceso denegado' }), { status: 403 });
    }

    try {
        await ensureFiscalSchema(db);
        const result = await db.execute(
            "SELECT codigo, nombre, stock, unidad_medida, costo, precio_divisas, precio_bcv, exento_iva FROM productos WHERE estatus = 'activo'"
        );
        const productos = result.rows.map((p) => ({
            codigo: p.codigo,
            nombre: p.nombre,
            cantidad: p.stock,
            unidad_medida: p.unidad_medida,
            costo_usd: p.costo,
            precio_divisas_usd: Number(p.precio_divisas) || Number(p.venta) || 0,
            precio_bcv_usd: Number(p.precio_bcv) || Number(p.venta) || 0,
            exento_iva: Number(p.exento_iva) ? 'SI' : 'NO',
        }));

        const worksheet = xlsx.utils.json_to_sheet(productos);
        worksheet['!cols'] = [
            { wch: 16 },
            { wch: 36 },
            { wch: 12 },
            { wch: 16 },
            { wch: 14 },
            { wch: 20 },
            { wch: 18 },
            { wch: 12 },
        ];

        const workbook = xlsx.utils.book_new();
        xlsx.utils.book_append_sheet(workbook, worksheet, 'Productos');

        const buffer = xlsx.write(workbook, { type: 'buffer', bookType: 'xlsx' });

        return new Response(buffer, {
            status: 200,
            headers: {
                'Content-Type':
                'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet',
                'Content-Disposition': 'attachment; filename="productos.xlsx"',
            },
        });
    } catch (error) {
        console.error('Error al exportar productos:', error);
        return new Response(JSON.stringify({ error: 'Error al exportar productos' }), {
            status: 500,
            headers: { 'Content-Type': 'application/json' },
        });
    }
}
