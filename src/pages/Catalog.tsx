import { useRef, useState } from 'react';
import { History as HistoryIcon, Plus, Tag } from 'lucide-react';
import { api, useApi } from '../lib/api';
import { useAuth } from '../lib/auth';
import { fmtDate, rp, todayWib } from '../lib/format';
import { Alert, Badge, Card, ConfirmDialog, Col, DataTable, Drawer, EmptyState, Field, Loadable, Modal, ReasonDialog, Spinner, errMsg, useToast } from '../components/ui';

export default function Catalog() {
  const { user, meta } = useAuth();
  const toast = useToast();
  const isSA = user!.role === 'super_admin';
  const { data, loading, error, reload } = useApi<{ rows: any[] }>('/waste-types');
  const [price, setPrice] = useState<any>(null);
  const [hist, setHist] = useState<any>(null);
  const [adding, setAdding] = useState(false);
  const [toggle, setToggle] = useState<any>(null);

  const cols: Col<any>[] = [
    { key: 'nama', header: 'Jenis sampah', mobile: 'title', render: (r) => <span className={r.is_active ? 'font-bold' : 'text-ink-soft'}>{r.nama}</span> },
    { key: 'kat', header: 'Kategori', render: (r) => <span className="inline-flex items-center gap-2"><span className="h-3 w-3 rounded-sm" style={{ background: r.warna }} />{r.kategori}</span> },
    { key: 'unit', header: 'Satuan', render: (r) => r.unit },
    { key: 'harga', header: 'Harga', align: 'right', render: (r) => <b>{rp(r.price)}<span className="font-normal text-ink-soft">/{r.unit}</span></b> },
    { key: 'st', header: 'Status', render: (r) => <Badge tone={r.is_active ? 'teal' : 'muted'}>{r.is_active ? 'Aktif' : 'Nonaktif'}</Badge> },
    { key: 'aksi', header: 'Aksi', render: (r) => (
      <div className="flex gap-1 flex-wrap">
        <button className="btn-ghost btn-sm" onClick={() => setHist(r)}><HistoryIcon size={16} />Riwayat</button>
        {isSA && <><button className="btn-ghost btn-sm" onClick={() => setPrice(r)}><Tag size={16} />Ubah Harga</button>
          <button className="btn-ghost btn-sm" onClick={() => setToggle(r)}>{r.is_active ? 'Nonaktifkan' : 'Aktifkan'}</button></>}
      </div>) },
  ];

  return (
    <div className="space-y-4">
      <Card className="p-4 flex flex-wrap items-center justify-between gap-3">
        <p className="text-sm text-ink-soft max-w-2xl">Harga dikunci pada setiap transaksi saat disimpan. Perubahan harga tidak pernah mengubah transaksi lama, dan setiap perubahan tercatat beserta alasannya.</p>
        {isSA && <button className="btn-primary" onClick={() => setAdding(true)}><Plus size={16} />Tambah Jenis</button>}
      </Card>
      <Card className="p-4">
        <Loadable loading={loading} error={error} reload={reload} hasData={!!data} empty={!data?.rows.length} emptyNode={<EmptyState title="Katalog kosong" text="Tambahkan jenis sampah pertama." />}>
          {data && <DataTable cols={cols} rows={data.rows} rowKey={(r) => r.id} rowClass={(r) => (r.is_active ? '' : 'opacity-70')} />}
        </Loadable>
      </Card>
      {price && <PriceDialog row={price} onClose={() => setPrice(null)} onDone={() => { setPrice(null); reload(); }} />}
      {hist && <HistoryDrawer row={hist} onClose={() => setHist(null)} />}
      {adding && <AddType categories={meta!.categories} onClose={() => setAdding(false)} onDone={() => { setAdding(false); reload(); }} />}
      <ConfirmDialog open={!!toggle} title={toggle?.is_active ? 'Nonaktifkan jenis sampah' : 'Aktifkan jenis sampah'} confirmLabel={toggle?.is_active ? 'Nonaktifkan' : 'Aktifkan'} onClose={() => setToggle(null)}
        message={toggle?.is_active ? `"${toggle?.nama}" tidak akan muncul di form transaksi baru, tetapi tetap tampil pada data dan laporan lama.` : `"${toggle?.nama}" akan muncul kembali di form transaksi baru.`}
        onConfirm={async () => { try { await api(`/waste-types/${toggle.id}`, { method: 'PATCH', body: { is_active: !toggle.is_active } }); toast.ok('Status jenis sampah diperbarui.'); setToggle(null); reload(); } catch (e) { toast.err(errMsg(e)); } }} />
    </div>
  );
}

function PriceDialog({ row, onClose, onDone }: { row: any; onClose: () => void; onDone: () => void }) {
  const toast = useToast();
  const [price, setPrice] = useState(String(row.price ?? ''));
  const [eff, setEff] = useState(todayWib());
  const [jump, setJump] = useState<string | null>(null);
  const pending = useRef('');
  const valid = Number.isInteger(Number(price)) && Number(price) > 0 && Number(price) !== row.price;
  const save = async (reason: string, confirm_jump = false) => {
    try {
      await api(`/waste-types/${row.id}/price`, { method: 'PUT', body: { price: Number(price), effective_from: eff, reason, confirm_jump } });
      toast.ok(`Harga ${row.nama} diperbarui.`); onDone();
    } catch (e: any) {
      if (e.code === 'PRICE_JUMP') { pending.current = reason; setJump(e.message); return; }
      throw e;
    }
  };
  return (
    <>
      <ReasonDialog open title={`Ubah harga — ${row.nama}`} confirmLabel="Simpan harga" danger={false} onClose={onClose}
        message={`Harga saat ini ${rp(row.price)}/${row.unit}. Transaksi lama tidak berubah.`}
        extra={<div className="grid grid-cols-2 gap-3">
          <Field label={`Harga baru (Rp/${row.unit})`} required>{(i) => <input id={i} className="input tnum" inputMode="numeric" value={price} onChange={(e) => setPrice(e.target.value.replace(/\D/g, ''))} />}</Field>
          <Field label="Berlaku mulai" required>{(i) => <input id={i} type="date" className="input" value={eff} onChange={(e) => setEff(e.target.value)} />}</Field>
        </div>}
        onConfirm={async (reason) => { if (!valid) throw new Error('Masukkan harga baru yang berbeda dari harga saat ini.'); await save(reason); }} />
      <ConfirmDialog open={!!jump} title="Perubahan harga besar" message={jump} confirmLabel="Tetap simpan" onClose={() => setJump(null)}
        onConfirm={async () => { try { await save(pending.current, true); setJump(null); } catch (e) { toast.err(errMsg(e)); } }} />
    </>
  );
}

function HistoryDrawer({ row, onClose }: { row: any; onClose: () => void }) {
  const { data, loading, error, reload } = useApi<{ rows: any[] }>(`/waste-types/${row.id}/history`);
  return (
    <Drawer open title={`Riwayat harga — ${row.nama}`} onClose={onClose}>
      <Loadable loading={loading} error={error} reload={reload} hasData={!!data}>
        <ol className="space-y-3">
          {data?.rows.map((h, i) => (
            <li key={h.id} className="rounded-ctl border border-line p-3 text-sm">
              <div className="flex justify-between items-center"><b className="text-base tnum">{rp(h.price_idr)}</b>{i === 0 && <Badge tone="teal">Terbaru</Badge>}</div>
              <p className="text-ink-soft">Berlaku mulai {fmtDate(h.effective_from)}{h.changed_by ? ` • oleh ${h.changed_by}` : ''}</p>
              {h.reason && <p className="mt-1">Alasan: {h.reason}</p>}
            </li>
          ))}
        </ol>
      </Loadable>
    </Drawer>
  );
}

function AddType({ categories, onClose, onDone }: { categories: any[]; onClose: () => void; onDone: () => void }) {
  const toast = useToast();
  const [v, setV] = useState({ nama: '', category_id: String(categories[0]?.id ?? ''), unit: 'kg', price: '' });
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState('');
  const valid = v.nama.trim().length >= 2 && Number(v.price) > 0;
  const save = async () => {
    setBusy(true); setError('');
    try { await api('/waste-types', { method: 'POST', body: { ...v, category_id: Number(v.category_id), price: Number(v.price) } }); toast.ok('Jenis sampah ditambahkan.'); onDone(); }
    catch (e) { setError(errMsg(e)); } finally { setBusy(false); }
  };
  return (
    <Modal open onClose={onClose} title="Tambah Jenis Sampah" footer={<><button className="btn-outline" onClick={onClose}>Batal</button><button className="btn-primary" disabled={!valid || busy} onClick={save}>{busy && <Spinner />}Simpan</button></>}>
      <div className="space-y-4">
        {error && <Alert tone="danger">{error}</Alert>}
        <Field label="Nama jenis" required>{(i) => <input id={i} className="input" value={v.nama} onChange={(e) => setV({ ...v, nama: e.target.value })} />}</Field>
        <Field label="Kategori" required>{(i) => <select id={i} className="input" value={v.category_id} onChange={(e) => setV({ ...v, category_id: e.target.value })}>{categories.map((c) => <option key={c.id} value={c.id}>{c.nama}</option>)}</select>}</Field>
        <Field label="Satuan" required hint="Satuan tidak dapat diubah setelah dipakai pada transaksi.">{(i) => <select id={i} className="input" value={v.unit} onChange={(e) => setV({ ...v, unit: e.target.value })}><option value="kg">kg (desimal sampai 2 angka)</option><option value="unit">unit (bilangan bulat)</option></select>}</Field>
        <Field label={`Harga (Rp per ${v.unit})`} required>{(i) => <input id={i} className="input tnum" inputMode="numeric" value={v.price} onChange={(e) => setV({ ...v, price: e.target.value.replace(/\D/g, '') })} />}</Field>
      </div>
    </Modal>
  );
}
