<script setup lang="ts">
import { computed, onMounted, onUnmounted, ref } from 'vue'
import {
  type ConfigPrinter,
  type DiscoveredDevice,
  type HealthResponse,
  type PrinterRole,
  type RecentJob,
  deviceLabel,
  getConfig,
  getHealth,
  getJobs,
  listDevices,
  saveConfig,
  sendTestReceipt,
} from './bridge'
import { useI18n } from './i18n'
import sufraLogoUrl from './assets/sufra-logo.png'

const { t, locale, isRTL } = useI18n()

const health = ref<HealthResponse | null>(null)
const devices = ref<DiscoveredDevice[]>([])
const jobs = ref<RecentJob[]>([])
const mapping = ref<Record<PrinterRole, string>>({ pos: '', kitchen: '' })
const initialMapping = ref<Record<PrinterRole, string>>({ pos: '', kitchen: '' })
const loading = ref(true)
const saving = ref(false)
const message = ref<{ kind: 'ok' | 'err'; text: string } | null>(null)
const enumError = ref<string | null>(null)
const expandedJob = ref<string | null>(null)

const roles: PrinterRole[] = ['pos', 'kitchen']
const roleLabel = (r: PrinterRole) => t(`roles.${r}` as 'roles.pos')

const dirty = computed(() =>
  roles.some((r) => mapping.value[r] !== initialMapping.value[r]),
)

function encodeDevice(d: DiscoveredDevice): string {
  return `${d.vendor_id}:${d.product_id}`
}

function decodeDevice(value: string): { vendorId: number; productId: number } | null {
  if (!value) return null
  const [v, p] = value.split(':')
  if (!v || !p) return null
  return { vendorId: Number(v), productId: Number(p) }
}

function formatDateTime(ms: number): string {
  if (!ms) return '—'
  const d = new Date(ms)
  const tag = locale.value === 'ar' ? 'ar-SA-u-nu-latn' : 'en-US'
  const date = d.toLocaleDateString(tag, { day: '2-digit', month: '2-digit', year: 'numeric' })
  const time = d.toLocaleTimeString(tag, { hour: '2-digit', minute: '2-digit', second: '2-digit', hour12: false })
  return `${date} · ${time}`
}

const connectedStore = computed(() => health.value?.connectedStore ?? null)

async function refresh(opts: { silent?: boolean } = {}) {
  if (!opts.silent) loading.value = true
  if (!opts.silent) enumError.value = null
  try {
    const results = await Promise.allSettled([
      getHealth(),
      safeListDevices(opts.silent ?? false),
      getConfig(),
      getJobs(),
    ])

    const [hr, _dr, cr, jr] = results
    if (hr.status === 'fulfilled') health.value = hr.value
    if (cr.status === 'fulfilled') {
      const next: Record<PrinterRole, string> = { pos: '', kitchen: '' }
      for (const c of cr.value) next[c.role] = `${c.vendorId}:${c.productId}`
      if (!dirty.value) {
        mapping.value = { ...next }
        initialMapping.value = { ...next }
      }
    }
    if (jr.status === 'fulfilled') jobs.value = jr.value

    if (!opts.silent) {
      const firstErr = results.find((r) => r.status === 'rejected') as
        | PromiseRejectedResult
        | undefined
      if (firstErr) {
        message.value = { kind: 'err', text: (firstErr.reason as Error).message }
      }
    }
  } finally {
    if (!opts.silent) loading.value = false
  }
}

async function safeListDevices(silent: boolean): Promise<DiscoveredDevice[]> {
  try {
    const ds = await listDevices()
    devices.value = ds
    if (!silent) enumError.value = null
    return ds
  } catch (e) {
    if (!silent) enumError.value = (e as Error).message
    return devices.value
  }
}

async function onSave() {
  saving.value = true
  message.value = null
  try {
    const printers: ConfigPrinter[] = []
    for (const role of roles) {
      const decoded = decodeDevice(mapping.value[role])
      if (!decoded) continue
      const dev = devices.value.find(
        (d) => d.vendor_id === decoded.vendorId && d.product_id === decoded.productId,
      )
      if (!dev) continue
      printers.push({
        role,
        name: deviceLabel(dev),
        vendorId: dev.vendor_id,
        productId: dev.product_id,
      })
    }
    await saveConfig(printers)
    message.value = { kind: 'ok', text: t('roles.saved') }
    await refresh()
  } catch (e) {
    message.value = { kind: 'err', text: (e as Error).message }
  } finally {
    saving.value = false
  }
}

function toggleJob(id: string) {
  expandedJob.value = expandedJob.value === id ? null : id
}

const testing = ref(false)
async function onSendTest(role: PrinterRole) {
  testing.value = true
  message.value = null
  try {
    const r = await sendTestReceipt(role, locale.value)
    if (!r.ok) {
      message.value = { kind: 'err', text: r.message ?? t('recent.failed') }
    } else {
      message.value = {
        kind: 'ok',
        text: r.mocked
          ? t('recent.mocked_msg')
          : t('recent.sent_msg', { role: roleLabel(role) }),
      }
      expandedJob.value = r.jobId
    }
    await refresh({ silent: true })
  } catch (e) {
    message.value = { kind: 'err', text: (e as Error).message }
  } finally {
    testing.value = false
  }
}

let pollHandle: number | undefined
onMounted(() => {
  refresh()
  pollHandle = window.setInterval(() => {
    if (!saving.value) refresh({ silent: true })
  }, 5_000)
})
onUnmounted(() => {
  if (pollHandle !== undefined) window.clearInterval(pollHandle)
})
</script>

<template>
  <main class="app" :dir="isRTL ? 'rtl' : 'ltr'">
    <header>
      <div class="header-row">
        <div class="brand">
          <img :src="sufraLogoUrl" alt="Sufra" class="brand-logo" />
          <h1>{{ t('app.title') }}</h1>
        </div>
        <select v-model="locale" class="lang-select" :title="t('language.label')">
          <option value="ar">{{ t('language.ar') }}</option>
          <option value="en">{{ t('language.en') }}</option>
        </select>
      </div>
      <div class="status">
        <span class="dot" :class="health?.ok ? 'ok' : 'err'" />
        <span v-if="health?.ok">
          {{ t('app.bridge_running') }} · v{{ health.version }} · 127.0.0.1:9177
        </span>
        <span v-else>{{ t('app.bridge_not_responding') }}</span>
      </div>

      <!-- Connected-store strip: shows which Sufra dashboard tab last
           announced itself via POST /hello, with the store's logo when
           the dashboard sent one. Hidden when no store has been
           announced (e.g. before any tab has loaded). -->
      <div v-if="connectedStore" class="connected-store">
        <img
          v-if="connectedStore.logoUrl"
          :src="connectedStore.logoUrl"
          alt=""
          class="store-logo"
          referrerpolicy="no-referrer"
        />
        <div class="store-text">
          <div class="store-label">{{ t('app.connected_store_label') }}</div>
          <div class="store-name">{{ connectedStore.name }}</div>
        </div>
      </div>
    </header>

    <section class="card">
      <h2>{{ t('roles.section_title') }}</h2>
      <p class="muted">{{ t('roles.description') }}</p>

      <div v-if="loading" class="muted">{{ t('roles.loading') }}</div>

      <div v-else-if="enumError" class="alert err">
        <strong>{{ t('roles.enum_error_strong') }}</strong>
        {{ enumError }}
        <div class="muted">
          {{ t('roles.winusb_hint_lead') }}
          <a href="https://zadig.akeo.ie/" target="_blank" rel="noreferrer">
            {{ t('roles.winusb_hint_zadig') }}
          </a>
        </div>
      </div>

      <div v-else-if="!devices.length" class="alert warn">
        <strong>{{ t('roles.no_devices_strong') }}</strong>
        {{ t('roles.no_devices_hint') }}
      </div>

      <div v-else class="form">
        <label v-for="role in roles" :key="role" class="row">
          <span class="label">{{ roleLabel(role) }}</span>
          <select v-model="mapping[role]">
            <option value="">{{ t('roles.not_assigned') }}</option>
            <option
              v-for="d in devices"
              :key="encodeDevice(d)"
              :value="encodeDevice(d)"
            >
              {{ deviceLabel(d) }}
            </option>
          </select>
        </label>
      </div>

      <div class="actions">
        <button class="primary" :disabled="saving || loading || !dirty" @click="onSave">
          {{ saving ? t('roles.saving') : t('roles.save') }}
        </button>
        <button :disabled="loading || saving" @click="() => refresh()">
          {{ t('roles.refresh') }}
        </button>
      </div>

      <div v-if="message" class="alert" :class="message.kind">{{ message.text }}</div>
    </section>

    <section class="card">
      <div class="card-head">
        <h2>
          {{ t('recent.title') }}
          <span class="muted" style="font-weight: 400; text-transform: none; letter-spacing: 0">
            {{ t('recent.last_count', { n: jobs.length }) }}
          </span>
        </h2>
        <div class="test-actions">
          <button
            class="ghost"
            :disabled="testing"
            :title="t('recent.test_help')"
            @click="onSendTest('pos')"
          >
            {{ testing ? t('recent.sending') : t('recent.send_test') }}
          </button>
        </div>
      </div>
      <p v-if="!jobs.length" class="muted">
        {{ t('recent.empty_lead') }}
        <strong>{{ t('recent.empty_action') }}</strong>
        {{ t('recent.empty_tail') }}
      </p>
      <ul v-else class="jobs-list">
        <li v-for="j in jobs" :key="j.jobId" class="job">
          <button class="job-summary" @click="toggleJob(j.jobId)">
            <span class="dot" :class="j.error ? 'err' : j.mocked ? 'warn' : 'ok'" />
            <span class="role">{{ roleLabel(j.role) }}</span>
            <span v-if="j.mocked" class="badge mocked">{{ t('recent.badge_mocked') }}</span>
            <span v-else-if="j.error" class="badge offline">{{ t('recent.badge_failed') }}</span>
            <span v-else class="badge online">{{ t('recent.badge_printed') }}</span>
            <span class="muted job-meta">{{ formatDateTime(j.receivedAt) }} · {{ j.bytes }}B</span>
            <span class="chev">{{ expandedJob === j.jobId ? '▾' : '▸' }}</span>
          </button>
          <div v-if="expandedJob === j.jobId" class="job-detail">
            <div v-if="j.printer" class="meta-line">
              <span class="meta-key">{{ t('recent.printer_label') }}</span>
              <span>{{ j.printer }}</span>
            </div>
            <div class="meta-line">
              <span class="meta-key">{{ t('recent.job_id_label') }}</span>
              <code>{{ j.jobId }}</code>
            </div>
            <div v-if="j.error" class="alert err meta-line">{{ j.error }}</div>
            <div class="preview-wrap">
              <template v-if="j.previewHtml">
                <div class="preview-title">{{ t('recent.preview_title') }}</div>
                <iframe
                  class="receipt-iframe"
                  :srcdoc="j.previewHtml"
                  sandbox=""
                  :title="t('recent.preview_title')"
                />
              </template>
              <template v-else>
                <div class="preview-title">{{ t('recent.preview_text_title') }}</div>
                <pre class="receipt">{{ j.preview || t('recent.no_text') }}</pre>
              </template>
            </div>
          </div>
        </li>
      </ul>
    </section>

    <section v-if="health?.printers?.length" class="card">
      <h2>{{ t('status.title') }}</h2>
      <ul class="status-list">
        <li v-for="p in health.printers" :key="p.role">
          <span class="dot" :class="p.status === 'online' ? 'ok' : 'err'" />
          <span class="role">{{ roleLabel(p.role as PrinterRole) }}</span>
          <span class="muted">·</span>
          <span>{{ p.name }}</span>
          <span class="badge" :class="p.status">
            {{ p.status === 'online' ? t('status.online') : t('status.offline') }}
          </span>
        </li>
      </ul>
    </section>

    <footer>
      <span class="muted">{{ t('app.works_offline') }}</span>
    </footer>
  </main>
</template>

<style scoped>
.app {
  font-family: -apple-system, 'Segoe UI', 'Tahoma', 'Geeza Pro', system-ui, sans-serif;
  max-width: 520px;
  margin: 0 auto;
  padding: 20px;
  color: #1f2937;
}
h1 { font-size: 22px; margin: 0; }
h2 { font-size: 14px; text-transform: uppercase; letter-spacing: 0.06em; color: #6b7280; margin: 0 0 12px 0; }
header { margin-bottom: 20px; }
.header-row { display: flex; align-items: center; justify-content: space-between; gap: 12px; margin-bottom: 4px; }
.brand { display: flex; align-items: center; gap: 10px; min-width: 0; }
.brand-logo { width: 32px; height: 32px; object-fit: contain; border-radius: 6px; flex-shrink: 0; }
.connected-store {
  display: flex; align-items: center; gap: 10px;
  margin-top: 12px;
  padding: 8px 10px;
  border: 1px solid #e5e7eb;
  border-radius: 10px;
  background: #f9fafb;
}
.store-logo { width: 28px; height: 28px; object-fit: contain; border-radius: 4px; flex-shrink: 0; border: 1px solid #e5e7eb; background: #ffffff; }
.store-text { min-width: 0; }
.store-label { font-size: 10px; font-weight: 700; text-transform: uppercase; letter-spacing: 0.04em; color: #6b7280; }
.store-name { font-size: 14px; font-weight: 600; color: #111827; line-height: 1.2; }
.lang-select {
  padding: 6px 10px;
  border-radius: 8px;
  border: 1px solid #d1d5db;
  background: #ffffff;
  font: inherit;
  font-size: 13px;
  cursor: pointer;
}
.status { display: flex; align-items: center; gap: 8px; font-size: 13px; color: #4b5563; }
.dot { width: 8px; height: 8px; border-radius: 50%; display: inline-block; flex-shrink: 0; }
.dot.ok { background: #10b981; }
.dot.err { background: #ef4444; }
.dot.warn { background: #f59e0b; }
.card {
  background: #ffffff;
  border: 1px solid #e5e7eb;
  border-radius: 10px;
  padding: 16px;
  margin-bottom: 16px;
}
.muted { color: #6b7280; font-size: 13px; }
.form { display: flex; flex-direction: column; gap: 10px; margin: 12px 0; }
.row { display: grid; grid-template-columns: 130px 1fr; align-items: center; gap: 8px; font-size: 14px; }
.label { color: #374151; }
select {
  width: 100%;
  padding: 8px 10px;
  border-radius: 8px;
  border: 1px solid #d1d5db;
  background: #f9fafb;
  font: inherit;
}
.actions { display: flex; gap: 8px; margin-top: 12px; }
button {
  padding: 8px 14px;
  border-radius: 8px;
  border: 1px solid #d1d5db;
  background: #ffffff;
  font: inherit;
  cursor: pointer;
}
button:disabled { opacity: 0.5; cursor: not-allowed; }
button.primary { background: #2563eb; color: white; border-color: #2563eb; }
button.primary:hover:not(:disabled) { background: #1d4ed8; }
.alert { padding: 10px 12px; border-radius: 8px; font-size: 13px; margin-top: 12px; }
.alert.ok { background: #ecfdf5; color: #065f46; border: 1px solid #a7f3d0; }
.alert.err { background: #fef2f2; color: #991b1b; border: 1px solid #fecaca; }
.alert.warn { background: #fffbeb; color: #92400e; border: 1px solid #fde68a; }
.status-list { list-style: none; padding: 0; margin: 0; }
.status-list li { display: flex; align-items: center; gap: 8px; font-size: 13px; padding: 6px 0; }
.role { font-weight: 500; }
.badge {
  margin-inline-start: auto;
  padding: 2px 8px;
  font-size: 11px;
  text-transform: uppercase;
  border-radius: 999px;
  letter-spacing: 0.04em;
}
.badge.online { background: #d1fae5; color: #065f46; }
.badge.offline { background: #fee2e2; color: #991b1b; }
.badge.mocked  { background: #fef3c7; color: #92400e; }
footer { text-align: center; padding: 8px; }
.card-head { display: flex; align-items: center; justify-content: space-between; gap: 8px; margin-bottom: 8px; }
.card-head h2 { margin: 0; }
.test-actions { display: flex; gap: 6px; }
button.ghost {
  background: transparent;
  border: 1px dashed #d1d5db;
  color: #2563eb;
  font-size: 12px;
  padding: 6px 12px;
}
button.ghost:hover:not(:disabled) { background: #eff6ff; border-color: #2563eb; }

/* Jobs list */
.jobs-list { list-style: none; padding: 0; margin: 0; display: flex; flex-direction: column; gap: 6px; }
.job { border: 1px solid #e5e7eb; border-radius: 8px; overflow: hidden; }
.job-summary {
  display: flex;
  align-items: center;
  gap: 8px;
  width: 100%;
  background: #f9fafb;
  border: none;
  padding: 8px 12px;
  font-size: 13px;
  text-align: start;
  border-radius: 0;
}
.job-summary:hover { background: #f3f4f6; }
.job-meta { margin-inline-start: auto; font-size: 12px; }
.chev { font-size: 10px; color: #9ca3af; padding-inline-start: 8px; }
.job-detail { padding: 12px; background: #ffffff; border-top: 1px solid #e5e7eb; }
.meta-line { font-size: 12px; color: #4b5563; margin-bottom: 6px; display: flex; gap: 6px; align-items: baseline; }
.meta-key { color: #9ca3af; min-width: 56px; }
.preview-wrap { margin-top: 8px; }
.preview-title { font-size: 11px; text-transform: uppercase; letter-spacing: 0.06em; color: #6b7280; margin-bottom: 4px; }
.receipt {
  font-family: 'Cascadia Code', 'Consolas', 'Menlo', monospace;
  font-size: 12px;
  line-height: 1.4;
  padding: 12px;
  background: #fffef8;
  border: 1px dashed #d1d5db;
  border-radius: 6px;
  white-space: pre-wrap;
  word-break: break-all;
  margin: 0;
  color: #111827;
  direction: ltr;
}
.receipt-iframe {
  display: block;
  width: 100%;
  max-width: 340px;
  height: 720px;
  border: 0;
  border-radius: 6px;
  background: #ffffff;
  box-shadow: 0 1px 3px rgba(0, 0, 0, 0.08), 0 0 0 1px #e5e7eb;
  margin: 0 auto;
}
</style>
