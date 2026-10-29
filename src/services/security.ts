const KEY = 'asmo_pin_verifier_v1';
const LEGACY = 'asmo_wipe_secret_pin';
const ITERATIONS = 600000;
const hex = (bytes: Uint8Array) => Array.from(bytes, b => b.toString(16).padStart(2, '0')).join('');
async function derive(pin: string, salt: string): Promise<string> {
  const key = await crypto.subtle.importKey('raw', new TextEncoder().encode(pin), 'PBKDF2', false, ['deriveBits']);
  return hex(new Uint8Array(await crypto.subtle.deriveBits({ name: 'PBKDF2', hash: 'SHA-256', salt: new TextEncoder().encode(salt), iterations: ITERATIONS }, key, 256)));
}
async function storePin(pin: string) {
    if (!/^\d{4}$/.test(pin)) throw new Error('أدخل أربعة أرقام');
    const salt = hex(crypto.getRandomValues(new Uint8Array(32)));
    const hash = await derive(pin, salt);
    localStorage.setItem(KEY, JSON.stringify({ salt, hash, failures: 0, blockedUntil: 0 }));
    localStorage.removeItem(LEGACY);
  }
export const pinSecurity = {
  configured: () => !!localStorage.getItem(KEY) || !!localStorage.getItem(LEGACY),
  async setup(pin: string) {
    if (this.configured()) throw new Error('الرمز مُعد مسبقًا');
    await storePin(pin);
  },
  async verify(pin: string): Promise<boolean> {
    const record = localStorage.getItem(KEY);
    if (!record) {
      const legacy = localStorage.getItem(LEGACY);
      if (!legacy) return false;
      await storePin(legacy);
      return this.verify(pin);
    }
    const data = JSON.parse(record);
    if (Date.now() < data.blockedUntil) throw new Error('محاولات كثيرة؛ انتظر دقيقة');
    const candidate = await derive(pin, data.salt);
    const valid = candidate === data.hash;
    data.failures = valid ? 0 : data.failures + 1;
    data.blockedUntil = data.failures >= 5 ? Date.now() + 60000 : 0;
    if (data.failures >= 5) data.failures = 0;
    localStorage.setItem(KEY, JSON.stringify(data));
    return valid;
  },
  async change(oldPin: string, nextPin: string) {
    if (!await this.verify(oldPin)) throw new Error('الرمز الحالي غير صحيح');
    await storePin(nextPin);
  },
};

// Reject concurrent requests so one approval cannot authorize multiple mutations.
let pending = false;
export async function authorizeMutation(action: string): Promise<void> {
  if (typeof window === 'undefined' || pending) throw new Error('يلزم اعتماد المستخدم؛ توجد عملية معلقة');
  pending = true;
  return new Promise((resolve, reject) => {
    const handler = (event: Event) => {
      pending = false;
      (event as CustomEvent).detail === true ? resolve() : reject(new Error('أُلغيت العملية'));
    };
    window.addEventListener('asmo-authorize-result', handler, { once: true });
    window.dispatchEvent(new CustomEvent('asmo-authorize-request', { detail: { action } }));
  });
}
