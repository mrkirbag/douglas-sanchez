# Cliente nuevo · SAVI

Guía interna para levantar una instancia del sistema para un cliente.  
**Una instancia por cliente:** proyecto nuevo, otra base, otro `.env`, otra marca. No es multi-tenant.

Se entrega de **una** de estas dos formas:

| Modalidad | Qué es | Infra |
|-----------|--------|--------|
| **Membresía anual** | Web en la nube; el cliente paga renovación | Netlify + Turso |
| **Licencia local** | App `.exe` en la PC del cliente (pago único o según contrato) | Electron + SQLite local |

El código es el mismo. Cambia la base, el `.env` y cómo se publica.

---

## 1. Datos que hay que pedirle

- Modalidad: **membresía (nube)** o **licencia local (.exe)**
- Nombre comercial, RIF, teléfono, dirección, email
- Logo (SVG o PNG)
- Colores (3 hex: primario, secundario, acento)
- Moneda de precios: `USD` o `COP`
- Tasas iniciales COP y Bs
- Usuario y clave del primer admin

---

## 2. Crear el proyecto, dependencias y copiar archivos

Hace falta **Node.js 18+** y **pnpm**. Si no está pnpm:

```bash
npm install -g pnpm
```

### 2.1 Proyecto Astro nuevo

```bash
pnpm create astro@latest nombre-cliente -- --template minimal --install --no-git --yes
cd nombre-cliente
```

`--template minimal` arranca vacío. `--install` instala Astro. `--no-git` evita mezclar el historial del demo. `--yes` salta las preguntas.

### 2.2 Dependencias de SAVI

Astro ya viene del create. El resto (pnpm toma la última compatible):

```bash
pnpm add @astrojs/netlify @astrojs/node @libsql/client bcrypt chart.js chartjs-plugin-datalabels cookie dotenv html-to-image jsonwebtoken xlsx
```

Para empaquetar el `.exe` (también si este cliente es solo nube: queda listo por si después piden local):

```bash
pnpm add -D electron electron-builder
```

| Paquete | Para qué |
|---------|----------|
| `astro` | Framework (ya instalado) |
| `@astrojs/netlify` | Deploy membresía (Netlify) |
| `@astrojs/node` | Dev en Windows y servidor del `.exe` |
| `@libsql/client` | Turso (nube) o archivo SQLite (local) |
| `bcrypt` | Hash de contraseñas |
| `jsonwebtoken` | Sesión |
| `cookie` | Cookie de auth |
| `dotenv` | `.env` en el seed |
| `chart.js` + `chartjs-plugin-datalabels` | Reportes |
| `html-to-image` | Captura de gráficos |
| `xlsx` | Carga / export de Excel |
| `electron` | Ventana de la app local |
| `electron-builder` | Generar el instalador `.exe` |

### 2.3 Copiar el sistema

Pegá **todos los archivos** del demo encima de este proyecto (sobrescribí lo que haya creado Astro: `astro.config.mjs`, `src/`, `public/`, `package.json`, `tsconfig.json`, `scripts/`).

No copies:

- `node_modules/`
- `dist/`
- `.env`
- `.astro/`

Después del pegado:

```bash
pnpm install
```

---

## 3. Base de datos

### A — Membresía (Turso)

Si no está el CLI:

```bash
powershell -c "irm https://get.tur.so/install.ps1 | iex"
turso auth login
```

Después:

```bash
turso db create cliente-xyz
turso db show cliente-xyz --url
turso db tokens create cliente-xyz
```

Una BD **nueva** por cliente. No reutilizar la de otro.

### B — Licencia local (SQLite en disco)

No hace falta Turso. La BD es un archivo en la PC del cliente, por ejemplo `savi.db`. Se crea sola al correr el seed (`DATABASE_URL=file:savi.db`).

---

## 4. Armar el `.env`

Archivo en la raíz del proyecto nuevo.

### Común (las dos modalidades)

```env
JWT_SECRET=secreto_unico_de_este_cliente

SEED_ADMIN_USER=admin
SEED_ADMIN_PASSWORD=clave_segura
SEED_ADMIN_NOMBRE=Administrador
SEED_TASA=4000
SEED_TASA_BS=36.50
```

Opcional (cliente de mostrador):

```env
SEED_CLIENTE_NOMBRE=Consumidor final
SEED_CLIENTE_CEDULA=V-00000000
SEED_CLIENTE_TELEFONO=0000-0000000
```

### A — Membresía (sumar Turso)

```env
DATABASE_URL=libsql://...
DATABASE_AUTH_TOKEN=...
```

### B — Licencia local (archivo, sin token)

```env
DATABASE_URL=file:savi.db
```

| Variable | Nube | Local | Uso |
|----------|------|-------|-----|
| `DATABASE_URL` | Sí (Turso) | Sí (`file:savi.db`) | Conexión a la BD |
| `DATABASE_AUTH_TOKEN` | Sí | No | Token de Turso |
| `JWT_SECRET` | Sí | Sí | Sesiones; único por cliente |
| `SEED_ADMIN_*` | No | No | Primer admin (defaults: `admin` / `admin123`) |
| `SEED_TASA` / `SEED_TASA_BS` | No | No | Tasas iniciales USD→COP y USD→Bs |

---

## 5. Semilla

```bash
pnpm seed
```

Crea tablas de forma segura (sin borrar datos existentes), el admin, las tasas y el cliente “Consumidor final”.  
En una BD nueva no hace falta pegar `src/lib/db.sql` a mano.

El script es **idempotente**: si el usuario o cliente ya existen, no los duplica. Si las tasas ya tienen valor distinto de 0, no las pisa.

En local, después del seed tiene que existir `savi.db` en la raíz (o la ruta que hayas puesto en `DATABASE_URL`). Ese archivo **viaja con el `.exe`** o se genera en el primer arranque; no lo subas a git.

---

## 6. Personalizar la marca

| Archivo | Qué cambiar |
|---------|-------------|
| `src/data/empresa.json` | Nombre, RIF, teléfono, dirección, email, `subtitulo`, `etiquetaMarca`, `monedaBase` (`USD` o `COP`) |
| `src/utils/tema.ts` | `primario`, `secundario`, `acento` |
| `public/logo.svg` | Logo (login e impresiones) |
| `public/favicon.svg` | Icono del navegador |

Precios:

- En **USD**: COP = USD × tasa COP · Bs = USD × tasa Bs
- En **COP**: USD = COP ÷ tasa COP · Bs = (COP ÷ tasa COP) × tasa Bs

---

## 7. Probar en local

```bash
pnpm dev
```

Abrir http://localhost:4321 con el admin del seed. Revisar:

- [ ] Login y cierre de sesión
- [ ] Tasa del día
- [ ] Alta de producto y cliente
- [ ] Registro de compra (manual o Excel con números de serie)
- [ ] Venta de contado y a crédito
- [ ] Procesar devolución (efectivo o nota de crédito)
- [ ] Registro de abono a crédito
- [ ] Reportes y auditoría en bitácora (como admin)

Vale para las dos modalidades. En nube estás pegado a Turso; en local, a `savi.db`.

---

## 8. Cargar operación *(opcional)*

Como admin, en el panel:

1. Confirmar la tasa del día
2. Cargar productos (manual en *Productos* o importación masiva Excel en *Compras*)
3. Crear clientes reales
4. Si hace falta, crear un usuario empleado en *Usuarios*

---

## 9. Entregar

### A — Membresía: publicar en Netlify

1. Sitio nuevo conectado a **este** proyecto
2. **Build command:** `pnpm build`
3. Variables de entorno del sitio:
   - `DATABASE_URL`
   - `DATABASE_AUTH_TOKEN`
   - `JWT_SECRET`

   `SEED_*` no hace falta en Netlify si el seed ya corrió contra esa BD.

4. Deploy y probar login en producción

En Windows el adapter local es **Node**; en Netlify es **Netlify** (`astro.config.mjs`).

Renovación anual: el sitio y la BD siguen vivos mientras paguen. Si no renuevan, se baja el sitio y/o se revoca el token de Turso.

### B — Licencia local: empaquetar `.exe`

Las deps `electron` y `electron-builder` ya están en el proyecto (valen para cualquier cliente). **Todavía no hay** proceso main ni config de `electron-builder`: el instalador no se genera todavía.

Cuando exista el wrapper:

1. `pnpm build` (adapter Node)
2. Empaquetar con Electron para Windows
3. Entregar el instalador / `.exe` al cliente
4. La BD queda en disco (`savi.db`); backups = copiar ese archivo

---

## Qué es único por cliente

| Elemento | Membresía | Licencia local |
|----------|-----------|----------------|
| Proyecto / carpeta | Sí | Sí |
| Base | Turso (sí, nueva) | `savi.db` en esa PC |
| `.env` | URL + token + JWT | `file:…` + JWT |
| Vars Netlify | Sí | No |
| `pnpm seed` | Una vez por BD Turso | Una vez (o en el primer arranque) |
| `empresa.json` + `tema.ts` + logos | Sí | Sí |
| URL del sitio | Sí | No — corre en la PC |
| `.exe` / instalador | No | Sí |

No compartir BD, JWT ni token de Turso entre clientes.
