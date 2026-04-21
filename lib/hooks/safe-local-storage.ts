export function safeReadJson<T>(key: string, fallback: T): T {
  if (typeof window === "undefined") return fallback;
  try {
    const raw = window.localStorage.getItem(key);
    return raw ? (JSON.parse(raw) as T) : fallback;
  } catch (e) {
    console.warn(`[safeReadJson] ${key} unreadable, resetting:`, e);
    try { window.localStorage.removeItem(key); } catch {}
    return fallback;
  }
}

export function safeWriteJson(key: string, value: unknown): boolean {
  if (typeof window === "undefined") return false;
  try {
    window.localStorage.setItem(key, JSON.stringify(value));
    return true;
  } catch (e) {
    console.warn(`[safeWriteJson] ${key} write failed (quota or serialization):`, e);
    return false;
  }
}
