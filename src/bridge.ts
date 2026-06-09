// Tiny typed client for our own HTTP bridge.
// The Tauri webview runs at tauri.localhost (or http://localhost:1420 in dev);
// the bridge listens on 127.0.0.1:9177. CORS is permissive for both origins.

const BASE = 'http://127.0.0.1:9177'

export type PrinterRole = 'pos' | 'kitchen'

export interface HealthPrinter {
  role: PrinterRole
  name: string
  status: 'online' | 'offline'
}

export interface ConnectedStore {
  name: string
  logoUrl?: string
  uuid?: string
  lastSeenAt: number
}

export interface HealthResponse {
  ok: boolean
  version: string
  printers: HealthPrinter[]
  connectedStore?: ConnectedStore
  latestVersion?: string
  updateAvailable?: boolean
}

export interface DiscoveredDevice {
  vendor_id: number
  product_id: number
  manufacturer: string | null
  product: string | null
  serial: string | null
}

export interface ConfigPrinter {
  role: PrinterRole
  name: string
  vendorId: number
  productId: number
}

export async function getHealth(): Promise<HealthResponse> {
  const res = await fetch(`${BASE}/health`)
  if (!res.ok) throw new Error(`health ${res.status}`)
  return res.json()
}

export async function listDevices(): Promise<DiscoveredDevice[]> {
  const res = await fetch(`${BASE}/devices`)
  const body = await res.json()
  if (!res.ok || !body.ok) {
    throw new Error(body.message ?? `devices ${res.status}`)
  }
  return body.devices ?? []
}

export async function getConfig(): Promise<ConfigPrinter[]> {
  const res = await fetch(`${BASE}/config`)
  if (!res.ok) throw new Error(`config ${res.status}`)
  const body = await res.json()
  return body.printers ?? []
}

export async function saveConfig(printers: ConfigPrinter[]): Promise<void> {
  const res = await fetch(`${BASE}/config`, {
    method: 'PUT',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ printers }),
  })
  const body = await res.json()
  if (!res.ok || !body.ok) {
    throw new Error(body.message ?? `save config ${res.status}`)
  }
}

export interface RecentJob {
  jobId: string
  role: PrinterRole
  receivedAt: number
  bytes: number
  mocked: boolean
  printer: string | null
  preview: string
  previewHtml?: string | null
  error: string | null
}

export async function getJobs(): Promise<RecentJob[]> {
  const res = await fetch(`${BASE}/jobs`)
  if (!res.ok) throw new Error(`jobs ${res.status}`)
  const body = await res.json()
  return body.jobs ?? []
}

export async function removeJob(jobId: string): Promise<void> {
  const res = await fetch(`${BASE}/jobs/${encodeURIComponent(jobId)}`, { method: 'DELETE' })
  if (!res.ok) throw new Error(`remove job ${res.status}`)
}

export async function clearJobs(): Promise<void> {
  const res = await fetch(`${BASE}/jobs`, { method: 'DELETE' })
  if (!res.ok) throw new Error(`clear jobs ${res.status}`)
}

function bytesToBase64(bytes: Uint8Array): string {
  const CHUNK = 0x8000
  let s = ''
  for (let i = 0; i < bytes.length; i += CHUNK) {
    s += String.fromCharCode.apply(
      null,
      bytes.subarray(i, i + CHUNK) as unknown as number[],
    )
  }
  return btoa(s)
}

/** Mirror of the dashboard's useOrderReceipt.buildEscPos output — a real
 *  sample receipt with header, items, totals, and cut. Useful for verifying
 *  the bridge's roundtrip without involving the dashboard or hardware. */
export function buildSampleReceipt(): Uint8Array {
  const bytes: number[] = []
  const text = (s: string) => {
    for (const c of s) {
      const code = c.codePointAt(0) ?? 0
      if (code < 0x80) {
        bytes.push(code)
      } else {
        // UTF-8 encode (matches what the dashboard would send for Arabic)
        const buf = new TextEncoder().encode(c)
        for (const b of buf) bytes.push(b)
      }
    }
  }
  const lf = () => bytes.push(0x0A)
  const esc = (...b: number[]) => bytes.push(0x1B, ...b)
  const gs = (...b: number[]) => bytes.push(0x1D, ...b)

  esc(0x40) // Initialize
  esc(0x61, 0x01) // Center align
  esc(0x21, 0x30) // Double width + height
  text('SAFRA TEST')
  lf()
  esc(0x21, 0x00) // Normal size
  text('Cafe Demo · Branch 1')
  lf()
  text(new Date().toLocaleString())
  lf()
  lf()
  esc(0x61, 0x00) // Left align
  text('--------------------------------')
  lf()
  text('Item                  Qty   Total')
  lf()
  text('--------------------------------')
  lf()
  text('Espresso              x2   12.00')
  lf()
  text('Croissant             x1    6.50')
  lf()
  text('Iced Latte (large)    x1    9.00')
  lf()
  text('--------------------------------')
  lf()
  esc(0x61, 0x02) // Right align
  text('Subtotal:   27.50')
  lf()
  text('Tax (15%):   4.13')
  lf()
  esc(0x21, 0x10) // Double height
  text('TOTAL:   31.63 SAR')
  lf()
  esc(0x21, 0x00)
  lf()
  esc(0x61, 0x01) // Center
  text('Thank you!')
  lf()
  text('sufra.app')
  lf()
  lf()
  lf()
  gs(0x56, 0x41, 0x10) // Cut + feed
  return new Uint8Array(bytes)
}

export async function sendTestReceipt(
  role: PrinterRole = 'pos',
  locale: 'ar' | 'en' = 'ar',
): Promise<{
  ok: boolean
  mocked?: boolean
  message?: string
  jobId: string
}> {
  const { buildSampleReceiptHtml } = await import('./receiptHtml')
  const bytes = buildSampleReceipt()
  const previewHtml = buildSampleReceiptHtml(locale)
  const jobId =
    typeof crypto !== 'undefined' && 'randomUUID' in crypto
      ? `test-${crypto.randomUUID().slice(0, 8)}`
      : `test-${Date.now().toString(36)}`
  const res = await fetch(`${BASE}/print`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({
      role,
      format: 'escpos',
      data: bytesToBase64(bytes),
      jobId,
      previewHtml,
    }),
  })
  const body = await res.json().catch(() => ({}))
  return { jobId, ok: body.ok ?? res.ok, mocked: body.mocked, message: body.message }
}

export function deviceLabel(d: DiscoveredDevice): string {
  const parts: string[] = []
  if (d.manufacturer) parts.push(d.manufacturer)
  if (d.product) parts.push(d.product)
  const name = parts.join(' ').trim() || 'USB printer'
  const vid = d.vendor_id.toString(16).padStart(4, '0')
  const pid = d.product_id.toString(16).padStart(4, '0')
  return `${name} (${vid}:${pid})`
}
