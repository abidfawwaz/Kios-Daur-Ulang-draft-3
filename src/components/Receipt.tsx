import { ReactNode, useRef, useState } from 'react';
import { Download, FileImage, MessageCircle } from 'lucide-react';
import { toJpeg } from 'html-to-image';
import { downloadFile, useApi } from '../lib/api';
import { fmtDate, kg, num, rp } from '../lib/format';
import { Loadable, Modal, Spinner, useToast, errMsg } from './ui';

/** Struk transaksi / konversi: pratinjau, unduh PDF/JPEG, bagikan WhatsApp (tautan wa.me berisi ringkasan; tanpa nomor lengkap). */
export function ReceiptDialog({ kind, id, onClose, footerExtra }: { kind: 'trx' | 'cnv'; id: number | null; onClose: () => void; footerExtra?: ReactNode }) {
  const toast = useToast();
  const ref = useRef<HTMLDivElement>(null);
  const [busy, setBusy] = useState('');
  const path = id ? (kind === 'trx' ? `/transactions/${id}` : `/conversions/${id}`) : null;
  const { data, loading, error, reload } = useApi<any>(path);

  const pdf = async () => {
    setBusy('pdf');
    try { await downloadFile(`${path}/receipt.pdf`); } catch (e) { toast.err(errMsg(e)); } finally { setBusy(''); }
  };
  const jpeg = async () => {
    if (!ref.current) return;
    setBusy('jpg');
    try {
      const url = await toJpeg(ref.current, { quality: 0.95, backgroundColor: '#ffffff', pixelRatio: 2 });
      const a = document.createElement('a'); a.href = url; a.download = `${kind === 'trx' ? data.trx_no : data.cnv_no}.jpg`; a.click();
    } catch { toast.err('Gagal membuat gambar struk.'); } finally { setBusy(''); }
  };
  const wa = () => {
    const text = kind === 'trx'
      ? `Struk Setoran ${data.trx_no}\nTanggal: ${fmtDate(data.trx_date)}\nLokasi: ${data.location_nama}\nNasabah: ${data.customer_nama}\n` +
        data.items.map((i: any) => `• ${i.nama} ${num(i.qty)} ${i.unit} = ${rp(i.subtotal)}`).join('\n') + `\nTotal: ${rp(data.total_idr)}\nSaldo terbaru: ${rp(data.saldo.available)}\n\nTerima kasih telah ikut program Ubah Sampah Jadi Emas BSI x Kepul.`
      : `Struk Konversi ${data.cnv_no}\nTanggal transfer: ${fmtDate(data.transferred_at)}\nNasabah: ${data.customer_nama}\nNominal: ${rp(data.amount_idr)}\nStatus: Transfer Selesai\n\nSaldo telah menjadi Tabungan Emas BSI. Terima kasih.`;
    window.open(`https://wa.me/?text=${encodeURIComponent(text)}`, '_blank', 'noopener');
  };
  const blocked = kind === 'cnv' && data && data.status !== 'transfer_selesai';

  return (
    <Modal open={!!id} onClose={onClose} title={kind === 'trx' ? 'Struk Setoran' : 'Struk Konversi'} size="sm"
      footer={data && !blocked ? (
        <>
          {footerExtra}
          <button className="btn-outline btn-sm" onClick={pdf} disabled={!!busy}>{busy === 'pdf' ? <Spinner /> : <Download size={16} />}PDF</button>
          <button className="btn-outline btn-sm" onClick={jpeg} disabled={!!busy}>{busy === 'jpg' ? <Spinner /> : <FileImage size={16} />}JPEG</button>
          <button className="btn-primary btn-sm" onClick={wa}><MessageCircle size={16} />Bagikan WhatsApp</button>
        </>) : undefined}>
      <Loadable loading={loading} error={error} reload={reload} hasData={!!data} rows={5}>
        {blocked ? <p className="text-sm text-ink-soft">Struk konversi tersedia setelah status Transfer Selesai.</p> : data && (
          <div ref={ref} className="bg-white border border-line rounded-ctl overflow-hidden">
            <div className="px-4 py-3 text-white" style={{ background: 'var(--teal-dark)' }}>
              <p className="font-bold">BSI Kios Daur Ulang</p><p className="text-xs text-gold">Ubah Sampah Jadi Emas — BSI x Kepul</p>
            </div>
            <div className="p-4 space-y-3 text-sm">
              <p className="font-bold text-teal-dark">{kind === 'trx' ? `Struk Setoran ${data.trx_no}` : `Struk Konversi ${data.cnv_no}`}</p>
              <dl className="grid grid-cols-[110px_1fr] gap-y-1">
                <dt className="text-ink-soft">{kind === 'trx' ? 'Tanggal' : 'Tgl. transfer'}</dt><dd>{fmtDate(kind === 'trx' ? data.trx_date : data.transferred_at)}</dd>
                <dt className="text-ink-soft">Lokasi</dt><dd>{data.location_nama}</dd>
                <dt className="text-ink-soft">Nasabah</dt><dd>{data.customer_nama}</dd>
                {kind === 'cnv' && <><dt className="text-ink-soft">Rekening BSI</dt><dd>{data.bsi_account_no}</dd></>}
                {kind === 'trx' && data.status === 'void' && <><dt className="text-ink-soft">Status</dt><dd className="font-bold text-danger">VOID</dd></>}
              </dl>
              {kind === 'trx' && (
                <ul className="border-t border-line pt-2 space-y-1.5">
                  {data.items.map((i: any) => (
                    <li key={i.id} className="flex justify-between gap-3"><span>{i.nama}<br /><span className="text-xs text-ink-soft tnum">{i.unit === 'kg' ? kg(i.qty) : `${num(i.qty)} unit`} × {rp(i.price)}</span></span><span className="font-bold tnum">{rp(i.subtotal)}</span></li>
                  ))}
                </ul>
              )}
              <div className="border-t border-line pt-2 flex justify-between text-base font-bold text-teal-dark tnum"><span>Total</span><span>{rp(kind === 'trx' ? data.total_idr : data.amount_idr)}</span></div>
              {kind === 'trx' && <p className="tnum">Saldo terbaru: <strong>{rp(data.saldo.available)}</strong></p>}
              <p className="text-xs text-ink-soft">{kind === 'trx' ? 'Terima kasih telah berpartisipasi dalam program Ubah Sampah Jadi Emas.' : 'Saldo telah dikonversi menjadi Tabungan Emas BSI.'}</p>
            </div>
          </div>
        )}
      </Loadable>
    </Modal>
  );
}
