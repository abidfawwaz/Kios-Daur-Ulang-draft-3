import { useEffect, useState } from 'react';
import { useSearchParams } from 'react-router-dom';
import { Ban, Check, ExternalLink, FileUp, Plus, Receipt, Search, X } from 'lucide-react';
import { api, qs, useApi } from '../lib/api';
import { useAuth } from '../lib/auth';
import { fmtDate, fmtDateTime, rp, STATUS_KONVERSI, todayWib } from '../lib/format';
import { Alert, Card, ConfirmDialog, ConversionBadge, Col, DataTable, Drawer, EmptyState, Field, Loadable, Modal, Pagination, ReasonDialog, Spinner, errMsg, useToast } from '../components/ui';
import { LocationSelect } from '../components/Filters';
import { ReceiptDialog } from '../components/Receipt';

export default function Conversions() {
  const { user } = useAuth();
  const isSA = user!.role === 'super_admin';
  const [sp, setSp] = useSearchParams();
  const [status, setStatus] = useState(sp.get('status') ?? (isSA ? 'perlu_tindakan' : ''));
  const [search, setSearch] = useState('');
  const [loc, setLoc] = useState('');
  const [page, setPage] = useState(1);
  const [open, setOpen] = useState<number | null>(sp.get('open') ? Number(sp.get('open')) : null);
  const [creating, setCreating] = useState<number | 'new' | null>(sp.get('new') ? Number(sp.get('new')) : null);
  useEffect(() => { const s = sp.get('status'); if (s) setStatus(s); const o = sp.get('open'); if (o) setOpen(Number(o)); }, [sp]);
  useEffect(() => setPage(1), [status, search, loc]);
  const clearParams = (...keys: string[]) => { const n = new URLSearchParams(sp); keys.forEach((k) => n.delete(k)); setSp(n, { replace: true }); };

  const { data, loading, error, reload } = useApi<any>(`/conversions${qs({ status, q: search, location_id: loc, page })}`);
  const counts = data?.counts ?? {};
  const chips = [
    ...(isSA ? [{ id: 'perlu_tindakan', label: `Perlu tindakan (${(counts.diajukan ?? 0) + (counts.diverifikasi ?? 0)})` }] : []),
    { id: '', label: 'Semua' },
    ...Object.entries(STATUS_KONVERSI).map(([id, label]) => ({ id, label: `${label} (${counts[id] ?? 0})` })),
  ];

  const cols: Col<any>[] = [
    { key: 'no', header: 'Nomor', mobile: 'title', render: (r) => <b>{r.cnv_no}</b> },
    { key: 'n', header: 'Nasabah', render: (r) => r.customer_nama },
    ...(isSA ? [{ key: 'l', header: 'Lokasi', render: (r: any) => r.location_nama } as Col<any>] : []),
    { key: 'rek', header: 'Rekening', render: (r) => <span className="tnum">{r.bsi_account_no}</span> },
    { key: 'nom', header: 'Nominal', align: 'right', render: (r) => <b>{rp(r.amount_idr)}</b> },
    { key: 'tgl', header: 'Diajukan', render: (r) => fmtDate(r.requested_at.slice(0, 10)) },
    { key: 'st', header: 'Status', render: (r) => <ConversionBadge status={r.status} /> },
  ];

  return (
    <div className="space-y-4">
      <Card className="p-4 space-y-3">
        <div className="flex flex-wrap items-end gap-3">
          <div className="flex-1 min-w-[200px]"><label className="label" htmlFor="v-q">Cari</label><div className="relative"><Search size={16} className="absolute left-3 top-1/2 -translate-y-1/2 text-ink-soft" /><input id="v-q" className="input pl-9" placeholder="Nomor konversi atau nama nasabah" value={search} onChange={(e) => setSearch(e.target.value)} /></div></div>
          <LocationSelect value={loc} onChange={setLoc} />
          {!isSA && <button className="btn-primary" onClick={() => setCreating('new')}><Plus size={16} />Ajukan Konversi</button>}
        </div>
        <div className="flex gap-2 flex-wrap" role="group" aria-label="Filter status">
          {chips.map((c) => (
            <button key={c.id || 'all'} onClick={() => { setStatus(c.id); clearParams('status'); }} aria-pressed={status === c.id}
              className={`px-3 min-h-[36px] rounded-full text-sm font-bold border ${status === c.id ? 'bg-[var(--teal-action)] text-white border-transparent' : 'bg-white border-line text-ink hover:bg-page'}`}>{c.label}</button>
          ))}
        </div>
      </Card>
      <Card className="p-4">
        <Loadable loading={loading} error={error} reload={reload} hasData={!!data} empty={!data?.rows.length}
          emptyNode={<EmptyState title={status === 'perlu_tindakan' ? 'Tidak ada konversi yang perlu tindakan' : 'Belum ada konversi'} text={isSA ? 'Pengajuan baru dari Admin Lokasi akan muncul di sini.' : 'Nasabah eligible dapat diajukan konversinya dengan tombol "Ajukan Konversi".'} />}>
          {data && (<>
            <DataTable cols={cols} rows={data.rows} rowKey={(r) => r.id} onRowClick={(r) => setOpen(r.id)} />
            <Pagination page={data.page} size={data.size} total={data.total} onPage={setPage} />
          </>)}
        </Loadable>
      </Card>
      {open && <ConversionDrawer id={open} onClose={() => { setOpen(null); clearParams('open'); }} onChanged={reload} />}
      {creating !== null && <NewConversion preselect={creating === 'new' ? null : creating} onClose={() => { setCreating(null); clearParams('new'); }} onSaved={() => { setCreating(null); clearParams('new'); reload(); }} />}
    </div>
  );
}

/* ------------------------------ Ajukan ------------------------------ */
function NewConversion({ preselect, onClose, onSaved }: { preselect: number | null; onClose: () => void; onSaved: () => void }) {
  const { meta } = useAuth();
  const toast = useToast();
  const min = meta!.settings.min_conversion;
  const list = useApi<any>('/customers?eligible=1&size=100&sort=saldo');
  const [cid, setCid] = useState<string>(preselect ? String(preselect) : '');
  const [amount, setAmount] = useState('');
  const [acc, setAcc] = useState('');
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState('');
  const c = list.data?.rows.find((r: any) => String(r.id) === cid);

  useEffect(() => {
    if (!cid) return;
    setError('');
    api<any>(`/customers/${cid}/full`).then((f) => setAcc(f.bsi_account_no ?? '')).catch(() => {});
  }, [cid]);
  useEffect(() => { if (c) setAmount(String(c.saldo)); }, [c?.id]); // eslint-disable-line
  const amt = Number(amount);
  const valid = !!c && Number.isInteger(amt) && amt >= min && amt <= c.saldo && /^\d{10}$/.test(acc);
  const save = async () => {
    setBusy(true); setError('');
    try { const r = await api<any>('/conversions', { method: 'POST', body: { customer_id: Number(cid), amount_idr: amt, bsi_account_no: acc } }); toast.ok(`Konversi ${r.cnv_no} diajukan.`); onSaved(); }
    catch (e) { setError(errMsg(e)); } finally { setBusy(false); }
  };
  return (
    <Modal open onClose={onClose} title="Ajukan Konversi Tabungan Emas" footer={<><button className="btn-outline" onClick={onClose}>Batal</button><button className="btn-primary" disabled={!valid || busy} onClick={save}>{busy && <Spinner />}Ajukan</button></>}>
      <Loadable loading={list.loading} error={list.error} reload={list.reload} hasData={!!list.data}>
        <div className="space-y-4">
          {error && <Alert tone="danger">{error}</Alert>}
          {!list.data?.rows.length && <Alert tone="gold">Belum ada nasabah yang eligible (saldo tersedia minimal {rp(min)}).</Alert>}
          <Field label="Nasabah (eligible)" required>{(id) => (
            <select id={id} className="input" value={cid} onChange={(e) => setCid(e.target.value)}>
              <option value="">Pilih nasabah…</option>{list.data?.rows.map((r: any) => <option key={r.id} value={r.id}>{r.nama} — saldo {rp(r.saldo)}</option>)}
            </select>)}</Field>
          <Field label="Nominal konversi (Rp)" required hint={c ? `Minimal ${rp(min)}, maksimal saldo tersedia ${rp(c.saldo)}.` : `Minimal ${rp(min)}.`}
            error={amount && (!Number.isInteger(amt) || amt < min) ? `Nominal minimal ${rp(min)}.` : c && amt > c.saldo ? `Nominal melebihi saldo tersedia (${rp(c.saldo)}).` : null}>
            {(id) => <input id={id} className="input tnum" inputMode="numeric" value={amount} onChange={(e) => setAmount(e.target.value.replace(/\D/g, ''))} />}</Field>
          <Field label="Nomor rekening BSI" required hint="10 digit angka. Setelah diajukan hanya tampil disamarkan." error={acc && !/^\d{10}$/.test(acc) ? 'Harus 10 digit angka.' : null}>
            {(id) => <input id={id} className="input tnum" inputMode="numeric" maxLength={10} value={acc} onChange={(e) => setAcc(e.target.value.replace(/\D/g, ''))} />}</Field>
          <p className="text-xs text-ink-soft">Nominal akan ditahan dari saldo tersedia sampai konversi diverifikasi dan ditransfer oleh Super Admin.</p>
        </div>
      </Loadable>
    </Modal>
  );
}

/* ------------------------------ Panel rincian ------------------------------ */
function Stepper({ d }: { d: any }) {
  const steps = [
    { label: 'Diajukan', who: d.requested_by_nama, at: d.requested_at, done: true },
    { label: 'Diverifikasi', who: d.verified_by_nama, at: d.verified_at, done: ['diverifikasi', 'transfer_selesai'].includes(d.status) },
    { label: 'Transfer', who: d.status === 'transfer_selesai' ? 'Super Admin' : null, at: d.transferred_at ? `${d.transferred_at}T00:00:00Z` : null, done: d.status === 'transfer_selesai', dateOnly: true },
    { label: 'Selesai', who: null, at: d.completed_at, done: d.status === 'transfer_selesai' },
  ];
  const stopped = d.status === 'ditolak' || d.status === 'dibatalkan';
  return (
    <ol className="space-y-0">
      {steps.map((s, i) => {
        const dead = stopped && !s.done;
        return (
          <li key={s.label} className="flex gap-3">
            <div className="flex flex-col items-center">
              <span className={`h-7 w-7 rounded-full flex items-center justify-center text-xs font-bold shrink-0 ${s.done ? 'bg-[var(--teal-action)] text-white' : dead ? 'bg-danger-tint text-danger' : 'bg-[#EEF1F3] text-ink-soft'}`}>{s.done ? <Check size={14} /> : dead ? <X size={14} /> : i + 1}</span>
              {i < 3 && <span className={`w-0.5 flex-1 min-h-[22px] ${s.done ? 'bg-teal' : 'bg-line'}`} />}
            </div>
            <div className="pb-3"><p className={`text-sm font-bold ${s.done ? 'text-ink' : 'text-ink-soft'}`}>{s.label}</p>
              {s.done && <p className="text-xs text-ink-soft">{s.who ? `${s.who} • ` : ''}{s.dateOnly ? fmtDate(s.at?.slice(0, 10)) : fmtDateTime(s.at)}</p>}</div>
          </li>
        );
      })}
    </ol>
  );
}

function ConversionDrawer({ id, onClose, onChanged }: { id: number; onClose: () => void; onChanged: () => void }) {
  const { user } = useAuth();
  const toast = useToast();
  const isSA = user!.role === 'super_admin';
  const { data: d, loading, error, reload } = useApi<any>(`/conversions/${id}`);
  const [reject, setReject] = useState(false);
  const [cancel, setCancel] = useState(false);
  const [verify, setVerify] = useState(false);
  const [correct, setCorrect] = useState(false);
  const [receipt, setReceipt] = useState(false);
  const [file, setFile] = useState<File | null>(null);
  const [tdate, setTdate] = useState(todayWib());
  const [busy, setBusy] = useState(false);
  const [err, setErr] = useState('');
  const done = () => { reload(); onChanged(); };

  const upload = async () => {
    if (!file) return;
    setBusy(true); setErr('');
    const fd = new FormData(); fd.append('file', file); fd.append('transfer_date', tdate);
    try { await api(`/conversions/${id}/proof`, { method: 'POST', form: fd }); toast.ok(`Konversi ${d.cnv_no} selesai. Tabungan Emas nasabah bertambah ${rp(d.amount_idr)}.`); setFile(null); done(); }
    catch (e) { setErr(errMsg(e)); } finally { setBusy(false); }
  };
  const viewProof = async (pid: number) => {
    try { const r = await api<{ url: string }>(`/conversions/${id}/proofs/${pid}/link`); window.open(r.url, '_blank', 'noopener'); } catch (e) { toast.err(errMsg(e)); }
  };

  const canCancel = d && (isSA ? ['diajukan', 'diverifikasi'].includes(d.status) : d.status === 'diajukan');
  return (
    <Drawer open title={d?.cnv_no ?? 'Rincian Konversi'} onClose={onClose}>
      <Loadable loading={loading} error={error} reload={reload} hasData={!!d}>
        {d && (
          <div className="space-y-5">
            <div className="flex items-center justify-between gap-2"><ConversionBadge status={d.status} /><span className="text-xl font-bold text-teal-dark tnum">{rp(d.amount_idr)}</span></div>
            <dl className="text-sm grid grid-cols-[130px_1fr] gap-y-1.5">
              <dt className="text-ink-soft">Nasabah</dt><dd className="font-bold">{d.customer_nama}</dd>
              <dt className="text-ink-soft">Lokasi</dt><dd>{d.location_nama}</dd>
              <dt className="text-ink-soft">Rekening BSI</dt><dd className="tnum font-bold">{d.bsi_account_no}</dd>
              {isSA && d.saldo != null && <><dt className="text-ink-soft">Saldo tersedia</dt><dd className="tnum">{rp(d.saldo)}</dd></>}
              {d.transferred_at && <><dt className="text-ink-soft">Tanggal transfer</dt><dd>{fmtDate(d.transferred_at)}</dd></>}
            </dl>
            {d.reject_reason && <Alert tone="danger">Ditolak: {d.reject_reason}</Alert>}
            {d.cancel_reason && <Alert tone="danger">Dibatalkan: {d.cancel_reason}</Alert>}
            {!['ditolak', 'dibatalkan'].includes(d.status) || true ? <section><h3 className="font-bold mb-2">Status</h3><Stepper d={d} /></section> : null}

            {isSA && d.status === 'diajukan' && (
              <div className="flex gap-2"><button className="btn-primary flex-1" onClick={() => setVerify(true)}><Check size={16} />Verifikasi</button><button className="btn-danger flex-1" onClick={() => setReject(true)}><X size={16} />Tolak</button></div>
            )}
            {isSA && d.status === 'diverifikasi' && (
              <section className="rounded-ctl border border-line p-3 space-y-3">
                <h3 className="font-bold">Unggah bukti transfer</h3>
                <p className="text-xs text-ink-soft">Lakukan transfer lewat BYOND di luar sistem, lalu unggah bukti (JPG, PNG, atau PDF, maks. 5 MB).</p>
                {err && <Alert tone="danger">{err}</Alert>}
                <Field label="Tanggal transfer" required>{(i) => <input id={i} type="date" className="input" max={todayWib()} value={tdate} onChange={(e) => setTdate(e.target.value)} />}</Field>
                <Field label="Berkas bukti" required>{(i) => <input id={i} type="file" accept=".jpg,.jpeg,.png,.pdf" className="input py-2" onChange={(e) => setFile(e.target.files?.[0] ?? null)} />}</Field>
                <button className="btn-primary w-full" disabled={!file || !tdate || busy} onClick={upload}>{busy ? <Spinner /> : <FileUp size={16} />}Unggah & Selesaikan</button>
              </section>
            )}
            {isSA && d.proofs?.length > 0 && (
              <section><h3 className="font-bold mb-2">Bukti transfer</h3>
                <ul className="divide-y divide-line border border-line rounded-ctl">{d.proofs.map((p: any, i: number) => (
                  <li key={p.id} className="flex items-center justify-between gap-2 p-3 text-sm"><span className="min-w-0"><b>Versi {p.version}</b>{i === 0 && <span className="text-xs text-teal-dark font-bold"> (terbaru)</span>}<br /><span className="text-xs text-ink-soft break-all">{p.file_name} • {p.uploaded_by_nama} • {fmtDateTime(p.uploaded_at)}</span>{p.correction_reason && <><br /><span className="text-xs">Koreksi: {p.correction_reason}</span></>}</span>
                    <button className="btn-outline btn-sm shrink-0" onClick={() => viewProof(p.id)}><ExternalLink size={14} />Lihat</button></li>))}</ul>
                {d.status === 'transfer_selesai' && <button className="btn-outline btn-sm mt-2" onClick={() => setCorrect(true)}><FileUp size={16} />Koreksi Bukti</button>}
              </section>
            )}
            {!isSA && d.has_proof && <p className="text-sm text-teal-dark font-bold">Bukti transfer telah diarsipkan oleh Super Admin.</p>}
            <div className="flex flex-wrap gap-2">
              {d.status === 'transfer_selesai' && <button className="btn-outline btn-sm" onClick={() => setReceipt(true)}><Receipt size={16} />Struk Konversi</button>}
              {canCancel && <button className="btn-outline btn-sm text-danger" onClick={() => setCancel(true)}><Ban size={16} />Batalkan konversi</button>}
            </div>
          </div>
        )}
      </Loadable>
      <ConfirmDialog open={verify} title="Verifikasi konversi" message={`Data ${d?.cnv_no} lolos pemeriksaan dan siap ditransfer lewat BYOND?`} confirmLabel="Verifikasi" onClose={() => setVerify(false)}
        onConfirm={async () => { try { await api(`/conversions/${id}/verify`, { method: 'POST' }); toast.ok('Konversi diverifikasi.'); setVerify(false); done(); } catch (e) { toast.err(errMsg(e)); } }} />
      <ReasonDialog open={reject} title="Tolak konversi" confirmLabel="Tolak konversi" message="Dana akan kembali ke saldo tersedia nasabah dan Admin Lokasi akan menerima notifikasi." onClose={() => setReject(false)}
        onConfirm={async (reason) => { await api(`/conversions/${id}/reject`, { method: 'POST', body: { reason } }); toast.ok('Konversi ditolak.'); setReject(false); done(); }} />
      <ReasonDialog open={cancel} title="Batalkan konversi" confirmLabel="Batalkan konversi" message="Dana akan kembali ke saldo tersedia nasabah." onClose={() => setCancel(false)}
        onConfirm={async (reason) => { await api(`/conversions/${id}/cancel`, { method: 'POST', body: { reason } }); toast.ok('Konversi dibatalkan.'); setCancel(false); done(); }} />
      <CorrectProof open={correct} id={id} onClose={() => setCorrect(false)} onDone={() => { setCorrect(false); done(); }} />
      <ReceiptDialog kind="cnv" id={receipt ? id : null} onClose={() => setReceipt(false)} />
    </Drawer>
  );
}

function CorrectProof({ open, id, onClose, onDone }: { open: boolean; id: number; onClose: () => void; onDone: () => void }) {
  const toast = useToast();
  const [file, setFile] = useState<File | null>(null);
  useEffect(() => { if (open) setFile(null); }, [open]);
  return (
    <ReasonDialog open={open} title="Koreksi bukti transfer" confirmLabel="Simpan koreksi" danger={false} onClose={onClose}
      message="Berkas lama tetap tersimpan sebagai versi sebelumnya dan koreksi tercatat di log audit."
      extra={<Field label="Berkas bukti baru" required>{(i) => <input id={i} type="file" accept=".jpg,.jpeg,.png,.pdf" className="input py-2" onChange={(e) => setFile(e.target.files?.[0] ?? null)} />}</Field>}
      onConfirm={async (reason) => {
        if (!file) throw new Error('Pilih berkas bukti baru.');
        const fd = new FormData(); fd.append('file', file); fd.append('reason', reason);
        await api(`/conversions/${id}/proof/correct`, { method: 'POST', form: fd }); toast.ok('Bukti dikoreksi (versi baru tersimpan).'); onDone();
      }} />
  );
}
