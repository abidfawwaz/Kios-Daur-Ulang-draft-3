// Format Indonesia (BR-20): WIB, dd/mm/yyyy, "Rp 5.551.718", "2.571,87 kg".
const nf = new Intl.NumberFormat('id-ID', { maximumFractionDigits: 2 });
const nf2 = new Intl.NumberFormat('id-ID', { minimumFractionDigits: 2, maximumFractionDigits: 2 });
const nf0 = new Intl.NumberFormat('id-ID', { maximumFractionDigits: 0 });
export const num = (n: number | null | undefined) => nf.format(n ?? 0);
export const rp = (n: number | null | undefined) => 'Rp ' + nf0.format(Math.round(n ?? 0));
export const kg = (n: number | null | undefined) => nf2.format(n ?? 0) + ' kg';
export const pct = (n: number) => nf.format(n) + '%';
export const fmtDate = (d?: string | null) => (d ? `${d.slice(8, 10)}/${d.slice(5, 7)}/${d.slice(0, 4)}` : '-');
export const fmtDateTime = (iso?: string | null) => {
  if (!iso) return '-';
  const w = new Date(new Date(iso).getTime() + 7 * 3600e3).toISOString();
  return `${fmtDate(w.slice(0, 10))} ${w.slice(11, 16)} WIB`;
};
export const todayWib = () => new Date(Date.now() + 7 * 3600e3).toISOString().slice(0, 10);
export const addDays = (d: string, n: number) => new Date(Date.parse(d) + n * 86400e3).toISOString().slice(0, 10);

export const STATUS_KONVERSI: Record<string, string> = {
  diajukan: 'Diajukan', diverifikasi: 'Diverifikasi', transfer_selesai: 'Transfer Selesai', ditolak: 'Ditolak', dibatalkan: 'Dibatalkan',
};
export const JENIS: Record<string, string> = { individu: 'Individu', usaha: 'Usaha', institusi: 'Institusi' };
