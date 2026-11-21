import empresa from '@/data/empresa.json';

export const MONEDAS = Object.freeze({
    USD: 'USD',
    COP: 'COP',
    BS: 'BS',
});

const ETIQUETAS = {
    USD: 'USD',
    COP: 'COP',
    BS: 'Bs',
};

/**
 * Moneda en la que el comercio carga sus precios.
 * USD: referencia COP = precio_divisas USD × tasa_cop; Bs = precio_bcv USD × tasa_bcv
 */
export function obtenerMonedaBase() {
    return empresa?.monedaBase === MONEDAS.COP ? MONEDAS.COP : MONEDAS.USD;
}

export function etiquetaMoneda(moneda) {
    return ETIQUETAS[String(moneda || '').toUpperCase()] || String(moneda || '');
}

export function formatearDecimal(valor, min = 2, max = 2) {
    const n = Math.round((Number(valor) || 0) * 100) / 100;
    const fixedMax = n.toFixed(max);
    const trimmed = fixedMax.replace(/(\.\d*?[1-9])0+$/, '$1').replace(/\.0+$/, '');
    const [, dec = ''] = trimmed.split('.');
    if (dec.length < min) {
        return n.toFixed(min);
    }
    return trimmed;
}

/** Dólares: redondeo a 2 decimales. */
export function redondearUSD(valor) {
    const n = Number(valor);
    if (!Number.isFinite(n) || n <= 0) return 0;
    return Math.round(n * 100) / 100;
}

/** Pesos: siempre hacia la cifra de 100 inmediata superior (19220 → 19300). */
export function redondearCOP(valor) {
    const n = Number(valor);
    if (!Number.isFinite(n) || n <= 0) return 0;
    return Math.ceil(n / 100) * 100;
}

/** Bolívares: redondeo a 2 decimales. */
export function redondearBS(valor) {
    const n = Number(valor);
    if (!Number.isFinite(n) || n <= 0) return 0;
    return Math.round(n * 100) / 100;
}

export function redondearMoneda(valor, moneda) {
    switch (String(moneda || '').toUpperCase()) {
        case MONEDAS.COP:
            return redondearCOP(valor);
        case MONEDAS.BS:
            return redondearBS(valor);
        case MONEDAS.USD:
        default:
            return redondearUSD(valor);
    }
}

function tasasValidas(tasas) {
    const cop = Number(tasas?.tasa_cop ?? tasas?.cop) > 0 ? Number(tasas?.tasa_cop ?? tasas?.cop) : 0;
    const bs = Number(tasas?.tasa_bcv ?? tasas?.bs) > 0 ? Number(tasas?.tasa_bcv ?? tasas?.bs) : 0;
    const cop_a_bs = Number(tasas?.tasa_cop_bs ?? tasas?.cop_a_bs) > 0 ? Number(tasas?.tasa_cop_bs ?? tasas?.cop_a_bs) : 0;
    const iva_porcentaje = Number.isFinite(Number(tasas?.iva_porcentaje)) ? Number(tasas.iva_porcentaje) : 16;
    const retencion_iva_porcentaje = Number.isFinite(Number(tasas?.retencion_iva_porcentaje)) ? Number(tasas.retencion_iva_porcentaje) : 75;
    return { cop, bs, cop_a_bs, iva_porcentaje, retencion_iva_porcentaje };
}

function aUsd(monto, moneda, tasas) {
    const n = Number(monto);
    const origen = String(moneda || '').toUpperCase();
    const { cop, bs } = tasasValidas(tasas);

    if (!Number.isFinite(n) || n <= 0) return 0;
    if (origen === MONEDAS.USD) return n;
    if (origen === MONEDAS.COP) return cop > 0 ? n / cop : 0;
    if (origen === MONEDAS.BS) return bs > 0 ? n / bs : 0;
    return 0;
}

/** Convierte un monto pagado en USD, COP o Bs a la moneda base del comercio. */
export function convertirAMonedaBase(monto, monedaOrigen, monedaBase, tasas) {
    const n = Number(monto);
    const origen = String(monedaOrigen || '').toUpperCase();
    const base = String(monedaBase || obtenerMonedaBase()).toUpperCase();
    const { cop, bs } = tasasValidas(tasas);

    if (!Number.isFinite(n) || n <= 0) return 0;
    if (origen === base) return n;

    const usd = aUsd(n, origen, { cop, bs });
    if (base === MONEDAS.USD) return usd;
    if (base === MONEDAS.COP) return cop > 0 ? usd * cop : 0;
    return bs > 0 ? usd * bs : 0;
}

export function toleranciaPago(monedaBase) {
    const base = String(monedaBase || obtenerMonedaBase()).toUpperCase();
    if (base === MONEDAS.COP) return 100;
    if (base === MONEDAS.BS) return 0.05;
    return 0.51;
}

/**
 * Convierte el precio_divisas a USD y COP usando tasa_cop según la moneda base.
 */
export function convertirPrecioDivisas(precioDivisas, tasas) {
    const { cop: tasaCop } = tasasValidas(tasas);
    if (obtenerMonedaBase() === MONEDAS.COP) {
        const cop = redondearCOP(precioDivisas);
        const usd = tasaCop > 0 ? redondearUSD(cop / tasaCop) : 0;
        return { usd, cop };
    }
    const usd = redondearUSD(precioDivisas);
    return {
        usd,
        cop: tasaCop > 0 ? redondearCOP(usd * tasaCop) : 0,
    };
}

/**
 * Calcula el precio BCV en Bs a partir del precio en COP usando tasa_cop_bs.
 */
export function calcularBcvDesdeCop(precioCop, tasas) {
    const { cop_a_bs } = tasasValidas(tasas);
    const cop = Number(precioCop) || 0;
    if (cop <= 0 || cop_a_bs <= 0) return 0;
    return redondearBS(cop / cop_a_bs);
}

/**
 * Convierte el precio_bcv (en Bs si monedaBase es COP, o en USD si monedaBase es USD)
 * y calcula su equivalente en USD según tasa_bcv e IVA.
 */
export function convertirPrecioBcv(precioBcv, tasas, { exento = false } = {}) {
    const { bs: tasaBcv, iva_porcentaje } = tasasValidas(tasas);
    const alicuota = exento ? 0 : iva_porcentaje;

    if (obtenerMonedaBase() === MONEDAS.COP) {
        const baseBs = redondearBS(precioBcv);
        const ivaBs = redondearBS(baseBs * (alicuota / 100));
        const totalBs = redondearBS(baseBs + ivaBs);
        const baseUsd = tasaBcv > 0 ? redondearUSD(baseBs / tasaBcv) : 0;
        const ivaUsd = tasaBcv > 0 ? redondearUSD(ivaBs / tasaBcv) : 0;
        const totalUsd = tasaBcv > 0 ? redondearUSD(totalBs / tasaBcv) : 0;

        return {
            baseUsd,
            ivaUsd,
            totalUsd,
            baseBs,
            ivaBs,
            totalBs,
            alicuota,
            exento: Boolean(exento),
        };
    }

    const baseUsd = redondearUSD(precioBcv);
    const ivaUsd = redondearUSD(baseUsd * (alicuota / 100));
    const totalUsd = redondearUSD(baseUsd + ivaUsd);
    const baseBs = tasaBcv > 0 ? redondearBS(baseUsd * tasaBcv) : 0;
    const ivaBs = tasaBcv > 0 ? redondearBS(ivaUsd * tasaBcv) : 0;
    const totalBs = tasaBcv > 0 ? redondearBS(totalUsd * tasaBcv) : 0;

    return {
        baseUsd,
        ivaUsd,
        totalUsd,
        baseBs,
        ivaBs,
        totalBs,
        alicuota,
        exento: Boolean(exento),
    };
}

/**
 * Convierte un precio en la moneda base del comercio a USD, COP y Bs.
 */
export function convertirPrecio(precio, monedaBase, tasas) {
    const n = Number(precio);
    const { cop: tasaCop, bs: tasaBs } = tasasValidas(tasas);
    const base = String(monedaBase || obtenerMonedaBase()).toUpperCase();

    if (!Number.isFinite(n) || n <= 0) {
        return { usd: 0, cop: 0, bs: 0 };
    }

    if (base === MONEDAS.COP) {
        const cop = redondearCOP(n);
        const usdPivot = tasaCop > 0 ? cop / tasaCop : 0;
        return {
            usd: redondearUSD(usdPivot),
            cop,
            bs: tasaBs > 0 ? redondearBS(usdPivot * tasaBs) : 0,
        };
    }

    const usd = redondearUSD(n);
    return {
        usd,
        cop: tasaCop > 0 ? redondearCOP(usd * tasaCop) : 0,
        bs: tasaBs > 0 ? redondearBS(usd * tasaBs) : 0,
    };
}

export function formatearMoneda(valor, moneda) {
    const codigo = String(moneda || '').toUpperCase();
    const n = Number(valor) || 0;
    const etiqueta = etiquetaMoneda(codigo);

    if (codigo === MONEDAS.COP) {
        if (Math.abs(n - Math.round(n)) > 0.009) {
            return `${formatearDecimal(n, 0, 2)} ${etiqueta}`;
        }
        return `${Math.round(n).toLocaleString('es-CO')} ${etiqueta}`;
    }

    return `${formatearDecimal(n, 2, 2)} ${etiqueta}`;
}

function monedasVisibles(montos, tasas) {
    const { cop, bs } = tasasValidas(tasas);
    return [
        montos.usd > 0 ? MONEDAS.USD : null,
        cop > 0 && montos.cop > 0 ? MONEDAS.COP : null,
        bs > 0 && montos.bs > 0 ? MONEDAS.BS : null,
    ].filter(Boolean);
}

export function textoReferencia(precio, monedaBase, tasas) {
    const n = Number(String(precio).replace(',', '.'));
    if (!Number.isFinite(n) || n <= 0) {
        return 'Referencia: —';
    }

    const base = String(monedaBase || obtenerMonedaBase()).toUpperCase();
    const montos = convertirPrecio(n, base, tasas);
    const otras = monedasVisibles(montos, tasas).filter((moneda) => moneda !== base);

    if (otras.length === 0) {
        return 'Referencia: —';
    }

    const partes = otras.map((moneda) => formatearMoneda(montos[moneda.toLowerCase()], moneda));
    return `Referencia: ${partes.join(' · ')}`;
}

export function textoTotal(precio, monedaBase, tasas) {
    const n = Number(precio);
    if (!Number.isFinite(n) || n <= 0) {
        return '—';
    }

    const base = String(monedaBase || obtenerMonedaBase()).toUpperCase();
    const montos = convertirPrecio(n, base, tasas);
    return monedasVisibles(montos, tasas)
        .map((moneda) => formatearMoneda(montos[moneda.toLowerCase()], moneda))
        .join(' · ');
}

export function desgloseMontos(precio, monedaBase, tasas) {
    const base = String(monedaBase || obtenerMonedaBase()).toUpperCase();
    const montos = convertirPrecio(precio, base, tasas);
    const visibles = monedasVisibles(montos, tasas);
    const principal = visibles.includes(base) ? base : (visibles[0] || base);
    const secundarias = visibles.filter((moneda) => moneda !== principal);

    return {
        montos,
        principal: formatearMoneda(montos[principal.toLowerCase()], principal),
        secundarias: secundarias
            .map((moneda) => formatearMoneda(montos[moneda.toLowerCase()], moneda))
            .join(' · '),
    };
}
