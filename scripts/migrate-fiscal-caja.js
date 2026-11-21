import { createClient } from '@libsql/client';
import dotenv from 'dotenv';

dotenv.config();

const db = createClient({
    url: process.env.DATABASE_URL,
    authToken: process.env.DATABASE_AUTH_TOKEN,
});

async function addColumnSafe(table, column, definition) {
    try {
        await db.execute(`ALTER TABLE ${table} ADD COLUMN ${column} ${definition}`);
        console.log(`Columna ${table}.${column} creada.`);
    } catch (error) {
        const msg = String(error?.message || error).toLowerCase();
        if (msg.includes('duplicate column') || msg.includes('already exists')) {
            console.log(`Columna ${table}.${column} ya existe.`);
        } else {
            throw error;
        }
    }
}

async function migrate() {
    if (!process.env.DATABASE_URL) {
        throw new Error('Falta DATABASE_URL en .env');
    }

    await addColumnSafe('tasa', 'bs', 'REAL NOT NULL DEFAULT 0');
    await addColumnSafe('tasa', 'iva_porcentaje', 'REAL NOT NULL DEFAULT 16');
    await addColumnSafe('tasa', 'retencion_iva_porcentaje', 'REAL NOT NULL DEFAULT 75');

    await addColumnSafe('productos', 'precio_divisas', 'REAL NOT NULL DEFAULT 0');
    await addColumnSafe('productos', 'precio_bcv', 'REAL NOT NULL DEFAULT 0');
    await addColumnSafe('productos', 'exento_iva', 'INTEGER NOT NULL DEFAULT 0');

    await db.execute(`
        UPDATE productos
        SET precio_divisas = CASE WHEN precio_divisas = 0 THEN venta ELSE precio_divisas END,
            precio_bcv = CASE WHEN precio_bcv = 0 THEN venta ELSE precio_bcv END
        WHERE (precio_divisas = 0 OR precio_bcv = 0) AND venta > 0
    `);
    console.log('Precios de productos sincronizados (precio_divisas y precio_bcv).');

    await db.execute(`
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
    console.log('Tabla cajas verificada/creada.');

    await db.execute(`CREATE INDEX IF NOT EXISTS idx_cajas_estado ON cajas(estado)`);
    await db.execute(`CREATE INDEX IF NOT EXISTS idx_cajas_fecha_apertura ON cajas(fecha_apertura)`);

    await addColumnSafe('ventas', 'nro_factura', 'INTEGER');
    await addColumnSafe('ventas', 'caja_id', 'TEXT');
    await addColumnSafe('ventas', 'subtotal_base', 'REAL NOT NULL DEFAULT 0');
    await addColumnSafe('ventas', 'subtotal_exento', 'REAL NOT NULL DEFAULT 0');
    await addColumnSafe('ventas', 'iva_porcentaje', 'REAL NOT NULL DEFAULT 16');
    await addColumnSafe('ventas', 'iva_monto', 'REAL NOT NULL DEFAULT 0');
    await addColumnSafe('ventas', 'retencion_iva_porcentaje', 'REAL NOT NULL DEFAULT 0');
    await addColumnSafe('ventas', 'retencion_iva_monto', 'REAL NOT NULL DEFAULT 0');
    await addColumnSafe('ventas', 'comprobante_retencion', "TEXT NOT NULL DEFAULT ''");
    await addColumnSafe('ventas', 'total_divisas', 'REAL NOT NULL DEFAULT 0');
    await addColumnSafe('ventas', 'tasa_bcv', 'REAL NOT NULL DEFAULT 0');
    await addColumnSafe('ventas', 'tasa_cop', 'REAL NOT NULL DEFAULT 0');

    await addColumnSafe('detalle_venta', 'precio_divisas', 'REAL NOT NULL DEFAULT 0');
    await addColumnSafe('detalle_venta', 'exento_iva', 'INTEGER NOT NULL DEFAULT 0');
    await addColumnSafe('detalle_venta', 'alicuota_iva', 'REAL NOT NULL DEFAULT 16');
    await addColumnSafe('detalle_venta', 'monto_iva', 'REAL NOT NULL DEFAULT 0');

    console.log('Migración fiscal y de caja completada exitosamente.');
}

migrate().catch((err) => {
    console.error('Error en migración:', err.message);
    process.exit(1);
});

