const KEY = 'asmo_pin_verifier_v1';
const LEGACY = 'asmo_wipe_secret_pin';
const ITERATIONS = 600000;
const hex = (bytes: Uint8Array) => Array.from(bytes, b => b.toString(16).padStart(2, '0')).join('');

export function normalizePinDigits(raw: string): string {
  return String(raw || '')
    .replace(/[٠-٩]/g, d => String('٠١٢٣٤٥٦٧٨٩'.indexOf(d)))
    .replace(/[۰-۹]/g, d => String('۰۱۲۳۴۵۶۷۸۹'.indexOf(d)))
    .replace(/\D/g, '')
    .slice(0, 4);
}

async function derive(pin: string, salt: string): Promise<string> {
  const key = await crypto.subtle.importKey('raw', new TextEncoder().encode(pin), 'PBKDF2', false, ['deriveBits']);
  return hex(new Uint8Array(await crypto.subtle.deriveBits({ name: 'PBKDF2', hash: 'SHA-256', salt: new TextEncoder().encode(salt), iterations: ITERATIONS }, key, 256)));
}

async function storePin(rawPin: string) {
  const pin = normalizePinDigits(rawPin);
  if (!/^\d{4}$/.test(pin)) throw new Error('أدخل رقماً سرياً مكوناً من 4 أرقام');
  const salt = hex(crypto.getRandomValues(new Uint8Array(32)));
  const hash = await derive(pin, salt);
  localStorage.setItem(KEY, JSON.stringify({ salt, hash, failures: 0, blockedUntil: 0 }));
  localStorage.removeItem(LEGACY);
}

export const pinSecurity = {
  configured: () => !!localStorage.getItem(KEY) || !!localStorage.getItem(LEGACY),
  async setup(rawPin: string) {
    if (this.configured()) throw new Error('الرمز مُعد مسبقًا');
    await storePin(rawPin);
  },
  async verify(rawPin: string): Promise<boolean> {
    const pin = normalizePinDigits(rawPin);
    if (!/^\d{4}$/.test(pin)) return false;
    const record = localStorage.getItem(KEY);
    if (!record) {
      const legacy = localStorage.getItem(LEGACY);
      if (!legacy) return false;
      await storePin(legacy);
      return this.verify(pin);
    }
    const data = JSON.parse(record);
    if (Date.now() < data.blockedUntil) throw new Error('محاولات كثيرة خاطئة؛ انتظر دقيقة قبل المحاولة مجدداً');
    const candidate = await derive(pin, data.salt);
    const valid = candidate === data.hash;
    data.failures = valid ? 0 : data.failures + 1;
    data.blockedUntil = data.failures >= 5 ? Date.now() + 60000 : 0;
    if (data.failures >= 5) data.failures = 0;
    localStorage.setItem(KEY, JSON.stringify(data));
    return valid;
  },
  async change(oldPin: string, nextPin: string) {
    if (!await this.verify(oldPin)) throw new Error('الرقم السري الحالي غير صحيح');
    await storePin(nextPin);
  },
};

// Reject concurrent requests so one approval cannot authorize multiple deletions.
let pending = false;
let activeHandler: ((event: Event) => void) | null = null;

export function resetPendingAuthorization(): void {
  if (activeHandler && typeof window !== 'undefined') {
    window.removeEventListener('asmo-authorize-result', activeHandler);
  }
  activeHandler = null;
  pending = false;
}

/**
 * إلزام إدخال الرقم السري (4 أرقام) قبل أي عملية مسح أو حذف لمنع فقدان البيانات نهائياً
 */
export async function authorizeDeletion(action: string): Promise<void> {
  if (typeof window === 'undefined') {
    throw new Error('يلزم إدخال الرقم السري لتأكيد المسح');
  }
  if (pending) {
    resetPendingAuthorization();
  }
  pending = true;
  return new Promise((resolve, reject) => {
    const handler = (event: Event) => {
      pending = false;
      activeHandler = null;
      (event as CustomEvent).detail === true
        ? resolve()
        : reject(new Error('تم إلغاء عملية المسح لحماية البيانات'));
    };
    activeHandler = handler;
    window.addEventListener('asmo-authorize-result', handler, { once: true });
    window.dispatchEvent(new CustomEvent('asmo-authorize-request', { detail: { action } }));
  });
}

export async function authorizeMutation(action: string): Promise<void> {
  // تفعيل طلب الرقم السري حصرياً عند أي عملية مسح أو حذف أو تصفير لمنع فقدان البيانات، مع إبقاء الحفظ الفوري بدون رقم سري
  if (/حذف|مسح|إزالة|تصفير|delete|wipe|clear/i.test(action)) {
    return authorizeDeletion(action);
  }
  return Promise.resolve();
}

