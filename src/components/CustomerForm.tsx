import { useEffect, useState } from 'react';
import { api } from '../lib/api';
import { Alert, Field, Modal, Spinner, useToast, errMsg } from './ui';

export interface CustomerFormValue { nama: string; whatsapp: string; jenis: string; bsi_account_no: string; is_active: boolean }
const EMPTY: CustomerFormValue = { nama: '', whatsapp: '', jenis: 'individu', bsi_account_no: '', is_active: true };

/** Tambah / ubah nasabah (FR-4.2). Nomor lengkap hanya dimuat di form ubah milik Admin Lokasi (FR-4.4). */
export function CustomerFormModal({ open, customerId, onClose, onSaved }: { open: boolean; customerId?: number | null; onClose: () => void; onSaved: (id: number) => void }) {
  const toast = useToast();
  const [v, setV] = useState<CustomerFormValue>(EMPTY);
  const [busy, setBusy] = useState(false);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState('');
  const [similar, setSimilar] = useState<{ id: number; nama: string }[]>([]);
  const editing = !!customerId;

  useEffect(() => {
    if (!open) return;
    setError(''); setSimilar([]); setV(EMPTY);
    if (customerId) {
      setLoading(true);
      api<any>(`/customers/${customerId}/full`).then((c) => setV({ nama: c.nama, whatsapp: c.whatsapp, jenis: c.jenis, bsi_account_no: c.bsi_account_no ?? '', is_active: c.is_active })).catch((e) => setError(errMsg(e))).finally(() => setLoading(false));
    }
  }, [open, customerId]);

  useEffect(() => {
    if (!open || v.nama.trim().length < 3) { setSimilar([]); return; }
    const t = setTimeout(() => api<{ rows: any[] }>(`/customers/similar?nama=${encodeURIComponent(v.nama)}&exclude=${customerId ?? 0}`).then((r) => setSimilar(r.rows)).catch(() => {}), 350);
    return () => clearTimeout(t);
  }, [v.nama, open, customerId]);

  const valid = v.nama.trim().length >= 2 && v.whatsapp.replace(/\D/g, '').length >= 9 && (!v.bsi_account_no || /^\d{10}$/.test(v.bsi_account_no));
  const save = async () => {
    setBusy(true); setError('');
    try {
      const body = { nama: v.nama.trim(), whatsapp: v.whatsapp, jenis: v.jenis, bsi_account_no: v.bsi_account_no || null };
      const r = editing
        ? await api<any>(`/customers/${customerId}`, { method: 'PUT', body: { ...body, is_active: v.is_active } })
        : await api<any>('/customers', { method: 'POST', body });
      toast.ok(editing ? 'Data nasabah diperbarui.' : 'Nasabah baru ditambahkan.');
      onSaved(r.id);
    } catch (e) { setError(errMsg(e)); } finally { setBusy(false); }
  };

  return (
    <Modal open={open} onClose={onClose} title={editing ? 'Ubah Nasabah' : 'Nasabah Baru'} footer={
      <><button className="btn-outline" onClick={onClose}>Batal</button><button className="btn-primary" disabled={!valid || busy || loading} onClick={save}>{busy && <Spinner />}Simpan</button></>}>
      <div className="space-y-4" aria-busy={loading}>
        {error && <Alert tone="danger">{error}</Alert>}
        <Field label="Nama nasabah" required>{(id) => <input id={id} className="input" value={v.nama} onChange={(e) => setV({ ...v, nama: e.target.value })} autoFocus />}</Field>
        {similar.length > 0 && <Alert tone="gold">Ada nasabah bernama serupa di lokasi ini: {similar.map((s) => s.nama).join(', ')}. Anda tetap dapat menyimpan bila ini orang yang berbeda.</Alert>}
        <Field label="Nomor WhatsApp" required hint="Contoh 081234567890. Satu nomor boleh dipakai beberapa nasabah.">{(id) => <input id={id} className="input" inputMode="tel" value={v.whatsapp} onChange={(e) => setV({ ...v, whatsapp: e.target.value })} />}</Field>
        <Field label="Jenis nasabah" required>{(id) => (
          <select id={id} className="input" value={v.jenis} onChange={(e) => setV({ ...v, jenis: e.target.value })}>
            <option value="individu">Individu</option><option value="usaha">Usaha</option><option value="institusi">Institusi</option>
          </select>)}</Field>
        <Field label="Nomor rekening BSI (opsional)" hint="10 digit angka." error={v.bsi_account_no && !/^\d{10}$/.test(v.bsi_account_no) ? 'Harus 10 digit angka.' : null}>
          {(id) => <input id={id} className="input" inputMode="numeric" maxLength={10} value={v.bsi_account_no} onChange={(e) => setV({ ...v, bsi_account_no: e.target.value.replace(/\D/g, '') })} />}
        </Field>
        {editing && (
          <label className="flex items-center gap-2 text-sm font-bold"><input type="checkbox" className="h-5 w-5" checked={v.is_active} onChange={(e) => setV({ ...v, is_active: e.target.checked })} />Nasabah aktif <span className="font-normal text-ink-soft">(nonaktifkan, bukan hapus)</span></label>
        )}
      </div>
    </Modal>
  );
}
