import { useEffect, useState } from 'react';
import { useNavigate, useSearchParams } from 'react-router-dom';
import { Download, Pencil, Plus, Receipt, Repeat, Search } from 'lucide-react';
import { downloadFile, qs, useApi } from '../lib/api';
import { useAuth } from '../lib/auth';
import { fmtDate, fmtDateTime, JENIS, num, rp } from '../lib/format';
import { Badge, Card, ConversionBadge, Col, CustStatusBadge, DataTable, Drawer, EligibleBadge, EmptyState, Loadable, Pagination, Progress, TrxBadge, errMsg, useToast } from '../components/ui';
import { LocationSelect } from '../components/Filters';
import { CustomerFormModal } from '../components/CustomerForm';

export default function Customers() {
  const { user } = useAuth();
  const nav = useNavigate();
  const [sp, setSp] = useSearchParams();
  const isLoc = user!.role === 'admin_lokasi';
  const [q, setQ] = useState(sp.get('q') ?? '');
  const [status, setStatus] = useState('');
  const [jenis, setJenis] = useState('');
  const [eligible, setEligible] = useState(sp.get('eligible') === '1');
  const [loc, setLoc] = useState('');
  const [page, setPage] = useState(1);
  const [detail, setDetail] = useState<number | null>(sp.get('open') ? Number(sp.get('open')) : null);
  const [form, setForm] = useState<{ open: boolean; id?: number | null }>({ open: false });
  useEffect(() => { setQ(sp.get('q') ?? ''); setEligible(sp.get('eligible') === '1'); }, [sp]);
  useEffect(() => setPage(1), [q, status, jenis, eligible, loc]);

  const path = `/customers${qs({ q, status, jenis, eligible: eligible ? 1 : '', location_id: loc, page, sort: 'nama' })}`;
  const { data, loading, error, reload } = useApi<any>(path);

  const cols: Col<any>[] = [
    { key: 'nama', header: 'Nama', mobile: 'title', render: (r) => <span className="font-bold">{r.nama}</span> },
    { key: 'wa', header: 'WhatsApp', render: (r) => <span className="tnum">{r.whatsapp}</span> },
    ...(!isLoc ? [{ key: 'lok', header: 'Lokasi', render: (r: any) => r.location_nama } as Col<any>] : []),
    { key: 'st', header: 'Status', render: (r) => <CustStatusBadge status={r.status} /> },
    { key: 'jn', header: 'Jenis', render: (r) => JENIS[r.jenis] },
    { key: 'sp', header: 'Total Nilai Setoran', align: 'right', render: (r) => rp(r.total_setoran) },
    { key: 'sd', header: 'Saldo', align: 'right', render: (r) => <b>{rp(r.saldo)}</b> },
    { key: 'te', header: 'Tabungan Emas', align: 'right', render: (r) => rp(r.tabungan_emas) },
    { key: 'el', header: 'Kelayakan', render: (r) => (r.is_active ? <EligibleBadge eligible={r.eligible} /> : <Badge tone="muted">Nonaktif</Badge>) },
  ];

  return (
    <div className="space-y-4">
      <Card className="p-4">
        <div className="flex flex-wrap items-end gap-3">
          <div className="flex-1 min-w-[200px]"><label className="label" htmlFor="c-q">Cari</label><div className="relative"><Search size={16} className="absolute left-3 top-1/2 -translate-y-1/2 text-ink-soft" /><input id="c-q" className="input pl-9" placeholder="Nama atau nomor WhatsApp" value={q} onChange={(e) => { setQ(e.target.value); const n = new URLSearchParams(sp); e.target.value ? n.set('q', e.target.value) : n.delete('q'); setSp(n, { replace: true }); }} /></div></div>
          <LocationSelect value={loc} onChange={setLoc} />
          <div><label className="label" htmlFor="c-st">Status</label><select id="c-st" className="input" value={status} onChange={(e) => setStatus(e.target.value)}><option value="">Semua</option><option value="baru">Baru</option><option value="existing">Existing</option></select></div>
          <div><label className="label" htmlFor="c-jn">Jenis</label><select id="c-jn" className="input" value={jenis} onChange={(e) => setJenis(e.target.value)}><option value="">Semua</option>{Object.entries(JENIS).map(([k, v]) => <option key={k} value={k}>{v}</option>)}</select></div>
          <label className="flex items-center gap-2 min-h-[44px] text-sm font-bold"><input type="checkbox" className="h-5 w-5" checked={eligible} onChange={(e) => { setEligible(e.target.checked); const n = new URLSearchParams(sp); e.target.checked ? n.set('eligible', '1') : n.delete('eligible'); setSp(n, { replace: true }); }} />Hanya eligible</label>
          {isLoc && <button className="btn-primary" onClick={() => setForm({ open: true, id: null })}><Plus size={16} />Tambah Nasabah</button>}
        </div>
        {user!.role === 'bsi_viewer' && <p className="text-xs text-ink-soft mt-2">Tampilan baca saja; nomor WhatsApp dan rekening disamarkan.</p>}
      </Card>
      <Card className="p-4">
        <Loadable loading={loading} error={error} reload={reload} hasData={!!data} empty={!data?.rows.length}
          emptyNode={<EmptyState title="Belum ada nasabah" text={q || status || eligible ? 'Tidak ada nasabah yang cocok dengan filter.' : isLoc ? 'Tambahkan nasabah pertama dengan tombol "Tambah Nasabah".' : 'Data nasabah akan muncul setelah Admin Lokasi menambahkannya.'} />}>
          {data && (<>
            <DataTable cols={cols} rows={data.rows} rowKey={(r) => r.id} onRowClick={(r) => setDetail(r.id)} rowClass={(r) => (r.is_active ? '' : 'opacity-60')} />
            <Pagination page={data.page} size={data.size} total={data.total} onPage={setPage} />
          </>)}
        </Loadable>
      </Card>

      {detail && <CustomerDrawer id={detail} onClose={() => { setDetail(null); if (sp.get('open')) { const n = new URLSearchParams(sp); n.delete('open'); setSp(n, { replace: true }); } }}
        onEdit={() => setForm({ open: true, id: detail })} onTrx={() => nav(`/transaksi?customer=${detail}`)} onCnv={() => nav(`/konversi?new=${detail}`)} version={data} />}
      <CustomerFormModal open={form.open} customerId={form.id} onClose={() => setForm({ open: false })} onSaved={() => { setForm({ open: false }); reload(); }} />
    </div>
  );
}

function CustomerDrawer({ id, onClose, onEdit, onTrx, onCnv, version }: { id: number; onClose: () => void; onEdit: () => void; onTrx: () => void; onCnv: () => void; version: any }) {
  const { user, meta } = useAuth();
  const toast = useToast();
  const { data, loading, error, reload } = useApi<any>(`/customers/${id}`);
  useEffect(() => { reload(); }, [version]); // eslint-disable-line
  const c = data?.customer;
  const isLoc = user!.role === 'admin_lokasi';
  const dl = (fmt: 'pdf' | 'xlsx') => downloadFile(`/customers/${id}/export?format=${fmt}`).catch((e) => toast.err(errMsg(e)));
  return (
    <Drawer open title={c?.nama ?? 'Detail Nasabah'} onClose={onClose}
      footer={c && user!.role !== 'bsi_viewer' ? (<>
        <button className="btn-outline btn-sm" onClick={() => dl('pdf')}><Download size={16} />PDF</button>
        <button className="btn-outline btn-sm" onClick={() => dl('xlsx')}><Download size={16} />Excel</button>
      </>) : undefined}>
      <Loadable loading={loading} error={error} reload={reload} hasData={!!c}>
        {c && (
          <div className="space-y-5">
            <div className="flex flex-wrap gap-2 items-center"><CustStatusBadge status={c.status} /><EligibleBadge eligible={c.eligible} /><Badge tone="slate">{JENIS[c.jenis]}</Badge>{!c.is_active && <Badge tone="muted">Nonaktif</Badge>}</div>
            <dl className="text-sm grid grid-cols-[120px_1fr] gap-y-1"><dt className="text-ink-soft">Lokasi</dt><dd>{c.location_nama}</dd><dt className="text-ink-soft">WhatsApp</dt><dd className="tnum">{c.whatsapp}</dd><dt className="text-ink-soft">Rekening BSI</dt><dd className="tnum">{c.bsi_account_no ?? '-'}</dd><dt className="text-ink-soft">Transaksi sukses</dt><dd>{num(c.jumlah_transaksi)}</dd></dl>
            <div className="rounded-ctl bg-gold-tint border border-gold p-3 space-y-2">
              <div className="grid grid-cols-3 gap-2 text-center">
                <div><p className="text-xs text-ink-soft">Saldo tersedia</p><p className="font-bold tnum">{rp(c.saldo)}</p></div>
                <div><p className="text-xs text-ink-soft">Tertahan</p><p className="font-bold tnum">{rp(c.saldo_tertahan)}</p></div>
                <div><p className="text-xs text-ink-soft">Tabungan Emas</p><p className="font-bold tnum">{rp(c.tabungan_emas)}</p></div>
              </div>
              <Progress value={c.progress} />
              <p className="text-sm font-bold">{c.kurang === 0 ? 'Siap dikonversi menjadi Tabungan Emas.' : `Kurang ${rp(c.kurang)} menuju minimum konversi (${rp(meta!.settings.min_conversion)}).`}</p>
            </div>
            {isLoc && c.is_active && (
              <div className="flex flex-wrap gap-2">
                <button className="btn-primary btn-sm" onClick={onTrx}><Receipt size={16} />Catat Setoran</button>
                {c.eligible && <button className="btn-outline btn-sm" onClick={onCnv}><Repeat size={16} />Ajukan Konversi</button>}
                <button className="btn-outline btn-sm" onClick={onEdit}><Pencil size={16} />Ubah</button>
              </div>
            )}
            {isLoc && !c.is_active && <button className="btn-outline btn-sm" onClick={onEdit}><Pencil size={16} />Ubah / aktifkan kembali</button>}
            {data.transactions && (
              <section><h3 className="font-bold mb-2">Riwayat transaksi</h3>
                {data.transactions.length === 0 ? <p className="text-sm text-ink-soft">Belum ada transaksi.</p> : (
                  <ul className="divide-y divide-line border border-line rounded-ctl max-h-64 overflow-y-auto">{data.transactions.map((t: any) => (
                    <li key={t.id} className="flex items-center justify-between gap-2 px-3 py-2 text-sm"><span><b className={t.status === 'void' ? 'line-through text-ink-soft' : ''}>{t.trx_no}</b><br /><span className="text-xs text-ink-soft">{fmtDate(t.trx_date)}</span></span><span className="text-right tnum"><span className={t.status === 'void' ? 'line-through text-ink-soft block' : 'block'}>{rp(t.total_idr)}</span><TrxBadge status={t.status} /></span></li>))}</ul>)}
              </section>
            )}
            <section><h3 className="font-bold mb-2">Riwayat konversi</h3>
              {data.conversions.length === 0 ? <p className="text-sm text-ink-soft">Belum ada konversi.</p> : (
                <ul className="divide-y divide-line border border-line rounded-ctl">{data.conversions.map((v: any) => (
                  <li key={v.id} className="flex items-center justify-between gap-2 px-3 py-2 text-sm"><span><b>{v.cnv_no}</b><br /><span className="text-xs text-ink-soft">{fmtDateTime(v.requested_at)}</span></span><span className="text-right tnum"><span className="block">{rp(v.amount_idr)}</span><ConversionBadge status={v.status} /></span></li>))}</ul>)}
            </section>
          </div>
        )}
      </Loadable>
    </Drawer>
  );
}
