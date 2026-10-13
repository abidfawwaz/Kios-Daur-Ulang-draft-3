import { FormEvent, useState } from 'react';
import { Eye, EyeOff, LogIn } from 'lucide-react';
import { useAuth } from '../lib/auth';
import { Alert, Field, Spinner, errMsg } from '../components/ui';

export default function Login() {
  const { login, notice } = useAuth();
  const [email, setEmail] = useState('');
  const [password, setPassword] = useState('');
  const [show, setShow] = useState(false);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState('');

  const submit = async (e: FormEvent) => {
    e.preventDefault(); setBusy(true); setError('');
    try { await login(email, password); } catch (err) { setError(errMsg(err)); } finally { setBusy(false); }
  };

  return (
    <div className="min-h-full grid lg:grid-cols-2">
      <section className="relative overflow-hidden text-white p-8 lg:p-14 flex flex-col justify-between min-h-[220px]" style={{ background: 'var(--teal-dark)' }}>
        <svg className="absolute inset-0 w-full h-full opacity-[.12]" aria-hidden>
          <defs><pattern id="geo" width="64" height="64" patternUnits="userSpaceOnUse"><path d="M32 0 64 32 32 64 0 32Z" fill="none" stroke="#fff" strokeWidth="1.2" /><circle cx="32" cy="32" r="6" fill="none" stroke="#F8AD3C" strokeWidth="1.2" /></pattern></defs>
          <rect width="100%" height="100%" fill="url(#geo)" />
        </svg>
        <div className="relative flex items-center gap-3">
          <img src="/assets/logo-bsi.svg" alt="Bank Syariah Indonesia" className="h-10" />
          <img src="/assets/logo-kepul.svg" alt="Kepul" className="h-10" />
        </div>
        <div className="relative mt-10 lg:mt-0">
          <p className="text-gold font-bold tracking-[.2em] text-xs mb-3">BSI x KEPUL</p>
          <h2 className="text-[34px] lg:text-[44px] leading-tight font-bold">Ubah Sampah<br />Jadi Emas</h2>
          <p className="mt-4 text-white/80 max-w-md hidden sm:block">Dashboard pencatatan, pemantauan, dan pelaporan program kios daur ulang dengan konversi menjadi Tabungan Emas BSI.</p>
        </div>
        <p className="relative text-xs text-white/60 hidden lg:block">© {new Date().getFullYear()} PT Bank Syariah Indonesia Tbk</p>
      </section>

      <section className="flex items-center justify-center p-6 lg:p-14 bg-white">
        <form onSubmit={submit} className="w-full max-w-sm space-y-5" noValidate>
          <div>
            <h1 className="text-[28px] font-bold text-teal-dark">Masuk</h1>
            <p className="text-ink-soft mt-1">Assalamu'alaikum. Silakan masuk dengan akun Anda.</p>
          </div>
          {notice && <Alert tone="gold">{notice}</Alert>}
          {error && <Alert tone="danger">{error}</Alert>}
          <Field label="Email">{(id) => <input id={id} className="input" type="email" autoComplete="username" value={email} onChange={(e) => setEmail(e.target.value)} required autoFocus />}</Field>
          <Field label="Kata sandi">
            {(id) => (
              <div className="relative">
                <input id={id} className="input pr-12" type={show ? 'text' : 'password'} autoComplete="current-password" value={password} onChange={(e) => setPassword(e.target.value)} required />
                <button type="button" onClick={() => setShow(!show)} className="absolute right-1 top-1/2 -translate-y-1/2 p-2.5 text-ink-soft" aria-label={show ? 'Sembunyikan kata sandi' : 'Tampilkan kata sandi'}>{show ? <EyeOff size={18} /> : <Eye size={18} />}</button>
              </div>
            )}
          </Field>
          <button className="btn-primary w-full min-h-[48px]" disabled={busy || !email || !password}>{busy ? <Spinner /> : <LogIn size={18} />}Masuk</button>
          <p className="text-xs text-ink-soft">Lupa kata sandi? Hubungi Super Admin unit ESG BSI untuk mengatur ulang.</p>
        </form>
      </section>
    </div>
  );
}
