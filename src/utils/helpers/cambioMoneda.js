export async function cambioUSDaCOP() {
    try {
        const response = await fetch('/api/tasa');
        if (!response.ok) throw new Error('Error al obtener la tasa de cambio');

        const data = await response.json();
        return Number(data.valor);
    } catch (error) {
        console.error('Error fetching tasa:', error);
        throw error;
    }
}

/** Tasa BCV: bolívares por 1 USD (para precio en Bs = pventa_bcv × tasa) */
export async function cambioBcv() {
    try {
        const response = await fetch('/api/tasaBcv');
        if (!response.ok) throw new Error('Error al obtener la tasa BCV');

        if (response.status === 204) return 0;

        const data = await response.json();
        return Number(data.valor);
    } catch (error) {
        console.error('Error fetching tasa BCV:', error);
        throw error;
    }
}

/** @deprecated Usar cambioBcv() — mantenido por compatibilidad */
export async function cambioBs() {
    return cambioBcv();
}

export async function obtenerRecargoBcv() {
    try {
        const response = await fetch('/api/configPrecios');
        if (!response.ok) return 35;

        const data = await response.json();
        return Number(data.recargo_bcv ?? 35);
    } catch {
        return 35;
    }
}

export async function obtenerTasasPrecios() {
    const [tasaCopUsd, tasaBcvUsd, recargoBcv] = await Promise.all([
        cambioUSDaCOP(),
        cambioBcv(),
        obtenerRecargoBcv(),
    ]);
    return { tasaCopUsd, tasaBcvUsd, recargoBcv };
}
