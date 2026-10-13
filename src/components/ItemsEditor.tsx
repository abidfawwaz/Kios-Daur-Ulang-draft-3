import { Plus, Trash2 } from 'lucide-react';
import { num, rp } from '../lib/format';

export interface CatalogRow { id: number; nama: string; unit: 'kg' | 'unit'; is_active: number; kategori: string; price: number | null; freq: number }
export interface ItemDraft { key: number; waste_type_id: string; qty: string }

let k = 1;
export const newItem = (): ItemDraft => ({ key: k++, waste_type_id: '', qty: '' });

export function itemTotals(items: ItemDraft[], catalog: CatalogRow[], priceOverride?: Map<number, number>) {
  let total = 0, kgSum = 0, units = 0;
  const lines = items.map((it) => {
    const wt = catalog.find((c) => String(c.id) === it.waste_type_id);
    const qty = Number(it.qty.replace(',', '.'));
    const price = wt ? priceOverride?.get(wt.id) ?? wt.price ?? 0 : 0;
    const valid = !!wt && Number.isFinite(qty) && qty > 0 && (wt.unit === 'kg' ? Math.abs(qty * 100 - Math.round(qty * 100)) < 1e-6 : Number.isInteger(qty));
    const sub = valid ? Math.round(qty * price) : 0;
    if (valid) { total += sub; if (wt!.unit === 'kg') kgSum += qty; else units += qty; }
    return { wt, qty, price, sub, valid };
  });
  return { lines, total, kg: kgSum, units, allValid: items.length > 0 && lines.every((l) => l.valid) };
}

export function ItemsEditor({ items, onChange, catalog, priceOverride }: { items: ItemDraft[]; onChange: (i: ItemDraft[]) => void; catalog: CatalogRow[]; priceOverride?: Map<number, number> }) {
  const t = itemTotals(items, catalog, priceOverride);
  const freq = [...catalog].filter((c) => c.freq > 0).sort((a, b) => b.freq - a.freq).slice(0, 5);
  const cats = [...new Set(catalog.map((c) => c.kategori))];
  const set = (key: number, patch: Partial<ItemDraft>) => onChange(items.map((i) => (i.key === key ? { ...i, ...patch } : i)));

  return (
    <div className="space-y-3">
      {items.map((it, idx) => {
        const l = t.lines[idx];
        const unit = l.wt?.unit ?? 'kg';
        const bad = it.qty !== '' && !l.valid && !!l.wt;
        return (
          <div key={it.key} className="rounded-ctl border border-line p-3 bg-white">
            <div className="grid grid-cols-12 gap-2 items-start">
              <div className="col-span-12 sm:col-span-5">
                <label className="label" htmlFor={`jenis-${it.key}`}>Jenis sampah</label>
                <select id={`jenis-${it.key}`} className="input" value={it.waste_type_id} onChange={(e) => set(it.key, { waste_type_id: e.target.value })}>
                  <option value="">Pilih jenis…</option>
                  {freq.length > 0 && <optgroup label="Sering dipakai">{freq.map((c) => <option key={`f${c.id}`} value={c.id}>{c.nama}</option>)}</optgroup>}
                  {cats.map((cat) => <optgroup key={cat} label={cat}>{catalog.filter((c) => c.kategori === cat).map((c) => <option key={c.id} value={c.id}>{c.nama}{c.unit === 'unit' ? ' (per unit)' : ''}</option>)}</optgroup>)}
                </select>
              </div>
              <div className="col-span-6 sm:col-span-3">
                <label className="label" htmlFor={`qty-${it.key}`}>Jumlah ({unit})</label>
                <div className="relative">
                  <input id={`qty-${it.key}`} className={`input pr-12 tnum ${bad ? 'border-danger' : ''}`} inputMode="decimal" placeholder={unit === 'kg' ? '0,00' : '0'} value={it.qty}
                    onChange={(e) => set(it.key, { qty: e.target.value.replace(/[^0-9.,]/g, '') })} aria-invalid={bad} />
                  <span className="absolute right-3 top-1/2 -translate-y-1/2 text-sm text-ink-soft">{unit}</span>
                </div>
                {bad && <p className="text-xs text-danger font-bold mt-1">{unit === 'kg' ? 'Maks. 2 desimal, lebih dari 0.' : 'Bilangan bulat ≥ 1.'}</p>}
              </div>
              <div className="col-span-6 sm:col-span-3">
                <span className="label">Harga terkunci</span>
                <div className="min-h-[44px] flex flex-col justify-center text-sm tnum">{l.wt ? <><span>{rp(l.price)}/{unit}</span><span className="font-bold text-teal-dark">{rp(l.sub)}</span></> : <span className="text-ink-soft">—</span>}</div>
              </div>
              <div className="col-span-12 sm:col-span-1 flex sm:justify-end sm:pt-6">
                <button type="button" className="btn-ghost btn-sm text-danger" onClick={() => onChange(items.length > 1 ? items.filter((i) => i.key !== it.key) : [newItem()])} aria-label={`Hapus item ${idx + 1}`}><Trash2 size={16} /></button>
              </div>
            </div>
          </div>
        );
      })}
      <button type="button" className="btn-outline btn-sm" onClick={() => onChange([...items, newItem()])}><Plus size={16} />Tambah Item</button>
      <p className="text-xs text-ink-soft">Total: <strong className="tnum text-ink">{rp(t.total)}</strong>{t.kg > 0 && <> • {num(t.kg)} kg</>}{t.units > 0 && <> • {num(t.units)} unit</>}</p>
    </div>
  );
}
