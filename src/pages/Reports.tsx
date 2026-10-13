import { useEffect, useRef, useState } from 'react';
import { Archive, Camera, Download, Eye, FileSpreadsheet, FileText, LayoutGrid, Plus, Save, Table2 } from 'lucide-react';
import { api, downloadFile, fetchBlobUrl, qs, useApi } from '../lib/api';
import { useAuth } from '../lib/auth';
import { fmtDate, fmtDateTime, kg, num, rp, STATUS_KONVERSI, todayWib } from '../lib/format';
import { Alert, Badge, Card, DataTable, EmptyState, Field, Loadable, Modal, ReasonDialog, Spinner, Tabs, errMsg, useToast } from '../components/ui';
import { LocationSelect, PeriodFilter, periodRange, usePeriod } from '../components/Filters';

type Tab = 'laporan' | 'dokumentasi';
export default function Reports() {
  const [tab, setTab] = useState<Tab>('laporan');
  return (
    <div className="space-y-4">
      <Tabs<Tab> value={tab} onChange={setTab} tabs={[{ id: 'laporan', label: 'Laporan' }, { id: 'dokumentasi', label: 'Dokumentasi' }]} />
      {tab === 'laporan' ? <ReportTab /> : <DocsTab />}
    </div>
  );
}

/* ------------------------------ Laporan ------------------------------ */
function ReportTab() {
  const { user } = useAuth();
  const toast = useToast();
  const [period, setPeriod] = usePeriod();
  const [loc, setLoc] = useState('');
  const [cs, setCs] = useState('');
  const [ts, setTs] = useState('');
  const [wt, setWt] = useState('');
  const { from, to } = periodRange(period);
  const params = qs({ from, to, location_id: loc, customer_status: cs, transfer_status: ts, waste_type_id: wt });
  const sum = useApi<any>(`/reports/summary${params}`);
  const types = useApi<{ rows: any[] }>('/waste-types');
  const snaps = useApi<{ rows: any[] }>('/reports/snapshots');
  const [busy, setBusy] = useState('');
  const [preview, setPreview] = useState<string | null>(null);
  const [snapOpen, setSnapOpen] = useState(false);
  const [snapView, setSnapView] = useState<any>(null);

  const dl = async (kind: 'pdf' | 'excel') => {
    setBusy(kind);
    try { await downloadFile(`/reports/${kind}${params}`); toast.ok(kind === 'pdf' ? 'PDF Executive Summary diunduh.' : 'Excel Audit Report diunduh.'); } catch (e) { toast.err(errMsg(e)); } finally { setBusy(''); }
  };
  const openPreview = async () => {
    setBusy('prev');
    try { setPreview(await fetchBlobUrl(`/reports/pdf${params}${params ? '&' : '?'}preview=1`)); } catch (e) { toast.err(errMsg(e)); } finally { setBusy(''); }
  };
  const closePreview = () => { if (preview) URL.revokeObjectURL(preview); setPreview(null); };
  const k = sum.data?.kpis, r = sum.data?.recon;

  return (
    <div className="space-y-4">
      <Card className="p-4 space-y-3">
        <div className="flex flex-wrap items-end gap-3">
          <PeriodFilter value={period} onChange={setPeriod} />
          <LocationSelect value={loc} onChange={setLoc} />
          <div><label className="label" htmlFor="r-cs">Status nasabah</label><select id="r-cs" className="input" value={cs} onChange={(e) => setCs(e.target.value)}><option value="">Semua</option><option value="baru">Baru</option><option value="existing">Existing</option></select></div>
          <div><label className="label" htmlFor="r-ts">Status transfer</label><select id="r-ts" className="input" value={ts} onChange={(e) => setTs(e.target.value)}><option value="">Semua</option>{Object.entries(STATUS_KONVERSI).map(([id, l]) => <option key={id} value={id}>{l}</option>)}</select></div>
          <div><label className="label" htmlFor="r-wt">Jenis sampah</label><select id="r-wt" className="input" value={wt} onChange={(e) => setWt(e.target.value)}><option value="">Semua jenis</option>{types.data?.rows.map((w) => <option key={w.id} value={w.id}>{w.nama}</option>)}</select></div>
        </div>
        <div className="flex flex-wrap gap-2 pt-1">
          <button className="btn-primary" onClick={() => dl('pdf')} disabled={!!busy}>{busy === 'pdf' ? <Spinner /> : <FileText size={16} />}Unduh PDF</button>
          <button className="btn-primary" onClick={() => dl('excel')} disabled={!!busy}>{busy === 'excel' ? <Spinner /> : <FileSpreadsheet size={16} />}Unduh Excel</button>
          <button className="btn-outline" onClick={openPreview} disabled={!!busy}>{busy === 'prev' ? <Spinner /> : <Eye size={16} />}Preview</button>
          <button className="btn-outline" onClick={() => setSnapOpen(true)}><Save size={16} />Simpan Snapshot</button>
        </div>
        {sum.data && <p className="text-xs text-ink-soft">{sum.data.filterText.join(' • ')}</p>}
      </Card>

      <Loadable loading={sum.loading} error={sum.error} reload={sum.reload} hasData={!!k} rows={5}>
        {k && (
          <>
            <div className="grid grid-cols-2 lg:grid-cols-4 gap-3">
              {[['Total Transaksi', num(k.totalTransaksi)], ['Total Nasabah', num(k.totalNasabah)], ['Total Berat', kg(k.totalBeratKg) + (k.totalUnit ? ` + ${num(k.totalUnit)} unit` : '')], ['Nilai Ekonomi', rp(k.nilaiEkonomi)],
                ['Saldo Belum Dikonversi', rp(k.saldoBelumDikonversi)], ['Sudah Jadi Tabungan Emas', rp(k.sudahTabunganEmas)], ['Nasabah Eligible', num(k.nasabahEligible)], ['Transfer Pending', rp(k.transferPending)]].map(([l, v]) => (
                <Card key={l} className="p-3"><p className="text-xs font-bold text-ink-soft">{l}</p><p className="text-lg font-bold text-teal-dark kpi-value break-words">{v}</p></Card>))}
            </div>
            <Card className="p-4">
              <div className="flex items-center justify-between flex-wrap gap-2 mb-2">
                <h3 className="font-bold">Rekonsiliasi nilai ekonomi</h3>
                <Badge tone={r.status === 'seimbang' ? 'tealSolid' : r.status === 'belum_ada_data' ? 'muted' : 'danger'}>{r.status === 'seimbang' ? 'Seimbang' : r.status === 'belum_ada_data' ? 'Belum ada data' : 'Tidak seimbang'}</Badge>
              </div>
              {r.status === 'belum_ada_data' ? <p className="text-sm text-ink-soft">Belum ada data untuk dibandingkan.</p> : (
                <>
                  <dl className="grid sm:grid-cols-3 gap-3 text-sm tnum">
                    <div className="rounded-ctl bg-page p-3"><dt className="text-ink-soft text-xs">Nilai Ekonomi (kumulatif)</dt><dd className="font-bold text-base">{rp(r.nilaiEkonomi)}</dd></div>
                    <div className="rounded-ctl bg-page p-3"><dt className="text-ink-soft text-xs">Saldo Belum Dikonversi + Tabungan Emas</dt><dd className="font-bold text-base">{rp(r.saldoBelumDikonversi)} + {rp(r.tabunganEmas)}</dd></div>
                    <div className="rounded-ctl bg-page p-3"><dt className="text-ink-soft text-xs">Selisih</dt><dd className={`font-bold text-base ${r.selisih ? 'text-danger' : ''}`}>{rp(r.selisih)}</dd></div>
                  </dl>
                  {r.status === 'tidak_seimbang' && <div className="mt-3"><Alert tone="danger">Identitas rekonsiliasi tidak seimbang dengan selisih {rp(r.selisih)}. Hubungi Super Admin untuk penelusuran.</Alert></div>}
                  <p className="text-xs text-ink-soft mt-2">Nilai Ekonomi = Saldo Belum Dikonversi + Sudah Jadi Tabungan Emas. {r.basis}.</p>
                </>
              )}
            </Card>
            <Card className="p-4">
              <h3 className="font-bold mb-2">Konversi per status</h3>
              <DataTable rows={sum.data.konversiPerStatus} rowKey={(x: any) => x.status} cols={[
                { key: 's', header: 'Status', mobile: 'title', render: (x: any) => STATUS_KONVERSI[x.status] }, { key: 'j', header: 'Jumlah', align: 'right', render: (x: any) => num(x.jumlah) }, { key: 'n', header: 'Nominal', align: 'right', render: (x: any) => rp(x.nominal) }]} />
            </Card>
          </>
        )}
      </Loadable>

      <Card className="p-4">
        <h3 className="font-bold mb-2">Snapshot tersimpan</h3>
        <Loadable loading={snaps.loading} error={snaps.error} reload={snaps.reload} hasData={!!snaps.data} empty={!snaps.data?.rows.length}
          emptyNode={<EmptyState title="Belum ada snapshot" text="Simpan snapshot untuk mengabadikan angka KPI pada waktu tertentu. Snapshot tidak dapat diubah atau dihapus." />}>
          <ul className="divide-y divide-line">{snaps.data?.rows.map((s) => (
            <li key={s.id} className="py-2.5 flex items-center justify-between gap-3"><span className="min-w-0"><b className="block truncate">{s.label}</b><span className="text-xs text-ink-soft">{fmtDateTime(s.created_at)} • {s.created_by_nama}</span></span>
              <button className="btn-outline btn-sm" onClick={async () => setSnapView(await api(`/reports/snapshots/${s.id}`))}>Buka</button></li>))}</ul>
        </Loadable>
      </Card>

      <Modal open={!!preview} title="Preview PDF Executive Summary" size="xl" onClose={closePreview} footer={<><button className="btn-outline" onClick={closePreview}>Tutup</button><button className="btn-primary" onClick={() => dl('pdf')}><Download size={16} />Unduh PDF</button></>}>
        {preview && <iframe title="Preview laporan PDF" src={preview} className="w-full h-[70vh] rounded-ctl border border-line" />}
      </Modal>
      <SnapshotModal open={snapOpen} onClose={() => setSnapOpen(false)} params={params} onSaved={() => { setSnapOpen(false); snaps.reload(); }} />
      <Modal open={!!snapView} title={snapView?.label ?? ''} onClose={() => setSnapView(null)} footer={<button className="btn-primary" onClick={() => setSnapView(null)}>Tutup</button>}>
        {snapView && (<div className="space-y-3 text-sm">
          <p className="text-ink-soft">Disimpan {fmtDateTime(snapView.created_at)}. {snapView.filters?.text?.join(' • ')}</p>
          <dl className="grid grid-cols-2 gap-2 tnum">{[['Total Transaksi', num(snapView.kpis.totalTransaksi)], ['Total Nasabah', num(snapView.kpis.totalNasabah)], ['Total Berat', kg(snapView.kpis.totalBeratKg)], ['Nilai Ekonomi', rp(snapView.kpis.nilaiEkonomi)], ['Saldo Belum Dikonversi', rp(snapView.kpis.saldoBelumDikonversi)], ['Tabungan Emas', rp(snapView.kpis.sudahTabunganEmas)], ['Eligible', num(snapView.kpis.nasabahEligible)], ['Transfer Pending', rp(snapView.kpis.transferPending)]].map(([l, v]) => <div key={l} className="rounded-ctl bg-page p-2"><dt className="text-xs text-ink-soft">{l}</dt><dd className="font-bold">{v}</dd></div>)}</dl>
          <p className="text-xs">Rekonsiliasi: <b>{snapView.recon.status === 'seimbang' ? 'Seimbang' : snapView.recon.status === 'belum_ada_data' ? 'Belum ada data' : 'Tidak seimbang'}</b></p>
        </div>)}
      </Modal>
      <span className="sr-only">{user?.role}</span>
    </div>
  );
}

function SnapshotModal({ open, onClose, params, onSaved }: { open: boolean; onClose: () => void; params: string; onSaved: () => void }) {
  const toast = useToast();
  const [label, setLabel] = useState('');
  const [busy, setBusy] = useState(false);
  useEffect(() => { if (open) setLabel(''); }, [open]);
  return (
    <Modal open={open} onClose={onClose} title="Simpan Snapshot" size="sm" footer={<><button className="btn-outline" onClick={onClose}>Batal</button>
      <button className="btn-primary" disabled={busy} onClick={async () => { setBusy(true); try { await api(`/reports/snapshots${params}`, { method: 'POST', body: { label } }); toast.ok('Snapshot disimpan.'); onSaved(); } catch (e) { toast.err(errMsg(e)); } finally { setBusy(false); } }}>{busy && <Spinner />}Simpan</button></>}>
      <p className="text-sm text-ink-soft mb-3">Menyimpan salinan KPI, filter, waktu, dan pembuat. Snapshot tidak dapat diubah atau dihapus.</p>
      <Field label="Label (opsional)">{(i) => <input id={i} className="input" placeholder="Contoh: Posisi akhir kuartal III" value={label} onChange={(e) => setLabel(e.target.value)} />}</Field>
    </Modal>
  );
}

/* ------------------------------ Dokumentasi ------------------------------ */
const KATEGORI = ['Kegiatan Kios', 'Penyerahan Tabungan Emas', 'Edukasi', 'Lainnya'];

/** Perkecil foto ke sisi terpanjang 1600 px sebelum diunggah (FR-7.7). */
async function resizeImage(file: File, max = 1600): Promise<File> {
  if (!/^image\/(jpeg|png|webp)$/.test(file.type)) return file;
  const bmp = await createImageBitmap(file);
  const scale = Math.min(1, max / Math.max(bmp.width, bmp.height));
  if (scale === 1 && file.size < 1.5 * 1024 * 1024) return file;
  const c = document.createElement('canvas');
  c.width = Math.round(bmp.width * scale); c.height = Math.round(bmp.height * scale);
  c.getContext('2d')!.drawImage(bmp, 0, 0, c.width, c.height);
  const blob: Blob = await new Promise((res) => c.toBlob((b) => res(b!), 'image/jpeg', 0.88));
  return new File([blob], file.name.replace(/\.\w+$/, '') + '.jpg', { type: 'image/jpeg' });
}

function DocsTab() {
  const { user } = useAuth();
  const canUpload = user!.role !== 'bsi_viewer';
  const [view, setView] = useState<'galeri' | 'tabel'>('galeri');
  const [loc, setLoc] = useState('');
  const [kat, setKat] = useState('');
  const [period, setPeriod] = usePeriod();
  const { from, to } = periodRange(period);
  const { data, loading, error, reload } = useApi<{ rows: any[] }>(`/documents${qs({ location_id: loc, kategori: kat, from, to })}`);
  const [upload, setUpload] = useState(false);
  const [zoom, setZoom] = useState<any>(null);
  const [arch, setArch] = useState<any>(null);
  const toast = useToast();

  return (
    <div className="space-y-4">
      <Card className="p-4">
        <div className="flex flex-wrap items-end gap-3">
          <PeriodFilter value={period} onChange={setPeriod} />
          <LocationSelect value={loc} onChange={setLoc} />
          <div><label className="label" htmlFor="d-k">Kategori</label><select id="d-k" className="input" value={kat} onChange={(e) => setKat(e.target.value)}><option value="">Semua</option>{KATEGORI.map((k) => <option key={k}>{k}</option>)}</select></div>
          <div className="flex gap-1" role="group" aria-label="Tampilan">
            <button className={view === 'galeri' ? 'btn-primary' : 'btn-outline'} onClick={() => setView('galeri')} aria-pressed={view === 'galeri'}><LayoutGrid size={16} />Galeri</button>
            <button className={view === 'tabel' ? 'btn-primary' : 'btn-outline'} onClick={() => setView('tabel')} aria-pressed={view === 'tabel'}><Table2 size={16} />Tabel</button>
          </div>
          {canUpload && <button className="btn-primary ml-auto" onClick={() => setUpload(true)}><Camera size={16} />Unggah Foto</button>}
        </div>
      </Card>
      <Loadable loading={loading} error={error} reload={reload} hasData={!!data} empty={!data?.rows.length}
        emptyNode={<Card><EmptyState title="Belum ada dokumentasi" text={canUpload ? 'Unggah foto kegiatan kios dengan tombol "Unggah Foto".' : 'Foto kegiatan akan muncul setelah diunggah oleh Admin Lokasi.'} /></Card>}>
        {data && view === 'galeri' && (
          <div className="grid grid-cols-2 md:grid-cols-3 lg:grid-cols-4 gap-3">
            {data.rows.map((d) => (
              <Card key={d.id} className="overflow-hidden">
                <button className="block w-full aspect-[4/3] bg-page" onClick={() => setZoom(d)} aria-label={`Perbesar ${d.judul}`}><img src={d.url} alt={d.caption || d.judul} loading="lazy" className="w-full h-full object-cover" /></button>
                <div className="p-3"><p className="font-bold text-sm truncate">{d.judul}</p><p className="text-xs text-ink-soft">{fmtDate(d.tanggal)} • {d.location_nama}</p><div className="mt-1"><Badge tone="teal">{d.kategori}</Badge></div></div>
              </Card>))}
          </div>
        )}
        {data && view === 'tabel' && (
          <Card className="p-4"><DataTable rows={data.rows} rowKey={(d: any) => d.id} onRowClick={setZoom} cols={[
            { key: 'j', header: 'Judul', mobile: 'title', render: (d: any) => <b>{d.judul}</b> }, { key: 'k', header: 'Kategori', render: (d: any) => d.kategori },
            { key: 'l', header: 'Lokasi', render: (d: any) => d.location_nama }, { key: 't', header: 'Tanggal', render: (d: any) => fmtDate(d.tanggal) }, { key: 'u', header: 'Pengunggah', render: (d: any) => d.uploaded_by_nama }]} /></Card>
        )}
      </Loadable>

      <UploadDialog open={upload} onClose={() => setUpload(false)} onDone={() => { setUpload(false); reload(); }} />
      <Modal open={!!zoom} title={zoom?.judul ?? ''} size="lg" onClose={() => setZoom(null)}
        footer={<>{canUpload && <button className="btn-outline text-danger" onClick={() => { setArch(zoom); setZoom(null); }}><Archive size={16} />Arsipkan</button>}<button className="btn-primary" onClick={() => setZoom(null)}>Tutup</button></>}>
        {zoom && <div className="space-y-2"><img src={zoom.url} alt={zoom.caption || zoom.judul} className="w-full max-h-[60vh] object-contain rounded-ctl bg-page" />
          <p className="text-sm">{zoom.caption}</p><p className="text-xs text-ink-soft">{fmtDate(zoom.tanggal)} • {zoom.location_nama} • {zoom.kategori} • diunggah {zoom.uploaded_by_nama}</p></div>}
      </Modal>
      <ReasonDialog open={!!arch} title="Arsipkan foto" confirmLabel="Arsipkan" message="Foto yang diarsipkan tidak tampil lagi, tetapi tetap tersimpan." onClose={() => setArch(null)}
        onConfirm={async (reason) => { await api(`/documents/${arch.id}/archive`, { method: 'POST', body: { reason } }); toast.ok('Foto diarsipkan.'); setArch(null); reload(); }} />
    </div>
  );
}

function UploadDialog({ open, onClose, onDone }: { open: boolean; onClose: () => void; onDone: () => void }) {
  const { user, meta } = useAuth();
  const toast = useToast();
  const fileRef = useRef<HTMLInputElement>(null);
  const [file, setFile] = useState<File | null>(null);
  const [v, setV] = useState({ judul: '', caption: '', kategori: KATEGORI[0], tanggal: todayWib(), location_id: '' });
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState('');
  useEffect(() => { if (open) { setFile(null); setError(''); setV({ judul: '', caption: '', kategori: KATEGORI[0], tanggal: todayWib(), location_id: '' }); } }, [open]);
  const isLoc = user!.role === 'admin_lokasi';
  const valid = !!file && v.judul.trim().length > 1 && (isLoc || !!v.location_id);
  const save = async () => {
    setBusy(true); setError('');
    try {
      const small = await resizeImage(file!);
      if (small.size > 5 * 1024 * 1024) throw new Error('Ukuran foto maksimal 5 MB.');
      const fd = new FormData();
      fd.append('file', small); Object.entries(v).forEach(([k, val]) => val && fd.append(k, val));
      await api('/documents', { method: 'POST', form: fd }); toast.ok('Foto diunggah.'); onDone();
    } catch (e) { setError(errMsg(e)); } finally { setBusy(false); }
  };
  return (
    <Modal open={open} onClose={onClose} title="Unggah Foto Dokumentasi" footer={<><button className="btn-outline" onClick={onClose}>Batal</button><button className="btn-primary" disabled={!valid || busy} onClick={save}>{busy && <Spinner />}Unggah</button></>}>
      <div className="space-y-4">
        {error && <Alert tone="danger">{error}</Alert>}
        <Field label="Foto (JPG, PNG, atau WebP, maks. 5 MB)" required hint="Foto besar otomatis diperkecil ke sisi terpanjang 1600 px.">{(i) => <input id={i} ref={fileRef} type="file" accept="image/jpeg,image/png,image/webp" className="input py-2" onChange={(e) => setFile(e.target.files?.[0] ?? null)} />}</Field>
        <Field label="Judul" required>{(i) => <input id={i} className="input" value={v.judul} onChange={(e) => setV({ ...v, judul: e.target.value })} />}</Field>
        <Field label="Caption">{(i) => <textarea id={i} className="input py-2" rows={2} value={v.caption} onChange={(e) => setV({ ...v, caption: e.target.value })} />}</Field>
        <div className="grid sm:grid-cols-2 gap-3">
          <Field label="Kategori" required>{(i) => <select id={i} className="input" value={v.kategori} onChange={(e) => setV({ ...v, kategori: e.target.value })}>{KATEGORI.map((k) => <option key={k}>{k}</option>)}</select>}</Field>
          <Field label="Tanggal" required>{(i) => <input id={i} type="date" className="input" max={todayWib()} value={v.tanggal} onChange={(e) => setV({ ...v, tanggal: e.target.value })} />}</Field>
        </div>
        {isLoc ? <p className="text-sm text-ink-soft">Lokasi: <b>{user!.location_nama}</b> (terkunci)</p> : (
          <Field label="Lokasi" required>{(i) => <select id={i} className="input" value={v.location_id} onChange={(e) => setV({ ...v, location_id: e.target.value })}><option value="">Pilih lokasi…</option>{meta!.locations.filter((l) => l.is_active).map((l) => <option key={l.id} value={l.id}>{l.nama}</option>)}</select>}</Field>
        )}
      </div>
    </Modal>
  );
}
