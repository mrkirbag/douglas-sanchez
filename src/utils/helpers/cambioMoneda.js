let tasasCache = null;
let tasasCacheExpira = 0;
const CACHE_MS = 60_000;

function tasasDesdeRespuesta(data) {
    const cop = Number(data?.tasa_cop ?? data?.cop ?? data?.valor);
    const bs = Number(data?.tasa_bcv ?? data?.bs);
    const cop_a_bs = Number(data?.tasa_cop_bs ?? data?.cop_a_bs);
    const iva_porcentaje = data?.iva_porcentaje !== undefined ? Number(data.iva_porcentaje) : 16;
    const retencion_iva_porcentaje = data?.retencion_iva_porcentaje !== undefined ? Number(data.retencion_iva_porcentaje) : 75;

    if (!Number.isFinite(cop) || cop <= 0) {
        throw new Error('La tasa COP del día no es válida. Actualízala en Tasas y Retenciones.');
    }

    const bcvValido = Number.isFinite(bs) && bs > 0 ? bs : 0;
    const copBsValido = Number.isFinite(cop_a_bs) && cop_a_bs > 0 ? cop_a_bs : 0;

    return {
        cop,
        tasa_cop: cop,
        bs: bcvValido,
        tasa_bcv: bcvValido,
        cop_a_bs: copBsValido,
        tasa_cop_bs: copBsValido,
        iva_porcentaje: Number.isFinite(iva_porcentaje) ? iva_porcentaje : 16,
        retencion_iva_porcentaje: Number.isFinite(retencion_iva_porcentaje) ? retencion_iva_porcentaje : 75,
    };
}

export async function obtenerTasas({ strict = false } = {}) {
    if (tasasCache !== null && Date.now() < tasasCacheExpira) {
        return tasasCache;
    }

    try {
        const response = await fetch('/api/tasa');

        if (response.status === 204) {
            throw new Error('No hay tasa registrada. Configura la tasa del día primero.');
        }

        if (!response.ok) {
            throw new Error('Error al obtener la tasa de cambio');
        }

        const data = await response.json();
        const tasas = tasasDesdeRespuesta(data);

        tasasCache = tasas;
        tasasCacheExpira = Date.now() + CACHE_MS;

        return tasas;
    } catch (error) {
        console.error('Error fetching tasa:', error);

        if (strict) {
            throw error;
        }

        return tasasCache ?? {
            cop: 1,
            tasa_cop: 1,
            bs: 0,
            tasa_bcv: 0,
            cop_a_bs: 3,
            tasa_cop_bs: 3,
            iva_porcentaje: 16,
            retencion_iva_porcentaje: 75,
        };
    }
}

/** @deprecated Usar obtenerTasas(). Se mantiene para pantallas que aún convierten USD → COP a mano. */
export async function cambioUSDaCOP(opciones = {}) {
    const { cop } = await obtenerTasas(opciones);
    return cop;
}

/** Compatibilidad para pantallas legadas como presupuestos.astro. */
export async function obtenerTasasPrecios(opciones = {}) {
    const { cop, bs } = await obtenerTasas(opciones);
    return {
        tasaCopUsd: cop,
        tasaBcvUsd: bs,
        recargoBcv: 0,
    };
}

export function invalidarCacheTasa() {
    tasasCache = null;
    tasasCacheExpira = 0;
}
