import { computed, ref, watch } from 'vue'

export type Locale = 'ar' | 'en'

const LS_KEY = 'sufra_printer_locale'

interface Dict {
  app: {
    title: string
    bridge_running: string
    bridge_not_responding: string
    no_app: string
    works_offline: string
  }
  language: { label: string; ar: string; en: string }
  roles: {
    section_title: string
    description: string
    pos: string
    kitchen: string
    not_assigned: string
    no_devices_strong: string
    no_devices_hint: string
    enum_error_strong: string
    winusb_hint_lead: string
    winusb_hint_zadig: string
    save: string
    saving: string
    refresh: string
    loading: string
    saved: string
  }
  recent: {
    title: string
    last_count: string
    empty_lead: string
    empty_action: string
    empty_tail: string
    send_test: string
    sending: string
    test_help: string
    mocked_msg: string
    sent_msg: string
    failed: string
    preview_title: string
    preview_text_title: string
    no_text: string
    printer_label: string
    job_id_label: string
    badge_mocked: string
    badge_printed: string
    badge_failed: string
  }
  status: { title: string; online: string; offline: string }
}

const en: Dict = {
  app: {
    title: 'Sufra Printer',
    bridge_running: 'Bridge running',
    bridge_not_responding: 'Bridge not responding',
    no_app: 'No app responding at http://127.0.0.1:9177',
    works_offline:
      'Works fully offline. Closing this window leaves the bridge running in the tray.',
  },
  language: { label: 'Language', ar: 'العربية', en: 'English' },
  roles: {
    section_title: 'Printer roles',
    description:
      "Choose which connected USB printer handles each role. You can leave both unassigned for now — incoming print jobs will be logged below so you can verify the dashboard wiring without hardware.",
    pos: 'POS receipts',
    kitchen: 'Kitchen tickets',
    not_assigned: '— not assigned (mock) —',
    no_devices_strong: 'No USB printers detected yet.',
    no_devices_hint:
      'Mock mode is on — the bridge accepts print jobs and logs them below. Plug in your thermal printer later and click Refresh to assign roles.',
    enum_error_strong: "Couldn't enumerate USB printers.",
    winusb_hint_lead:
      'On Windows your thermal printer needs the WinUSB driver. Use ',
    winusb_hint_zadig: 'Zadig',
    save: 'Save',
    saving: 'Saving…',
    refresh: 'Refresh',
    loading: 'Loading…',
    saved: 'Saved.',
  },
  recent: {
    title: 'Recent prints',
    last_count: '· last {n}',
    empty_lead: 'Nothing yet. Click ',
    empty_action: 'Send test receipt',
    empty_tail:
      ' above to verify the bridge end-to-end — no printer or dashboard needed. Real orders from the dashboard also land here.',
    send_test: 'Send test receipt',
    sending: 'Sending…',
    test_help: 'Send a sample receipt through the bridge (POS role)',
    mocked_msg:
      'Test receipt logged (mock) — expand it below to see the preview.',
    sent_msg: 'Test receipt sent to {role} printer.',
    failed: 'test print failed',
    preview_title: 'Receipt preview',
    preview_text_title: 'Receipt preview (text from ESC/POS bytes)',
    no_text: '(no printable text)',
    printer_label: 'printer',
    job_id_label: 'jobId',
    badge_mocked: 'mocked',
    badge_printed: 'printed',
    badge_failed: 'failed',
  },
  status: { title: 'Live status', online: 'online', offline: 'offline' },
}

const ar: Dict = {
  app: {
    title: 'سفرة برينتر',
    bridge_running: 'الجسر يعمل',
    bridge_not_responding: 'الجسر لا يستجيب',
    no_app: 'لا يوجد تطبيق يستجيب على http://127.0.0.1:9177',
    works_offline:
      'يعمل دون اتصال بالكامل. إغلاق هذه النافذة يُبقي الجسر يعمل في شريط النظام.',
  },
  language: { label: 'اللغة', ar: 'العربية', en: 'English' },
  roles: {
    section_title: 'أدوار الطابعات',
    description:
      'اختر الطابعة المتصلة المسؤولة عن كل دور. يمكنك ترك كليهما بدون تعيين حالياً — سيتم تسجيل مهام الطباعة الواردة بالأسفل للتأكد من ربط لوحة التحكم بدون أجهزة.',
    pos: 'إيصالات نقطة البيع',
    kitchen: 'تذاكر المطبخ',
    not_assigned: '— غير معيّن (تجريبي) —',
    no_devices_strong: 'لم يتم اكتشاف أي طابعات USB بعد.',
    no_devices_hint:
      'الوضع التجريبي مُفعّل — الجسر يقبل مهام الطباعة ويسجلها أدناه. قم بتوصيل طابعتك الحرارية لاحقاً واضغط تحديث لتعيين الأدوار.',
    enum_error_strong: 'تعذّر سرد طابعات USB.',
    winusb_hint_lead:
      'على نظام Windows تحتاج طابعتك الحرارية إلى تعريف WinUSB. استخدم ',
    winusb_hint_zadig: 'Zadig',
    save: 'حفظ',
    saving: 'جاري الحفظ…',
    refresh: 'تحديث',
    loading: 'جاري التحميل…',
    saved: 'تم الحفظ.',
  },
  recent: {
    title: 'المطبوعات الأخيرة',
    last_count: '· آخر {n}',
    empty_lead: 'لا يوجد شيء بعد. اضغط ',
    empty_action: 'إرسال إيصال تجريبي',
    empty_tail:
      ' بالأعلى للتحقق من الجسر من البداية للنهاية — لا حاجة لطابعة أو لوحة تحكم. تظهر الطلبات الفعلية من لوحة التحكم هنا أيضاً.',
    send_test: 'إرسال إيصال تجريبي',
    sending: 'جاري الإرسال…',
    test_help: 'إرسال إيصال نموذجي عبر الجسر (دور نقطة البيع)',
    mocked_msg: 'تم تسجيل الإيصال التجريبي (تجريبي) — وسّعه بالأسفل لمعاينته.',
    sent_msg: 'تم إرسال الإيصال التجريبي إلى طابعة {role}.',
    failed: 'فشلت الطباعة التجريبية',
    preview_title: 'معاينة الإيصال',
    preview_text_title: 'معاينة الإيصال (نص مستخرج من بايتات ESC/POS)',
    no_text: '(لا يوجد نص قابل للطباعة)',
    printer_label: 'الطابعة',
    job_id_label: 'رقم المهمة',
    badge_mocked: 'تجريبي',
    badge_printed: 'مطبوع',
    badge_failed: 'فشل',
  },
  status: { title: 'الحالة المباشرة', online: 'متصل', offline: 'غير متصل' },
}

const dictionaries: Record<Locale, Dict> = { ar, en }

function readStoredLocale(): Locale {
  if (typeof localStorage === 'undefined') return 'ar'
  const v = localStorage.getItem(LS_KEY)
  return v === 'en' || v === 'ar' ? v : 'ar'
}

const locale = ref<Locale>(readStoredLocale())

watch(
  locale,
  (v) => {
    if (typeof localStorage !== 'undefined') localStorage.setItem(LS_KEY, v)
    if (typeof document !== 'undefined') {
      document.documentElement.lang = v
      document.documentElement.dir = v === 'ar' ? 'rtl' : 'ltr'
    }
  },
  { immediate: true },
)

type DotPath<T, P extends string = ''> = {
  [K in keyof T]: T[K] extends object
    ? DotPath<T[K], `${P}${K & string}.`>
    : `${P}${K & string}`
}[keyof T]

export type TranslationKey = DotPath<Dict>

function lookup(dict: Dict, key: string): string {
  const parts = key.split('.')
  let val: unknown = dict
  for (const p of parts) {
    if (val && typeof val === 'object' && p in (val as Record<string, unknown>)) {
      val = (val as Record<string, unknown>)[p]
    } else {
      return key
    }
  }
  return typeof val === 'string' ? val : key
}

export function useI18n() {
  const t = (key: TranslationKey, params?: Record<string, string | number>): string => {
    const raw = lookup(dictionaries[locale.value], key)
    if (!params) return raw
    return raw.replace(/\{(\w+)\}/g, (_, k) => String(params[k] ?? ''))
  }
  const isRTL = computed(() => locale.value === 'ar')
  return { locale, t, isRTL }
}
