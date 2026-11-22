-- ============================================================================
-- SAVI / Comercializadora AG - Esquema Completo y Guía de Migración (SQLite / Turso)
-- Versión del esquema: 1.0.3
-- Uso:
--   1) NUEVOS CLIENTES: Ejecutar la SECCIÓN 1 + SECCIÓN 3 + SECCIÓN 4 completas.
--   2) CLIENTES EXISTENTES (ACTUALIZACIÓN SIN PERDER INVENTARIO):
--      - Ejecutar SECCIÓN 1 (crea solo las tablas nuevas faltantes sin tocar las existentes).
--      - Revisar y ejecutar en SECCIÓN 2 los ALTER TABLE de las columnas que le falten
--        a tu BD vieja (SQLite no soporta ADD COLUMN IF NOT EXISTS; si alguna columna ya
--        existe, omite esa línea).
--      - Ejecutar SECCIÓN 3 (índices y triggers) y SECCIÓN 4 (datos iniciales seguros).
-- ============================================================================

PRAGMA foreign_keys = ON;

-- ============================================================================
-- SECCIÓN 1: TABLAS BASE Y OPERATIVAS (CREATE TABLE IF NOT EXISTS)
-- ============================================================================

CREATE TABLE IF NOT EXISTS usuarios (
    id      TEXT PRIMARY KEY DEFAULT (lower(hex(randomblob(16)))),
    usuario TEXT    NOT NULL UNIQUE,
    clave   TEXT    NOT NULL,
    rol     TEXT    NOT NULL CHECK (rol IN ('admin', 'empleado')),
    nombre  TEXT    NOT NULL
);

CREATE TABLE IF NOT EXISTS tasa (
    id                       INTEGER PRIMARY KEY,
    valor                    REAL    NOT NULL DEFAULT 0 CHECK (valor >= 0),
    bs                       REAL    NOT NULL DEFAULT 0 CHECK (bs >= 0),
    cop_a_bs                 REAL    NOT NULL DEFAULT 3 CHECK (cop_a_bs >= 0),
    iva_porcentaje           REAL    NOT NULL DEFAULT 16 CHECK (iva_porcentaje >= 0),
    retencion_iva_porcentaje REAL    NOT NULL DEFAULT 75 CHECK (retencion_iva_porcentaje >= 0)
);

CREATE TABLE IF NOT EXISTS clientes (
    id       TEXT PRIMARY KEY DEFAULT (lower(hex(randomblob(16)))),
    nombre   TEXT    NOT NULL,
    telefono TEXT    NOT NULL,
    cedula   TEXT    NOT NULL UNIQUE,
    estatus  TEXT    NOT NULL DEFAULT 'activo' CHECK (estatus IN ('activo', 'inactivo'))
);

CREATE TABLE IF NOT EXISTS proveedores (
    id              TEXT PRIMARY KEY DEFAULT (lower(hex(randomblob(16)))),
    nombre          TEXT NOT NULL,
    rif             TEXT NOT NULL DEFAULT '',
    telefono        TEXT NOT NULL DEFAULT '',
    direccion       TEXT NOT NULL DEFAULT '',
    email           TEXT NOT NULL DEFAULT '',
    estatus         TEXT NOT NULL DEFAULT 'activo' CHECK (estatus IN ('activo', 'inactivo')),
    fecha_creacion  TEXT NOT NULL DEFAULT (datetime('now'))
);

CREATE TABLE IF NOT EXISTS productos (
    id             TEXT PRIMARY KEY DEFAULT (lower(hex(randomblob(16)))),
    codigo         TEXT    NOT NULL UNIQUE,
    nombre         TEXT    NOT NULL,
    descripcion    TEXT    NOT NULL DEFAULT '',
    stock          REAL    NOT NULL DEFAULT 0 CHECK (stock >= 0),
    costo          REAL    NOT NULL DEFAULT 0 CHECK (costo >= 0),
    venta          REAL    NOT NULL DEFAULT 0 CHECK (venta >= 0),
    precio_divisas REAL    NOT NULL DEFAULT 0 CHECK (precio_divisas >= 0),
    precio_bcv     REAL    NOT NULL DEFAULT 0 CHECK (precio_bcv >= 0),
    exento_iva     INTEGER NOT NULL DEFAULT 0 CHECK (exento_iva IN (0, 1)),
    unidad_medida  TEXT    NOT NULL DEFAULT '',
    estatus        TEXT    NOT NULL DEFAULT 'activo' CHECK (estatus IN ('activo', 'inactivo'))
);

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
    cantidad_notas_entrega   INTEGER NOT NULL DEFAULT 0,
    total_notas_entrega_usd  REAL NOT NULL DEFAULT 0,
    total_fletes_usd         REAL NOT NULL DEFAULT 0,
    observaciones            TEXT NOT NULL DEFAULT '',
    estado                   TEXT NOT NULL DEFAULT 'abierta' CHECK (estado IN ('abierta', 'cerrada'))
);

CREATE TABLE IF NOT EXISTS ventas (
    id                       TEXT PRIMARY KEY DEFAULT (lower(hex(randomblob(16)))),
    tipo_documento           TEXT    NOT NULL DEFAULT 'factura' CHECK (tipo_documento IN ('factura', 'nota_entrega')),
    nro_factura              INTEGER,
    nro_nota_entrega         INTEGER,
    caja_id                  TEXT,
    fecha                    TEXT    NOT NULL,
    cliente_id               TEXT    NOT NULL,
    subtotal_base            REAL    NOT NULL DEFAULT 0 CHECK (subtotal_base >= 0),
    subtotal_exento          REAL    NOT NULL DEFAULT 0 CHECK (subtotal_exento >= 0),
    iva_porcentaje           REAL    NOT NULL DEFAULT 16 CHECK (iva_porcentaje >= 0),
    iva_monto                REAL    NOT NULL DEFAULT 0 CHECK (iva_monto >= 0),
    retencion_iva_porcentaje REAL    NOT NULL DEFAULT 0 CHECK (retencion_iva_porcentaje >= 0),
    retencion_iva_monto      REAL    NOT NULL DEFAULT 0 CHECK (retencion_iva_monto >= 0),
    comprobante_retencion    TEXT    NOT NULL DEFAULT '',
    total_divisas            REAL    NOT NULL DEFAULT 0 CHECK (total_divisas >= 0),
    tasa_bcv                 REAL    NOT NULL DEFAULT 0,
    tasa_cop                 REAL    NOT NULL DEFAULT 0,
    total                    REAL    NOT NULL CHECK (total >= 0),
    flete_monto              REAL    NOT NULL DEFAULT 0,
    estado                   TEXT    NOT NULL DEFAULT 'pendiente',
    tipo_pago                TEXT    NOT NULL,
    facturada_en_venta_id    TEXT,
    nota_entrega_origen_id   TEXT,
    FOREIGN KEY (cliente_id) REFERENCES clientes(id)
);

CREATE TABLE IF NOT EXISTS detalle_venta (
    id               TEXT PRIMARY KEY DEFAULT (lower(hex(randomblob(16)))),
    id_venta         TEXT    NOT NULL,
    producto_id      TEXT    NOT NULL,
    codigo_producto  TEXT    NOT NULL,
    nombre_producto  TEXT    NOT NULL,
    precio_unitario  REAL    NOT NULL CHECK (precio_unitario >= 0),
    precio_divisas   REAL    NOT NULL DEFAULT 0 CHECK (precio_divisas >= 0),
    exento_iva       INTEGER NOT NULL DEFAULT 0,
    alicuota_iva     REAL    NOT NULL DEFAULT 16,
    monto_iva        REAL    NOT NULL DEFAULT 0,
    cantidad         REAL    NOT NULL CHECK (cantidad > 0),
    subtotal         REAL    GENERATED ALWAYS AS (precio_unitario * cantidad) STORED,
    FOREIGN KEY (id_venta)    REFERENCES ventas(id),
    FOREIGN KEY (producto_id) REFERENCES productos(id)
);

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
);

CREATE TABLE IF NOT EXISTS creditos (
    id              TEXT PRIMARY KEY DEFAULT (lower(hex(randomblob(16)))),
    id_venta        TEXT    NOT NULL UNIQUE,
    saldo_pendiente REAL    NOT NULL DEFAULT 0 CHECK (saldo_pendiente >= 0),
    FOREIGN KEY (id_venta) REFERENCES ventas(id)
);

CREATE TABLE IF NOT EXISTS abonos_credito (
    id             TEXT PRIMARY KEY DEFAULT (lower(hex(randomblob(16)))),
    id_credito     TEXT    NOT NULL,
    fecha          TEXT    NOT NULL,
    monto          REAL    NOT NULL CHECK (monto > 0),
    moneda         TEXT,
    metodo         TEXT,
    monto_recibido REAL,
    moneda_base    TEXT,
    tasa_cop       REAL    NOT NULL DEFAULT 0,
    tasa_bs        REAL    NOT NULL DEFAULT 0,
    FOREIGN KEY (id_credito) REFERENCES creditos(id)
);

CREATE TABLE IF NOT EXISTS compras (
    id                       TEXT PRIMARY KEY DEFAULT (lower(hex(randomblob(16)))),
    fecha                    TEXT    NOT NULL DEFAULT (date('now')),
    proveedor                TEXT    NOT NULL,
    proveedor_id             TEXT,
    proveedor_rif            TEXT    NOT NULL DEFAULT '',
    nro_factura              TEXT    NOT NULL DEFAULT '',
    nro_control              TEXT    NOT NULL DEFAULT '',
    tipo_documento           TEXT    NOT NULL DEFAULT 'factura',
    moneda                   TEXT    NOT NULL DEFAULT 'USD',
    tasa_bcv                 REAL    NOT NULL DEFAULT 0,
    subtotal_base            REAL    NOT NULL DEFAULT 0,
    subtotal_exento          REAL    NOT NULL DEFAULT 0,
    iva_porcentaje           REAL    NOT NULL DEFAULT 16,
    iva_monto                REAL    NOT NULL DEFAULT 0,
    retencion_iva_porcentaje REAL    NOT NULL DEFAULT 0,
    retencion_iva_monto      REAL    NOT NULL DEFAULT 0,
    comprobante_retencion    TEXT    NOT NULL DEFAULT '',
    tipo_pago                TEXT    NOT NULL DEFAULT 'contado',
    monto_abonado            REAL    NOT NULL DEFAULT 0,
    estado_pago              TEXT    NOT NULL DEFAULT 'pagada',
    flete_monto              REAL    NOT NULL DEFAULT 0,
    monto_total              REAL    NOT NULL DEFAULT 0 CHECK (monto_total >= 0)
);

CREATE TABLE IF NOT EXISTS detalle_compra (
    id               TEXT PRIMARY KEY DEFAULT (lower(hex(randomblob(16)))),
    id_compra        TEXT NOT NULL,
    producto_id      TEXT NOT NULL,
    codigo_producto  TEXT NOT NULL,
    nombre_producto  TEXT NOT NULL,
    costo            REAL NOT NULL DEFAULT 0 CHECK (costo >= 0),
    cantidad         REAL NOT NULL DEFAULT 0 CHECK (cantidad > 0),
    subtotal         REAL GENERATED ALWAYS AS (costo * cantidad) STORED,
    exento_iva       INTEGER NOT NULL DEFAULT 0,
    alicuota_iva     REAL NOT NULL DEFAULT 16,
    monto_iva        REAL NOT NULL DEFAULT 0,
    FOREIGN KEY (id_compra) REFERENCES compras(id),
    FOREIGN KEY (producto_id) REFERENCES productos(id)
);

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
);

CREATE TABLE IF NOT EXISTS cotizaciones (
    id                 TEXT PRIMARY KEY DEFAULT (lower(hex(randomblob(16)))),
    fecha              TEXT    NOT NULL,
    cliente_nombre     TEXT    NOT NULL,
    cliente_cedula_rif TEXT    NOT NULL,
    cliente_telefono   TEXT    NOT NULL,
    cliente_direccion  TEXT    NOT NULL,
    moneda             TEXT    NOT NULL DEFAULT 'DIVISAS',
    total              REAL    NOT NULL CHECK (total >= 0)
);

CREATE TABLE IF NOT EXISTS detalle_cotizacion (
    id               TEXT PRIMARY KEY DEFAULT (lower(hex(randomblob(16)))),
    id_cotizacion    TEXT    NOT NULL,
    producto_id      TEXT    NOT NULL,
    codigo_producto  TEXT    NOT NULL,
    nombre_producto  TEXT    NOT NULL,
    precio_unitario  REAL    NOT NULL CHECK (precio_unitario >= 0),
    cantidad         REAL    NOT NULL CHECK (cantidad > 0),
    subtotal         REAL    GENERATED ALWAYS AS (precio_unitario * cantidad) STORED,
    FOREIGN KEY (id_cotizacion) REFERENCES cotizaciones(id),
    FOREIGN KEY (producto_id) REFERENCES productos(id)
);

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
);

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
);

CREATE TABLE IF NOT EXISTS seriales (
    id           TEXT PRIMARY KEY DEFAULT (lower(hex(randomblob(16)))),
    producto_id  TEXT NOT NULL,
    serial       TEXT NOT NULL UNIQUE,
    estado       TEXT NOT NULL DEFAULT 'disponible' CHECK (estado IN ('disponible', 'vendido', 'garantia', 'devuelto')),
    id_compra    TEXT,
    id_venta     TEXT,
    FOREIGN KEY (producto_id) REFERENCES productos(id),
    FOREIGN KEY (id_compra) REFERENCES compras(id),
    FOREIGN KEY (id_venta) REFERENCES ventas(id)
);

CREATE TABLE IF NOT EXISTS cargas_productos (
    id                  TEXT PRIMARY KEY DEFAULT (lower(hex(randomblob(16)))),
    fecha               TEXT    NOT NULL DEFAULT (date('now')),
    proveedor           TEXT    NOT NULL,
    monto_total         REAL    NOT NULL DEFAULT 0 CHECK (monto_total >= 0),
    productos_previos   REAL    NOT NULL DEFAULT 0 CHECK (productos_previos >= 0),
    productos_agregados REAL    NOT NULL DEFAULT 0 CHECK (productos_agregados >= 0)
);

CREATE TABLE IF NOT EXISTS detalle_carga_productos (
    id               TEXT PRIMARY KEY DEFAULT (lower(hex(randomblob(16)))),
    id_carga         TEXT    NOT NULL,
    codigo_producto  TEXT    NOT NULL,
    nombre_producto  TEXT    NOT NULL,
    costo            REAL    NOT NULL DEFAULT 0 CHECK (costo >= 0),
    unidades_nuevas  REAL    NOT NULL DEFAULT 0 CHECK (unidades_nuevas >= 0),
    FOREIGN KEY (id_carga) REFERENCES cargas_productos(id)
);

CREATE TABLE IF NOT EXISTS movimientos_inventario (
    id              TEXT PRIMARY KEY DEFAULT (lower(hex(randomblob(16)))),
    producto_id     TEXT    NOT NULL,
    codigo_producto TEXT    NOT NULL,
    nombre_producto TEXT    NOT NULL,
    tipo            TEXT    NOT NULL CHECK (tipo IN ('entrada', 'salida')),
    cantidad        REAL    NOT NULL CHECK (cantidad > 0),
    stock_antes     REAL    NOT NULL,
    stock_despues   REAL    NOT NULL CHECK (stock_despues >= 0),
    motivo          TEXT    NOT NULL,
    usuario_id      TEXT    NOT NULL,
    usuario_nombre  TEXT    NOT NULL,
    fecha           TEXT    NOT NULL,
    hora            TEXT    NOT NULL,
    FOREIGN KEY (producto_id) REFERENCES productos(id),
    FOREIGN KEY (usuario_id)  REFERENCES usuarios(id)
);

CREATE TABLE IF NOT EXISTS bitacora (
    id              TEXT PRIMARY KEY DEFAULT (lower(hex(randomblob(16)))),
    fecha           TEXT    NOT NULL,
    hora            TEXT    NOT NULL,
    usuario_id      TEXT,
    usuario_nombre  TEXT    NOT NULL,
    accion          TEXT    NOT NULL,
    entidad         TEXT,
    entidad_id      TEXT,
    detalle         TEXT    NOT NULL DEFAULT '',
    FOREIGN KEY (usuario_id) REFERENCES usuarios(id)
);


-- ============================================================================
-- SECCIÓN 2: ACTUALIZACIÓN DE BASES DE DATOS EXISTENTES (SIN PERDER INVENTARIO)
-- IMPORTANTE: Ejecuta solo las líneas ALTER TABLE cuyas columnas NO existan
-- todavía en tu BD vieja (puedes verificar con PRAGMA table_info(nombre_tabla);).
-- ============================================================================

-- --- productos (conserva todo tu inventario actual) ---
-- ALTER TABLE productos ADD COLUMN precio_divisas REAL NOT NULL DEFAULT 0;
-- ALTER TABLE productos ADD COLUMN precio_bcv REAL NOT NULL DEFAULT 0;
-- ALTER TABLE productos ADD COLUMN exento_iva INTEGER NOT NULL DEFAULT 0;
-- ALTER TABLE productos ADD COLUMN unidad_medida TEXT NOT NULL DEFAULT '';
-- ALTER TABLE productos ADD COLUMN estatus TEXT NOT NULL DEFAULT 'activo';
-- Sincroniza precios en inventario existente tras agregar precio_divisas / precio_bcv:
UPDATE productos SET precio_divisas = venta WHERE COALESCE(precio_divisas, 0) = 0 AND COALESCE(venta, 0) > 0;
UPDATE productos SET precio_bcv = venta WHERE COALESCE(precio_bcv, 0) = 0 AND COALESCE(venta, 0) > 0;

-- --- tasa ---
-- ALTER TABLE tasa ADD COLUMN bs REAL NOT NULL DEFAULT 0;
-- ALTER TABLE tasa ADD COLUMN iva_porcentaje REAL NOT NULL DEFAULT 16;
-- ALTER TABLE tasa ADD COLUMN retencion_iva_porcentaje REAL NOT NULL DEFAULT 75;

-- --- ventas ---
-- ALTER TABLE ventas ADD COLUMN tipo_documento TEXT NOT NULL DEFAULT 'factura';
-- ALTER TABLE ventas ADD COLUMN nro_factura INTEGER;
-- ALTER TABLE ventas ADD COLUMN nro_nota_entrega INTEGER;
-- ALTER TABLE ventas ADD COLUMN caja_id TEXT;
-- ALTER TABLE ventas ADD COLUMN subtotal_base REAL NOT NULL DEFAULT 0;
-- ALTER TABLE ventas ADD COLUMN subtotal_exento REAL NOT NULL DEFAULT 0;
-- ALTER TABLE ventas ADD COLUMN iva_porcentaje REAL NOT NULL DEFAULT 16;
-- ALTER TABLE ventas ADD COLUMN iva_monto REAL NOT NULL DEFAULT 0;
-- ALTER TABLE ventas ADD COLUMN retencion_iva_porcentaje REAL NOT NULL DEFAULT 0;
-- ALTER TABLE ventas ADD COLUMN retencion_iva_monto REAL NOT NULL DEFAULT 0;
-- ALTER TABLE ventas ADD COLUMN comprobante_retencion TEXT NOT NULL DEFAULT '';
-- ALTER TABLE ventas ADD COLUMN total_divisas REAL NOT NULL DEFAULT 0;
-- ALTER TABLE ventas ADD COLUMN tasa_bcv REAL NOT NULL DEFAULT 0;
-- ALTER TABLE ventas ADD COLUMN tasa_cop REAL NOT NULL DEFAULT 0;
-- ALTER TABLE ventas ADD COLUMN facturada_en_venta_id TEXT;
-- ALTER TABLE ventas ADD COLUMN nota_entrega_origen_id TEXT;
-- ALTER TABLE ventas ADD COLUMN flete_monto REAL NOT NULL DEFAULT 0;

-- --- detalle_venta ---
-- ALTER TABLE detalle_venta ADD COLUMN precio_divisas REAL NOT NULL DEFAULT 0;
-- ALTER TABLE detalle_venta ADD COLUMN exento_iva INTEGER NOT NULL DEFAULT 0;
-- ALTER TABLE detalle_venta ADD COLUMN alicuota_iva REAL NOT NULL DEFAULT 16;
-- ALTER TABLE detalle_venta ADD COLUMN monto_iva REAL NOT NULL DEFAULT 0;

-- --- compras ---
-- ALTER TABLE compras ADD COLUMN proveedor_id TEXT;
-- ALTER TABLE compras ADD COLUMN proveedor_rif TEXT NOT NULL DEFAULT '';
-- ALTER TABLE compras ADD COLUMN nro_factura TEXT NOT NULL DEFAULT '';
-- ALTER TABLE compras ADD COLUMN nro_control TEXT NOT NULL DEFAULT '';
-- ALTER TABLE compras ADD COLUMN tipo_documento TEXT NOT NULL DEFAULT 'factura';
-- ALTER TABLE compras ADD COLUMN moneda TEXT NOT NULL DEFAULT 'USD';
-- ALTER TABLE compras ADD COLUMN tasa_bcv REAL NOT NULL DEFAULT 0;
-- ALTER TABLE compras ADD COLUMN subtotal_base REAL NOT NULL DEFAULT 0;
-- ALTER TABLE compras ADD COLUMN subtotal_exento REAL NOT NULL DEFAULT 0;
-- ALTER TABLE compras ADD COLUMN iva_porcentaje REAL NOT NULL DEFAULT 16;
-- ALTER TABLE compras ADD COLUMN iva_monto REAL NOT NULL DEFAULT 0;
-- ALTER TABLE compras ADD COLUMN retencion_iva_porcentaje REAL NOT NULL DEFAULT 0;
-- ALTER TABLE compras ADD COLUMN retencion_iva_monto REAL NOT NULL DEFAULT 0;
-- ALTER TABLE compras ADD COLUMN comprobante_retencion TEXT NOT NULL DEFAULT '';
-- ALTER TABLE compras ADD COLUMN tipo_pago TEXT NOT NULL DEFAULT 'contado';
-- ALTER TABLE compras ADD COLUMN monto_abonado REAL NOT NULL DEFAULT 0;
-- ALTER TABLE compras ADD COLUMN estado_pago TEXT NOT NULL DEFAULT 'pagada';
-- ALTER TABLE compras ADD COLUMN flete_monto REAL NOT NULL DEFAULT 0;

-- --- detalle_compra ---
-- ALTER TABLE detalle_compra ADD COLUMN exento_iva INTEGER NOT NULL DEFAULT 0;
-- ALTER TABLE detalle_compra ADD COLUMN alicuota_iva REAL NOT NULL DEFAULT 16;
-- ALTER TABLE detalle_compra ADD COLUMN monto_iva REAL NOT NULL DEFAULT 0;

-- --- cajas ---
-- ALTER TABLE cajas ADD COLUMN total_fletes_usd REAL NOT NULL DEFAULT 0;

-- --- abonos_credito ---
-- ALTER TABLE abonos_credito ADD COLUMN tasa_cop REAL NOT NULL DEFAULT 0;
-- ALTER TABLE abonos_credito ADD COLUMN tasa_bs REAL NOT NULL DEFAULT 0;


-- ============================================================================
-- SECCIÓN 3: ÍNDICES Y TRIGGERS FISCALES (SEGURIDAD SENIAT)
-- ============================================================================

CREATE INDEX IF NOT EXISTS idx_abonos_compra_id ON abonos_compra(id_compra);
CREATE INDEX IF NOT EXISTS idx_abonos_credito ON abonos_credito(id_credito);
CREATE INDEX IF NOT EXISTS idx_abonos_fecha ON abonos_credito(fecha);
CREATE INDEX IF NOT EXISTS idx_bitacora_accion ON bitacora(accion);
CREATE INDEX IF NOT EXISTS idx_bitacora_fecha ON bitacora(fecha);
CREATE INDEX IF NOT EXISTS idx_bitacora_usuario ON bitacora(usuario_id);
CREATE INDEX IF NOT EXISTS idx_cajas_estado ON cajas(estado);
CREATE INDEX IF NOT EXISTS idx_cajas_fecha_apertura ON cajas(fecha_apertura);
CREATE INDEX IF NOT EXISTS idx_clientes_estatus ON clientes(estatus);
CREATE INDEX IF NOT EXISTS idx_clientes_nombre ON clientes(nombre);
CREATE INDEX IF NOT EXISTS idx_cotizaciones_fecha ON cotizaciones(fecha);
CREATE INDEX IF NOT EXISTS idx_creditos_venta ON creditos(id_venta);
CREATE INDEX IF NOT EXISTS idx_detalle_carga ON detalle_carga_productos(id_carga);
CREATE INDEX IF NOT EXISTS idx_detalle_compra ON detalle_compra(id_compra);
CREATE INDEX IF NOT EXISTS idx_detalle_cotizacion_cotizacion ON detalle_cotizacion(id_cotizacion);
CREATE INDEX IF NOT EXISTS idx_detalle_cotizacion_producto ON detalle_cotizacion(producto_id);
CREATE INDEX IF NOT EXISTS idx_detalle_devolucion ON detalle_devolucion(id_devolucion);
CREATE INDEX IF NOT EXISTS idx_detalle_venta_producto ON detalle_venta(producto_id);
CREATE INDEX IF NOT EXISTS idx_detalle_venta_venta ON detalle_venta(id_venta);
CREATE INDEX IF NOT EXISTS idx_devoluciones_cliente ON devoluciones(cliente_id);
CREATE INDEX IF NOT EXISTS idx_devoluciones_fecha ON devoluciones(fecha_creacion);
CREATE INDEX IF NOT EXISTS idx_devoluciones_tipo ON devoluciones(tipo_resolucion);
CREATE INDEX IF NOT EXISTS idx_devoluciones_venta ON devoluciones(id_venta);
CREATE INDEX IF NOT EXISTS idx_movimientos_fecha ON movimientos_inventario(fecha);
CREATE INDEX IF NOT EXISTS idx_movimientos_producto ON movimientos_inventario(producto_id);
CREATE INDEX IF NOT EXISTS idx_movimientos_tipo ON movimientos_inventario(tipo);
CREATE INDEX IF NOT EXISTS idx_pagos_venta_metodo ON pagos_venta(moneda, metodo);
CREATE INDEX IF NOT EXISTS idx_pagos_venta_venta ON pagos_venta(id_venta);
CREATE INDEX IF NOT EXISTS idx_productos_codigo ON productos(codigo);
CREATE INDEX IF NOT EXISTS idx_productos_estatus ON productos(estatus);
CREATE INDEX IF NOT EXISTS idx_seriales_producto ON seriales(producto_id);
CREATE INDEX IF NOT EXISTS idx_ventas_cliente ON ventas(cliente_id);
CREATE INDEX IF NOT EXISTS idx_ventas_estado ON ventas(estado);
CREATE INDEX IF NOT EXISTS idx_ventas_fecha ON ventas(fecha);

CREATE TRIGGER IF NOT EXISTS trg_seniat_no_cancel_ventas
BEFORE UPDATE OF estado ON ventas
WHEN NEW.estado IN ('anulado', 'cancelado', 'anulada', 'cancelada')
BEGIN
    SELECT RAISE(ABORT, 'SENIAT: Las facturas numeradas no pueden ser anuladas ni canceladas.');
END;

CREATE TRIGGER IF NOT EXISTS trg_seniat_no_delete_ventas
BEFORE DELETE ON ventas
BEGIN
    SELECT RAISE(ABORT, 'SENIAT: Las facturas y documentos numerados no pueden ser eliminados.');
END;


-- ============================================================================
-- SECCIÓN 4: CONFIGURACIÓN INICIAL SEGURA (NO SOBRESCRIBE DATOS EXISTENTES)
-- ============================================================================

INSERT OR IGNORE INTO tasa (id, valor, bs, iva_porcentaje, retencion_iva_porcentaje)
VALUES (1, 0, 0, 16, 75);
