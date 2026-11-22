import { db } from '@/pages/api/db';

let schemaPromise = null;

async function addColumnSafe(client, table, column, definition) {
    try {
        await client.execute(`ALTER TABLE ${table} ADD COLUMN ${column} ${definition}`);
    } catch (error) {
        const msg = String(error?.message || error).toLowerCase();
        if (!msg.includes('duplicate column') && !msg.includes('already exists')) {
            console.warn(`Aviso al agregar columna ${table}.${column}:`, msg);
        }
    }
}

export async function runFiscalMigration(client = db) {
    // 1. Tasas y Retenciones
    await addColumnSafe(client, 'tasa', 'bs', 'REAL NOT NULL DEFAULT 0');
    await addColumnSafe(client, 'tasa', 'cop_a_bs', 'REAL NOT NULL DEFAULT 3');
    await addColumnSafe(client, 'tasa', 'iva_porcentaje', 'REAL NOT NULL DEFAULT 16');
    await addColumnSafe(client, 'tasa', 'retencion_iva_porcentaje', 'REAL NOT NULL DEFAULT 75');

    // 2. Productos (precio_divisas, precio_bcv, exento_iva)
    await addColumnSafe(client, 'productos', 'precio_divisas', 'REAL NOT NULL DEFAULT 0');
    await addColumnSafe(client, 'productos', 'precio_bcv', 'REAL NOT NULL DEFAULT 0');
    await addColumnSafe(client, 'productos', 'exento_iva', 'INTEGER NOT NULL DEFAULT 0');

    try {
        await client.execute(`
            UPDATE productos
            SET precio_divisas = CASE WHEN precio_divisas = 0 THEN venta ELSE precio_divisas END,
                precio_bcv = CASE WHEN precio_bcv = 0 THEN venta ELSE precio_bcv END
            WHERE (precio_divisas = 0 OR precio_bcv = 0) AND venta > 0
        `);
    } catch (e) {
        console.warn('Aviso al sincronizar precios de productos:', e?.message || e);
    }

    // 3. Cajas (Apertura, Cierre y Reporte Diario Z)
    await client.execute(`
        CREATE TABLE IF NOT EXISTS cajas (
            id                       TEXT PRIMARY KEY DEFAULT (lower(hex(randomblob(16)))),
            nro_reporte_z            INTEGER,
            fecha_apertura           TEXT NOT NULL,
            hora_apertura            TEXT NOT NULL,
            fecha_cierre             TEXT,
            hora_cierre              TEXT,
            usuario_apertura_id      TEXT NOT NULL,
            usuario_apertura_nombre  TEXT NOT NULL,
            usuario_cierre_id        TEXT,
            usuario_cierre_nombre    TEXT,
            monto_apertura_usd       REAL NOT NULL DEFAULT 0,
            monto_apertura_cop       REAL NOT NULL DEFAULT 0,
            monto_apertura_bs        REAL NOT NULL DEFAULT 0,
            tasa_bcv_cierre          REAL NOT NULL DEFAULT 0,
            tasa_cop_cierre          REAL NOT NULL DEFAULT 0,
            total_ventas_contado     REAL NOT NULL DEFAULT 0,
            total_ventas_credito     REAL NOT NULL DEFAULT 0,
            base_imponible_usd       REAL NOT NULL DEFAULT 0,
            base_imponible_bs        REAL NOT NULL DEFAULT 0,
            exento_usd               REAL NOT NULL DEFAULT 0,
            exento_bs                REAL NOT NULL DEFAULT 0,
            iva_usd                  REAL NOT NULL DEFAULT 0,
            iva_bs                   REAL NOT NULL DEFAULT 0,
            retencion_iva_usd        REAL NOT NULL DEFAULT 0,
            retencion_iva_bs         REAL NOT NULL DEFAULT 0,
            total_facturado_usd      REAL NOT NULL DEFAULT 0,
            total_facturado_bs       REAL NOT NULL DEFAULT 0,
            total_devoluciones_usd   REAL NOT NULL DEFAULT 0,
            total_devoluciones_bs    REAL NOT NULL DEFAULT 0,
            cantidad_facturas        INTEGER NOT NULL DEFAULT 0,
            primera_factura          INTEGER,
            ultima_factura           INTEGER,
            observaciones            TEXT NOT NULL DEFAULT '',
            estado                   TEXT NOT NULL DEFAULT 'abierta' CHECK (estado IN ('abierta', 'cerrada'))
        )
    `);

    await client.execute(`CREATE INDEX IF NOT EXISTS idx_cajas_estado ON cajas(estado)`);
    await client.execute(`CREATE INDEX IF NOT EXISTS idx_cajas_fecha_apertura ON cajas(fecha_apertura)`);

    // 4. Ventas (campos fiscales, tipo_documento, numeración y enlace a caja)
    await addColumnSafe(client, 'ventas', 'tipo_documento', "TEXT NOT NULL DEFAULT 'factura'");
    await addColumnSafe(client, 'ventas', 'nro_factura', 'INTEGER');
    await addColumnSafe(client, 'ventas', 'nro_nota_entrega', 'INTEGER');
    await addColumnSafe(client, 'ventas', 'caja_id', 'TEXT');
    await addColumnSafe(client, 'ventas', 'subtotal_base', 'REAL NOT NULL DEFAULT 0');
    await addColumnSafe(client, 'ventas', 'subtotal_exento', 'REAL NOT NULL DEFAULT 0');
    await addColumnSafe(client, 'ventas', 'iva_porcentaje', 'REAL NOT NULL DEFAULT 16');
    await addColumnSafe(client, 'ventas', 'iva_monto', 'REAL NOT NULL DEFAULT 0');
    await addColumnSafe(client, 'ventas', 'retencion_iva_porcentaje', 'REAL NOT NULL DEFAULT 0');
    await addColumnSafe(client, 'ventas', 'retencion_iva_monto', 'REAL NOT NULL DEFAULT 0');
    await addColumnSafe(client, 'ventas', 'comprobante_retencion', "TEXT NOT NULL DEFAULT ''");
    await addColumnSafe(client, 'ventas', 'total_divisas', 'REAL NOT NULL DEFAULT 0');
    await addColumnSafe(client, 'ventas', 'tasa_bcv', 'REAL NOT NULL DEFAULT 0');
    await addColumnSafe(client, 'ventas', 'tasa_cop', 'REAL NOT NULL DEFAULT 0');
    await addColumnSafe(client, 'ventas', 'facturada_en_venta_id', 'TEXT');
    await addColumnSafe(client, 'ventas', 'nota_entrega_origen_id', 'TEXT');
    await addColumnSafe(client, 'ventas', 'flete_monto', 'REAL NOT NULL DEFAULT 0');

    // Backfill numeración para facturas existentes que aún no tengan nro_factura
    try {
        const sinNum = await client.execute(
            `SELECT id FROM ventas WHERE nro_factura IS NULL AND nro_nota_entrega IS NULL ORDER BY fecha ASC, id ASC`
        );
        if (sinNum.rows && sinNum.rows.length > 0) {
            const maxRes = await client.execute(`SELECT COALESCE(MAX(nro_factura), 0) AS max_fact FROM ventas`);
            let corr = Number(maxRes.rows?.[0]?.max_fact) || 0;
            for (const row of sinNum.rows) {
                corr += 1;
                await client.execute(`UPDATE ventas SET nro_factura = ?, tipo_documento = 'factura' WHERE id = ?`, [corr, row.id]);
            }
        }
    } catch (e) {
        console.warn('Aviso numerando facturas previas:', e?.message || e);
    }

    // Columnas adicionales en cajas para Notas de Entrega en Divisas
    await addColumnSafe(client, 'cajas', 'cantidad_notas_entrega', 'INTEGER NOT NULL DEFAULT 0');
    await addColumnSafe(client, 'cajas', 'total_notas_entrega_usd', 'REAL NOT NULL DEFAULT 0');
    await addColumnSafe(client, 'cajas', 'total_fletes_usd', 'REAL NOT NULL DEFAULT 0');

    // Triggers SENIAT: prohibir eliminar o anular/cancelar ventas numeradas
    try {
        await client.execute(`
            CREATE TRIGGER IF NOT EXISTS trg_seniat_no_delete_ventas
            BEFORE DELETE ON ventas
            BEGIN
                SELECT RAISE(ABORT, 'SENIAT: Las facturas y documentos numerados no pueden ser eliminados.');
            END
        `);
        await client.execute(`
            CREATE TRIGGER IF NOT EXISTS trg_seniat_no_cancel_ventas
            BEFORE UPDATE OF estado ON ventas
            WHEN NEW.estado IN ('anulado', 'cancelado', 'anulada', 'cancelada')
            BEGIN
                SELECT RAISE(ABORT, 'SENIAT: Las facturas numeradas no pueden ser anuladas ni canceladas.');
            END
        `);
    } catch (e) {
        console.warn('Aviso creando triggers SENIAT:', e?.message || e);
    }

    // 5. Detalle Venta (campos fiscales por ítem)
    await addColumnSafe(client, 'detalle_venta', 'precio_divisas', 'REAL NOT NULL DEFAULT 0');
    await addColumnSafe(client, 'detalle_venta', 'exento_iva', 'INTEGER NOT NULL DEFAULT 0');
    await addColumnSafe(client, 'detalle_venta', 'alicuota_iva', 'REAL NOT NULL DEFAULT 16');
    await addColumnSafe(client, 'detalle_venta', 'monto_iva', 'REAL NOT NULL DEFAULT 0');

    // 6. Garantizar tablas de pagos_venta y devoluciones para reportes
    await client.execute(`
        CREATE TABLE IF NOT EXISTS pagos_venta (
            id           TEXT PRIMARY KEY DEFAULT (lower(hex(randomblob(16)))),
            id_venta     TEXT    NOT NULL,
            moneda       TEXT    NOT NULL CHECK (moneda IN ('USD', 'COP', 'BS')),
            metodo       TEXT    NOT NULL,
            monto        REAL    NOT NULL CHECK (monto > 0),
            monto_base   REAL    NOT NULL CHECK (monto_base >= 0),
            moneda_base  TEXT    NOT NULL,
            tasa_cop     REAL    NOT NULL DEFAULT 0,
            tasa_bs      REAL    NOT NULL DEFAULT 0,
            FOREIGN KEY (id_venta) REFERENCES ventas(id)
        )
    `);

    await client.execute(`
        CREATE TABLE IF NOT EXISTS devoluciones (
            id                TEXT PRIMARY KEY DEFAULT (lower(hex(randomblob(16)))),
            id_venta          TEXT    NOT NULL,
            cliente_id        TEXT    NOT NULL,
            monto_total       REAL    NOT NULL CHECK (monto_total > 0),
            tipo_resolucion   TEXT    NOT NULL CHECK (tipo_resolucion IN ('EFECTIVO', 'NOTA_CREDITO')),
            saldo_disponible  REAL    NOT NULL DEFAULT 0 CHECK (saldo_disponible >= 0),
            motivo            TEXT    NOT NULL DEFAULT '',
            fecha_creacion    DATETIME DEFAULT CURRENT_TIMESTAMP,
            FOREIGN KEY (id_venta)   REFERENCES ventas(id),
            FOREIGN KEY (cliente_id) REFERENCES clientes(id)
        )
    `);

    await client.execute(`
        CREATE TABLE IF NOT EXISTS detalle_devolucion (
            id               TEXT PRIMARY KEY DEFAULT (lower(hex(randomblob(16)))),
            id_devolucion    TEXT    NOT NULL,
            producto_id      TEXT    NOT NULL,
            codigo_producto  TEXT    NOT NULL,
            nombre_producto  TEXT    NOT NULL,
            precio_unitario  REAL    NOT NULL,
            cantidad         REAL    NOT NULL CHECK (cantidad > 0),
            subtotal         REAL    GENERATED ALWAYS AS (precio_unitario * cantidad) STORED,
            FOREIGN KEY (id_devolucion) REFERENCES devoluciones(id),
            FOREIGN KEY (producto_id)   REFERENCES productos(id)
        )
    `);

    // 7. Compras Fiscales (Libro de Compras, Crédito Fiscal IVA y Retenciones)
    await addColumnSafe(client, 'compras', 'proveedor_rif', "TEXT NOT NULL DEFAULT ''");
    await addColumnSafe(client, 'compras', 'nro_factura', "TEXT NOT NULL DEFAULT ''");
    await addColumnSafe(client, 'compras', 'nro_control', "TEXT NOT NULL DEFAULT ''");
    await addColumnSafe(client, 'compras', 'tipo_documento', "TEXT NOT NULL DEFAULT 'factura'");
    await addColumnSafe(client, 'compras', 'moneda', "TEXT NOT NULL DEFAULT 'USD'");
    await addColumnSafe(client, 'compras', 'tasa_bcv', 'REAL NOT NULL DEFAULT 0');
    await addColumnSafe(client, 'compras', 'subtotal_base', 'REAL NOT NULL DEFAULT 0');
    await addColumnSafe(client, 'compras', 'subtotal_exento', 'REAL NOT NULL DEFAULT 0');
    await addColumnSafe(client, 'compras', 'iva_porcentaje', 'REAL NOT NULL DEFAULT 16');
    await addColumnSafe(client, 'compras', 'iva_monto', 'REAL NOT NULL DEFAULT 0');
    await addColumnSafe(client, 'compras', 'retencion_iva_porcentaje', 'REAL NOT NULL DEFAULT 0');
    await addColumnSafe(client, 'compras', 'retencion_iva_monto', 'REAL NOT NULL DEFAULT 0');
    await addColumnSafe(client, 'compras', 'comprobante_retencion', "TEXT NOT NULL DEFAULT ''");

    await addColumnSafe(client, 'detalle_compra', 'exento_iva', 'INTEGER NOT NULL DEFAULT 0');
    await addColumnSafe(client, 'detalle_compra', 'alicuota_iva', 'REAL NOT NULL DEFAULT 16');
    await addColumnSafe(client, 'detalle_compra', 'monto_iva', 'REAL NOT NULL DEFAULT 0');

    // 8. Compras a Crédito (Cuentas por Pagar a Proveedores)
    await addColumnSafe(client, 'compras', 'tipo_pago', "TEXT NOT NULL DEFAULT 'contado'");
    await addColumnSafe(client, 'compras', 'monto_abonado', 'REAL NOT NULL DEFAULT 0');
    await addColumnSafe(client, 'compras', 'estado_pago', "TEXT NOT NULL DEFAULT 'pagada'");
    await addColumnSafe(client, 'compras', 'flete_monto', 'REAL NOT NULL DEFAULT 0');

    await client.execute(`
        CREATE TABLE IF NOT EXISTS abonos_compra (
            id              TEXT PRIMARY KEY DEFAULT (lower(hex(randomblob(16)))),
            id_compra       TEXT    NOT NULL,
            fecha           TEXT    NOT NULL,
            monto           REAL    NOT NULL CHECK (monto > 0),
            moneda          TEXT    NOT NULL DEFAULT 'USD',
            metodo          TEXT    NOT NULL DEFAULT '',
            monto_recibido  REAL    NOT NULL DEFAULT 0,
            tasa_cop        REAL    NOT NULL DEFAULT 0,
            tasa_bs         REAL    NOT NULL DEFAULT 0,
            observacion     TEXT    NOT NULL DEFAULT '',
            usuario_id      TEXT,
            usuario_nombre  TEXT,
            FOREIGN KEY (id_compra) REFERENCES compras(id)
        )
    `);
    await client.execute(`CREATE INDEX IF NOT EXISTS idx_abonos_compra_id ON abonos_compra(id_compra)`);

    // 9. Tabla de Proveedores y vínculo con Compras
    await client.execute(`
        CREATE TABLE IF NOT EXISTS proveedores (
            id              TEXT PRIMARY KEY DEFAULT (lower(hex(randomblob(16)))),
            nombre          TEXT NOT NULL,
            rif             TEXT NOT NULL DEFAULT '',
            telefono        TEXT NOT NULL DEFAULT '',
            direccion       TEXT NOT NULL DEFAULT '',
            email           TEXT NOT NULL DEFAULT '',
            estatus         TEXT NOT NULL DEFAULT 'activo' CHECK (estatus IN ('activo', 'inactivo')),
            fecha_creacion  TEXT NOT NULL DEFAULT (datetime('now'))
        )
    `);
    await addColumnSafe(client, 'compras', 'proveedor_id', 'TEXT');
    await addColumnSafe(client, 'cotizaciones', 'moneda', "TEXT NOT NULL DEFAULT 'DIVISAS'");

    // Migrar proveedores desde compras existentes que aún no tengan proveedor_id
    try {
        const sinProv = await client.execute(
            `SELECT id, proveedor, proveedor_rif FROM compras WHERE proveedor_id IS NULL OR proveedor_id = ''`
        );
        if (sinProv.rows && sinProv.rows.length > 0) {
            const existentes = await client.execute(`SELECT id, nombre, rif FROM proveedores`);
            const mapa = new Map();
            for (const p of existentes.rows || []) {
                const key = p.rif ? `RIF:${String(p.rif).trim().toUpperCase()}` : `NOM:${String(p.nombre).trim().toUpperCase()}`;
                mapa.set(key, p.id);
            }
            for (const c of sinProv.rows) {
                const nom = String(c.proveedor || '').trim();
                const rif = String(c.proveedor_rif || '').trim().toUpperCase();
                if (!nom) continue;
                const key = rif ? `RIF:${rif}` : `NOM:${nom.toUpperCase()}`;
                let provId = mapa.get(key);
                if (!provId) {
                    const ins = await client.execute(
                        `INSERT INTO proveedores (nombre, rif) VALUES (?, ?) RETURNING id`,
                        [nom, rif]
                    );
                    provId = ins.rows?.[0]?.id;
                    if (provId) mapa.set(key, provId);
                }
                if (provId) {
                    await client.execute(`UPDATE compras SET proveedor_id = ? WHERE id = ?`, [provId, c.id]);
                }
            }
        }
    } catch (e) {
        console.warn('Aviso al migrar proveedores desde compras:', e?.message || e);
    }
}

export function ensureFiscalSchema(client = db) {
    if (!schemaPromise) {
        schemaPromise = runFiscalMigration(client).catch((err) => {
            schemaPromise = null;
            console.error('Error asegurando esquema fiscal:', err);
        });
    }
    return schemaPromise;
}

