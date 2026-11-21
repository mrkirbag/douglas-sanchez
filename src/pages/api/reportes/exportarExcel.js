import { verificarToken } from '@/utils/auth';
import xlsx from 'xlsx';

function calcularAnchosColumnas(filas) {
    if (!Array.isArray(filas) || filas.length === 0) return [];
    const claves = Object.keys(filas[0]);
    return claves.map((clave) => {
        let maxLen = String(clave).length;
        for (const fila of filas) {
            const val = fila?.[clave];
            const len = val === null || val === undefined ? 0 : String(val).length;
            if (len > maxLen) maxLen = len;
        }
        return { wch: Math.min(Math.max(maxLen + 3, 10), 45) };
    });
}

export async function POST({ request }) {
    const usuario = verificarToken(request);
    if (!usuario) {
        return new Response(JSON.stringify({ error: 'No autorizado' }), {
            status: 401,
            headers: { 'Content-Type': 'application/json' },
        });
    }

    try {
        const body = await request.json();
        const nombreArchivoRaw = String(body?.nombreArchivo || 'reporte').replace(/[^a-zA-Z0-9_-]/g, '_');
        const hojas = Array.isArray(body?.hojas) ? body.hojas : [];

        if (hojas.length === 0) {
            return new Response(JSON.stringify({ error: 'No hay datos para exportar' }), {
                status: 400,
                headers: { 'Content-Type': 'application/json' },
            });
        }

        const workbook = xlsx.utils.book_new();

        hojas.forEach((hoja, idx) => {
            const filas = Array.isArray(hoja?.filas) && hoja.filas.length > 0
                ? hoja.filas
                : [{ Mensaje: 'Sin registros' }];
            const nombreHoja = String(hoja?.nombre || `Hoja_${idx + 1}`)
                .replace(/[\\/?*[\]:]/g, '')
                .slice(0, 31) || `Hoja_${idx + 1}`;

            const worksheet = xlsx.utils.json_to_sheet(filas);
            worksheet['!cols'] = calcularAnchosColumnas(filas);
            xlsx.utils.book_append_sheet(workbook, worksheet, nombreHoja);
        });

        const buffer = xlsx.write(workbook, { type: 'buffer', bookType: 'xlsx' });

        return new Response(buffer, {
            status: 200,
            headers: {
                'Content-Type': 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet',
                'Content-Disposition': `attachment; filename="${nombreArchivoRaw}.xlsx"`,
            },
        });
    } catch (error) {
        console.error('Error al generar Excel:', error);
        return new Response(JSON.stringify({ error: 'Error al generar el archivo Excel' }), {
            status: 500,
            headers: { 'Content-Type': 'application/json' },
        });
    }
}

