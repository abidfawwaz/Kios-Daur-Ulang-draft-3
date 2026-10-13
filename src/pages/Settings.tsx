import { useEffect, useState } from 'react';
import { Copy, Download, KeyRound, Pencil, Plus } from 'lucide-react';
import { api, downloadFile, qs, useApi } from '../lib/api';
import { useAuth } from '../lib/auth';
import { fmtDateTime } from '../lib/format';
import { Alert, Badge, Card, ConfirmDialog, Col, DataTable, EmptyState, Field, Loadable, Modal, Pagination, Spinner, Tabs, errMsg, useToast } from '../components/ui';
import { ROLE_LABEL } from '../components/Layout';

type Tab = 'pengguna' | 'lokasi' | 'audit' | 'parameter';
export default function Settings() {
  const [tab, setTab] = useState<Tab>('pengguna');
  return (
    <div className="space-y-4">
      <Tabs<Tab> value={tab} onChange={setTab} tabs={[{ id: 'pengguna', label: 'Pengguna' }, { id: 'lokasi', label: 'Lokasi' }, { id: 'audit', label: 'Log Audit' }, { id: 'parameter', label: 'Parameter' }]} />
      {tab === 'pengguna' && <Users />}
      {tab === 'lokasi' && <Locations />}
      {tab === 'audit' && <Audit />}
      {tab === 'parameter' && <Params />}
    </div>
  );
}

/* ------------------------------ Pengguna ------------------------------ */
function Users() {
  const { user, refreshMeta } = useAuth();
  const toast = useToast();
  const { data, loading, error, reload } = useApi<{ rows: any[] }>('/admin/users');
  const [edit, setEdit] = useState<any | 'new' | null>(null);
  const [reset, setReset] = useState<any>(null);
  const [secret, setSecret] = useState<{ nama: string; pw: string } | null>(null);

  const cols: Col<any>[] = [
    { key: 'n', header: 'Nama', mobile: 'title', render: (r) => <b>{r.nama}</b> },
    { key: 'e', header: 'Email', render: (r) => r.email },
    { key: 'r', header: 'Peran', render: (r) => <Badge tone={r.role === 'super_admin' ? 'gold' : 'slate'}>{ROLE_LABEL[r.role as keyof typeof ROLE_LABEL]}</Badge> },
    { key: 'l', header: 'Lokasi', render: (r) => r.location_nama ?? 'Semua lokasi' },
    { key: 'st', header: 'Status', render: (r) => <Badge tone={r.is_active ? 'teal' : 'muted'}>{r.is_active ? 'Aktif' : 'Nonaktif'}</Badge> },
    { key: 'll', header: 'Login terakhir', render: (r) => fmtDateTime(r.last_login_at) },
    { key: 'a', header: 'Aksi', render: (r) => (
      <div className="flex gap-1 flex-wrap">
        <button className="btn-ghost btn-sm" onClick={() => setEdit(r)}><Pencil size={16} />Ubah</button>
        <button className="btn-ghost btn-sm" onClick={() => setReset(r)} disabled={r.id === user!.id}><KeyRound size={16} />Reset sandi</button>
      </div>) },
  ];
  return (
    <div className="space-y-4">
      <div className="flex justify-end"><button className="btn-primary" onClick={() => setEdit('new')}><Plus size={16} />Tambah Pengguna</button></div>
      <Card className="p-4">
        <Loadable loading={loading} error={error} reload={reload} hasData={!!data} empty={!data?.rows.length} emptyNode={<EmptyState title="Belum ada pengguna" />}>
          {data && <DataTable cols={cols} rows={data.rows} rowKey={(r) => r.id} rowClass={(r) => (r.is_active ? '' : 'opacity-60')} />}
        </Loadable>
      </Card>
      {edit && <UserForm user={edit === 'new' ? null : edit} onClose={() => setEdit(null)} onDone={(pw, nama) => { setEdit(null); reload(); refreshMeta(); if (pw) setSecret({ nama, pw }); }} />}
      <ConfirmDialog open={!!reset} title="Reset kata sandi" confirmLabel="Reset" onClose={() => setReset(null)}
        message={`Buat kata sandi sementara baru untuk ${reset?.nama}? Kata sandi hanya ditampilkan sekali dan pengguna wajib menggantinya saat login.`}
        onConfirm={async () => { try { const r = await api<any>(`/admin/users/${reset.id}/reset-password`, { method: 'POST' }); const n = reset.nama; setReset(null); setSecret({ nama: n, pw: r.temporary_password }); reload(); } catch (e) { toast.err(errMsg(e)); } }} />
      <SecretDialog secret={secret} onClose={() => setSecret(null)} />
    </div>
  );
}

function SecretDialog({ secret, onClose }: { secret: { nama: string; pw: string } | null; onClose: () => void }) {
  const toast = useToast();
  return (
    <Modal open={!!secret} title="Kata sandi sementara" size="sm" onClose={onClose} footer={<button className="btn-primary" onClick={onClose}>Saya sudah menyalin</button>}>
      <div className="space-y-3">
        <Alert tone="gold">Kata sandi ini hanya ditampilkan <b>sekali</b>. Berikan kepada {secret?.nama} lewat kanal terpisah. Pengguna wajib menggantinya saat login pertama.</Alert>
        <div className="flex gap-2"><input readOnly className="input font-mono" value={secret?.pw ?? ''} aria-label="Kata sandi sementara" onFocus={(e) => e.target.select()} />
          <button className="btn-outline" onClick={() => { navigator.clipboard?.writeText(secret!.pw).then(() => toast.ok('Disalin.')).catch(() => toast.err('Gagal menyalin.')); }} aria-label="Salin"><Copy size={16} /></button></div>
      </div>
    </Modal>
  );
}

function UserForm({ user, onClose, onDone }: { user: any | null; onClose: () => void; onDone: (pw: string | null, nama: string) => void }) {
  const { meta } = useAuth();
  const toast = useToast();
  const [v, setV] = useState({ nama: user?.nama ?? '', email: user?.email ?? '', role: user?.role ?? 'admin_lokasi', location_id: String(user?.location_id ?? ''), is_active: user ? !!user.is_active : true });
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState('');
  const valid = v.nama.trim().length > 1 && /^\S+@\S+\.\S+$/.test(v.email) && (v.role !== 'admin_lokasi' || !!v.location_id);
  const save = async () => {
    setBusy(true); setError('');
    try {
      const body = { nama: v.nama, email: v.email, role: v.role, location_id: v.role === 'admin_lokasi' ? Number(v.location_id) : null, is_active: v.is_active };
      if (user) { await api(`/admin/users/${user.id}`, { method: 'PUT', body }); toast.ok('Pengguna diperbarui.'); onDone(null, v.nama); }
      else { const r = await api<any>('/admin/users', { method: 'POST', body }); toast.ok('Pengguna dibuat.'); onDone(r.temporary_password, v.nama); }
    } catch (e) { setError(errMsg(e)); } finally { setBusy(false); }
  };
  return (
    <Modal open onClose={onClose} title={user ? 'Ubah Pengguna' : 'Tambah Pengguna'} footer={<><button className="btn-outline" onClick={onClose}>Batal</button><button className="btn-primary" disabled={!valid || busy} onClick={save}>{busy && <Spinner />}Simpan</button></>}>
      <div className="space-y-4">
        {error && <Alert tone="danger">{error}</Alert>}
        <Field label="Nama" required>{(i) => <input id={i} className="input" value={v.nama} onChange={(e) => setV({ ...v, nama: e.target.value })} />}</Field>
        <Field label="Email" required hint={user ? 'Email tidak dapat diubah.' : undefined}>{(i) => <input id={i} type="email" className="input" disabled={!!user} value={v.email} onChange={(e) => setV({ ...v, email: e.target.value })} />}</Field>
        <Field label="Peran" required>{(i) => <select id={i} className="input" value={v.role} onChange={(e) => setV({ ...v, role: e.target.value })}><option value="admin_lokasi">Admin Lokasi</option><option value="super_admin">Super Admin</option><option value="bsi_viewer">BSI Viewer</option></select>}</Field>
        {v.role === 'admin_lokasi' && <Field label="Lokasi" required>{(i) => <select id={i} className="input" value={v.location_id} onChange={(e) => setV({ ...v, location_id: e.target.value })}><option value="">Pilih lokasi…</option>{meta!.locations.filter((l) => l.is_active || String(l.id) === v.location_id).map((l) => <option key={l.id} value={l.id}>{l.nama}</option>)}</select>}</Field>}
        {user && <label className="flex items-center gap-2 text-sm font-bold"><input type="checkbox" className="h-5 w-5" checked={v.is_active} onChange={(e) => setV({ ...v, is_active: e.target.checked })} />Akun aktif</label>}
        {!user && <p className="text-xs text-ink-soft">Kata sandi sementara acak akan dibuat dan ditampilkan sekali setelah disimpan.</p>}
      </div>
    </Modal>
  );
}

/* ------------------------------ Lokasi ------------------------------ */
function Locations() {
  const { refreshMeta } = useAuth();
  const toast = useToast();
  const { data, loading, error, reload } = useApi<{ rows: any[] }>('/admin/locations');
  const [edit, setEdit] = useState<any | 'new' | null>(null);
  const cols: Col<any>[] = [
    { key: 'n', header: 'Lokasi', mobile: 'title', render: (r) => <b>{r.nama}</b> },
    { key: 'a', header: 'Alamat', render: (r) => r.alamat ?? '-' },
    { key: 't', header: 'Target bulanan', align: 'right', render: (r) => (r.target_kg_bulanan ? `${r.target_kg_bulanan} kg` : 'Belum diatur') },
    { key: 's', header: 'Status', render: (r) => <Badge tone={r.is_active ? 'teal' : 'muted'}>{r.is_active ? 'Aktif' : 'Nonaktif'}</Badge> },
    { key: 'x', header: 'Aksi', render: (r) => <button className="btn-ghost btn-sm" onClick={() => setEdit(r)}><Pencil size={16} />Ubah</button> },
  ];
  return (
    <div className="space-y-4">
      <div className="flex justify-end"><button className="btn-primary" onClick={() => setEdit('new')}><Plus size={16} />Tambah Lokasi</button></div>
      <Card className="p-4"><Loadable loading={loading} error={error} reload={reload} hasData={!!data} empty={!data?.rows.length} emptyNode={<EmptyState title="Belum ada lokasi" />}>{data && <DataTable cols={cols} rows={data.rows} rowKey={(r) => r.id} />}</Loadable></Card>
      {edit && <LocationForm loc={edit === 'new' ? null : edit} onClose={() => setEdit(null)} onDone={() => { setEdit(null); reload(); refreshMeta(); toast.ok('Lokasi disimpan.'); }} />}
    </div>
  );
}
function LocationForm({ loc, onClose, onDone }: { loc: any | null; onClose: () => void; onDone: () => void }) {
  const [v, setV] = useState({ nama: loc?.nama ?? '', alamat: loc?.alamat ?? '', target: loc?.target_kg_bulanan ? String(loc.target_kg_bulanan) : '', is_active: loc ? !!loc.is_active : true });
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState('');
  const save = async () => {
    setBusy(true); setError('');
    try {
      const body = { nama: v.nama, alamat: v.alamat, target_kg_bulanan: v.target === '' ? null : Number(v.target), is_active: v.is_active };
      if (loc) await api(`/admin/locations/${loc.id}`, { method: 'PUT', body }); else await api('/admin/locations', { method: 'POST', body });
      onDone();
    } catch (e) { setError(errMsg(e)); } finally { setBusy(false); }
  };
  return (
    <Modal open onClose={onClose} title={loc ? 'Ubah Lokasi' : 'Tambah Lokasi'} footer={<><button className="btn-outline" onClick={onClose}>Batal</button><button className="btn-primary" disabled={v.nama.trim().length < 2 || busy} onClick={save}>{busy && <Spinner />}Simpan</button></>}>
      <div className="space-y-4">
        {error && <Alert tone="danger">{error}</Alert>}
        <Field label="Nama lokasi" required>{(i) => <input id={i} className="input" value={v.nama} onChange={(e) => setV({ ...v, nama: e.target.value })} />}</Field>
        <Field label="Alamat">{(i) => <input id={i} className="input" value={v.alamat} onChange={(e) => setV({ ...v, alamat: e.target.value })} />}</Field>
        <Field label="Target bulanan (kg)" hint="Opsional. Kosongkan bila belum diatur.">{(i) => <input id={i} className="input tnum" inputMode="decimal" value={v.target} onChange={(e) => setV({ ...v, target: e.target.value.replace(/[^0-9.]/g, '') })} />}</Field>
        {loc && <label className="flex items-center gap-2 text-sm font-bold"><input type="checkbox" className="h-5 w-5" checked={v.is_active} onChange={(e) => setV({ ...v, is_active: e.target.checked })} />Lokasi aktif <span className="font-normal text-ink-soft">(nonaktif tetap tampil di laporan)</span></label>}
      </div>
    </Modal>
  );
}

/* ------------------------------ Log audit ------------------------------ */
function Audit() {
  const toast = useToast();
  const users = useApi<{ rows: any[] }>('/admin/users');
  const [f, setF] = useState({ from: '', to: '', user_id: '', action: '', entity: '' });
  const [page, setPage] = useState(1);
  useEffect(() => setPage(1), [f]);
  const { data, loading, error, reload } = useApi<any>(`/admin/audit${qs({ ...f, page })}`);
  const [view, setView] = useState<any>(null);
  const cols: Col<any>[] = [
    { key: 'at', header: 'Waktu', mobile: 'title', render: (r) => <span className="tnum">{fmtDateTime(r.at)}</span> },
    { key: 'u', header: 'Pengguna', render: (r) => r.user_nama ?? '-' },
    { key: 'r', header: 'Peran', render: (r) => (r.role ? ROLE_LABEL[r.role as keyof typeof ROLE_LABEL] : '-') },
    { key: 'a', header: 'Aksi', render: (r) => <code className="text-xs">{r.action}</code> },
    { key: 'e', header: 'Entitas', render: (r) => `${r.entity}${r.entity_id ? ` #${r.entity_id}` : ''}` },
    { key: 'al', header: 'Alasan', render: (r) => <span className="line-clamp-1 max-w-[200px]">{r.reason ?? '-'}</span> },
    { key: 'd', header: '', render: (r) => <button className="btn-ghost btn-sm" onClick={(e) => { e.stopPropagation(); setView(r); }}>Rincian</button> },
  ];
  return (
    <div className="space-y-4">
      <Card className="p-4">
        <div className="flex flex-wrap items-end gap-3">
          <div><label className="label" htmlFor="a-f">Dari</label><input id="a-f" type="date" className="input" value={f.from} onChange={(e) => setF({ ...f, from: e.target.value })} /></div>
          <div><label className="label" htmlFor="a-t">Sampai</label><input id="a-t" type="date" className="input" value={f.to} onChange={(e) => setF({ ...f, to: e.target.value })} /></div>
          <div><label className="label" htmlFor="a-u">Pengguna</label><select id="a-u" className="input" value={f.user_id} onChange={(e) => setF({ ...f, user_id: e.target.value })}><option value="">Semua</option>{users.data?.rows.map((u) => <option key={u.id} value={u.id}>{u.nama}</option>)}</select></div>
          <div><label className="label" htmlFor="a-a">Aksi</label><input id="a-a" className="input" placeholder="mis. transaction" value={f.action} onChange={(e) => setF({ ...f, action: e.target.value })} /></div>
          <div><label className="label" htmlFor="a-e">Entitas</label><select id="a-e" className="input" value={f.entity} onChange={(e) => setF({ ...f, entity: e.target.value })}><option value="">Semua</option>{['transactions', 'customers', 'conversions', 'waste_types', 'profiles', 'locations', 'documents', 'app_settings', 'reports', 'route', 'api'].map((x) => <option key={x}>{x}</option>)}</select></div>
          <button className="btn-outline" onClick={() => downloadFile('/admin/audit/export').catch((e) => toast.err(errMsg(e)))}><Download size={16} />Ekspor CSV</button>
        </div>
        <p className="text-xs text-ink-soft mt-2">Log audit bersifat baca saja: tidak dapat diubah atau dihapus.</p>
      </Card>
      <Card className="p-4">
        <Loadable loading={loading} error={error} reload={reload} hasData={!!data} empty={!data?.rows.length} emptyNode={<EmptyState title="Tidak ada catatan" text="Belum ada aktivitas yang cocok dengan filter." />}>
          {data && <><DataTable cols={cols} rows={data.rows} rowKey={(r) => r.id} onRowClick={setView} /><Pagination page={data.page} size={data.size} total={data.total} onPage={setPage} /></>}
        </Loadable>
      </Card>
      <Modal open={!!view} title="Rincian aktivitas" size="lg" onClose={() => setView(null)} footer={<button className="btn-primary" onClick={() => setView(null)}>Tutup</button>}>
        {view && (
          <div className="space-y-3 text-sm">
            <dl className="grid grid-cols-[110px_1fr] gap-y-1"><dt className="text-ink-soft">Waktu</dt><dd>{fmtDateTime(view.at)}</dd><dt className="text-ink-soft">Pengguna</dt><dd>{view.user_nama} ({view.role})</dd><dt className="text-ink-soft">Aksi</dt><dd><code>{view.action}</code></dd><dt className="text-ink-soft">Entitas</dt><dd>{view.entity} #{view.entity_id}</dd><dt className="text-ink-soft">Alasan</dt><dd>{view.reason ?? '-'}</dd></dl>
            <div className="grid md:grid-cols-2 gap-3">
              {(['before', 'after'] as const).map((k) => <div key={k}><p className="font-bold mb-1">{k === 'before' ? 'Sebelum' : 'Sesudah'}</p><pre className="bg-page rounded-ctl p-3 text-xs overflow-auto max-h-64 whitespace-pre-wrap break-all">{view[k] ? JSON.stringify(JSON.parse(view[k]), null, 2) : '-'}</pre></div>)}
            </div>
          </div>
        )}
      </Modal>
    </div>
  );
}

/* ------------------------------ Parameter ------------------------------ */
function Params() {
  const toast = useToast();
  const { refreshMeta } = useAuth();
  const { data, loading, error, reload } = useApi<{ settings: Record<string, number> }>('/admin/settings');
  const [v, setV] = useState<Record<string, string>>({});
  const [busy, setBusy] = useState(false);
  useEffect(() => { if (data) setV(Object.fromEntries(Object.entries(data.settings).map(([k, x]) => [k, String(x)]))); }, [data]);
  const rows = [
    { k: 'min_conversion', label: 'Minimum konversi (Rp)', hint: 'Saldo tersedia minimal ini dianggap eligible (inklusif).' },
    { k: 'existing_threshold', label: 'Ambang status Existing (transaksi sukses)', hint: 'Nasabah dengan transaksi sukses ≥ nilai ini berstatus Existing.' },
    { k: 'backdate_days', label: 'Batas tanggal mundur tanpa alasan (hari)', hint: 'Lebih dari ini wajib mengisi alasan.' },
    { k: 'session_minutes', label: 'Batas waktu sesi tidak aktif (menit)', hint: 'Berlaku untuk seluruh pengguna.' },
  ];
  const save = async () => {
    setBusy(true);
    try { await api('/admin/settings', { method: 'PUT', body: Object.fromEntries(Object.entries(v).map(([k, x]) => [k, Number(x)])) }); toast.ok('Parameter disimpan. Berlaku untuk transaksi baru.'); reload(); refreshMeta(); }
    catch (e) { toast.err(errMsg(e)); } finally { setBusy(false); }
  };
  return (
    <Card className="p-5 max-w-2xl">
      <Loadable loading={loading} error={error} reload={reload} hasData={!!data}>
        <div className="space-y-4">
          {rows.map((r) => <Field key={r.k} label={r.label} hint={r.hint}>{(i) => <input id={i} className="input tnum max-w-xs" inputMode="numeric" value={v[r.k] ?? ''} onChange={(e) => setV({ ...v, [r.k]: e.target.value.replace(/\D/g, '') })} />}</Field>)}
          <p className="text-xs text-ink-soft">Setiap perubahan tercatat di Log Audit.</p>
          <button className="btn-primary" disabled={busy} onClick={save}>{busy && <Spinner />}Simpan parameter</button>
        </div>
      </Loadable>
    </Card>
  );
}
