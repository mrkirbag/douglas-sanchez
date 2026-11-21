const esDecimalPositivo = /^\d+(\.\d+)?$/;

export function parsearItemVenta(item, ivaPorcentajeDefault = 16) {
    const {
        idProducto,
        id,
        codigo,
        nombre,
        precio,
        precio_bcv,
        precio_divisas,
        exento_iva,
        cantidad,
        seriales,
    } = item;
    const productoId = idProducto ?? id;

    const cantidadStr = String(cantidad ?? '').trim().replace(',', '.');
    const precioBaseVal = precio_bcv ?? precio;
    const precioStr = String(precioBaseVal ?? '').trim().replace(',', '.');
    const divisasVal = precio_divisas ?? precioBaseVal;
    const divisasStr = String(divisasVal ?? '').trim().replace(',', '.');

    const cantidadValida = esDecimalPositivo.test(cantidadStr) && parseFloat(cantidadStr) > 0;
    const precioValido = esDecimalPositivo.test(precioStr) && parseFloat(precioStr) >= 0;

    if (!productoId || !codigo || !nombre || !cantidadValida || !precioValido) {
        return { ok: false, error: 'Faltan datos válidos del producto' };
    }

    const precioNum = parseFloat(precioStr);
    const divisasNum = esDecimalPositivo.test(divisasStr) ? parseFloat(divisasStr) : precioNum;
    const cantidadNum = parseFloat(cantidadStr);
    const esExento = Number(exento_iva) ? 1 : 0;
    const alicuota = esExento ? 0 : (Number(ivaPorcentajeDefault) || 0);
    const subtotalBase = precioNum * cantidadNum;
    const montoIva = esExento ? 0 : +(subtotalBase * (alicuota / 100)).toFixed(4);

    return {
        ok: true,
        item: {
            productoId,
            codigo,
            nombre,
            precio: +precioNum.toFixed(4),
            precio_divisas: +divisasNum.toFixed(4),
            exento_iva: esExento,
            alicuota_iva: alicuota,
            monto_iva: montoIva,
            cantidad: +cantidadNum.toFixed(4),
            seriales: Array.isArray(seriales) ? seriales : undefined,
        },
    };
}

export async function verificarProductoDisponible(tx, codigo, cantidadRequerida) {
    const result = await tx.execute({
        sql: 'SELECT id, stock, estatus, nombre FROM productos WHERE codigo = ?',
        args: [codigo],
    });

    if (!result.rows?.length) {
        return { ok: false, error: `Producto ${codigo} no encontrado` };
    }

    const producto = result.rows[0];

    if (producto.estatus !== 'activo') {
        return { ok: false, error: `Producto ${codigo} no está activo` };
    }

    const stockDisponible = parseFloat(producto.stock);
    const cantidad = parseFloat(cantidadRequerida);

    if (stockDisponible < cantidad) {
        return {
            ok: false,
            error: `Stock insuficiente para ${codigo}. Disponible: ${stockDisponible}`,
        };
    }

    return { ok: true, producto };
}

export async function descontarStock(tx, codigo, cantidad) {
    const result = await tx.execute({
        sql: `UPDATE productos SET stock = stock - ?
         WHERE codigo = ? AND estatus = 'activo' AND stock >= ? RETURNING stock`,
        args: [cantidad, codigo, cantidad],
    });

    const afectadas = result.rowsAffected ?? result.affectedRows ?? 0;
    if (afectadas === 0 && (!result.rows || result.rows.length === 0)) {
        throw new Error(`No se pudo descontar stock de ${codigo}`);
    }

    const stockDespues = Number(result.rows[0].stock);
    const stockAntes = stockDespues + Number(cantidad);

    return { stockAntes, stockDespues };
}

export async function insertarDetalleVenta(tx, ventaId, item) {
    await tx.execute({
        sql: `INSERT INTO detalle_venta
            (id_venta, producto_id, codigo_producto, nombre_producto, precio_unitario, precio_divisas, exento_iva, alicuota_iva, monto_iva, cantidad)
            VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
        args: [
            ventaId,
            item.productoId,
            item.codigo,
            item.nombre,
            item.precio,
            item.precio_divisas ?? item.precio,
            item.exento_iva ?? 0,
            item.alicuota_iva ?? 16,
            item.monto_iva ?? 0,
            item.cantidad,
        ],
    });
}

export function normalizarId(id) {
    return typeof id === 'bigint' ? id.toString() : id;
}
