import { FormEvent, useState } from 'react';
import { KeyRound } from 'lucide-react';
import { api } from '../lib/api';
import { useAuth } from '../lib/auth';
import { Alert, Field, Spinner, errMsg } from '../components/ui';

export default function ChangePassword() {
  const { user, refresh, logout } = useAuth();
  const [cur, setCur] = useState('');
  const [pw, setPw] = useState('');
  const [pw2, setPw2] = useState('');
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState('');
  const rulesOk = pw.length >= 12 && /[A-Za-z]/.test(pw) && /\d/.test(pw);
  const match = pw === pw2 && pw2.length > 0;

  const submit = async (e: FormEvent) => {
    e.preventDefault(); setBusy(true); setError('');
    try { await api('/auth/change-password', { method: 'POST', body: { current: cur, next: pw } }); await refresh(); }
    catch (err) { setError(errMsg(err)); } finally { setBusy(false); }
  };
  return (
    <div className="min-h-full flex items-center justify-center p-4 bg-page">
      <form onSubmit={submit} className="card w-full max-w-md p-6 space-y-4">
        <div className="flex items-center gap-3">
          <span className="h-11 w-11 rounded-full bg-gold-tint text-[#9A6200] flex items-center justify-center"><KeyRound size={22} /></span>
          <div><h1 className="text-xl font-bold text-teal-dark">Ganti kata sandi</h1><p className="text-sm text-ink-soft">Halo {user?.nama}. Kata sandi sementara wajib diganti sebelum Anda memakai aplikasi.</p></div>
        </div>
        {error && <Alert tone="danger">{error}</Alert>}
        <Field label="Kata sandi sementara saat ini">{(id) => <input id={id} className="input" type="password" autoComplete="current-password" value={cur} onChange={(e) => setCur(e.target.value)} />}</Field>
        <Field label="Kata sandi baru" hint="Minimal 12 karakter, berisi huruf dan angka.">{(id) => <input id={id} className="input" type="password" autoComplete="new-password" value={pw} onChange={(e) => setPw(e.target.value)} />}</Field>
        <Field label="Ulangi kata sandi baru" error={pw2 && !match ? 'Kata sandi tidak sama.' : null}>{(id) => <input id={id} className="input" type="password" autoComplete="new-password" value={pw2} onChange={(e) => setPw2(e.target.value)} />}</Field>
        <div className="flex gap-2 justify-between">
          <button type="button" className="btn-outline" onClick={logout}>Keluar</button>
          <button className="btn-primary" disabled={busy || !cur || !rulesOk || !match}>{busy && <Spinner />}Simpan kata sandi</button>
        </div>
      </form>
    </div>
  );
}
