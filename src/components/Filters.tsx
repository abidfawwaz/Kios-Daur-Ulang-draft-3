import { useState } from 'react';
import { useAuth } from '../lib/auth';
import { addDays, todayWib } from '../lib/format';

export type Preset = 'all' | '30d' | 'month' | 'custom';
export interface Period { preset: Preset; from: string; to: string }
export const defaultPeriod: Period = { preset: 'all', from: '', to: '' };

export function periodRange(p: Period): { from: string; to: string } {
  const today = todayWib();
  if (p.preset === '30d') return { from: addDays(today, -29), to: today };
  if (p.preset === 'month') return { from: today.slice(0, 8) + '01', to: today };
  if (p.preset === 'custom') return { from: p.from, to: p.to };
  return { from: '', to: '' };
}
export const usePeriod = () => useState<Period>(defaultPeriod);

export function PeriodFilter({ value, onChange }: { value: Period; onChange: (p: Period) => void }) {
  return (
    <div className="flex flex-wrap items-end gap-2">
      <div>
        <label className="label" htmlFor="f-periode">Periode</label>
        <select id="f-periode" className="input" value={value.preset} onChange={(e) => onChange({ ...value, preset: e.target.value as Preset })}>
          <option value="all">Semua waktu</option><option value="30d">30 hari terakhir</option><option value="month">Bulan ini</option><option value="custom">Pilih tanggal…</option>
        </select>
      </div>
      {value.preset === 'custom' && (
        <>
          <div><label className="label" htmlFor="f-dari">Dari</label><input id="f-dari" type="date" className="input" max={todayWib()} value={value.from} onChange={(e) => onChange({ ...value, from: e.target.value })} /></div>
          <div><label className="label" htmlFor="f-sampai">Sampai</label><input id="f-sampai" type="date" className="input" max={todayWib()} value={value.to} onChange={(e) => onChange({ ...value, to: e.target.value })} /></div>
        </>
      )}
    </div>
  );
}

export function LocationSelect({ value, onChange, label = 'Lokasi' }: { value: string; onChange: (v: string) => void; label?: string }) {
  const { user, meta } = useAuth();
  if (user?.role === 'admin_lokasi') return null; // terkunci ke lokasinya sendiri
  return (
    <div>
      <label className="label" htmlFor="f-lokasi">{label}</label>
      <select id="f-lokasi" className="input" value={value} onChange={(e) => onChange(e.target.value)}>
        <option value="">Semua lokasi</option>
        {meta?.locations.map((l) => <option key={l.id} value={l.id}>{l.nama}{l.is_active ? '' : ' (nonaktif)'}</option>)}
      </select>
    </div>
  );
}
