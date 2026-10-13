import { ReactNode, useEffect, useRef, useState } from 'react';
import { NavLink, useLocation, useNavigate } from 'react-router-dom';
import { Bell, BookOpen, FileText, LayoutDashboard, LogOut, Menu, Receipt, Repeat, Search, Settings, Tag, Users } from 'lucide-react';
import { useAuth, User } from '../lib/auth';
import { api, useApi } from '../lib/api';
import { fmtDateTime } from '../lib/format';
import { Drawer } from './ui';

export interface NavItem { to: string; label: string; sub: string; icon: any }
const ringkasan: NavItem = { to: '/', label: 'Ringkasan', sub: 'Pantau kinerja program Ubah Sampah Jadi Emas secara ringkas.', icon: LayoutDashboard };
const transaksi: NavItem = { to: '/transaksi', label: 'Transaksi', sub: 'Catat setoran sampah dan telusuri riwayatnya.', icon: Receipt };
const nasabah: NavItem = { to: '/nasabah', label: 'Nasabah', sub: 'Kelola nasabah, saldo, dan progres menuju Tabungan Emas.', icon: Users };
const konversi: NavItem = { to: '/konversi', label: 'Konversi', sub: 'Ajukan dan pantau konversi saldo menjadi Tabungan Emas.', icon: Repeat };
const katalog: NavItem = { to: '/katalog', label: 'Katalog Harga', sub: 'Daftar jenis sampah, harga, dan riwayat perubahannya.', icon: Tag };
const laporan: NavItem = { to: '/laporan', label: 'Laporan & Dokumentasi', sub: 'Unduh laporan resmi dan kelola foto kegiatan.', icon: FileText };
const pengaturan: NavItem = { to: '/pengaturan', label: 'Pengaturan', sub: 'Kelola pengguna, lokasi, log audit, dan parameter sistem.', icon: Settings };

export const NAV: Record<User['role'], NavItem[]> = {
  admin_lokasi: [ringkasan, transaksi, nasabah, konversi, laporan],
  super_admin: [ringkasan, { ...transaksi, sub: 'Riwayat transaksi seluruh lokasi (hanya baca).' }, { ...nasabah, sub: 'Data nasabah seluruh lokasi (hanya baca).' },
    { ...konversi, sub: 'Verifikasi pengajuan, unggah bukti transfer, dan koreksi.' }, katalog, laporan, pengaturan],
  bsi_viewer: [ringkasan, { ...nasabah, label: 'Nasabah & Tabungan Emas', sub: 'Data nasabah dan Tabungan Emas (hanya baca, data disamarkan).' }, { ...katalog, sub: 'Daftar jenis sampah dan harga (hanya baca).' }, laporan],
};
export const ROLE_LABEL: Record<User['role'], string> = { admin_lokasi: 'Admin Lokasi', super_admin: 'Super Admin', bsi_viewer: 'BSI Viewer' };

function Logos({ light = false }: { light?: boolean }) {
  return (
    <div className="flex items-center gap-2">
      <img src="/assets/logo-bsi.svg" alt="Bank Syariah Indonesia" className="h-8" />
      <img src="/assets/logo-kepul.svg" alt="Kepul" className="h-8" />
      {light && null}
    </div>
  );
}

function Bell_() {
  const nav = useNavigate();
  const { data, reload } = useApi<{ rows: any[]; unread: number }>('/notifications');
  const [open, setOpen] = useState(false);
  const ref = useRef<HTMLDivElement>(null);
  useEffect(() => { const t = setInterval(reload, 60000); return () => clearInterval(t); }, [reload]);
  useEffect(() => {
    const h = (e: MouseEvent) => { if (ref.current && !ref.current.contains(e.target as Node)) setOpen(false); };
    document.addEventListener('mousedown', h); return () => document.removeEventListener('mousedown', h);
  }, []);
  const unread = data?.unread ?? 0;
  const go = async (n: any) => {
    await api(`/notifications/${n.id}/read`, { method: 'POST' }).catch(() => {});
    setOpen(false); reload();
    nav(n.ref_entity === 'conversions' ? `/konversi?open=${n.ref_id}` : `/nasabah?open=${n.ref_id}`);
  };
  return (
    <div className="relative" ref={ref}>
      <button className="relative p-2.5 rounded-full hover:bg-page" aria-label={`Notifikasi${unread ? `, ${unread} belum dibaca` : ''}`} onClick={() => { setOpen(!open); if (!open) reload(); }}>
        <Bell size={20} />
        {unread > 0 && <span className="absolute top-1 right-1 min-w-[18px] h-[18px] px-1 rounded-full bg-danger text-white text-[11px] font-bold flex items-center justify-center">{unread > 99 ? '99+' : unread}</span>}
      </button>
      {open && (
        <div className="absolute right-0 mt-2 w-[min(92vw,380px)] card z-50 text-ink">
          <div className="flex items-center justify-between px-4 py-3 border-b border-line">
            <span className="font-bold">Notifikasi</span>
            {unread > 0 && <button className="text-sm font-bold text-[var(--teal-action)]" onClick={async () => { await api('/notifications/read-all', { method: 'POST' }); reload(); }}>Tandai semua dibaca</button>}
          </div>
          <ul className="max-h-80 overflow-y-auto">
            {!data?.rows.length && <li className="p-6 text-center text-sm text-ink-soft">Belum ada notifikasi.</li>}
            {data?.rows.map((n) => (
              <li key={n.id}>
                <button onClick={() => go(n)} className={`w-full text-left px-4 py-3 border-b border-line hover:bg-page ${n.is_read ? '' : 'bg-teal-tint'}`}>
                  <p className={`text-sm ${n.is_read ? '' : 'font-bold'}`}>{n.message}</p>
                  <p className="text-xs text-ink-soft mt-1">{fmtDateTime(n.created_at)}</p>
                </button>
              </li>
            ))}
          </ul>
        </div>
      )}
    </div>
  );
}

export default function Layout({ children }: { children: ReactNode }) {
  const { user, meta, logout } = useAuth();
  const loc = useLocation();
  const nav = useNavigate();
  const [more, setMore] = useState(false);
  const [q, setQ] = useState('');
  const items = NAV[user!.role];
  const current = items.find((i) => (i.to === '/' ? loc.pathname === '/' : loc.pathname.startsWith(i.to)));
  useEffect(() => { document.title = `${current?.label ?? 'BSI Kios Daur Ulang'} — BSI Kios Daur Ulang`; setMore(false); }, [current, loc.pathname]);
  const bottom = items.length > 5 ? items.slice(0, 4) : items;
  const rest = items.length > 5 ? items.slice(4) : [];

  const linkCls = ({ isActive }: { isActive: boolean }) =>
    `flex items-center gap-3 rounded-ctl px-3 min-h-[44px] text-sm font-bold transition ${isActive ? 'bg-teal-tint text-[var(--teal-action)]' : 'text-ink hover:bg-page'}`;

  return (
    <div className="min-h-full flex">
      {/* Sidebar (≥768: ikon; ≥1024: penuh) */}
      <aside className="hidden md:flex flex-col w-[72px] lg:w-[260px] shrink-0 bg-white border-r border-line sticky top-0 h-screen">
        <div className="px-3 lg:px-5 py-5 border-b border-line"><div className="hidden lg:block"><Logos /></div><img src="/assets/logo-bsi.svg" alt="BSI" className="lg:hidden h-8 mx-auto" /></div>
        <nav className="flex-1 p-3 space-y-1 overflow-y-auto" aria-label="Menu utama">
          {items.map((i) => (
            <NavLink key={i.to} to={i.to} end={i.to === '/'} className={linkCls} title={i.label}>
              <i.icon size={20} className="shrink-0" /><span className="hidden lg:inline">{i.label}</span>
            </NavLink>
          ))}
        </nav>
        <div className="p-3 border-t border-line">
          <div className="hidden lg:block rounded-ctl bg-page p-3 mb-2">
            <p className="font-bold text-sm truncate">{user!.nama}</p>
            <p className="text-xs text-ink-soft">{ROLE_LABEL[user!.role]}{user!.location_nama ? ` • ${user!.location_nama}` : ''}</p>
          </div>
          <button className="btn-outline w-full btn-sm" onClick={logout} title="Keluar"><LogOut size={16} /><span className="hidden lg:inline">Keluar</span></button>
        </div>
      </aside>

      <div className="flex-1 min-w-0 flex flex-col pb-16 md:pb-0">
        <header className="sticky top-0 z-30 bg-white border-b border-line">
          <div className="max-w-[1280px] mx-auto px-4 md:px-6 py-3 flex items-center gap-3">
            <img src="/assets/logo-bsi.svg" alt="BSI" className="h-7 md:hidden" />
            <div className="min-w-0 flex-1">
              <h1 className="text-[22px] leading-7 font-bold text-teal-dark truncate">{current?.label ?? 'Halaman'}</h1>
              <p className="text-sm text-ink-soft hidden sm:block truncate">{current?.sub}</p>
            </div>
            <form className="hidden md:flex items-center relative" role="search" onSubmit={(e) => { e.preventDefault(); if (q.trim()) nav(`/nasabah?q=${encodeURIComponent(q.trim())}`); }}>
              <Search size={16} className="absolute left-3 text-ink-soft" />
              <input className="input !min-h-[40px] pl-9 w-56 lg:w-72" placeholder="Cari nasabah (nama / WhatsApp)" aria-label="Pencarian nasabah" value={q} onChange={(e) => setQ(e.target.value)} />
            </form>
            <Bell_ />
            <div className="md:hidden"><button onClick={logout} className="p-2.5 rounded-full hover:bg-page" aria-label="Keluar"><LogOut size={20} /></button></div>
          </div>
        </header>

        <main className="flex-1 w-full max-w-[1280px] mx-auto px-4 md:px-6 py-5">{children}</main>

        <footer className="max-w-[1280px] w-full mx-auto px-4 md:px-6 py-4 text-xs text-ink-soft border-t border-line flex flex-wrap gap-x-4 gap-y-1 justify-between">
          <span>Data terakhir diperbarui: <strong className="tnum">{fmtDateTime(meta?.lastUpdate)}</strong></span>
          <span>© {new Date().getFullYear()} PT Bank Syariah Indonesia Tbk • BSI Call 14040</span>
        </footer>
      </div>

      {/* Navigasi bawah ponsel */}
      <nav className="md:hidden fixed bottom-0 inset-x-0 z-40 bg-white border-t border-line flex" aria-label="Menu utama">
        {bottom.map((i) => (
          <NavLink key={i.to} to={i.to} end={i.to === '/'} className={({ isActive }) => `flex-1 flex flex-col items-center justify-center gap-0.5 min-h-[60px] text-[11px] font-bold ${isActive ? 'text-[var(--teal-action)]' : 'text-ink-soft'}`}>
            <i.icon size={20} /><span className="truncate max-w-[72px]">{i.label.split(' ')[0]}</span>
          </NavLink>
        ))}
        {rest.length > 0 && (
          <button onClick={() => setMore(true)} className="flex-1 flex flex-col items-center justify-center gap-0.5 min-h-[60px] text-[11px] font-bold text-ink-soft"><Menu size={20} />Lainnya</button>
        )}
      </nav>
      <Drawer open={more} title="Menu lainnya" onClose={() => setMore(false)}>
        <div className="space-y-1">
          {rest.map((i) => <NavLink key={i.to} to={i.to} className={linkCls}><i.icon size={20} />{i.label}</NavLink>)}
          <div className="rounded-ctl bg-page p-3 my-3"><p className="font-bold text-sm">{user!.nama}</p><p className="text-xs text-ink-soft">{ROLE_LABEL[user!.role]}</p></div>
          <button className="btn-outline w-full" onClick={logout}><LogOut size={16} />Keluar</button>
        </div>
      </Drawer>
    </div>
  );
}

export function Denied() {
  const { user } = useAuth();
  const loc = useLocation();
  useEffect(() => { api('/audit/denied', { method: 'POST', body: { path: loc.pathname } }).catch(() => {}); }, [loc.pathname]);
  return (
    <div className="card p-10 text-center max-w-lg mx-auto mt-10">
      <BookOpen className="mx-auto text-teal-dark mb-3" size={36} />
      <h2 className="text-xl font-bold text-teal-dark mb-1">Akses ditolak</h2>
      <p className="text-ink-soft">Anda tidak memiliki akses ke halaman ini.</p>
      <NavLink to="/" className="btn-primary mt-5 inline-flex">Kembali ke Ringkasan</NavLink>
      <span className="sr-only">{user?.role}</span>
    </div>
  );
}
