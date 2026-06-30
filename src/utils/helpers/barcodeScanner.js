export function normalizarCodigo(codigo) {
    return String(codigo || '')
        .trim()
        .toUpperCase()
        // Algunos lectores envían ' en lugar de - (layout de teclado)
        .replace(/[''`´]/g, '-');
}

export async function buscarProductoPorCodigo(codigo) {
    const codigoNormalizado = normalizarCodigo(codigo);
    if (!codigoNormalizado) return null;

    const response = await fetch(`/api/productos/codigo/${encodeURIComponent(codigoNormalizado)}`);

    if (!response.ok) return null;

    return response.json();
}

export function initBarcodeScanner(input, onScan, { refocusInput = true } = {}) {
    if (!input) return;

    input.addEventListener('keydown', (e) => {
        if (e.key !== 'Enter') return;

        e.preventDefault();

        const codigo = normalizarCodigo(input.value);
        input.value = '';

        if (codigo) onScan(codigo);

        if (refocusInput) input.focus();
    });

    input.focus();
}
