import empresa from '@/data/empresa.json';
import { imprimir } from '@/utils/helpers/imprimir.js';
import { formatearFecha } from '@/utils/helpers/formateoFecha.js';
import { formatearDecimal, formatearMoneda, redondearBS, redondearCOP } from '@/utils/helpers/tasas.js';
import { etiquetaPago } from '@/utils/helpers/metodosPago.js';

function esc(valor) {
    return String(valor ?? '')
        .replace(/&/g, '&amp;')
        .replace(/</g, '&lt;')
        .replace(/>/g, '&gt;')
        .replace(/"/g, '&quot;')
        .replace(/'/g, '&#39;');
}

function obtenerMetadatosDocumento(data) {
    const venta = data?.venta || {};
    const esNotaEntrega = venta.tipo_documento === 'nota_entrega';
    const numero = esNotaEntrega
        ? `NE-${String(venta.nro_nota_entrega || 1).padStart(6, '0')}`
        : `#${String(venta.nro_factura || 1).padStart(6, '0')}`;
    const tipoLabel = esNotaEntrega ? 'NOTA DE ENTREGA' : 'FACTURA';
    const titulo = esNotaEntrega
        ? `NOTA DE ENTREGA ${numero} (NO FISCAL)`
        : `FACTURA ${numero}`;

    return { esNotaEntrega, numero, tipoLabel, titulo };
}

function calcularMontos(data, tasaBcv, tasaCop) {
    const venta = data?.venta || {};
    const subtotalBaseUsd = Number(venta.subtotal_base) || 0;
    const subtotalExentoUsd = Number(venta.subtotal_exento) || 0;
    const ivaPorc = Number(venta.iva_porcentaje ?? 16);
    const ivaUsd = Number(venta.iva_monto) || 0;
    const retPorc = Number(venta.retencion_iva_porcentaje) || 0;
    const retUsd = Number(venta.retencion_iva_monto) || 0;
    const montoTotalUsd = Number(venta.monto_total) || 0;
    const totalDivisasUsd = Number(venta.total_divisas) || montoTotalUsd;

    return {
        ivaPorc,
        retPorc,
        retUsd,
        subtotalExentoUsd,
        comprobanteRet: venta.comprobante_retencion || '',
        baseBs: redondearBS(subtotalBaseUsd * tasaBcv),
        exentoBs: redondearBS(subtotalExentoUsd * tasaBcv),
        ivaBs: redondearBS(ivaUsd * tasaBcv),
        retBs: redondearBS(retUsd * tasaBcv),
        totalLegalBs: redondearBS(montoTotalUsd * tasaBcv),
        totalDivisasUsd,
        totalRefCop: redondearCOP(totalDivisasUsd * tasaCop),
    };
}

function renderizarCarta({ data, tasaBcv, tasaCop }) {
    const { esNotaEntrega, numero, tipoLabel } = obtenerMetadatosDocumento(data);
    const venta = data?.venta || {};
    const cliente = data?.cliente || {};
    const productos = Array.isArray(data?.productos) ? data.productos : [];
    const pagos = Array.isArray(data?.pagos) ? data.pagos : [];
    const montos = calcularMontos(data, tasaBcv, tasaCop);

    const filasProductos = productos
        .map((p) => {
            const pUnitBcvUsd = Number(p.precio_unitario) || 0;
            const pUnitBcvBs = redondearBS(pUnitBcvUsd * tasaBcv);
            const pUnitDivUsd = Number(p.precio_divisas) > 0 ? Number(p.precio_divisas) : pUnitBcvUsd;
            const pUnitCop = redondearCOP(pUnitDivUsd * tasaCop);
            const cant = Number(p.cantidad) || 0;
            const subBaseBs = redondearBS((Number(p.subtotal) || 0) * tasaBcv);
            const subDivUsd = pUnitDivUsd * cant;
            const subDivCop = redondearCOP(subDivUsd * tasaCop);
            const esExento = Boolean(Number(p.exento_iva));
            const seriales = Array.isArray(p.seriales) && p.seriales.length > 0
                ? `<div class="seriales">S/N: ${esc(p.seriales.join(', '))}</div>`
                : '';

            if (esNotaEntrega) {
                return `
                    <tr>
                        <td class="col-cod">${esc((p.codigo_producto || '').toUpperCase())}</td>
                        <td class="col-desc">
                            <span class="prod-nombre">${esc((p.nombre_producto || '').toUpperCase())}</span>
                            ${seriales}
                        </td>
                        <td class="col-cant">${cant}</td>
                        <td class="col-num">
                            <div>$${formatearDecimal(pUnitDivUsd, 2, 4)} USD</div>
                            <div class="sub-ref">${pUnitCop.toLocaleString('es-CO')} COP</div>
                        </td>
                        <td class="col-num strong">
                            <div>$${formatearDecimal(subDivUsd, 2, 4)} USD</div>
                            <div class="sub-ref">${subDivCop.toLocaleString('es-CO')} COP</div>
                        </td>
                    </tr>
                `;
            }

            return `
                <tr>
                    <td class="col-cod">${esc((p.codigo_producto || '').toUpperCase())}</td>
                    <td class="col-desc">
                        <span class="prod-nombre">${esc((p.nombre_producto || '').toUpperCase())}</span>
                        <span class="tag-fiscal">(${esExento ? 'E' : 'G'})</span>
                        ${seriales}
                    </td>
                    <td class="col-cant">${cant}</td>
                    <td class="col-num">${formatearDecimal(pUnitBcvBs, 2, 4)} Bs</td>
                    <td class="col-num strong">${formatearDecimal(subBaseBs, 2, 4)} Bs</td>
                </tr>
            `;
        })
        .join('');

    const bloquePagos = pagos.length > 0
        ? `
            <div class="bloque-info">
                <div class="bloque-titulo">Pagos recibidos</div>
                <ul class="lista-pagos">
                    ${pagos
                        .map(
                            (pago) => `
                        <li>
                            <span>${esc(etiquetaPago(pago.moneda, pago.metodo))}</span>
                            <strong>${esc(formatearMoneda(pago.monto, pago.moneda))}</strong>
                        </li>
                    `,
                        )
                        .join('')}
                </ul>
            </div>
        `
        : '';

    const bloqueTotales = esNotaEntrega
        ? `
            <div class="totales-lista">
                <div class="total-row total-final">
                    <span>Total Divisas (USD)</span>
                    <strong>$${formatearDecimal(montos.totalDivisasUsd, 2, 4)} USD</strong>
                </div>
                <div class="total-row total-secundario">
                    <span>Referencia en Pesos (COP)</span>
                    <strong>${montos.totalRefCop.toLocaleString('es-CO')} COP</strong>
                </div>
            </div>
        `
        : `
            <div class="totales-lista">
                <div class="total-row">
                    <span>Base Imponible (G)</span>
                    <strong>${formatearDecimal(montos.baseBs, 2, 4)} Bs</strong>
                </div>
                ${
                    montos.subtotalExentoUsd > 0
                        ? `
                    <div class="total-row">
                        <span>Monto Exento (E)</span>
                        <strong>${formatearDecimal(montos.exentoBs, 2, 4)} Bs</strong>
                    </div>
                `
                        : ''
                }
                <div class="total-row">
                    <span>IVA (${montos.ivaPorc}%)</span>
                    <strong>${formatearDecimal(montos.ivaBs, 2, 4)} Bs</strong>
                </div>
                ${
                    montos.retUsd > 0
                        ? `
                    <div class="total-row retencion">
                        <span>(-) Retención IVA (${montos.retPorc}%)${montos.comprobanteRet ? ` · Comp: ${esc(montos.comprobanteRet)}` : ''}</span>
                        <strong>-${formatearDecimal(montos.retBs, 2, 4)} Bs</strong>
                    </div>
                `
                        : ''
                }
                <div class="total-row total-final">
                    <span>TOTAL FACTURA</span>
                    <strong>${formatearDecimal(montos.totalLegalBs, 2, 4)} Bs</strong>
                </div>
            </div>
        `;

    const avisoNoFiscal = esNotaEntrega
        ? `<div class="cintillo-no-fiscal">DOCUMENTO NO FISCAL — NO VÁLIDO COMO FACTURA NI CRÉDITO FISCAL</div>`
        : '';

    const notaLegal = esNotaEntrega
        ? 'Documento de entrega y control interno expresado en divisas. No constituye factura fiscal.'
        : `Montos expresados en Bolívares (Bs) según tasa BCV del día: 1 USD = ${Number(tasaBcv || 0).toFixed(4)} Bs.`;

    const contenido = `
        <div class="doc-carta">
            <header class="carta-header">
                <div class="empresa-col">
                    ${empresa.logo ? `<img src="${esc(empresa.logo)}" alt="${esc(empresa.nombre)}" class="empresa-logo" />` : ''}
                    <div>
                        <h1 class="empresa-nombre">${esc(empresa.nombre)}</h1>
                        ${empresa.subtitulo ? `<p class="empresa-sub">${esc(empresa.subtitulo)}</p>` : ''}
                        <p class="empresa-meta">RIF: ${esc(empresa.rif)} &nbsp;·&nbsp; Tel: ${esc(empresa.telefono)}</p>
                        ${empresa.direccion ? `<p class="empresa-meta">${esc(empresa.direccion)}</p>` : ''}
                    </div>
                </div>
                <div class="doc-col">
                    <div class="doc-tipo">${tipoLabel}</div>
                    <div class="doc-numero">${esc(numero)}</div>
                    <div class="doc-meta-grid">
                        <span>Fecha:</span><strong>${esc(formatearFecha(venta.fecha))}</strong>
                        <span>Condición:</span><strong>${esc((venta.tipo_pago || '').toUpperCase())}</strong>
                        <span>Estado:</span><strong>${esc((venta.estado || '').toUpperCase())}</strong>
                    </div>
                </div>
            </header>

            ${avisoNoFiscal}

            <section class="cliente-strip">
                <div class="cliente-item cliente-item--wide">
                    <span class="lbl">Cliente / Razón Social</span>
                    <span class="val">${esc((cliente.nombre || '').toUpperCase())}</span>
                </div>
                <div class="cliente-item">
                    <span class="lbl">C.I. / RIF</span>
                    <span class="val">${esc(cliente.cedula || '—')}</span>
                </div>
                <div class="cliente-item">
                    <span class="lbl">Teléfono</span>
                    <span class="val">${esc(cliente.telefono || '—')}</span>
                </div>
            </section>

            <section class="tabla-wrap">
                <table class="tabla-legal">
                    <thead>
                        <tr>
                            <th class="col-cod">Código</th>
                            <th class="col-desc">Descripción</th>
                            <th class="col-cant">Cant.</th>
                            <th class="col-num">P. Unitario</th>
                            <th class="col-num">Subtotal</th>
                        </tr>
                    </thead>
                    <tbody>
                        ${filasProductos}
                    </tbody>
                </table>
            </section>

            <section class="pie-grid">
                <div class="pie-izq">
                    ${bloquePagos}
                    <p class="nota-legal">${esc(notaLegal)}</p>
                    <div class="firma-linea">
                        <span>Recibido conforme: ______________________________</span>
                    </div>
                </div>
                <div class="pie-der">
                    ${bloqueTotales}
                </div>
            </section>

            <footer class="carta-footer">
                <span>${esc(empresa.nombre)} · RIF: ${esc(empresa.rif)}</span>
                <span>Documento generado el ${esc(new Date().toLocaleDateString('es-VE', { timeZone: 'America/Caracas' }))}</span>
            </footer>
        </div>
    `;

    const estilosExtra = `
        * { box-sizing: border-box; }
        body {
            margin: 0;
            padding: 0;
            font-family: 'Segoe UI', 'Helvetica Neue', Arial, sans-serif;
            color: #111827;
            font-size: 10pt;
            line-height: 1.45;
            background: #fff;
        }
        .doc-carta {
            width: 100%;
            max-width: 7.5in;
            margin: 0 auto;
        }
        .carta-header {
            display: flex;
            justify-content: space-between;
            align-items: flex-start;
            gap: 20px;
            padding-bottom: 14px;
            border-bottom: 1.5px solid #1e293b;
        }
        .empresa-col {
            display: flex;
            align-items: flex-start;
            gap: 12px;
            max-width: 60%;
        }
        .empresa-logo {
            width: 52px;
            height: 52px;
            object-fit: contain;
            flex-shrink: 0;
        }
        .empresa-nombre {
            margin: 0 0 2px;
            font-size: 15pt;
            font-weight: 700;
            letter-spacing: 0.02em;
            color: #0f172a;
        }
        .empresa-sub {
            margin: 0 0 4px;
            font-size: 8.5pt;
            color: #475569;
        }
        .empresa-meta {
            margin: 1px 0;
            font-size: 8.5pt;
            color: #334155;
        }
        .doc-col {
            text-align: right;
            min-width: 190px;
        }
        .doc-tipo {
            font-size: 9pt;
            font-weight: 700;
            letter-spacing: 0.12em;
            color: #475569;
            text-transform: uppercase;
        }
        .doc-numero {
            font-size: 16pt;
            font-weight: 800;
            color: #0f172a;
            margin: 2px 0 6px;
        }
        .doc-meta-grid {
            display: grid;
            grid-template-columns: auto auto;
            justify-content: end;
            gap: 2px 10px;
            font-size: 8.5pt;
            color: #334155;
        }
        .doc-meta-grid strong {
            color: #0f172a;
        }
        .cintillo-no-fiscal {
            margin-top: 10px;
            padding: 5px 8px;
            text-align: center;
            font-size: 8.5pt;
            font-weight: 700;
            letter-spacing: 0.06em;
            color: #475569;
            border-top: 1px dashed #94a3b8;
            border-bottom: 1px dashed #94a3b8;
        }
        .cliente-strip {
            display: grid;
            grid-template-columns: 2fr 1fr 1fr;
            gap: 12px;
            padding: 12px 0;
            border-bottom: 1px solid #cbd5e1;
        }
        .cliente-item {
            display: flex;
            flex-direction: column;
            gap: 2px;
        }
        .cliente-item .lbl {
            font-size: 7.5pt;
            text-transform: uppercase;
            letter-spacing: 0.08em;
            color: #64748b;
            font-weight: 600;
        }
        .cliente-item .val {
            font-size: 9.5pt;
            font-weight: 600;
            color: #0f172a;
        }
        .tabla-wrap {
            margin-top: 14px;
        }
        .tabla-legal {
            width: 100%;
            border-collapse: collapse;
        }
        .tabla-legal thead th {
            padding: 7px 6px;
            font-size: 8pt;
            font-weight: 700;
            text-transform: uppercase;
            letter-spacing: 0.06em;
            color: #334155;
            background: #f8fafc;
            border-top: 1.5px solid #1e293b;
            border-bottom: 1.5px solid #1e293b;
            border-left: none;
            border-right: none;
            text-align: left;
        }
        .tabla-legal tbody td {
            padding: 8px 6px;
            font-size: 9.2pt;
            color: #1e293b;
            border-bottom: 1px solid #e2e8f0;
            border-left: none;
            border-right: none;
            vertical-align: top;
        }
        .tabla-legal tbody tr:last-child td {
            border-bottom: 1.5px solid #1e293b;
        }
        .tabla-legal .col-cod { width: 15%; font-family: Consolas, monospace; font-size: 8.5pt; }
        .tabla-legal .col-desc { width: 43%; }
        .tabla-legal .col-cant { width: 10%; text-align: center !important; }
        .tabla-legal .col-num { width: 16%; text-align: right !important; white-space: nowrap; }
        .tabla-legal .strong { font-weight: 700; color: #0f172a; }
        .tag-fiscal { font-size: 8pt; font-weight: 700; color: #475569; margin-left: 3px; }
        .sub-ref { font-size: 7.8pt; color: #64748b; }
        .seriales {
            margin-top: 2px;
            font-size: 7.8pt;
            color: #475569;
            font-family: Consolas, monospace;
        }
        .pie-grid {
            display: flex;
            justify-content: space-between;
            align-items: flex-start;
            gap: 24px;
            margin-top: 16px;
        }
        .pie-izq {
            flex: 1;
            max-width: 54%;
        }
        .pie-der {
            width: 42%;
            min-width: 240px;
        }
        .bloque-titulo {
            font-size: 8pt;
            font-weight: 700;
            text-transform: uppercase;
            letter-spacing: 0.08em;
            color: #475569;
            margin-bottom: 4px;
        }
        .lista-pagos {
            list-style: none;
            padding: 0;
            margin: 0 0 10px;
        }
        .lista-pagos li {
            display: flex;
            justify-content: space-between;
            font-size: 8.8pt;
            padding: 2px 0;
            border-bottom: 1px dotted #cbd5e1;
        }
        .nota-legal {
            margin: 6px 0 0;
            font-size: 8pt;
            color: #475569;
        }
        .firma-linea {
            margin-top: 26px;
            font-size: 8.5pt;
            color: #334155;
        }
        .totales-lista {
            display: flex;
            flex-direction: column;
            gap: 5px;
        }
        .total-row {
            display: flex;
            justify-content: space-between;
            align-items: baseline;
            font-size: 9.5pt;
            color: #334155;
        }
        .total-row.retencion {
            color: #92400e;
        }
        .total-row.total-final {
            margin-top: 4px;
            padding-top: 7px;
            border-top: 1.5px solid #1e293b;
            font-size: 12pt;
            font-weight: 800;
            color: #0f172a;
        }
        .total-row.total-secundario {
            font-size: 9pt;
            color: #475569;
        }
        .carta-footer {
            margin-top: 28px;
            padding-top: 8px;
            border-top: 1px solid #e2e8f0;
            display: flex;
            justify-content: space-between;
            font-size: 7.8pt;
            color: #64748b;
        }
    `;

    return {
        pageSize: 'letter',
        pageMargin: '0.45in 0.5in',
        contenido,
        estilosExtra,
    };
}

function renderizarTermica58({ data, tasaBcv, tasaCop }) {
    const { esNotaEntrega, numero, tipoLabel } = obtenerMetadatosDocumento(data);
    const venta = data?.venta || {};
    const cliente = data?.cliente || {};
    const productos = Array.isArray(data?.productos) ? data.productos : [];
    const pagos = Array.isArray(data?.pagos) ? data.pagos : [];
    const montos = calcularMontos(data, tasaBcv, tasaCop);

    const itemsHtml = productos
        .map((p) => {
            const pUnitBcvUsd = Number(p.precio_unitario) || 0;
            const pUnitBcvBs = redondearBS(pUnitBcvUsd * tasaBcv);
            const pUnitDivUsd = Number(p.precio_divisas) > 0 ? Number(p.precio_divisas) : pUnitBcvUsd;
            const cant = Number(p.cantidad) || 0;
            const subBaseBs = redondearBS((Number(p.subtotal) || 0) * tasaBcv);
            const subDivUsd = pUnitDivUsd * cant;
            const esExento = Boolean(Number(p.exento_iva));
            const seriales = Array.isArray(p.seriales) && p.seriales.length > 0
                ? `<div class="tk-serial">S/N: ${esc(p.seriales.join(', '))}</div>`
                : '';

            if (esNotaEntrega) {
                return `
                    <div class="tk-item">
                        <div class="tk-item-nombre">${esc((p.nombre_producto || '').toUpperCase())}</div>
                        ${seriales}
                        <div class="tk-item-det">
                            <span>${cant} x $${formatearDecimal(pUnitDivUsd, 2, 4)}</span>
                            <strong>$${formatearDecimal(subDivUsd, 2, 4)} USD</strong>
                        </div>
                    </div>
                `;
            }

            return `
                <div class="tk-item">
                    <div class="tk-item-nombre">${esc((p.nombre_producto || '').toUpperCase())} (${esExento ? 'E' : 'G'})</div>
                    ${seriales}
                    <div class="tk-item-det">
                        <span>${cant} x ${formatearDecimal(pUnitBcvBs, 2, 4)} Bs</span>
                        <strong>${formatearDecimal(subBaseBs, 2, 4)} Bs</strong>
                    </div>
                </div>
            `;
        })
        .join('');

    const totalesHtml = esNotaEntrega
        ? `
            <div class="tk-line tk-total">
                <span>TOTAL USD</span>
                <strong>$${formatearDecimal(montos.totalDivisasUsd, 2, 4)}</strong>
            </div>
            <div class="tk-line">
                <span>REF. COP</span>
                <strong>${montos.totalRefCop.toLocaleString('es-CO')}</strong>
            </div>
        `
        : `
            <div class="tk-line"><span>BASE (G):</span><span>${formatearDecimal(montos.baseBs, 2, 4)} Bs</span></div>
            ${montos.subtotalExentoUsd > 0 ? `<div class="tk-line"><span>EXENTO (E):</span><span>${formatearDecimal(montos.exentoBs, 2, 4)} Bs</span></div>` : ''}
            <div class="tk-line"><span>IVA (${montos.ivaPorc}%):</span><span>${formatearDecimal(montos.ivaBs, 2, 4)} Bs</span></div>
            ${montos.retUsd > 0 ? `<div class="tk-line"><span>RET IVA (${montos.retPorc}%):</span><span>-${formatearDecimal(montos.retBs, 2, 4)} Bs</span></div>` : ''}
            <div class="tk-line tk-total">
                <span>TOTAL BS</span>
                <strong>${formatearDecimal(montos.totalLegalBs, 2, 4)} Bs</strong>
            </div>
        `;

    const pagosHtml = pagos.length > 0
        ? `
            <div class="tk-sep"></div>
            <div class="tk-sub">PAGOS RECIBIDOS</div>
            ${pagos
                .map(
                    (pago) => `
                <div class="tk-line">
                    <span>${esc(etiquetaPago(pago.moneda, pago.metodo))}</span>
                    <span>${esc(formatearMoneda(pago.monto, pago.moneda))}</span>
                </div>
            `,
                )
                .join('')}
        `
        : '';

    const contenido = `
        <div class="tk-wrap">
            <div class="tk-center">
                <div class="tk-empresa">${esc(empresa.nombre)}</div>
                <div>RIF: ${esc(empresa.rif)}</div>
                <div>Tel: ${esc(empresa.telefono)}</div>
                ${empresa.direccion ? `<div>${esc(empresa.direccion)}</div>` : ''}
            </div>

            <div class="tk-sep"></div>

            <div class="tk-center">
                <div class="tk-doc">${tipoLabel} ${esc(numero)}</div>
                ${esNotaEntrega ? '<div class="tk-nofiscal">*** DOCUMENTO NO FISCAL ***</div>' : ''}
            </div>

            <div class="tk-meta">
                <div>Fecha: ${esc(formatearFecha(venta.fecha))}</div>
                <div>Pago: ${esc((venta.tipo_pago || '').toUpperCase())} | ${esc((venta.estado || '').toUpperCase())}</div>
                <div>Cliente: ${esc((cliente.nombre || '').toUpperCase())}</div>
                <div>CI/RIF: ${esc(cliente.cedula || '—')}</div>
            </div>

            <div class="tk-sep"></div>
            <div class="tk-sub">DETALLE</div>
            ${itemsHtml}
            <div class="tk-sep"></div>

            ${totalesHtml}
            ${pagosHtml}

            <div class="tk-sep"></div>
            <div class="tk-center tk-foot">
                ${esNotaEntrega ? 'NO VÁLIDO COMO FACTURA FISCAL' : `Tasa BCV: ${Number(tasaBcv || 0).toFixed(4)} Bs/USD`}
                <div>¡Gracias por su compra!</div>
            </div>
        </div>
    `;

    const estilosExtra = `
        * { box-sizing: border-box; }
        body {
            margin: 0;
            padding: 0;
            font-family: 'Courier New', Consolas, monospace;
            font-size: 9px;
            line-height: 1.3;
            color: #000;
            background: #fff;
        }
        .tk-wrap {
            width: 52mm;
            max-width: 52mm;
            margin: 0 auto;
        }
        .tk-center { text-align: center; }
        .tk-empresa { font-size: 11px; font-weight: 700; text-transform: uppercase; }
        .tk-doc { font-size: 10px; font-weight: 700; }
        .tk-nofiscal { font-size: 8px; font-weight: 700; margin-top: 2px; }
        .tk-sep { border-top: 1px dashed #000; margin: 5px 0; }
        .tk-sub { font-weight: 700; font-size: 8.5px; margin-bottom: 3px; }
        .tk-meta { font-size: 8.5px; word-break: break-word; }
        .tk-item { margin-bottom: 4px; }
        .tk-item-nombre { font-weight: 700; word-break: break-word; }
        .tk-serial { font-size: 7.5px; }
        .tk-item-det, .tk-line {
            display: flex;
            justify-content: space-between;
            gap: 4px;
        }
        .tk-total {
            font-size: 10.5px;
            font-weight: 700;
            margin-top: 3px;
            padding-top: 3px;
            border-top: 1px solid #000;
        }
        .tk-foot { font-size: 8px; margin-top: 4px; }
    `;

    return {
        pageSize: '58mm auto',
        pageMargin: '2mm 2.5mm',
        contenido,
        estilosExtra,
    };
}

/**
 * Imprime una factura o nota de entrega en formato Carta (legal, sin bordes) o Térmica 58mm.
 * @param {{ data: any, tasaBcv: number, tasaCop: number, formato?: 'carta' | 'termica58' }} params
 */
export function imprimirDocumentoVenta({ data, tasaBcv, tasaCop, formato = 'carta' }) {
    const { titulo } = obtenerMetadatosDocumento(data);
    const config = formato === 'termica58'
        ? renderizarTermica58({ data, tasaBcv, tasaCop })
        : renderizarCarta({ data, tasaBcv, tasaCop });

    imprimir({
        titulo,
        mostrarEncabezado: false,
        usarEstilosBase: false,
        pageSize: config.pageSize,
        pageMargin: config.pageMargin,
        estilosExtra: config.estilosExtra,
        contenido: config.contenido,
    });
}

