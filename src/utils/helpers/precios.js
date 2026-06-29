export const RECARGO_BCV_DEFAULT = 35;

/** USD con recargo BCV a partir del precio en COP */
export function calcularPventaBcv(ventaCop, tasaCopUsd, recargoBcv = RECARGO_BCV_DEFAULT) {
    const cop = Number(ventaCop) || 0;
    const tasa = Number(tasaCopUsd) || 0;
    if (tasa <= 0) return 0;
    return (cop / tasa) * (1 + Number(recargoBcv) / 100);
}

/** Precio en Bs según modalidad BCV (pventa_bcv × tasa BCV USD) */
export function calcularBsBcv(pventaBcv, tasaBcvUsd) {
    return (Number(pventaBcv) || 0) * (Number(tasaBcvUsd) || 0);
}

/** Bs BCV a partir de COP usando tasas y recargo actuales */
export function calcularBsBcvDesdeCop(ventaCop, tasaCopUsd, tasaBcvUsd, recargoBcv = RECARGO_BCV_DEFAULT) {
    const pventaBcv = calcularPventaBcv(ventaCop, tasaCopUsd, recargoBcv);
    return calcularBsBcv(pventaBcv, tasaBcvUsd);
}

/** Desglose completo de precios para un producto */
export function calcularPreciosProducto(
    { venta, pventa_bcv },
    { tasaCopUsd, tasaBcvUsd, recargoBcv = RECARGO_BCV_DEFAULT }
) {
    const cop = Number(venta) || 0;
    const tasa = Number(tasaCopUsd) || 0;
    const usdDivisa = tasa > 0 ? cop / tasa : 0;
    const pventaBcv =
        pventa_bcv != null && pventa_bcv !== ''
            ? Number(pventa_bcv)
            : calcularPventaBcv(cop, tasa, recargoBcv);
    const bsBcv = calcularBsBcv(pventaBcv, tasaBcvUsd);

    return { cop, usdDivisa, pventaBcv, bsBcv };
}

/** Total en Bs BCV para una lista de ítems con pventa_bcv y cantidad */
export function calcularTotalBsBcv(items, tasaBcvUsd) {
    return items.reduce((acc, item) => {
        const pventa = Number(item.pventa_bcv) || 0;
        const cantidad = Number(item.cantidad) || 0;
        return acc + calcularBsBcv(pventa, tasaBcvUsd) * cantidad;
    }, 0);
}
