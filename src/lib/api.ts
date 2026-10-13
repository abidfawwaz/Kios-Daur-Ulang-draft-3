import { useCallback, useEffect, useRef, useState } from 'react';

export class ApiError extends Error {
  status: number; code?: string;
  constructor(status: number, message: string, code?: string) { super(message); this.status = status; this.code = code; }
}

export const authEvents = new EventTarget();

export async function api<T = any>(path: string, opts: { method?: string; body?: any; form?: FormData } = {}): Promise<T> {
  const init: RequestInit = { method: opts.method ?? 'GET', credentials: 'same-origin', headers: {} };
  if (opts.form) init.body = opts.form;
  else if (opts.body !== undefined) { (init.headers as any)['Content-Type'] = 'application/json'; init.body = JSON.stringify(opts.body); }
  let res: Response;
  try { res = await fetch('/api' + path, init); } catch { throw new ApiError(0, 'Tidak dapat terhubung ke server. Periksa koneksi Anda lalu coba lagi.'); }
  const ct = res.headers.get('content-type') ?? '';
  const data = ct.includes('json') ? await res.json() : null;
  if (!res.ok) {
    const err = new ApiError(res.status, data?.error ?? 'Terjadi kesalahan.', data?.code);
    if (res.status === 401 && path !== '/auth/login') authEvents.dispatchEvent(new CustomEvent('expired', { detail: err }));
    throw err;
  }
  return data as T;
}

export async function downloadFile(path: string, filename?: string) {
  const res = await fetch('/api' + path, { credentials: 'same-origin' });
  if (!res.ok) { let m = 'Gagal mengunduh berkas.'; try { m = (await res.json()).error ?? m; } catch { /* abaikan */ } throw new ApiError(res.status, m); }
  const blob = await res.blob();
  const cd = res.headers.get('content-disposition') ?? '';
  const name = filename ?? /filename="([^"]+)"/.exec(cd)?.[1] ?? 'unduhan';
  const url = URL.createObjectURL(blob);
  const a = document.createElement('a'); a.href = url; a.download = name; document.body.appendChild(a); a.click(); a.remove();
  setTimeout(() => URL.revokeObjectURL(url), 5000);
}
export async function fetchBlobUrl(path: string) {
  const res = await fetch('/api' + path, { credentials: 'same-origin' });
  if (!res.ok) throw new ApiError(res.status, 'Gagal memuat berkas.');
  return URL.createObjectURL(await res.blob());
}

export const qs = (o: Record<string, any>) => {
  const p = new URLSearchParams();
  for (const [k, v] of Object.entries(o)) if (v !== undefined && v !== null && v !== '') p.set(k, String(v));
  const s = p.toString();
  return s ? '?' + s : '';
};

/** Memuat data dengan keadaan memuat / galat / coba lagi (PRD 7.4). `path` null = jangan memuat. */
export function useApi<T = any>(path: string | null) {
  const [data, setData] = useState<T | null>(null);
  const [error, setError] = useState<ApiError | null>(null);
  const [loading, setLoading] = useState(!!path);
  const seq = useRef(0);
  const load = useCallback(() => {
    if (!path) return;
    const my = ++seq.current;
    setLoading(true); setError(null);
    api<T>(path).then((d) => { if (my === seq.current) setData(d); })
      .catch((e) => { if (my === seq.current) setError(e); })
      .finally(() => { if (my === seq.current) setLoading(false); });
  }, [path]);
  useEffect(() => { load(); }, [load]);
  return { data, error, loading, reload: load, setData };
}
