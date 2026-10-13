import { createContext, ReactNode, useCallback, useContext, useEffect, useId, useRef, useState } from 'react';
import { AlertTriangle, CheckCircle2, ChevronLeft, ChevronRight, Inbox, Loader2, X } from 'lucide-react';
import { ApiError } from '../lib/api';
import { STATUS_KONVERSI } from '../lib/format';

/* ---------- Toast (sukses 4 detik, galat bertahan sampai ditutup) ---------- */
interface ToastItem { id: number; kind: 'ok' | 'err'; msg: string }
const ToastCtx = createContext<{ ok: (m: string) => void; err: (m: string) => void }>({ ok: () => {}, err: () => {} });
export const useToast = () => useContext(ToastCtx);
export function ToastProvider({ children }: { children: ReactNode }) {
  const [items, setItems] = useState<ToastItem[]>([]);
  const idRef = useRef(0);
  const remove = (id: number) => setItems((l) => l.filter((x) => x.id !== id));
  const push = useCallback((kind: 'ok' | 'err', msg: string) => {
    const id = ++idRef.current;
    setItems((l) => [...l, { id, kind, msg }]);
    if (kind === 'ok') setTimeout(() => remove(id), 4000);
  }, []);
  const value = { ok: (m: string) => push('ok', m), err: (m: string) => push('err', m) };
  return (
    <ToastCtx.Provider value={value}>
      {children}
      <div className="fixed z-[100] bottom-20 md:bottom-6 right-4 left-4 md:left-auto md:w-96 flex flex-col gap-2" aria-live="polite">
        {items.map((t) => (
          <div key={t.id} role={t.kind === 'err' ? 'alert' : 'status'}
            className={`flex items-start gap-3 rounded-ctl px-4 py-3 shadow-lg text-sm font-bold border ${t.kind === 'ok' ? 'bg-white border-teal text-teal-dark' : 'bg-white border-danger text-danger'}`}>
            {t.kind === 'ok' ? <CheckCircle2 size={18} className="shrink-0 mt-0.5" /> : <AlertTriangle size={18} className="shrink-0 mt-0.5" />}
            <span className="flex-1 break-words">{t.msg}</span>
            <button onClick={() => remove(t.id)} aria-label="Tutup notifikasi" className="shrink-0"><X size={16} /></button>
          </div>
        ))}
      </div>
    </ToastCtx.Provider>
  );
}
export const errMsg = (e: unknown) => (e instanceof Error && e.message ? e.message : 'Terjadi kesalahan. Silakan coba lagi.');

/* ---------- Dasar ---------- */
export const Spinner = ({ size = 18 }: { size?: number }) => <Loader2 size={size} className="animate-spin" aria-hidden />;
export const Card = ({ children, className = '' }: { children: ReactNode; className?: string }) => <div className={`card ${className}`}>{children}</div>;

type Tone = 'slate' | 'teal' | 'tealSolid' | 'gold' | 'danger' | 'muted';
const TONES: Record<Tone, string> = {
  slate: 'bg-[var(--slate-tint)] text-ink', teal: 'bg-teal-tint text-teal-dark', tealSolid: 'bg-[var(--teal-action)] text-white',
  gold: 'bg-gold text-ink', danger: 'bg-danger-tint text-danger', muted: 'bg-[#EEF1F3] text-ink-soft',
};
export const Badge = ({ tone = 'slate', children, strike }: { tone?: Tone; children: ReactNode; strike?: boolean }) => (
  <span className={`inline-flex items-center gap-1 rounded-full px-2.5 py-0.5 text-xs font-bold whitespace-nowrap ${TONES[tone]} ${strike ? 'line-through' : ''}`}>{children}</span>
);
const CNV_TONE: Record<string, Tone> = { diajukan: 'slate', diverifikasi: 'teal', transfer_selesai: 'tealSolid', ditolak: 'danger', dibatalkan: 'danger' };
export const ConversionBadge = ({ status }: { status: string }) => <Badge tone={CNV_TONE[status] ?? 'slate'}>{STATUS_KONVERSI[status] ?? status}</Badge>;
export const EligibleBadge = ({ eligible }: { eligible: boolean }) => <Badge tone={eligible ? 'gold' : 'muted'}>{eligible ? '★ Eligible' : 'Belum Eligible'}</Badge>;
export const CustStatusBadge = ({ status }: { status: string }) => <Badge tone={status === 'existing' ? 'teal' : 'slate'}>{status === 'existing' ? 'Existing' : 'Baru'}</Badge>;
export const TrxBadge = ({ status }: { status: string }) => (status === 'void' ? <Badge tone="muted" strike>Void</Badge> : <Badge tone="teal">Sukses</Badge>);

export function Progress({ value, tone = 'gold' }: { value: number; tone?: 'gold' | 'teal' }) {
  const v = Math.max(0, Math.min(1, value));
  return (
    <div className="h-2.5 w-full rounded-full bg-[#EEF1F3] overflow-hidden" role="progressbar" aria-valuenow={Math.round(v * 100)} aria-valuemin={0} aria-valuemax={100}>
      <div className="h-full rounded-full transition-all" style={{ width: `${v * 100}%`, background: tone === 'gold' ? 'var(--gold)' : 'var(--teal)' }} />
    </div>
  );
}

/* ---------- Keadaan memuat / kosong / galat ---------- */
export const Skeleton = ({ className = 'h-6 w-full' }: { className?: string }) => <div className={`skeleton ${className}`} aria-hidden />;
export function EmptyState({ icon, title, text, action }: { icon?: ReactNode; title: string; text?: string; action?: ReactNode }) {
  return (
    <div className="flex flex-col items-center text-center py-10 px-4 gap-2">
      <div className="h-12 w-12 rounded-full bg-teal-tint text-teal-dark flex items-center justify-center">{icon ?? <Inbox size={22} />}</div>
      <p className="font-bold text-ink">{title}</p>
      {text && <p className="text-sm text-ink-soft max-w-sm">{text}</p>}
      {action}
    </div>
  );
}
export function ErrorState({ error, onRetry }: { error: unknown; onRetry?: () => void }) {
  return (
    <div className="flex flex-col items-center text-center py-8 px-4 gap-3" role="alert">
      <div className="h-12 w-12 rounded-full bg-danger-tint text-danger flex items-center justify-center"><AlertTriangle size={22} /></div>
      <p className="text-sm text-ink max-w-sm">{errMsg(error)}</p>
      {onRetry && <button className="btn-outline btn-sm" onClick={onRetry}>Coba lagi</button>}
    </div>
  );
}
/** Pembungkus tiga keadaan: memuat (skeleton), galat (coba lagi), kosong (pesan). */
export function Loadable({ loading, error, reload, empty, emptyNode, hasData, children, rows = 4 }:
  { loading: boolean; error: unknown; reload?: () => void; empty?: boolean; emptyNode?: ReactNode; hasData: boolean; children: ReactNode; rows?: number }) {
  if (error && !hasData) return <ErrorState error={error} onRetry={reload} />;
  if (loading && !hasData) return <div className="space-y-3 p-4" aria-busy="true">{Array.from({ length: rows }).map((_, i) => <Skeleton key={i} className="h-8 w-full" />)}</div>;
  if (empty) return <>{emptyNode}</>;
  return <>{children}</>;
}

/* ---------- Form ---------- */
export function Field({ label, error, hint, children, required }: { label: string; error?: string | null; hint?: string; children: (id: string) => ReactNode; required?: boolean }) {
  const id = useId();
  return (
    <div>
      <label className="label" htmlFor={id}>{label}{required && <span className="text-danger" aria-hidden> *</span>}</label>
      {children(id)}
      {hint && !error && <p className="text-xs text-ink-soft mt-1">{hint}</p>}
      {error && <p className="text-xs text-danger font-bold mt-1" role="alert">{error}</p>}
    </div>
  );
}
export const Alert = ({ tone = 'gold', children }: { tone?: 'gold' | 'danger' | 'teal'; children: ReactNode }) => (
  <div role={tone === 'danger' ? 'alert' : 'status'} className={`rounded-ctl px-3 py-2.5 text-sm flex gap-2 items-start ${tone === 'gold' ? 'bg-gold-tint text-ink border border-gold' : tone === 'danger' ? 'bg-danger-tint text-danger border border-danger' : 'bg-teal-tint text-teal-dark border border-teal'}`}>
    <AlertTriangle size={16} className="shrink-0 mt-0.5" /><div>{children}</div>
  </div>
);

/* ---------- Dialog & drawer ---------- */
function useEsc(open: boolean, onClose: () => void) {
  useEffect(() => {
    if (!open) return;
    const h = (e: KeyboardEvent) => { if (e.key === 'Escape') onClose(); };
    document.addEventListener('keydown', h);
    const prev = document.body.style.overflow; document.body.style.overflow = 'hidden';
    return () => { document.removeEventListener('keydown', h); document.body.style.overflow = prev; };
  }, [open, onClose]);
}
export function Modal({ open, title, onClose, children, footer, size = 'md' }: { open: boolean; title: string; onClose: () => void; children: ReactNode; footer?: ReactNode; size?: 'sm' | 'md' | 'lg' | 'xl' }) {
  useEsc(open, onClose);
  if (!open) return null;
  const w = { sm: 'max-w-md', md: 'max-w-lg', lg: 'max-w-3xl', xl: 'max-w-5xl' }[size];
  return (
    <div className="fixed inset-0 z-50 flex items-end sm:items-center justify-center bg-black/40 p-0 sm:p-4" onMouseDown={(e) => e.target === e.currentTarget && onClose()}>
      <div role="dialog" aria-modal="true" aria-label={title} className={`bg-white w-full ${w} rounded-t-card sm:rounded-card shadow-xl max-h-[92vh] flex flex-col`}>
        <div className="flex items-center justify-between px-5 py-4 border-b border-line">
          <h2 className="text-lg font-bold text-teal-dark">{title}</h2>
          <button onClick={onClose} aria-label="Tutup" className="p-2 -mr-2 rounded hover:bg-page"><X size={20} /></button>
        </div>
        <div className="px-5 py-4 overflow-y-auto flex-1">{children}</div>
        {footer && <div className="px-5 py-3 border-t border-line flex flex-wrap justify-end gap-2">{footer}</div>}
      </div>
    </div>
  );
}
export function Drawer({ open, title, onClose, children, footer }: { open: boolean; title: string; onClose: () => void; children: ReactNode; footer?: ReactNode }) {
  useEsc(open, onClose);
  if (!open) return null;
  return (
    <div className="fixed inset-0 z-50 bg-black/40" onMouseDown={(e) => e.target === e.currentTarget && onClose()}>
      <aside role="dialog" aria-modal="true" aria-label={title} className="absolute right-0 top-0 h-full w-full sm:w-[480px] bg-white shadow-xl flex flex-col">
        <div className="flex items-center justify-between px-5 py-4 border-b border-line">
          <h2 className="text-lg font-bold text-teal-dark truncate">{title}</h2>
          <button onClick={onClose} aria-label="Tutup panel" className="p-2 -mr-2 rounded hover:bg-page"><X size={20} /></button>
        </div>
        <div className="px-5 py-4 overflow-y-auto flex-1">{children}</div>
        {footer && <div className="px-5 py-3 border-t border-line flex flex-wrap gap-2 justify-end">{footer}</div>}
      </aside>
    </div>
  );
}

/** Dialog alasan wajib (min. 10 karakter) untuk void, batal, tolak, koreksi, ubah harga (PRD 7.4). */
export function ReasonDialog({ open, title, message, confirmLabel, danger = true, onConfirm, onClose, extra }:
  { open: boolean; title: string; message?: ReactNode; confirmLabel: string; danger?: boolean; onConfirm: (reason: string) => Promise<void>; onClose: () => void; extra?: ReactNode }) {
  const [reason, setReason] = useState('');
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState('');
  useEffect(() => { if (open) { setReason(''); setError(''); setBusy(false); } }, [open]);
  const valid = reason.trim().length >= 10;
  const submit = async () => {
    setBusy(true); setError('');
    try { await onConfirm(reason.trim()); } catch (e) { setError(errMsg(e)); } finally { setBusy(false); }
  };
  return (
    <Modal open={open} title={title} onClose={onClose} size="sm" footer={
      <>
        <button className="btn-outline" onClick={onClose} disabled={busy}>Kembali</button>
        <button className={danger ? 'btn-danger' : 'btn-primary'} disabled={!valid || busy} onClick={submit}>{busy && <Spinner />}{confirmLabel}</button>
      </>}>
      <div className="space-y-3">
        {message && <p className="text-sm text-ink">{message}</p>}
        {extra}
        <Field label="Alasan (wajib, minimal 10 karakter)" error={error}>
          {(id) => <textarea id={id} className="input py-2" rows={3} value={reason} onChange={(e) => setReason(e.target.value)} />}
        </Field>
        <p className="text-xs text-ink-soft tnum">{reason.trim().length}/10 karakter</p>
      </div>
    </Modal>
  );
}
export function ConfirmDialog({ open, title, message, confirmLabel, onConfirm, onClose }: { open: boolean; title: string; message: ReactNode; confirmLabel: string; onConfirm: () => Promise<void> | void; onClose: () => void }) {
  const [busy, setBusy] = useState(false);
  return (
    <Modal open={open} title={title} onClose={onClose} size="sm" footer={
      <>
        <button className="btn-outline" onClick={onClose}>Batal</button>
        <button className="btn-primary" disabled={busy} onClick={async () => { setBusy(true); try { await onConfirm(); } finally { setBusy(false); } }}>{busy && <Spinner />}{confirmLabel}</button>
      </>}>
      <p className="text-sm">{message}</p>
    </Modal>
  );
}

/* ---------- Tab, paginasi, tabel ---------- */
export function Tabs<T extends string>({ tabs, value, onChange }: { tabs: { id: T; label: string }[]; value: T; onChange: (v: T) => void }) {
  return (
    <div role="tablist" className="flex gap-1 border-b border-line overflow-x-auto">
      {tabs.map((t) => (
        <button key={t.id} role="tab" aria-selected={value === t.id} onClick={() => onChange(t.id)}
          className={`px-4 min-h-[44px] text-sm font-bold whitespace-nowrap border-b-[3px] -mb-px transition ${value === t.id ? 'border-[var(--teal-action)] text-[var(--teal-action)]' : 'border-transparent text-ink-soft hover:text-ink'}`}>
          {t.label}
        </button>
      ))}
    </div>
  );
}
export function Pagination({ page, size, total, onPage }: { page: number; size: number; total: number; onPage: (p: number) => void }) {
  const pages = Math.max(1, Math.ceil(total / size));
  if (total <= size) return total ? <p className="text-xs text-ink-soft px-1 pt-3">{total} data</p> : null;
  return (
    <div className="flex items-center justify-between gap-2 pt-3 text-sm">
      <span className="text-ink-soft tnum">Halaman {page} dari {pages} • {total} data</span>
      <div className="flex gap-2">
        <button className="btn-outline btn-sm" disabled={page <= 1} onClick={() => onPage(page - 1)} aria-label="Halaman sebelumnya"><ChevronLeft size={16} /></button>
        <button className="btn-outline btn-sm" disabled={page >= pages} onClick={() => onPage(page + 1)} aria-label="Halaman berikutnya"><ChevronRight size={16} /></button>
      </div>
    </div>
  );
}

export interface Col<T> { key: string; header: string; render: (r: T) => ReactNode; align?: 'right' | 'left'; mobile?: 'title' | 'hide' | 'show' }
/** Tabel di layar lebar; daftar kartu di ponsel (PRD 7.3). Header lekat saat gulir, baris zebra halus. */
export function DataTable<T>({ cols, rows, rowKey, onRowClick, rowClass }: { cols: Col<T>[]; rows: T[]; rowKey: (r: T) => string | number; onRowClick?: (r: T) => void; rowClass?: (r: T) => string }) {
  const title = cols.find((c) => c.mobile === 'title') ?? cols[0];
  return (
    <>
      <div className="hidden md:block overflow-auto max-h-[70vh] rounded-ctl border border-line">
        <table className="w-full border-collapse">
          <thead className="sticky top-0 z-10">
            <tr>{cols.map((c) => <th key={c.key} className={`th ${c.align === 'right' ? 'text-right' : ''}`}>{c.header}</th>)}</tr>
          </thead>
          <tbody>
            {rows.map((r, i) => (
              <tr key={rowKey(r)} onClick={onRowClick ? () => onRowClick(r) : undefined}
                className={`${i % 2 ? 'bg-[#FAFCFC]' : 'bg-white'} ${onRowClick ? 'cursor-pointer hover:bg-teal-tint' : ''} ${rowClass?.(r) ?? ''}`}>
                {cols.map((c) => <td key={c.key} className={`td ${c.align === 'right' ? 'text-right' : ''}`}>{c.render(r)}</td>)}
              </tr>
            ))}
          </tbody>
        </table>
      </div>
      <ul className="md:hidden space-y-3">
        {rows.map((r) => (
          <li key={rowKey(r)} onClick={onRowClick ? () => onRowClick(r) : undefined}
            className={`rounded-ctl border border-line bg-white p-3 ${onRowClick ? 'active:bg-teal-tint' : ''} ${rowClass?.(r) ?? ''}`}>
            <div className="font-bold text-ink mb-2">{title.render(r)}</div>
            <dl className="grid grid-cols-2 gap-x-3 gap-y-1.5 text-sm">
              {cols.filter((c) => c !== title && c.mobile !== 'hide').map((c) => (
                <div key={c.key} className="min-w-0"><dt className="text-xs text-ink-soft">{c.header}</dt><dd className="break-words">{c.render(r)}</dd></div>
              ))}
            </dl>
          </li>
        ))}
      </ul>
    </>
  );
}

export function PageHeaderBar({ children }: { children: ReactNode }) { return <div className="flex flex-wrap items-end gap-3 mb-4">{children}</div>; }

export function KpiCard({ icon, label, value, hint, tone = 'teal', onClick }: { icon: ReactNode; label: string; value: ReactNode; hint?: string; tone?: 'teal' | 'gold'; onClick?: () => void }) {
  const Tag: any = onClick ? 'button' : 'div';
  return (
    <Tag onClick={onClick} className={`card p-4 text-left flex flex-col gap-2 ${onClick ? 'hover:shadow-md transition cursor-pointer' : ''}`}>
      <div className="flex items-center gap-3">
        <span className={`h-10 w-10 rounded-full flex items-center justify-center shrink-0 ${tone === 'gold' ? 'bg-gold-tint text-[#9A6200]' : 'bg-teal-tint text-teal-dark'}`}>{icon}</span>
        <span className="text-xs font-bold text-ink-soft leading-tight">{label}</span>
      </div>
      <div className="kpi-value text-[26px] leading-8 font-bold text-teal-dark break-words">{value}</div>
      {hint && <div className="text-xs text-ink-soft">{hint}</div>}
    </Tag>
  );
}
