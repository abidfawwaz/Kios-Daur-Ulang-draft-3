import { useEffect, useMemo, useState } from 'react';
import { useSearchParams } from 'react-router-dom';
import { Download, Eye, Pencil, Plus, Search, Tag, UserPlus, Ban, Save } from 'lucide-react';
import { api, downloadFile, qs, useApi } from '../lib/api';
import { useAuth } from '../lib/auth';
import { fmtDate, num, rp, todayWib } from '../lib/format';
import { Alert, Badge, Card, ConfirmDialog, DataTable, Col, EmptyState, EligibleBadge, Field, Loadable, Modal, Pagination, Progress, ReasonDialog, Spinner, Tabs, TrxBadge, errMsg, useToast } from '../components/ui';
import { CatalogRow, ItemDraft, ItemsEditor, itemTotals, newItem } from '../components/ItemsEditor';
import { CustomerFormModal } from '../components/CustomerForm';
import { ReceiptDialog } from '../components/Receipt';
import { LocationSelect, PeriodFilter, periodRange, usePeriod } from '../components/Filters';

type Tab = 'buat' | 'riwayat' | 'struk';

export default function Transactions() {
  const { user } = useAuth();
  const isLoc = user!.role === 'admin_lokasi';
  const [tab, setTab] = useState<Tab>(isLoc ? 'buat' : 'riwayat');
  return (
    <div className="space-y-4">
      {isLoc && <Tabs<Tab> value={tab} onChange={setTab} tabs={[{ id: 'buat', label: 'Buat Transaksi' }, { id: 'riwayat', label: 'Riwayat' }, { id: 'struk', label: 'Struk' }]} />}
      {tab === 'buat' && isLoc && <CreateTransaction />}
      {tab === 'riwayat' && <History />}
      {tab === 'struk' && isLoc && <Receipts />}
    </div>
  );
}

/* ------------------------------ Buat transaksi ------------------------------ */
const DRAFT = 'bsi-kios-draft-trx';
function CreateTransaction() {
  const { meta } = useAuth();
  const toast = useToast();
  const [params] = useSearchParams();
  const catalog = useApi<{ rows: CatalogRow[] }>('/waste-types');
  const active = useMemo(() => (catalog.data?.rows ?? []).filter((r) => r.is_active), [catalog.data]);

  const [cust, setCust] = useState<any>(null);
  const [q, setQ] = useState('');
  const [results, setResults] = useState<any[]>([]);
  const [searching, setSearching] = useState(false);
  const [date, setDate] = useState(todayWib());
  const [backReason, setBackReason] = useState('');
  const [items, setItems] = useState<ItemDraft[]>([newItem()]);
  const [saving, setSaving] = useState(false);
  const [showNewCust, setShowNewCust] = useState(false);
  const [showPrices, setShowPrices] = useState(false);
  const [confirm, setConfirm] = useState<{ msg: string; flags: Record<string, boolean> } | null>(null);
  const [done, setDone] = useState<{ id: number; trx_no: string } | null>(null);

  const min = meta!.settings.min_conversion;
  const t = itemTotals(items, active);
  const daysBack = Math.round((Date.parse(todayWib()) - Date.parse(date)) / 86400e3);
  const needBackReason = daysBack > meta!.settings.backdate_days;
  const futureDate = date > todayWib();
  const valid = !!cust && t.allValid && !futureDate && (!needBackReason || backReason.trim().length >= 10);

  // Draft sementara di perangkat agar data tidak hilang saat koneksi bermasalah (R-04)
  useEffect(() => {
    try {
      const d = JSON.parse(localStorage.getItem(DRAFT) ?? 'null');
      if (d?.items?.length) setItems(d.items.map((i: any) => ({ ...newItem(), waste_type_id: i.waste_type_id, qty: i.qty })));
      if (d?.date) setDate(d.date);
      if (d?.customerId && !params.get('customer')) api<any>(`/customers/${d.customerId}`).then((r) => setCust(r.customer)).catch(() => {});
    } catch { /* abaikan */ }
    const pre = params.get('customer');
    if (pre) api<any>(`/customers/${pre}`).then((r) => setCust(r.customer)).catch(() => {});
  }, []); // eslint-disable-line
  useEffect(() => {
    try { localStorage.setItem(DRAFT, JSON.stringify({ customerId: cust?.id, date, items: items.map((i) => ({ waste_type_id: i.waste_type_id, qty: i.qty })) })); } catch { /* abaikan */ }
  }, [cust, date, items]);

  useEffect(() => {
    if (cust) return;
    setSearching(true);
    const h = setTimeout(() => api<any>(`/customers${qs({ q, size: 6, sort: q ? 'nama' : 'terbaru' })}`).then((r) => setResults(r.rows)).catch(() => setResults([])).finally(() => setSearching(false)), 300);
    return () => clearTimeout(h);
  }, [q, cust]);

  const reset = () => {
    setCust(null); setQ(''); setItems([newItem()]); setDate(todayWib()); setBackReason(''); setDone(null);
    try { localStorage.removeItem(DRAFT); } catch { /* abaikan */ }
  };

  const submit = async (flags: Record<string, boolean> = {}) => {
    setSaving(true); setConfirm(null);
    try {
      const r = await api<any>('/transactions', { method: 'POST', body: {
        customer_id: cust.id, trx_date: date, backdate_reason: needBackReason ? backReason.trim() : undefined,
        items: t.lines.map((l) => ({ waste_type_id: l.wt!.id, qty: l.qty })), ...flags } });
      setDone({ id: r.id, trx_no: r.trx_no });
      toast.ok(`Transaksi ${r.trx_no} tersimpan.`);
      try { localStorage.removeItem(DRAFT); } catch { /* abaikan */ }
    } catch (e: any) {
      if (e.code === 'DUPLICATE') setConfirm({ msg: e.message, flags: { ...flags, confirm_duplicate: true } });
      else if (e.code === 'LARGE_QTY') setConfirm({ msg: e.message, flags: { ...flags, confirm_large: true } });
      else toast.err(errMsg(e));
    } finally { setSaving(false); }
  };

  const before = cust?.saldo ?? 0;
  const after = before + t.total;
  const kurang = Math.max(0, min - after);

  return (
    <div className="grid lg:grid-cols-[1fr_340px] gap-4 items-start pb-20 lg:pb-0">
      <div className="space-y-4">
        <Card className="p-4">
          <h2 className="font-bold text-lg mb-3"><span className="inline-flex h-6 w-6 rounded-full bg-teal text-white text-sm items-center justify-center mr-2">1</span>Pilih Nasabah</h2>
          {cust ? (
            <div className="rounded-ctl border border-teal bg-teal-tint p-3 flex items-center justify-between gap-3">
              <div className="min-w-0"><p className="font-bold truncate">{cust.nama}</p><p className="text-sm text-ink-soft tnum">{cust.whatsapp} • Saldo {rp(cust.saldo)}</p></div>
              <button className="btn-outline btn-sm" onClick={() => setCust(null)}>Ganti</button>
            </div>
          ) : (
            <div className="space-y-3">
              <div className="flex gap-2">
                <div className="relative flex-1"><Search size={16} className="absolute left-3 top-1/2 -translate-y-1/2 text-ink-soft" /><input className="input pl-9" placeholder="Cari nama atau nomor WhatsApp" aria-label="Cari nasabah" value={q} onChange={(e) => setQ(e.target.value)} /></div>
                <button className="btn-outline" onClick={() => setShowNewCust(true)}><UserPlus size={16} />Nasabah Baru</button>
              </div>
              {searching && !results.length ? <p className="text-sm text-ink-soft flex gap-2 items-center"><Spinner />Mencari…</p> : results.length === 0 ? (
                <p className="text-sm text-ink-soft">{q ? 'Tidak ada nasabah yang cocok. Tekan "Nasabah Baru" untuk menambahkan.' : 'Belum ada nasabah. Tambahkan dengan tombol "Nasabah Baru".'}</p>
              ) : (
                <ul className="divide-y divide-line rounded-ctl border border-line">
                  {results.map((r) => (
                    <li key={r.id}><button className="w-full text-left px-3 py-2.5 hover:bg-teal-tint flex justify-between gap-3 items-center min-h-[52px]" onClick={() => setCust(r)}>
                      <span className="min-w-0"><span className="font-bold block truncate">{r.nama}</span><span className="text-xs text-ink-soft tnum">{r.whatsapp}</span></span>
                      <span className="text-right shrink-0"><span className="block text-sm font-bold tnum">{rp(r.saldo)}</span>{r.eligible && <EligibleBadge eligible />}</span>
                    </button></li>
                  ))}
                </ul>
              )}
            </div>
          )}
        </Card>

        <Card className="p-4 space-y-4">
          <div className="flex items-center justify-between gap-2 flex-wrap">
            <h2 className="font-bold text-lg"><span className="inline-flex h-6 w-6 rounded-full bg-teal text-white text-sm items-center justify-center mr-2">2</span>Detail Sampah</h2>
            <button className="btn-ghost btn-sm" onClick={() => setShowPrices(true)}><Tag size={16} />Lihat daftar harga</button>
          </div>
          <Field label="Tanggal setoran" error={futureDate ? 'Tanggal tidak boleh di masa depan.' : null}>{(id) => <input id={id} type="date" className="input max-w-[220px]" max={todayWib()} value={date} onChange={(e) => setDate(e.target.value)} />}</Field>
          {needBackReason && <Field label={`Alasan tanggal mundur (> ${meta!.settings.backdate_days} hari)`} hint="Minimal 10 karakter.">{(id) => <textarea id={id} className="input py-2" rows={2} value={backReason} onChange={(e) => setBackReason(e.target.value)} />}</Field>}
          <Loadable loading={catalog.loading} error={catalog.error} reload={catalog.reload} hasData={!!catalog.data} rows={3}>
            <ItemsEditor items={items} onChange={setItems} catalog={active} />
          </Loadable>
        </Card>
      </div>

      {/* Ringkasan & panel saldo (menempel) */}
      <aside className="lg:sticky lg:top-24 space-y-4">
        <Card className="p-4 space-y-3">
          <h2 className="font-bold text-lg">Ringkasan</h2>
          <dl className="text-sm space-y-1.5 tnum">
            <div className="flex justify-between"><dt className="text-ink-soft">Jumlah item</dt><dd>{t.lines.filter((l) => l.valid).length}</dd></div>
            <div className="flex justify-between"><dt className="text-ink-soft">Total berat</dt><dd>{num(t.kg)} kg{t.units > 0 && ` + ${num(t.units)} unit`}</dd></div>
            <div className="flex justify-between text-base font-bold text-teal-dark border-t border-line pt-2"><dt>Total nilai</dt><dd>{rp(t.total)}</dd></div>
          </dl>
          <div className="rounded-ctl bg-gold-tint border border-gold p-3 space-y-2">
            <p className="text-xs font-bold text-ink-soft uppercase">Saldo nasabah</p>
            {cust ? (
              <>
                <dl className="text-sm space-y-1 tnum">
                  <div className="flex justify-between"><dt>Sebelumnya</dt><dd>{rp(before)}</dd></div>
                  <div className="flex justify-between"><dt>Tambahan hari ini</dt><dd>+ {rp(t.total)}</dd></div>
                  <div className="flex justify-between font-bold"><dt>Saldo terbaru</dt><dd>{rp(after)}</dd></div>
                </dl>
                <Progress value={after / min} />
                <p className="text-sm font-bold">{kurang === 0 ? 'Siap dikonversi menjadi Tabungan Emas.' : `Kurang ${rp(kurang)} menuju minimum konversi.`}</p>
              </>
            ) : <p className="text-sm text-ink-soft">Pilih nasabah untuk melihat saldo dan kelayakan konversi.</p>}
          </div>
          <button className="btn-primary w-full min-h-[48px] hidden lg:flex" disabled={!valid || saving} onClick={() => submit()}>{saving ? <Spinner /> : <Save size={18} />}Simpan Transaksi</button>
        </Card>
      </aside>

      {/* Tombol simpan menempel di bawah layar pada ponsel */}
      <div className="lg:hidden fixed bottom-[60px] inset-x-0 z-30 p-3 bg-white border-t border-line">
        <button className="btn-primary w-full min-h-[48px]" disabled={!valid || saving} onClick={() => submit()}>{saving ? <Spinner /> : <Save size={18} />}Simpan Transaksi • {rp(t.total)}</button>
      </div>

      <CustomerFormModal open={showNewCust} onClose={() => setShowNewCust(false)} onSaved={async (id) => { setShowNewCust(false); const r = await api<any>(`/customers/${id}`); setCust(r.customer); }} />
      <PriceListModal open={showPrices} onClose={() => setShowPrices(false)} rows={active} />
      <ConfirmDialog open={!!confirm} title="Konfirmasi sebelum menyimpan" message={confirm?.msg} confirmLabel="Tetap simpan" onClose={() => setConfirm(null)} onConfirm={() => submit(confirm!.flags)} />
      <ReceiptDialog kind="trx" id={done?.id ?? null} onClose={reset}
        footerExtra={<button className="btn-outline btn-sm" onClick={reset}><Plus size={16} />Transaksi Baru</button>} />
    </div>
  );
}

function PriceListModal({ open, onClose, rows }: { open: boolean; onClose: () => void; rows: CatalogRow[] }) {
  const cats = [...new Set(rows.map((r) => r.kategori))];
  return (
    <Modal open={open} onClose={onClose} title="Daftar Harga Sampah" footer={<button className="btn-primary" onClick={onClose}>Tutup</button>}>
      <p className="text-xs text-ink-soft mb-3">Panel baca saja. Harga dikunci saat transaksi disimpan.</p>
      {cats.map((c) => (
        <div key={c} className="mb-3"><h3 className="text-sm font-bold text-teal-dark mb-1">{c}</h3>
          <ul className="divide-y divide-line border border-line rounded-ctl">{rows.filter((r) => r.kategori === c).map((r) => <li key={r.id} className="flex justify-between px-3 py-2 text-sm"><span>{r.nama}</span><span className="tnum font-bold">{rp(r.price)}/{r.unit}</span></li>)}</ul></div>
      ))}
    </Modal>
  );
}

/* ------------------------------ Riwayat ------------------------------ */
function History() {
  const { user, meta } = useAuth();
  const toast = useToast();
  const isLoc = user!.role === 'admin_lokasi';
  const [period, setPeriod] = usePeriod();
  const [loc, setLoc] = useState('');
  const [search, setSearch] = useState('');
  const [status, setStatus] = useState('');
  const [page, setPage] = useState(1);
  const { from, to } = periodRange(period);
  const params = qs({ from, to, q: search, status, location_id: loc, page });
  const { data, loading, error, reload } = useApi<any>(`/transactions${params}`);
  const [receipt, setReceipt] = useState<number | null>(null);
  const [voiding, setVoiding] = useState<any>(null);
  const [editing, setEditing] = useState<number | null>(null);
  useEffect(() => setPage(1), [period, loc, search, status]);

  const cols: Col<any>[] = [
    { key: 'no', header: 'Nomor', mobile: 'title', render: (r) => <span className={r.status === 'void' ? 'line-through text-ink-soft' : 'font-bold'}>{r.trx_no}</span> },
    { key: 'tgl', header: 'Tanggal', render: (r) => fmtDate(r.trx_date) },
    ...(!isLoc ? [{ key: 'lok', header: 'Lokasi', render: (r: any) => r.location_nama } as Col<any>] : []),
    { key: 'nas', header: 'Nasabah', render: (r) => r.customer_nama },
    { key: 'item', header: 'Item', mobile: 'hide', render: (r) => <span className="text-ink-soft line-clamp-1 max-w-[220px]" title={r.ringkasan}>{r.ringkasan}</span> },
    { key: 'tot', header: 'Total', align: 'right', render: (r) => <span className={r.status === 'void' ? 'line-through text-ink-soft' : ''}>{rp(r.total_idr)}</span> },
    { key: 'st', header: 'Status', render: (r) => <TrxBadge status={r.status} /> },
    { key: 'aksi', header: 'Aksi', render: (r) => (
      <div className="flex gap-1" onClick={(e) => e.stopPropagation()}>
        <button className="btn-ghost btn-sm" onClick={() => setReceipt(r.id)} aria-label={`Lihat struk ${r.trx_no}`}><Eye size={16} /><span className="md:sr-only">Struk</span></button>
        {isLoc && r.status === 'sukses' && <>
          <button className="btn-ghost btn-sm" onClick={() => setEditing(r.id)} aria-label={`Edit ${r.trx_no}`}><Pencil size={16} /><span className="md:sr-only">Edit</span></button>
          <button className="btn-ghost btn-sm text-danger" onClick={() => setVoiding(r)} aria-label={`Void ${r.trx_no}`}><Ban size={16} /><span className="md:sr-only">Void</span></button></>}
      </div>) },
  ];

  return (
    <div className="space-y-4">
      <Card className="p-4">
        <div className="flex flex-wrap items-end gap-3">
          <div className="flex-1 min-w-[200px]"><label className="label" htmlFor="h-q">Cari</label><div className="relative"><Search size={16} className="absolute left-3 top-1/2 -translate-y-1/2 text-ink-soft" /><input id="h-q" className="input pl-9" placeholder="Nomor transaksi atau nama nasabah" value={search} onChange={(e) => setSearch(e.target.value)} /></div></div>
          <PeriodFilter value={period} onChange={setPeriod} />
          <LocationSelect value={loc} onChange={setLoc} />
          <div><label className="label" htmlFor="h-st">Status</label><select id="h-st" className="input" value={status} onChange={(e) => setStatus(e.target.value)}><option value="">Semua</option><option value="sukses">Sukses</option><option value="void">Void</option></select></div>
          <button className="btn-outline" onClick={() => downloadFile(`/transactions/export${params}`).catch((e) => toast.err(errMsg(e)))}><Download size={16} />Excel</button>
        </div>
      </Card>
      {!isLoc && <Alert tone="teal">Tampilan baca saja. Pencatatan, edit, dan void transaksi dilakukan oleh Admin Lokasi.</Alert>}
      <Card className="p-4">
        <Loadable loading={loading} error={error} reload={reload} hasData={!!data} empty={!data?.rows.length}
          emptyNode={<EmptyState title="Belum ada transaksi" text={search || status || from ? 'Tidak ada transaksi pada filter ini.' : 'Belum ada transaksi. Mulai catat setoran pertama dari menu Transaksi.'} />}>
          {data && (<>
            <p className="text-sm text-ink-soft mb-3">Nilai transaksi sukses pada filter: <strong className="text-teal-dark tnum">{rp(data.nilai)}</strong></p>
            <DataTable cols={cols} rows={data.rows} rowKey={(r) => r.id} onRowClick={(r) => setReceipt(r.id)} rowClass={(r) => (r.status === 'void' ? 'opacity-70' : '')} />
            <Pagination page={data.page} size={data.size} total={data.total} onPage={setPage} />
          </>)}
        </Loadable>
      </Card>
      <ReceiptDialog kind="trx" id={receipt} onClose={() => setReceipt(null)} />
      <ReasonDialog open={!!voiding} title="Void transaksi" confirmLabel="Void transaksi" onClose={() => setVoiding(null)}
        message={voiding && `Batalkan transaksi ${voiding.trx_no}? Saldo ${voiding.customer_nama} akan berkurang ${rp(voiding.total_idr)}. Tindakan ini tercatat dan tidak dapat dihapus.`}
        onConfirm={async (reason) => { await api(`/transactions/${voiding.id}/void`, { method: 'POST', body: { reason } }); toast.ok('Transaksi di-void.'); setVoiding(null); reload(); }} />
      {editing && <EditTransaction id={editing} onClose={() => setEditing(null)} onSaved={() => { setEditing(null); reload(); }} />}
      <span className="sr-only">{meta?.today}</span>
    </div>
  );
}

function EditTransaction({ id, onClose, onSaved }: { id: number; onClose: () => void; onSaved: () => void }) {
  const toast = useToast();
  const trx = useApi<any>(`/transactions/${id}`);
  const catalog = useApi<{ rows: CatalogRow[] }>('/waste-types');
  const [items, setItems] = useState<ItemDraft[]>([]);
  const [reason, setReason] = useState('');
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState('');
  const [confirm, setConfirm] = useState(false);
  useEffect(() => { if (trx.data) setItems(trx.data.items.map((i: any) => ({ ...newItem(), waste_type_id: String(i.waste_type_id), qty: String(i.qty) }))); }, [trx.data]);
  const usedIds = new Set<number>((trx.data?.items ?? []).map((i: any) => i.waste_type_id));
  const rows = (catalog.data?.rows ?? []).filter((r) => r.is_active || usedIds.has(r.id));
  const priceMap = new Map<number, number>((trx.data?.items ?? []).map((i: any) => [i.waste_type_id, i.price]));
  const t = itemTotals(items, rows, priceMap);
  const save = async (flags: any = {}) => {
    setBusy(true); setError(''); setConfirm(false);
    try {
      await api(`/transactions/${id}`, { method: 'PUT', body: { reason: reason.trim(), items: t.lines.map((l) => ({ waste_type_id: l.wt!.id, qty: l.qty })), ...flags } });
      toast.ok('Transaksi diperbarui.'); onSaved();
    } catch (e: any) { if (e.code === 'LARGE_QTY') setConfirm(true); else setError(errMsg(e)); } finally { setBusy(false); }
  };
  return (
    <Modal open onClose={onClose} title={`Edit ${trx.data?.trx_no ?? 'transaksi'}`} size="lg" footer={
      <><button className="btn-outline" onClick={onClose}>Batal</button><button className="btn-primary" disabled={busy || !t.allValid || reason.trim().length < 10} onClick={() => save()}>{busy && <Spinner />}Simpan perubahan</button></>}>
      <Loadable loading={trx.loading || catalog.loading} error={trx.error || catalog.error} reload={trx.reload} hasData={!!trx.data && !!catalog.data}>
        <div className="space-y-4">
          <p className="text-sm text-ink-soft">Nasabah dan tanggal tidak dapat diubah (void lalu buat ulang bila perlu). Harga item yang sudah ada tetap terkunci.</p>
          {error && <Alert tone="danger">{error}</Alert>}
          <ItemsEditor items={items} onChange={setItems} catalog={rows} priceOverride={priceMap} />
          <Field label="Alasan perubahan (wajib, minimal 10 karakter)">{(i) => <textarea id={i} className="input py-2" rows={2} value={reason} onChange={(e) => setReason(e.target.value)} />}</Field>
        </div>
      </Loadable>
      <ConfirmDialog open={confirm} title="Konfirmasi jumlah besar" message="Jumlah satu item melebihi batas peringatan. Pastikan angka sudah benar." confirmLabel="Tetap simpan" onClose={() => setConfirm(false)} onConfirm={() => save({ confirm_large: true })} />
    </Modal>
  );
}

/* ------------------------------ Struk ------------------------------ */
function Receipts() {
  const [sub, setSub] = useState<'trx' | 'cnv'>('trx');
  const [search, setSearch] = useState('');
  const [page, setPage] = useState(1);
  const trx = useApi<any>(`/transactions${qs({ q: search, status: 'sukses', page })}`);
  const cnv = useApi<any>(`/receipts/conversions${qs({ q: search })}`);
  const [open, setOpen] = useState<{ kind: 'trx' | 'cnv'; id: number } | null>(null);
  useEffect(() => setPage(1), [search]);
  return (
    <div className="space-y-4">
      <Card className="p-4 space-y-3">
        <Tabs<'trx' | 'cnv'> value={sub} onChange={setSub} tabs={[{ id: 'trx', label: `Struk Transaksi (${trx.data?.total ?? 0})` }, { id: 'cnv', label: `Struk Konversi (${cnv.data?.rows.length ?? 0})` }]} />
        <div className="relative"><Search size={16} className="absolute left-3 top-1/2 -translate-y-1/2 text-ink-soft" /><input className="input pl-9" placeholder="Cari nomor atau nama nasabah" aria-label="Cari struk" value={search} onChange={(e) => setSearch(e.target.value)} /></div>
        {sub === 'trx' ? (
          <Loadable loading={trx.loading} error={trx.error} reload={trx.reload} hasData={!!trx.data} empty={!trx.data?.rows.length} emptyNode={<EmptyState title="Belum ada struk" text="Struk muncul setelah transaksi disimpan." />}>
            {trx.data && (<>
              <DataTable rows={trx.data.rows} rowKey={(r: any) => r.id} onRowClick={(r: any) => setOpen({ kind: 'trx', id: r.id })} cols={[
                { key: 'no', header: 'Nomor', mobile: 'title', render: (r: any) => <b>{r.trx_no}</b> }, { key: 'd', header: 'Tanggal', render: (r: any) => fmtDate(r.trx_date) },
                { key: 'n', header: 'Nasabah', render: (r: any) => r.customer_nama }, { key: 't', header: 'Total', align: 'right', render: (r: any) => rp(r.total_idr) },
                { key: 'a', header: '', render: () => <Badge tone="teal">Lihat struk</Badge> }]} />
              <Pagination page={trx.data.page} size={trx.data.size} total={trx.data.total} onPage={setPage} />
            </>)}
          </Loadable>
        ) : (
          <Loadable loading={cnv.loading} error={cnv.error} reload={cnv.reload} hasData={!!cnv.data} empty={!cnv.data?.rows.length} emptyNode={<EmptyState title="Belum ada struk konversi" text="Struk konversi tersedia setelah status Transfer Selesai." />}>
            {cnv.data && <DataTable rows={cnv.data.rows} rowKey={(r: any) => r.id} onRowClick={(r: any) => setOpen({ kind: 'cnv', id: r.id })} cols={[
              { key: 'no', header: 'Nomor', mobile: 'title', render: (r: any) => <b>{r.cnv_no}</b> }, { key: 'd', header: 'Tgl. transfer', render: (r: any) => fmtDate(r.transferred_at) },
              { key: 'n', header: 'Nasabah', render: (r: any) => r.customer_nama }, { key: 't', header: 'Nominal', align: 'right', render: (r: any) => rp(r.amount_idr) },
              { key: 'a', header: '', render: () => <Badge tone="teal">Lihat struk</Badge> }]} />}
          </Loadable>
        )}
      </Card>
      <ReceiptDialog kind={open?.kind ?? 'trx'} id={open?.id ?? null} onClose={() => setOpen(null)} />
    </div>
  );
}
