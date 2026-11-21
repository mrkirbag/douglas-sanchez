/**
 * Solicita al servidor la generación de un archivo .xlsx con columnas autoajustadas
 * y dispara la descarga en el navegador.
 */
export async function descargarExcel({ nombreArchivo, hojas }) {
    const res = await fetch('/api/reportes/exportarExcel', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ nombreArchivo, hojas }),
    });

    if (!res.ok) {
        let mensaje = 'No se pudo exportar a Excel';
        try {
            const err = await res.json();
            if (err?.error) mensaje = err.error;
        } catch {
            // ignorar
        }
        throw new Error(mensaje);
    }

    const blob = await res.blob();
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url;
    a.download = `${String(nombreArchivo || 'reporte').replace(/[^a-zA-Z0-9_-]/g, '_')}.xlsx`;
    document.body.appendChild(a);
    a.click();
    a.remove();
    URL.revokeObjectURL(url);
}

