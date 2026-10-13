import { createContext, useCallback, useContext, useEffect, useState, ReactNode } from 'react';
import { api, authEvents } from './api';

export interface User { id: number; nama: string; email: string; role: 'super_admin' | 'admin_lokasi' | 'bsi_viewer'; location_id: number | null; location_nama: string | null; must_change_password: boolean }
export interface Meta {
  locations: { id: number; nama: string; is_active: number; target_kg_bulanan: number | null }[];
  categories: { id: number; nama: string; warna: string }[];
  settings: { min_conversion: number; existing_threshold: number; backdate_days: number; session_minutes: number; qty_warn: number; qty_max: number };
  lastUpdate: string | null; today: string;
}

interface Ctx {
  user: User | null; meta: Meta | null; ready: boolean; notice: string;
  login: (e: string, p: string) => Promise<void>; logout: () => Promise<void>; refresh: () => Promise<void>; refreshMeta: () => Promise<void>;
}
const AuthCtx = createContext<Ctx>(null as any);
export const useAuth = () => useContext(AuthCtx);

export function AuthProvider({ children }: { children: ReactNode }) {
  const [user, setUser] = useState<User | null>(null);
  const [meta, setMeta] = useState<Meta | null>(null);
  const [ready, setReady] = useState(false);
  const [notice, setNotice] = useState('');

  const refreshMeta = useCallback(async () => { setMeta(await api<Meta>('/meta')); }, []);
  const refresh = useCallback(async () => {
    try {
      const r = await api<{ user: User }>('/auth/me');
      setUser(r.user);
      if (!r.user.must_change_password) await refreshMeta();
    } catch { setUser(null); setMeta(null); }
    setReady(true);
  }, [refreshMeta]);

  useEffect(() => { refresh(); }, [refresh]);
  useEffect(() => {
    const onExpired = (e: Event) => {
      const err = (e as CustomEvent).detail;
      setUser(null); setMeta(null);
      setNotice(err.code === 'session_expired' ? 'Sesi Anda berakhir karena tidak aktif. Silakan masuk kembali.' : '');
    };
    authEvents.addEventListener('expired', onExpired);
    return () => authEvents.removeEventListener('expired', onExpired);
  }, []);

  const login = async (email: string, password: string) => {
    const r = await api<{ user: User }>('/auth/login', { method: 'POST', body: { email, password } });
    setNotice(''); setUser(r.user);
    if (!r.user.must_change_password) await refreshMeta();
  };
  const logout = async () => { await api('/auth/logout', { method: 'POST' }).catch(() => {}); setUser(null); setMeta(null); setNotice(''); };
  return <AuthCtx.Provider value={{ user, meta, ready, notice, login, logout, refresh, refreshMeta }}>{children}</AuthCtx.Provider>;
}
