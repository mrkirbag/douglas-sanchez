import { db } from '@/pages/api/db';
import { RECARGO_BCV_DEFAULT } from '@/utils/helpers/precios';
import { ensureBcvSchema } from '@/utils/db/ensureBcvSchema';

export async function obtenerTasaCopUsd() {
    await ensureBcvSchema();
    try {
        const result = await db.execute('SELECT valor FROM tasa WHERE id = 1');
        return Number(result.rows[0]?.valor) || 0;
    } catch {
        return 0;
    }
}

export async function obtenerTasaBcvUsd() {
    await ensureBcvSchema();
    try {
        const result = await db.execute('SELECT valor FROM tasaBcv WHERE id = 1');
        return Number(result.rows[0]?.valor) || 0;
    } catch {
        return 0;
    }
}

export async function obtenerRecargoBcv() {
    await ensureBcvSchema();
    try {
        const result = await db.execute('SELECT recargo_bcv FROM config_precios WHERE id = 1');
        return Number(result.rows[0]?.recargo_bcv ?? RECARGO_BCV_DEFAULT);
    } catch {
        return RECARGO_BCV_DEFAULT;
    }
}

export async function calcularPventaBcvParaVenta(ventaCop) {
    const tasaCopUsd = await obtenerTasaCopUsd();
    const recargoBcv = await obtenerRecargoBcv();
    if (tasaCopUsd <= 0) return 0;
    return (Number(ventaCop) / tasaCopUsd) * (1 + recargoBcv / 100);
}

export async function recalcularPventaBcvTodos() {
    const tasaCopUsd = await obtenerTasaCopUsd();
    const recargoBcv = await obtenerRecargoBcv();

    if (tasaCopUsd <= 0) {
        return { actualizados: 0, mensaje: 'Tasa COP/USD no configurada' };
    }

    const result = await db.execute(
        `UPDATE productos
         SET pventa_bcv = (venta / ?) * (1 + ? / 100.0)
         WHERE estatus = 'activo'`,
        [tasaCopUsd, recargoBcv]
    );

    return { actualizados: result.rowsAffected ?? 0 };
}
