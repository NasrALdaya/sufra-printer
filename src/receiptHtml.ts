// Receipt HTML — mirrors sufra-dashboard/app/composables/useOrderReceipt.ts
// (RECEIPT_STYLES + buildReceiptBody / buildReceiptDocument). Kept in lockstep
// so the bridge preview is pixel-identical to what the dashboard's invoice
// renders.
//
// Localized: pass locale='ar' for RTL + Arabic sample content. Logical CSS
// properties (border-inline-end, text-align: start/end) flip automatically
// when the doc's dir attribute is rtl.

import type { Locale } from './i18n'

const RECEIPT_STYLES = `
  *, *::before, *::after { box-sizing: border-box; margin: 0; padding: 0; }
  body {
    font-family: -apple-system, BlinkMacSystemFont, 'Segoe UI', Roboto, sans-serif;
    font-size: 11px; line-height: 1.4; color: #000; background: #fff;
    padding: 4mm;
  }

  /* ── Wrapper: no outer frame — sections separated by whitespace ── */
  .invoice { width: 72mm; margin: 0 auto; }

  /* ── Header (logo + store name + phone, centered) ── */
  .inv-header { padding: 8px 6px 12px; text-align: center; }
  .inv-branding { display: flex; flex-direction: column; align-items: center; gap: 3px; }
  .inv-logo { width: 16mm; max-width: 100%; height: auto; object-fit: contain; border-radius: 4px; border: 1px solid #000; filter: grayscale(100%); display: block; margin: 0 auto; }
  .inv-store-name { font-size: 13px; font-weight: 700; line-height: 1.2; margin-top: 3px; }
  .inv-store-phone { font-size: 10.5px; color: #000; font-variant-numeric: tabular-nums; }

  /* ── Custom header / footer text blocks ── */
  .inv-custom-text { padding: 4px 6px 8px; font-size: 10.5px; color: #000; text-align: center; white-space: pre-wrap; }

  /* ── Meta: flat label-value list, one per line. No borders, no grid —
     typography hierarchy carries the layout. Full-width rows (customer,
     address, notes) stack the value below the label so long strings
     don't shove the label off-screen. */
  .inv-meta { padding: 4px 6px 12px; display: flex; flex-direction: column; gap: 4px; }
  .inv-meta .meta-row { display: flex; justify-content: space-between; align-items: baseline; gap: 12px; }
  .inv-meta .meta-row .lbl { font-size: 9px; font-weight: 700; color: #000; text-transform: uppercase; letter-spacing: 0.04em; line-height: 1.3; white-space: nowrap; flex-shrink: 0; }
  .inv-meta .meta-row .val { font-size: 11px; font-weight: 600; color: #000; text-align: end; word-break: break-word; line-height: 1.3; }
  .inv-meta .meta-row.full { flex-direction: column; gap: 2px; align-items: stretch; }
  .inv-meta .meta-row.full .val { font-weight: 500; text-align: start; }
  .inv-meta .meta-row .val-sub { font-size: 10px; color: #000; font-variant-numeric: tabular-nums; word-break: break-word; }
  .inv-note { display: inline-block; padding: 2px 6px; border-radius: 3px; border: 1px solid #000; color: #000; font-size: 10px; font-style: italic; margin-top: 2px; max-width: 100%; word-break: break-word; }

  /* ── Items: only framed block on the receipt — full border around the
     table closes the column dividers cleanly at top + bottom. ── */
  .inv-items { width: 100%; border-collapse: collapse; table-layout: fixed; border-inline: 1px solid #000; }
  .inv-items thead th {
    background: transparent; color: #000;
    border-top: 1px solid #000; border-bottom: 1px solid #000;
    font-size: 9px; font-weight: 700; text-transform: uppercase; letter-spacing: 0.03em;
    padding: 4px 3px; text-align: start; white-space: nowrap;
  }
  .inv-items thead th.center { text-align: center; }
  .inv-items thead th.right { text-align: end; }
  .inv-items thead th + th { border-inline-start: 1px solid #000; }
  .inv-items tbody td { padding: 4px 3px; vertical-align: top; border-bottom: 1px solid #000; word-break: break-word; color: #000; }
  .inv-items tbody td + td { border-inline-start: 1px solid #000; }
  .inv-items tbody tr { break-inside: avoid; page-break-inside: avoid; }
  .inv-items .col-num { text-align: center; color: #000; font-size: 9px; font-variant-numeric: tabular-nums; }
  .inv-items .col-qty { text-align: center; font-size: 10px; font-weight: 700; font-variant-numeric: tabular-nums; }
  .inv-items .col-price { text-align: end; color: #000; font-size: 10px; font-variant-numeric: tabular-nums; }
  .inv-items .col-total { text-align: end; font-size: 10px; font-weight: 700; font-variant-numeric: tabular-nums; }
  .inv-items .item-name { font-size: 11.5px; font-weight: 600; line-height: 1.25; }
  .inv-items .item-sub { font-size: 10px; color: #000; margin-top: 2px; word-break: break-word; }
  .inv-items .item-note { display: inline-block; margin-top: 3px; padding: 1px 4px; border-radius: 3px; border: 1px solid #000; color: #000; font-size: 8.5px; font-style: italic; line-height: 1.2; }

  /* ── Totals + Payments: breakdown rows then a single rule and a
     heavier TOTAL. No outer rule — the items table above already
     terminates with its own bottom border. */
  .inv-bottom { padding: 10px 6px 6px; }
  .inv-totals { width: 100%; border-collapse: collapse; }
  .inv-totals td { padding: 2px 0; font-size: 11px; font-variant-numeric: tabular-nums; color: #000; }
  .inv-totals td:last-child { text-align: end; font-weight: 600; }
  .inv-totals tr { break-inside: avoid; page-break-inside: avoid; }
  .inv-totals tr.muted td { color: #000; font-weight: 500; }
  .inv-totals tr.discount td { color: #000; font-weight: 500; }
  .inv-totals tr.total-row td {
    color: #000;
    font-weight: 800; font-size: 14px;
    padding: 6px 0 4px;
    border-top: 1px solid #000;
  }
  .inv-totals tr.spacer td { padding: 2px 0; }
  .inv-totals tr.pmt-head td { text-align: start; font-size: 9px; font-weight: 700; color: #000; text-transform: uppercase; letter-spacing: 0.04em; padding-top: 10px; }
  .inv-totals tr.change-row td { color: #000; font-weight: 700; }

  /* ── Footer: thanks (start side) + order code (end side), no border. ── */
  .inv-footer { padding: 10px 6px 4px; display: flex; justify-content: space-between; align-items: center; gap: 6px; break-inside: avoid; page-break-inside: avoid; }
  .inv-footer .thanks { font-size: 10.5px; font-weight: 500; color: #000; }
  .inv-footer .order-code { font-size: 10.5px; font-weight: 700; color: #000; letter-spacing: 0.02em; font-variant-numeric: tabular-nums; white-space: nowrap; }
  .inv-store-notes { padding: 8px 6px 4px; break-inside: avoid; page-break-inside: avoid; }
  .inv-store-notes-label { font-size: 9px; font-weight: 700; color: #000; text-transform: uppercase; letter-spacing: 0.04em; margin-bottom: 2px; }
  .inv-store-notes-body { font-size: 10.5px; color: #000; white-space: pre-wrap; }
  .inv-brand-mark { text-align: center; font-size: 9px; color: #000; padding: 10px 0 0; }

  /* RTL: keep Latin-script bits (jobIds, currency numerals) flowing LTR
     inside the RTL frame so digits/symbols stay readable. */
  [dir="rtl"] .inv-store-phone,
  [dir="rtl"] .inv-items .col-num,
  [dir="rtl"] .inv-items .col-qty,
  [dir="rtl"] .inv-items .col-price,
  [dir="rtl"] .inv-items .col-total,
  [dir="rtl"] .inv-totals td:last-child,
  [dir="rtl"] .inv-footer .order-code {
    direction: ltr;
    unicode-bidi: embed;
  }
`

function escapeHtml(s: string | number | null | undefined): string {
  if (s == null) return ''
  return String(s)
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&#39;')
}

function makeFmt(locale: Locale) {
  // ar-SA-u-nu-latn → "ر.س." currency symbol with Western digits, which is
  // the convention on real Saudi POS receipts. en-US → "SAR 12.34".
  const tag = locale === 'ar' ? 'ar-SA-u-nu-latn' : 'en-US'
  return (v: number) =>
    new Intl.NumberFormat(tag, {
      style: 'currency',
      currency: 'SAR',
      minimumFractionDigits: 2,
    }).format(v)
}

export interface SampleItem {
  index: number
  name: string
  qty: number
  price: number
  total: number
  variant?: string
  addOns?: string[]
  note?: string
}

export interface SampleOrder {
  storeName: string
  storePhone: string
  orderCode: string
  invoiceNumber: string
  orderType: string
  date: Date
  cashier: string
  table?: string
  customer?: { name?: string; phone?: string }
  items: SampleItem[]
  subtotal: number
  discount: number
  tax: number
  total: number
  paymentMethod: string
  thanks: string
  brand: string
  labels: {
    order: string
    invoice: string
    type: string
    date: string
    cashier: string
    table: string
    customer: string
    addOns: string
    columnNum: string
    columnItem: string
    columnQty: string
    columnPrice: string
    columnTotal: string
    subtotal: string
    discount: string
    tax: string
    total: string
    payment: string
  }
}

export function buildSampleOrder(locale: Locale): SampleOrder {
  return locale === 'ar' ? sampleAr() : sampleEn()
}

function sampleEn(): SampleOrder {
  return {
    storeName: 'Sufra Demo Cafe',
    storePhone: '+966 11 555 0000',
    orderCode: 'A-1042',
    invoiceNumber: 'INV-000123',
    orderType: 'Dine-in',
    date: new Date(),
    cashier: 'Nasser',
    table: '7',
    customer: { name: 'Walk-in' },
    items: [
      { index: 1, name: 'Espresso', qty: 2, price: 6.0, total: 12.0 },
      {
        index: 2,
        name: 'Iced Latte',
        qty: 1,
        price: 9.0,
        total: 9.0,
        variant: 'Large',
        addOns: ['Vanilla syrup', 'Oat milk'],
      },
      { index: 3, name: 'Croissant', qty: 1, price: 6.5, total: 6.5 },
      {
        index: 4,
        name: 'Avocado Toast',
        qty: 1,
        price: 18.0,
        total: 18.0,
        note: 'No salt please',
      },
    ],
    subtotal: 45.5,
    discount: 2.0,
    tax: 6.53,
    total: 50.03,
    paymentMethod: 'Card',
    thanks: 'Thank you',
    brand: 'safra.app',
    labels: {
      order: 'Order #',
      invoice: 'Invoice #',
      type: 'Type',
      date: 'Date',
      cashier: 'Cashier',
      table: 'Table',
      customer: 'Customer',
      addOns: 'Add-ons',
      columnNum: '#',
      columnItem: 'Item',
      columnQty: 'Qty',
      columnPrice: 'Price',
      columnTotal: 'Total',
      subtotal: 'Subtotal',
      discount: 'Discount',
      tax: 'Tax (15%)',
      total: 'Total',
      payment: 'Payment',
    },
  }
}

function sampleAr(): SampleOrder {
  return {
    storeName: 'سُفرة - مقهى تجريبي',
    storePhone: '+966 11 555 0000',
    orderCode: 'A-1042',
    invoiceNumber: 'INV-000123',
    orderType: 'تناول في المطعم',
    date: new Date(),
    cashier: 'ناصر',
    table: '7',
    customer: { name: 'زائر' },
    items: [
      { index: 1, name: 'إسبريسو', qty: 2, price: 6.0, total: 12.0 },
      {
        index: 2,
        name: 'لاتيه مثلج',
        qty: 1,
        price: 9.0,
        total: 9.0,
        variant: 'كبير',
        addOns: ['شراب الفانيليا', 'حليب الشوفان'],
      },
      { index: 3, name: 'كرواسون', qty: 1, price: 6.5, total: 6.5 },
      {
        index: 4,
        name: 'توست أفوكادو',
        qty: 1,
        price: 18.0,
        total: 18.0,
        note: 'بدون ملح من فضلكم',
      },
    ],
    subtotal: 45.5,
    discount: 2.0,
    tax: 6.53,
    total: 50.03,
    paymentMethod: 'بطاقة',
    thanks: 'شكراً لزيارتكم',
    brand: 'safra.app',
    labels: {
      order: 'رقم الطلب',
      invoice: 'رقم الفاتورة',
      type: 'النوع',
      date: 'التاريخ',
      cashier: 'الكاشير',
      table: 'الطاولة',
      customer: 'العميل',
      addOns: 'إضافات',
      columnNum: '#',
      columnItem: 'الصنف',
      columnQty: 'الكمية',
      columnPrice: 'السعر',
      columnTotal: 'الإجمالي',
      subtotal: 'المجموع الفرعي',
      discount: 'الخصم',
      tax: 'ضريبة (15%)',
      total: 'الإجمالي',
      payment: 'الدفع',
    },
  }
}

export function buildReceiptBody(o: SampleOrder, locale: Locale): string {
  const fmt = makeFmt(locale)
  const dateLocale = locale === 'ar' ? 'ar-SA-u-nu-latn' : 'en-US'

  const metaRows: string[] = []
  metaRows.push(
    `<div class="meta-row"><span class="lbl">${escapeHtml(o.labels.order)}</span><span class="val">${escapeHtml(o.orderCode)}</span></div>`,
  )
  metaRows.push(
    `<div class="meta-row"><span class="lbl">${escapeHtml(o.labels.invoice)}</span><span class="val">${escapeHtml(o.invoiceNumber)}</span></div>`,
  )
  metaRows.push(
    `<div class="meta-row"><span class="lbl">${escapeHtml(o.labels.type)}</span><span class="val">${escapeHtml(o.orderType)}</span></div>`,
  )
  metaRows.push(
    `<div class="meta-row"><span class="lbl">${escapeHtml(o.labels.date)}</span><span class="val">${escapeHtml(
      o.date.toLocaleDateString(dateLocale, { year: 'numeric', month: '2-digit', day: '2-digit' }),
    )} <span class="val-sub">${escapeHtml(
      o.date.toLocaleTimeString(dateLocale, { hour: '2-digit', minute: '2-digit', hour12: false }),
    )}</span></span></div>`,
  )
  metaRows.push(
    `<div class="meta-row"><span class="lbl">${escapeHtml(o.labels.cashier)}</span><span class="val">${escapeHtml(o.cashier)}</span></div>`,
  )
  if (o.table) {
    metaRows.push(
      `<div class="meta-row"><span class="lbl">${escapeHtml(o.labels.table)}</span><span class="val">${escapeHtml(o.table)}</span></div>`,
    )
  }
  if (o.customer?.name) {
    metaRows.push(
      `<div class="meta-row full"><span class="lbl">${escapeHtml(o.labels.customer)}</span><div class="val">${escapeHtml(o.customer.name)}${
        o.customer.phone
          ? `<div class="val-sub" dir="ltr">${escapeHtml(o.customer.phone)}</div>`
          : ''
      }</div></div>`,
    )
  }

  const rows = o.items
    .map((it) => {
      const subs: string[] = []
      if (it.variant) subs.push(`<div class="item-sub">${escapeHtml(it.variant)}</div>`)
      if (it.addOns?.length)
        subs.push(
          `<div class="item-sub">${escapeHtml(o.labels.addOns)}: ${escapeHtml(it.addOns.join(', '))}</div>`,
        )
      if (it.note) subs.push(`<div class="item-note">${escapeHtml(it.note)}</div>`)
      return `<tr>
        <td class="col-num">${it.index}</td>
        <td><div class="item-name">${escapeHtml(it.name)}</div>${subs.join('')}</td>
        <td class="col-qty">${it.qty}</td>
        <td class="col-price">${fmt(it.price)}</td>
        <td class="col-total">${fmt(it.total)}</td>
      </tr>`
    })
    .join('')

  return `
    <div class="invoice">
      <div class="inv-header">
        <div class="inv-branding">
          <div class="inv-store-name">${escapeHtml(o.storeName)}</div>
          <div class="inv-store-phone">${escapeHtml(o.storePhone)}</div>
        </div>
      </div>
      <div class="inv-meta">${metaRows.join('')}</div>
      <table class="inv-items">
        <colgroup>
          <col style="width: 7mm" />
          <col />
          <col style="width: 10mm" />
          <col style="width: 14mm" />
          <col style="width: 16mm" />
        </colgroup>
        <thead>
          <tr>
            <th class="center">${escapeHtml(o.labels.columnNum)}</th>
            <th>${escapeHtml(o.labels.columnItem)}</th>
            <th class="center">${escapeHtml(o.labels.columnQty)}</th>
            <th class="right">${escapeHtml(o.labels.columnPrice)}</th>
            <th class="right">${escapeHtml(o.labels.columnTotal)}</th>
          </tr>
        </thead>
        <tbody>${rows}</tbody>
      </table>
      <div class="inv-bottom">
        <table class="inv-totals">
          <tbody>
            ${
              o.discount > 0
                ? `<tr class="muted"><td>${escapeHtml(o.labels.subtotal)}</td><td>${fmt(o.subtotal)}</td></tr>
                   <tr class="discount"><td>${escapeHtml(o.labels.discount)}</td><td>-${fmt(o.discount)}</td></tr>`
                : ''
            }
            <tr class="muted"><td>${escapeHtml(o.labels.tax)}</td><td>${fmt(o.tax)}</td></tr>
            <tr class="total-row"><td>${escapeHtml(o.labels.total)}</td><td>${fmt(o.total)}</td></tr>
            <tr class="pmt-head"><td colspan="2">${escapeHtml(o.labels.payment)}</td></tr>
            <tr><td>${escapeHtml(o.paymentMethod)}</td><td>${fmt(o.total)}</td></tr>
          </tbody>
        </table>
      </div>
      <div class="inv-footer">
        <span class="thanks">${escapeHtml(o.thanks)}</span>
        <span class="order-code">${escapeHtml(o.orderCode)}</span>
      </div>
      <div class="inv-brand-mark">${escapeHtml(o.brand)}</div>
    </div>
  `
}

export function buildReceiptDocument(body: string, locale: Locale): string {
  const dir = locale === 'ar' ? 'rtl' : 'ltr'
  return `<!doctype html><html lang="${locale}" dir="${dir}"><head><meta charset="utf-8"><style>${RECEIPT_STYLES}</style></head><body>${body}</body></html>`
}

export function buildSampleReceiptHtml(locale: Locale): string {
  const order = buildSampleOrder(locale)
  const body = buildReceiptBody(order, locale)
  return buildReceiptDocument(body, locale)
}
