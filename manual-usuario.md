# Manual de Usuario · Sistema Administrativo
**Comercializadora e Importadora AG**

Bienvenido al manual de usuario del sistema administrativo de ventas, inventario y gestión fiscal. Esta guía explica paso a paso cómo operar cada módulo del sistema de forma clara y práctica.

---

## 1. Acceso al Sistema y Perfiles de Usuario

Al abrir la aplicación, ingresarás directamente a la pantalla de **Inicio de Sesión**.

- Escribe tu **Usuario** y **Contraseña** y haz clic en **Entrar al sistema**.
- Para salir de forma segura al terminar tu jornada, usa el botón **Cerrar sesión** en la parte inferior del menú lateral izquierdo.

El sistema maneja dos niveles de acceso:
- **Administrador:** Acceso total a todos los módulos (panel principal, tasas, clientes, inventario, compras, ventas, devoluciones, créditos, cotizaciones, reportes, usuarios y bitácora).
- **Empleado:** Acceso operativo a panel principal, tasas y retenciones, clientes, cotizaciones, ventas, devoluciones y créditos. No visualiza módulos administrativos sensibles como costos de compras, ajustes internos de inventario, reportes financieros globales, usuarios ni bitácora.

---

## 2. Panel Principal (Inicio)

Es tu centro de control diario. Al entrar verás:
- **Resumen operativo:** Acceso rápido a las tareas más frecuentes (nueva venta, clientes, productos, créditos).
- **Alertas de inventario:** Listado automático de productos **agotados** o con **stock bajo** para que puedas reponer mercancía a tiempo.

---

## 3. Tasas y Retenciones (Configuración Fiscal y Monetaria)

Antes de iniciar las operaciones del día, es recomendable verificar este módulo en el menú lateral:

- **Tasa COP (USD → COP):** Valor de cambio para calcular precios y pagos en pesos colombianos.
- **Tasa BCV (USD → Bs):** Tasa oficial del Banco Central de Venezuela utilizada para el cálculo de facturación fiscal en bolívares.
- **Alícuota IVA General (%):** Porcentaje de IVA vigente (por defecto `16%`), calculado sobre la base imponible BCV en documentos fiscales.
- **Retención de IVA (%):** Porcentaje de retención por defecto (por ejemplo `75%`) aplicable a operaciones con contribuyentes especiales.

> **Importante:** Cada venta o compra guarda las tasas vigentes del momento en que se emitió, por lo que actualizar la tasa hoy no altera tus documentos históricos.

---

## 4. Gestión de Clientes

En el módulo **Clientes** puedes:
- **Registrar clientes nuevos:** Nombre o razón social, cédula o RIF y teléfono.
- **Buscar y editar:** Localiza rápidamente a cualquier cliente por nombre o documento y actualiza sus datos.
- **Saldo a Favor (Notas de Crédito):** En el listado de clientes verás una columna con el saldo disponible que tiene cada cliente por devoluciones a su favor, listo para usarse en próximas compras.
- **Consumidor final:** El sistema incluye un cliente genérico para ventas rápidas de mostrador que no requieran datos personalizados.

---

## 5. Inventario (Productos)

*(Disponible para Administrador)*

Desde **Inventario** controlas todo tu catálogo de mercancía:
- **Registro completo:** Al agregar o editar un producto puedes definir su código, nombre, **descripción**, unidad de medida, costo y precios.
- **Precios diferenciados:** Puedes definir el precio en **Divisas (USD)** y el precio de referencia **BCV (USD)** para cada producto.
- **Condición fiscal por producto:** Marca si el producto es **Gravado** (aplica IVA en factura fiscal) o **Exento de IVA**.
- **Control de Seriales:** Para equipos o artículos que lo requieran, puedes llevar el registro individual de sus números de serial al comprar y seleccionarlos al vender.
- **Movimientos manuales e historial:** Registra entradas o salidas especiales de mercancía (por ejemplo, ajustes o mermas) y consulta el historial completo de movimientos de cada artículo.

---

## 6. Compras y Fiscalización de Compras

*(Disponible para Administrador)*

Al registrar una compra en **Compras → Registrar compra**, el sistema te permite diferenciar claramente el tipo de respaldo recibido de tu proveedor:

### A. Factura Fiscal (Con IVA)
Ideal para compras formales que generan crédito fiscal:
- Permite registrar **N° de Factura** y **N° de Control**.
- Registra el **RIF / C.I. del proveedor**.
- Calcula el **IVA de la compra** y permite aplicar **Retención de IVA** (`0%` sin retención, `75%` agente de retención o `100%` retención total) junto con su **N° de Comprobante de Retención**.
- En el listado de compras queda identificada con la etiqueta **FACTURA FISCAL** y muestra el crédito fiscal y la retención aplicada.

### B. Nota de Entrega (Sin IVA)
Pensada para compras internas, reposiciones sin factura fiscal o inventario inicial:
- No solicita número de factura ni de control.
- No calcula IVA ni retenciones.
- Aumenta el stock de tus productos de inmediato y queda marcada como **NOTA ENTREGA**.

### Condición de Pago: Contado o A Crédito, Flete y Edición de Compras
Al registrar una compra puedes elegir cómo se paga:
- **Contado (Pagada):** La compra queda saldada de inmediato.
- **A Crédito (Cuenta por Pagar):** La deuda queda registrada a nombre del proveedor (puedes indicar un **Abono Inicial** opcional en USD si entregaste un adelanto) y pasa automáticamente al módulo de **Cuentas por Pagar**.
- **Gasto de Flete:** Si la compra incluye flete, marca **Registrar gasto de flete** e ingresa el monto en USD. Este monto **no se suma** al total de la factura de compra; queda guardado como constancia visual en el detalle de la compra y en el reporte de **Fletes**.
- **Precisión de 4 decimales:** Todos los costos, precios, impuestos y totales admiten y muestran hasta **4 decimales** para garantizar exactitud en montos unitarios y cálculos por volumen.
- **Editar datos de compra:** Si cometiste un error al cargar la cabecera (por ejemplo, la marcaste de contado y era a crédito, o necesitas corregir la fecha, el proveedor, el N° de factura o control), entra al detalle de la compra y usa **Editar datos de compra**.

### Proveedores
En el módulo **Proveedores** ves el directorio completo de tus proveedores junto con su cantidad de compras, total comprado y deuda pendiente. Cada vez que registras una compra con un proveedor nuevo, el sistema lo guarda automáticamente para que en próximas compras puedas seleccionarlo con un clic.

### Cuentas por Pagar (Deudas con Proveedores)
Desde el módulo **Cuentas por Pagar** en el menú lateral llevas el control consolidado de lo que debes a cada proveedor:
- **Vista agrupada por proveedor:** Ves una sola fila por proveedor con el total de compras a crédito, deuda total, total abonado y **saldo pendiente**.
- **Detalle y abonos:** Al entrar en **Ver / Abonar**, visualizas todas las compras a crédito de ese proveedor, su historial de pagos y puedes **registrar abonos** en **USD, Bolívares (BCV) o Pesos (COP)**, aplicándolos a una factura/nota específica o automáticamente a las deudas más antiguas.

### Importación y Exportación con Excel
En la barra superior de **Compras** cuentas con dos herramientas clave:
- **Importar desde Excel:** Carga inventario masivamente desde un archivo `.xlsx` (puedes descargar la **Plantilla (.xlsx)** directamente desde esa ventana). También te permite elegir si la carga entra como **Nota de Entrega / Inventario Inicial (Sin IVA)** o como **Factura Fiscal de Compra (Con IVA)**.
- **Exportar a Excel:** Descarga el listado completo de tus compras registradas en formato hoja de cálculo.

---

## 7. Ventas y Fiscalización (Facturas vs Notas de Entrega)

El módulo de **Ventas** es el corazón de la operación diaria.

### Apertura y Cierre de Caja
- Para poder vender, debes tener abierto el **turno de caja del día** desde el módulo de Ventas. Si intentas facturar con la caja cerrada, el sistema te mostrará un aviso para ir a abrirla.
- Al finalizar la jornada, realizas el **cierre de caja** con el resumen de lo cobrado por método de pago.

### Dos Modalidades de Documento en Ventas
Al emitir una venta (**Ventas → Registrar venta**), el sistema te ofrece dos opciones claras según la necesidad del cliente:

#### 1. Factura en Bs (Precio BCV) — Modalidad Fiscal
- Trabaja sobre la **Base Imponible BCV** convertida a Bolívares según la tasa BCV del día.
- Aplica automáticamente el **IVA** solo a los productos gravados (respetando los productos marcados como exentos).
- Soporta el registro de **Retención de IVA** cuando el cliente sea agente de retención.
- Genera un documento formal con desglose de base imponible, exento, IVA y total en Bs (con su referencia).

#### 2. Nota de Entrega en Divisas — Modalidad Comercial
- Trabaja directamente con el **precio en Divisas (USD)** y su equivalente referencial en COP / Bs.
- No calcula IVA al momento de emitirla, agilizando despachos rápidos o ventas acordadas en divisas.
- **Facturación posterior:** Si un cliente recibió una Nota de Entrega y luego solicita su factura fiscal, desde el detalle de la venta puedes convertir/facturar esa nota para darle respaldo fiscal sin perder el historial.

### Métodos de Pago y Condición de Venta
- **Venta de Contado:** Puedes cobrar en un solo método o combinar **pagos mixtos** (por ejemplo, una parte en efectivo USD, otra en Pago Móvil/Bs y otra en pesos COP o transferencia/Zelle).
- **Venta a Crédito:** Puedes dejar la venta como crédito (total o con un pago inicial) asociada a un cliente para hacerle seguimiento desde el módulo de Cuentas por Cobrar.
- **Gasto de Flete (opcional):** Si una venta incluye flete, marca la casilla **Registrar monto de flete** e ingresa el monto en USD. El cliente paga exactamente el mismo total de la factura/nota y el comprobante impreso no se altera; el flete queda registrado como constancia visual y se descuenta estadísticamente de la caja y de las utilidades reales en **Reportes**.
- **Ganancia Aproximada (vista interna):** En el listado de **Ventas** y en la vista de detalle de cada venta se muestra la casilla **Ganancia Aproximada** (`≈`) en USD, Bs y COP, calculada netamente como `precio de venta − costo de compra` de los productos (sin incluir fletes ni depender de abonos o créditos, pudiendo mostrar valores negativos). Nunca se imprime en facturas ni notas de entrega.
- **Impresión:** Al completar la venta puedes imprimir o reimprimir el comprobante en cualquier momento desde el detalle de la venta.

---

## 8. Cotizaciones

Desde **Cotizaciones** puedes preparar presupuestos formales para tus clientes antes de concretar la venta:
- Selecciona el cliente, agrega los productos y cantidades.
- Visualiza montos en USD, COP y Bs según la tasa vigente.
- Imprime la cotización con los datos y logo de la empresa para entregarla al cliente (las cotizaciones no descuentan inventario hasta que se realice la venta).

---

## 9. Devoluciones

Cuando un cliente devuelve mercancía, ve al módulo **Devoluciones**:
- Busca la venta original y selecciona los productos y cantidades a devolver.
- El sistema reingresa automáticamente los productos devueltos al inventario (incluyendo seriales si aplica).
- Puedes registrar si la devolución se resuelve mediante **reintegro** o **nota de crédito**, dejando trazabilidad completa del motivo y monto.

---

## 10. Cuentas por Cobrar (Créditos y Abonos)

El módulo **Cuentas por Cobrar** te permite llevar el control consolidado de todo lo que tus clientes te deben:
- **Vista agrupada por cliente:** En lugar de ver cada venta por separado, ves una fila por **cliente** con la cantidad de ventas a crédito, su deuda total, lo abonado y su **saldo pendiente total**.
- **Detalle y Abonos:** Al hacer clic en **Ver / Abonar** sobre un cliente puedes:
  - Ver todas sus ventas a crédito en un solo lugar (con enlace al detalle de cada una).
  - Consultar el historial completo de abonos realizados por ese cliente.
  - **Registrar un nuevo abono** en **USD, Bolívares (BCV) o Pesos (COP)**, eligiendo si deseas aplicarlo a una venta puntual o que el sistema lo distribuya automáticamente desde las más antiguas hasta las más recientes. Al saldarse por completo, la cuenta queda marcada como **Saldada**.

---

## 11. Reportes y Estadísticas

*(Disponible para Administrador)*

En **Reportes y Estadísticas** obtienes una visión clara del rendimiento del negocio:
- Filtros por rango de fechas para analizar períodos específicos.
- Gráficos interactivos de ventas, ingresos, productos más vendidos y comportamiento comercial.
- Resúmenes de operaciones fiscales y no fiscales (con precisión de hasta 4 decimales y descuento estadístico de fletes en caja y utilidades).
- **Reporte de Fletes:** Botón **Fletes** para consultar la constancia detallada de todos los fletes registrados en **Ventas** y **Compras** dentro de un rango de fechas (tipo de operación, ID de transacción, documento, fecha, cliente/proveedor, monto de flete y total), con exportación a Excel.
- Opción para exportar o capturar los reportes para tus presentaciones o controles contables.

---

## 12. Usuarios y Bitácora de Auditoría

*(Disponible para Administrador)*

- **Usuarios:** Crea cuentas nuevas para tu equipo asignando el rol **Administrador** o **Empleado**, cambia contraseñas o administra accesos.
- **Bitácoras:** Registro automático e inalterable de todas las acciones importantes realizadas en el sistema (inicios de sesión, cambios de tasa, compras, ventas, devoluciones, abonos y movimientos de inventario), indicando qué usuario la hizo y en qué fecha y hora.
