// Laporan: data tunggal -> Excel Audit Report (10 sheet) dan PDF Executive Summary (7 halaman) — PRD Bab 9.
// Seluruh angka KPI berasal dari kpi.js sehingga identik dengan layar (G1, F-08).
import ExcelJS from 'exceljs';
import PDFDocument from 'pdfkit';
import { getKpis, reconciliation, performaLokasi, wasteBreakdown, categoryKg } from './kpi.js';
import { maskWa, maskAccount, nowIso, wibDate, round2 } from './util.js';

const idn = new Intl.NumberFormat('id-ID', { maximumFractionDigits: 2 });
const idn2 = new Intl.NumberFormat('id-ID', { minimumFractionDigits: 2, maximumFractionDigits: 2 });
export const fmtRp = (n) => 'Rp ' + idn.format(Math.round(n ?? 0));
export const fmtKg = (n) => idn2.format(n ?? 0) + ' kg';
export const fmtDate = (d) => (d ? `${d.slice(8, 10)}/${d.slice(5, 7)}/${d.slice(0, 4)}` : '-');
export const fmtDateTime = (iso) => {
  if (!iso) return '-';
  const w = new Date(new Date(iso).getTime() + 7 * 3600e3).toISOString();
  return `${fmtDate(w.slice(0, 10))} ${w.slice(11, 16)} WIB`;
};

export const STATUS_KONVERSI = {
  diajukan: 'Diajukan', diverifikasi: 'Diverifikasi', transfer_selesai: 'Transfer Selesai',
  ditolak: 'Ditolak', dibatalkan: 'Dibatalkan',
};

export function describeFilters(db, f, extra = {}) {
  const parts = [];
  parts.push(`Periode: ${f.from || f.to ? `${f.from ? fmtDate(f.from) : 'awal'} s.d. ${f.to ? fmtDate(f.to) : 'hari ini'}` : 'Semua waktu'}`);
  if (f.locationIds?.length === 1) parts.push(`Lokasi: ${db.prepare('SELECT nama FROM locations WHERE id=?').get(f.locationIds[0])?.nama}`);
  else parts.push('Lokasi: Semua lokasi');
  if (f.customerStatus) parts.push(`Status nasabah: ${f.customerStatus === 'baru' ? 'Baru' : 'Existing'}`);
  if (extra.transferStatus) parts.push(`Status transfer: ${STATUS_KONVERSI[extra.transferStatus] ?? extra.transferStatus}`);
  if (f.wasteTypeId) parts.push(`Jenis sampah: ${db.prepare('SELECT nama FROM waste_types WHERE id=?').get(f.wasteTypeId)?.nama}`);
  return parts;
}

export function buildReportData(db, user, f, extra = {}) {
  const locClause = f.locationIds ? `IN (${f.locationIds.map(() => '?').join(',') || 'NULL'})` : null;
  const locP = f.locationIds ?? [];
  const lo = f.from || '0000-00-00', hi = f.to || '9999-12-31';
  const data = {
    generatedAt: nowIso(), user, filters: f, extra,
    filterText: describeFilters(db, f, extra),
    kpis: getKpis(db, f),
    recon: reconciliation(db, f),
    perf: performaLokasi(db, f),
    waste: wasteBreakdown(db, f),
    categories: categoryKg(db, f),
  };

  const tw = ['1=1'], tp = [];
  if (locClause) { tw.push(`t.location_id ${locClause}`); tp.push(...locP); }
  tw.push('t.trx_date >= ?', 't.trx_date <= ?'); tp.push(lo, hi);
  if (f.customerStatus) { tw.push('vb.cust_status = ?'); tp.push(f.customerStatus); }
  if (f.wasteTypeId) { tw.push('i.waste_type_id = ?'); tp.push(f.wasteTypeId); }
  data.transaksi = db.prepare(`SELECT t.trx_no, t.trx_date, t.created_at, l.nama AS lokasi, c.nama AS nasabah, wt.nama AS jenis,
      i.qty, i.unit, i.price_idr_snapshot AS harga, i.subtotal_idr AS subtotal, t.status
    FROM transactions t JOIN transaction_items i ON i.transaction_id = t.id AND i.is_active = 1
    JOIN customers c ON c.id = t.customer_id JOIN locations l ON l.id = t.location_id
    JOIN waste_types wt ON wt.id = i.waste_type_id JOIN v_customer_balance vb ON vb.customer_id = t.customer_id
    WHERE ${tw.join(' AND ')} ORDER BY t.trx_date, t.id, i.id`).all(...tp);

  const cw = ['1=1'], cp = [];
  if (locClause) { cw.push(`c.location_id ${locClause}`); cp.push(...locP); }
  if (f.customerStatus) { cw.push('vb.cust_status = ?'); cp.push(f.customerStatus); }
  const min = Number(db.prepare("SELECT value FROM app_settings WHERE key='min_conversion'").get().value);
  data.nasabah = db.prepare(`SELECT c.id, c.nama, c.whatsapp, c.jenis, c.is_active, l.nama AS lokasi, vb.cust_status, vb.deposits,
      vb.available, vb.held, vb.gold FROM customers c JOIN locations l ON l.id = c.location_id
    JOIN v_customer_balance vb ON vb.customer_id = c.id WHERE ${cw.join(' AND ')} ORDER BY l.id, c.nama`).all(...cp)
    .map((r) => ({ ...r, whatsapp: maskWa(r.whatsapp), eligible: r.is_active && r.available >= min }));

  // Buku saldo
  const dep = db.prepare(`SELECT customer_id, COALESCE(SUM(CASE WHEN trx_date < ? THEN total_idr END),0) AS awal,
      COALESCE(SUM(CASE WHEN trx_date >= ? AND trx_date <= ? THEN total_idr END),0) AS mut
    FROM transactions WHERE status='sukses' GROUP BY customer_id`).all(lo, lo, hi);
  const cnv = db.prepare(`SELECT customer_id, COALESCE(SUM(CASE WHEN date(requested_at,'+7 hours') < ? THEN amount_idr END),0) AS awal,
      COALESCE(SUM(CASE WHEN date(requested_at,'+7 hours') >= ? AND date(requested_at,'+7 hours') <= ? THEN amount_idr END),0) AS mut
    FROM conversions WHERE status IN ('diajukan','diverifikasi','transfer_selesai') GROUP BY customer_id`).all(lo, lo, hi);
  const dm = new Map(dep.map((r) => [r.customer_id, r])), cm = new Map(cnv.map((r) => [r.customer_id, r]));
  data.bukuSaldo = data.nasabah.map((n) => {
    const d = dm.get(n.id) ?? { awal: 0, mut: 0 }, c = cm.get(n.id) ?? { awal: 0, mut: 0 };
    const awal = d.awal - c.awal;
    return { nasabah: n.nama, lokasi: n.lokasi, saldoAwal: awal, setoran: d.mut, konversi: c.mut, saldoAkhir: awal + d.mut - c.mut };
  });

  const vw = ['1=1'], vp = [];
  if (locClause) { vw.push(`v.location_id ${locClause}`); vp.push(...locP); }
  vw.push("date(v.requested_at,'+7 hours') >= ?", "date(v.requested_at,'+7 hours') <= ?"); vp.push(lo, hi);
  if (extra.transferStatus) { vw.push('v.status = ?'); vp.push(extra.transferStatus); }
  if (f.customerStatus) { vw.push('vb.cust_status = ?'); vp.push(f.customerStatus); }
  data.konversi = db.prepare(`SELECT v.id, v.cnv_no, c.nama AS nasabah, l.nama AS lokasi, v.amount_idr, v.status, v.bsi_account_no,
      v.requested_at, v.verified_at, v.transferred_at, v.completed_at, pr.nama AS pengaju, pv.nama AS pemverifikasi
    FROM conversions v JOIN customers c ON c.id = v.customer_id JOIN locations l ON l.id = v.location_id
    JOIN v_customer_balance vb ON vb.customer_id = v.customer_id
    LEFT JOIN profiles pr ON pr.id = v.requested_by LEFT JOIN profiles pv ON pv.id = v.verified_by
    WHERE ${vw.join(' AND ')} ORDER BY v.id`).all(...vp)
    .map((r) => ({ ...r, bsi_account_no: maskAccount(r.bsi_account_no) }));
  const proofs = db.prepare(`SELECT p.conversion_id, p.file_name, p.version, p.uploaded_at, p.correction_reason FROM conversion_proofs p ORDER BY p.conversion_id, p.version`).all();
  const doneIds = new Set(data.konversi.filter((k) => k.status === 'transfer_selesai').map((k) => k.id));
  data.statusTransfer = proofs.filter((p) => doneIds.has(p.conversion_id)).map((p) => {
    const k = data.konversi.find((x) => x.id === p.conversion_id);
    return { cnv_no: k.cnv_no, nasabah: k.nasabah, tanggalTransfer: k.transferred_at, berkas: p.file_name, versi: p.version, diunggah: p.uploaded_at, koreksi: p.correction_reason };
  });

  const aw = ["substr(a.at,1,10) >= ?", "substr(a.at,1,10) <= ?"], ap = [lo, hi];
  if (f.locationIds) { aw.push(`(u.location_id ${locClause} OR a.role <> 'admin_lokasi')`); ap.push(...locP); }
  if (user.role === 'admin_lokasi') aw.push("a.role = 'admin_lokasi'");
  data.aktivitas = db.prepare(`SELECT a.user_nama AS pengguna, a.role, a.action AS aksi, a.entity AS entitas, COUNT(*) AS jumlah, MAX(a.at) AS terakhir
    FROM audit_logs a LEFT JOIN profiles u ON u.id = a.user_id WHERE ${aw.join(' AND ')} GROUP BY a.user_nama, a.role, a.action ORDER BY jumlah DESC`).all(...ap);

  const dw = ['d.is_archived = 0', 'd.tanggal >= ?', 'd.tanggal <= ?'], dp = [lo, hi];
  if (locClause) { dw.push(`d.location_id ${locClause}`); dp.push(...locP); }
  data.dokumentasi = db.prepare(`SELECT d.judul, d.kategori, l.nama AS lokasi, d.tanggal, u.nama AS pengunggah
    FROM documents d JOIN locations l ON l.id = d.location_id LEFT JOIN profiles u ON u.id = d.uploaded_by
    WHERE ${dw.join(' AND ')} ORDER BY d.tanggal DESC`).all(...dp);

  const jw = ['is_active = 1'], jp = [];
  if (locClause) { jw.push(`location_id ${locClause}`); jp.push(...locP); }
  data.jenisNasabah = db.prepare(`SELECT jenis, COUNT(*) AS n FROM customers WHERE ${jw.join(' AND ')} GROUP BY jenis`).all(...jp);
  return data;
}

// ======================= EXCEL =======================
export async function buildExcel(d) {
  const wb = new ExcelJS.Workbook();
  wb.creator = d.user.nama; wb.created = new Date();
  const HEAD = { font: { bold: true, color: { argb: 'FFFFFFFF' } }, fill: { type: 'pattern', pattern: 'solid', fgColor: { argb: 'FF00535A' } } };
  const sheet = (name, cols, rows, fmts = {}) => {
    const ws = wb.addWorksheet(name);
    ws.columns = cols.map(([header, key, width]) => ({ header, key, width: width ?? 18 }));
    ws.getRow(1).eachCell((c) => Object.assign(c, HEAD));
    ws.views = [{ state: 'frozen', ySplit: 1 }];
    rows.forEach((r) => ws.addRow(r));
    for (const [key, fmt] of Object.entries(fmts)) ws.getColumn(key).numFmt = fmt;
    return ws;
  };
  const RP = '"Rp" #,##0', KG = '#,##0.00';
  const k = d.kpis, r = d.recon;

  const s1 = wb.addWorksheet('Ringkasan');
  s1.columns = [{ width: 38 }, { width: 28 }, { width: 40 }];
  s1.addRow(['BSI Kios Daur Ulang — Excel Audit Report']).font = { bold: true, size: 14 };
  d.filterText.forEach((t) => s1.addRow([t]));
  s1.addRow([`Tanggal cetak: ${fmtDateTime(d.generatedAt)}`]);
  s1.addRow([`Diunduh oleh: ${d.user.nama}`]);
  s1.addRow([]);
  const h = s1.addRow(['KPI', 'Nilai', 'Catatan']); h.eachCell((c) => Object.assign(c, HEAD));
  const kp = [
    ['Total Transaksi', k.totalTransaksi, 'Transaksi sukses (void tidak dihitung)'],
    ['Total Nasabah', k.totalNasabah, 'Jumlah record nasabah aktif, bukan orang unik — per hari ini'],
    ['Total Berat (kg)', k.totalBeratKg, 'Hanya item berstatus kg'],
    ['Total Unit', k.totalUnit, 'Item berstatus unit dihitung terpisah'],
    ['Nilai Ekonomi (Rp)', k.nilaiEkonomi, 'Mencakup item kg dan unit'],
    ['Saldo Belum Dikonversi (Rp)', k.saldoBelumDikonversi, 'Per hari ini'],
    ['Sudah Jadi Tabungan Emas (Rp)', k.sudahTabunganEmas, 'Per hari ini'],
    ['Nasabah Eligible', k.nasabahEligible, 'Saldo tersedia ≥ minimum konversi — per hari ini'],
    ['Transfer Pending (Rp)', k.transferPending, 'Konversi Diajukan + Diverifikasi — per hari ini'],
  ];
  kp.forEach((row) => s1.addRow(row));
  s1.addRow([]);
  const hr = s1.addRow(['Rekonsiliasi', 'Nilai (Rp)', 'Catatan']); hr.eachCell((c) => Object.assign(c, HEAD));
  s1.addRow(['Nilai Ekonomi (kumulatif)', r.nilaiEkonomi, r.basis]);
  s1.addRow(['Saldo Belum Dikonversi', r.saldoBelumDikonversi]);
  s1.addRow(['Sudah Jadi Tabungan Emas', r.tabunganEmas]);
  s1.addRow(['Selisih', r.selisih]);
  s1.addRow(['Status', r.status === 'seimbang' ? 'Seimbang' : r.status === 'belum_ada_data' ? 'Belum ada data' : 'Tidak seimbang']);

  sheet('Transaksi', [['Nomor', 'trx_no', 22], ['Tanggal', 'tgl', 12], ['Waktu input', 'waktu', 20], ['Lokasi', 'lokasi', 30],
    ['Nasabah', 'nasabah', 24], ['Jenis', 'jenis', 22], ['Jumlah', 'qty', 10], ['Satuan', 'unit', 8], ['Harga', 'harga', 12],
    ['Subtotal', 'subtotal', 14], ['Status', 'status', 10]],
  d.transaksi.map((t) => ({ ...t, tgl: fmtDate(t.trx_date), waktu: fmtDateTime(t.created_at) })), { harga: RP, subtotal: RP, qty: KG });

  sheet('Nasabah', [['Nama', 'nama', 24], ['Lokasi', 'lokasi', 30], ['Jenis', 'jenis', 12], ['WhatsApp (disamarkan)', 'whatsapp', 20],
    ['Status', 's', 12], ['Total Setoran', 'deposits', 16], ['Saldo Tersedia', 'available', 16], ['Saldo Tertahan', 'held', 16],
    ['Tabungan Emas', 'gold', 16], ['Eligible', 'e', 10]],
  d.nasabah.map((n) => ({ ...n, s: n.cust_status === 'baru' ? 'Baru' : 'Existing', e: n.eligible ? 'Ya' : 'Tidak' })),
  { deposits: RP, available: RP, held: RP, gold: RP });

  sheet('Rincian Sampah', [['Jenis', 'nama', 24], ['Kategori', 'kategori', 14], ['Jumlah', 'qty', 12], ['Satuan', 'unit', 8],
    ['Nilai', 'nilai', 16], ['% Nilai', 'persen', 10], ['Jumlah Transaksi', 'transaksi', 16], ['Lokasi Teratas', 'lokasiTeratas', 30]],
  d.waste.map((w) => ({ ...w, persen: round2(w.persen) / 100 })), { nilai: RP, persen: '0.00%', qty: KG });

  sheet('Performa Lokasi', [['Lokasi', 'nama', 32], ['Transaksi', 'transaksi', 12], ['Nasabah', 'nasabah', 10], ['Baru', 'baru', 8],
    ['Existing', 'existing', 10], ['Berat (kg)', 'berat', 12], ['Unit', 'unit', 8], ['Nilai', 'nilai', 16], ['Eligible', 'eligible', 10],
    ['Tabungan Emas', 'tabunganEmas', 16], ['Target kg/bulan', 'targetKg', 14]],
  [...d.perf.rows, { nama: 'TOTAL', ...d.perf.total }], { nilai: RP, tabunganEmas: RP, berat: KG });

  sheet('Buku Saldo', [['Nasabah', 'nasabah', 24], ['Lokasi', 'lokasi', 30], ['Saldo Awal', 'saldoAwal', 16], ['Setoran', 'setoran', 16],
    ['Konversi', 'konversi', 16], ['Saldo Akhir', 'saldoAkhir', 16]], d.bukuSaldo, { saldoAwal: RP, setoran: RP, konversi: RP, saldoAkhir: RP });

  sheet('Konversi Emas', [['Nomor', 'cnv_no', 22], ['Nasabah', 'nasabah', 24], ['Lokasi', 'lokasi', 30], ['Rekening', 'bsi_account_no', 14],
    ['Nominal', 'amount_idr', 14], ['Status', 'st', 18], ['Pengaju', 'pengaju', 20], ['Pemverifikasi', 'pemverifikasi', 20], ['Diajukan', 'dj', 20]],
  d.konversi.map((c) => ({ ...c, st: STATUS_KONVERSI[c.status], dj: fmtDateTime(c.requested_at) })), { amount_idr: RP });

  sheet('Status Transfer Byond', [['Nomor Konversi', 'cnv_no', 22], ['Nasabah', 'nasabah', 24], ['Tanggal Transfer', 'tt', 16],
    ['Berkas Bukti', 'berkas', 40], ['Versi', 'versi', 8], ['Diunggah', 'du', 20], ['Alasan Koreksi', 'koreksi', 30]],
  d.statusTransfer.map((s) => ({ ...s, tt: fmtDate(s.tanggalTransfer), du: fmtDateTime(s.diunggah) })));

  sheet('Aktivitas Admin', [['Pengguna', 'pengguna', 24], ['Peran', 'role', 14], ['Aksi', 'aksi', 28], ['Entitas', 'entitas', 18],
    ['Jumlah', 'jumlah', 10], ['Terakhir', 'tr', 22]], d.aktivitas.map((a) => ({ ...a, tr: fmtDateTime(a.terakhir) })));

  sheet('Daftar Dokumentasi', [['Judul', 'judul', 36], ['Kategori', 'kategori', 24], ['Lokasi', 'lokasi', 30], ['Tanggal', 'tg', 12],
    ['Pengunggah', 'pengunggah', 22]], d.dokumentasi.map((x) => ({ ...x, tg: fmtDate(x.tanggal) })));

  return Buffer.from(await wb.xlsx.writeBuffer());
}

// ======================= PDF =======================
const C = { teal: '#00978C', dark: '#00535A', tint: '#E6F5F3', gold: '#F8AD3C', ink: '#1F2933', soft: '#5B6670', line: '#E5E7EB', danger: '#D64545' };

function pdfStart(info) {
  const doc = new PDFDocument({ size: 'A4', margins: { top: 40, left: 40, right: 40, bottom: 0 }, info });
  const chunks = [];
  doc.on('data', (c) => chunks.push(c));
  const done = new Promise((res) => doc.on('end', () => res(Buffer.concat(chunks))));
  return { doc, done };
}

function table(doc, x, y, cols, rows, { rowH = 18, size = 8.5 } = {}) {
  let cy = y;
  doc.save().rect(x, cy, cols.reduce((a, c) => a + c.w, 0), rowH).fill(C.dark).restore();
  let cx = x;
  doc.font('Helvetica-Bold').fontSize(size).fillColor('#fff');
  for (const c of cols) { doc.text(c.h, cx + 4, cy + 5, { width: c.w - 8, align: c.align ?? 'left', lineBreak: false }); cx += c.w; }
  cy += rowH;
  doc.font('Helvetica').fillColor(C.ink);
  rows.forEach((r, i) => {
    if (i % 2) doc.save().rect(x, cy, cols.reduce((a, c) => a + c.w, 0), rowH).fill('#F7FAFA').restore();
    cx = x;
    doc.fillColor(C.ink);
    for (const c of cols) { doc.text(String(r[c.k] ?? '-'), cx + 4, cy + 5, { width: c.w - 8, align: c.align ?? 'left', lineBreak: false, ellipsis: true }); cx += c.w; }
    cy += rowH;
  });
  return cy;
}

function hbars(doc, x, y, w, items, color = C.teal) {
  const max = Math.max(...items.map((i) => i.value), 1);
  let cy = y;
  for (const it of items) {
    doc.font('Helvetica').fontSize(8.5).fillColor(C.ink).text(it.label, x, cy + 2, { width: 150, lineBreak: false, ellipsis: true });
    const bw = Math.max((it.value / max) * (w - 260), it.value > 0 ? 2 : 0);
    doc.save().roundedRect(x + 155, cy, bw, 12, 3).fill(it.color ?? color).restore();
    doc.fillColor(C.soft).text(it.text, x + 160 + bw, cy + 2, { lineBreak: false });
    cy += 20;
  }
  return cy;
}

export async function buildPdf(d) {
  const { doc, done } = pdfStart({ Title: 'BSI Kios Daur Ulang — Executive Summary', Author: d.user.nama });
  const TOTAL = 7;
  let page = 0;
  const newPage = (title) => {
    page++;
    if (page > 1) doc.addPage();
    doc.save().rect(0, 0, 595, 6).fill(C.gold).restore();
    doc.font('Helvetica').fontSize(8).fillColor(C.soft).text('BSI Kios Daur Ulang Dashboard | Executive Summary', 40, 20, { lineBreak: false });
    doc.text('Internal — ESG, Operations & Communication, PT Bank Syariah Indonesia Tbk', 40, 806, { lineBreak: false });
    doc.text(`Halaman ${page} dari ${TOTAL}`, 455, 806, { width: 100, align: 'right', lineBreak: false });
    if (title) doc.font('Helvetica-Bold').fontSize(18).fillColor(C.dark).text(title, 40, 50, { lineBreak: false });
    doc.save().rect(40, 76, 515, 2).fill(C.gold).restore();
    return 92;
  };
  const k = d.kpis, r = d.recon;

  // 1. Sampul
  page++;
  doc.save().rect(0, 0, 595, 842).fill('#FFFFFF').restore();
  doc.save().rect(0, 0, 595, 330).fill(C.dark).restore();
  doc.save().rect(0, 330, 595, 6).fill(C.gold).restore();
  doc.font('Helvetica-Bold').fontSize(10).fillColor(C.gold).text('EXECUTIVE SUMMARY', 50, 120, { characterSpacing: 3 });
  doc.fontSize(30).fillColor('#fff').text('BSI Kios Daur Ulang', 50, 145);
  doc.font('Helvetica').fontSize(15).fillColor('#CDE9E6').text('Program Ubah Sampah Jadi Emas — BSI x Kepul', 50, 190);
  doc.font('Helvetica-Bold').fontSize(11).fillColor(C.dark).text('Cakupan laporan', 50, 370);
  doc.font('Helvetica').fontSize(11).fillColor(C.ink);
  let cy = 392;
  for (const t of d.filterText) { doc.text(t, 50, cy); cy += 20; }
  cy += 10;
  doc.text(`Tanggal cetak: ${fmtDateTime(d.generatedAt)}`, 50, cy); cy += 20;
  doc.text(`Diunduh oleh: ${d.user.nama}`, 50, cy);
  doc.font('Helvetica').fontSize(8).fillColor(C.soft).text('Internal — ESG, Operations & Communication, PT Bank Syariah Indonesia Tbk', 40, 806, { lineBreak: false });
  doc.text(`Halaman 1 dari ${TOTAL}`, 455, 806, { width: 100, align: 'right', lineBreak: false });

  // 2. KPI + rekonsiliasi
  let y = newPage('Ringkasan KPI dan Rekonsiliasi');
  const cards = [
    ['Total Transaksi', idn.format(k.totalTransaksi), 'transaksi sukses'],
    ['Total Nasabah', idn.format(k.totalNasabah), 'record aktif, per hari ini'],
    ['Total Berat', fmtKg(k.totalBeratKg), `+ ${idn.format(k.totalUnit)} unit`],
    ['Nilai Ekonomi', fmtRp(k.nilaiEkonomi), 'kg + unit'],
    ['Saldo Belum Dikonversi', fmtRp(k.saldoBelumDikonversi), 'per hari ini'],
    ['Sudah Jadi Tabungan Emas', fmtRp(k.sudahTabunganEmas), 'per hari ini'],
    ['Nasabah Eligible', idn.format(k.nasabahEligible), 'saldo ≥ minimum, per hari ini'],
    ['Transfer Pending', fmtRp(k.transferPending), 'per hari ini'],
  ];
  cards.forEach((c, i) => {
    const x = 40 + (i % 4) * 130, yy = y + Math.floor(i / 4) * 92;
    doc.save().roundedRect(x, yy, 120, 82, 10).fill(c[0].includes('Emas') || c[0].includes('Eligible') ? '#FFF6E5' : C.tint).restore();
    doc.font('Helvetica').fontSize(8).fillColor(C.soft).text(c[0], x + 8, yy + 9, { width: 104 });
    doc.font('Helvetica-Bold').fontSize(c[1].length > 13 ? 11 : 14).fillColor(C.dark).text(c[1], x + 8, yy + 34, { width: 106 });
    doc.font('Helvetica').fontSize(7.5).fillColor(C.soft).text(c[2], x + 8, yy + 62, { width: 106 });
  });
  y += 205;
  doc.font('Helvetica-Bold').fontSize(13).fillColor(C.dark).text('Rekonsiliasi nilai ekonomi', 40, y); y += 22;
  const statusTxt = r.status === 'seimbang' ? 'SEIMBANG' : r.status === 'belum_ada_data' ? 'BELUM ADA DATA' : 'TIDAK SEIMBANG';
  y = table(doc, 40, y, [{ h: 'Komponen', k: 'a', w: 300 }, { h: 'Nilai', k: 'b', w: 215, align: 'right' }], [
    { a: 'Nilai Ekonomi (kumulatif)', b: fmtRp(r.nilaiEkonomi) },
    { a: 'Saldo Belum Dikonversi', b: fmtRp(r.saldoBelumDikonversi) },
    { a: 'Sudah Jadi Tabungan Emas', b: fmtRp(r.tabunganEmas) },
    { a: 'Selisih', b: fmtRp(r.selisih) },
  ], { rowH: 22, size: 9.5 });
  doc.font('Helvetica-Bold').fontSize(12).fillColor(r.status === 'seimbang' ? C.teal : r.status === 'belum_ada_data' ? C.soft : C.danger)
    .text(`Status: ${statusTxt}`, 40, y + 10);
  doc.font('Helvetica').fontSize(8.5).fillColor(C.soft).text(`Identitas: Nilai Ekonomi = Saldo Belum Dikonversi + Sudah Jadi Tabungan Emas. ${r.basis}.`, 40, y + 30, { width: 515 });

  // 3. Performa lokasi
  y = newPage('Performa per Lokasi');
  const fl = (n) => idn.format(n);
  const locRows = [...d.perf.rows, { nama: 'TOTAL', ...d.perf.total }].map((x) => ({
    nama: x.nama, t: fl(x.transaksi), n: fl(x.nasabah), b: fmtKg(x.berat).replace(' kg', ''), nl: fmtRp(x.nilai), e: fl(x.eligible), te: fmtRp(x.tabunganEmas),
  }));
  y = table(doc, 40, y, [{ h: 'Lokasi', k: 'nama', w: 150 }, { h: 'Trx', k: 't', w: 32, align: 'right' }, { h: 'Nasabah', k: 'n', w: 48, align: 'right' },
    { h: 'Berat (kg)', k: 'b', w: 65, align: 'right' }, { h: 'Nilai', k: 'nl', w: 85, align: 'right' }, { h: 'Elig.', k: 'e', w: 35, align: 'right' },
    { h: 'Tab. Emas', k: 'te', w: 100, align: 'right' }], locRows, { rowH: 22 });
  y += 24;
  doc.font('Helvetica-Bold').fontSize(12).fillColor(C.dark).text('Berat sampah per lokasi (kg)', 40, y); y += 22;
  hbars(doc, 40, y, 515, d.perf.rows.map((x) => ({ label: x.nama, value: x.berat, text: fmtKg(x.berat) })));

  // 4. Sampah
  y = newPage('Sampah dan Nilai Ekonomi');
  doc.font('Helvetica-Bold').fontSize(12).fillColor(C.dark).text('Komposisi per kategori (kg)', 40, y); y += 20;
  y = hbars(doc, 40, y, 515, d.categories.map((c) => ({ label: c.kategori, value: c.kg, text: fmtKg(c.kg) + (c.unit ? ` + ${c.unit} unit` : ''), color: c.warna })));
  y += 8;
  doc.font('Helvetica-Bold').fontSize(12).fillColor(C.dark).text('Rincian per jenis', 40, y); y += 20;
  table(doc, 40, y, [{ h: 'Jenis', k: 'nama', w: 130 }, { h: 'Jumlah', k: 'q', w: 85, align: 'right' }, { h: 'Nilai', k: 'v', w: 90, align: 'right' },
    { h: '% Nilai', k: 'p', w: 50, align: 'right' }, { h: 'Trx', k: 't', w: 35, align: 'right' }, { h: 'Lokasi teratas', k: 'l', w: 125 }],
  d.waste.slice(0, 16).map((w) => ({ nama: w.nama, q: `${idn2.format(w.qty)} ${w.unit}`, v: fmtRp(w.nilai), p: `${idn2.format(w.persen)}%`, t: idn.format(w.transaksi), l: w.lokasiTeratas })), { rowH: 17, size: 8 });

  // 5. Konversi
  y = newPage('Tabungan Emas dan Konversi');
  const byStatus = Object.keys(STATUS_KONVERSI).map((s) => {
    const rows = d.konversi.filter((c) => c.status === s);
    return { s: STATUS_KONVERSI[s], n: idn.format(rows.length), v: fmtRp(rows.reduce((a, c) => a + c.amount_idr, 0)) };
  });
  y = table(doc, 40, y, [{ h: 'Status konversi', k: 's', w: 200 }, { h: 'Jumlah', k: 'n', w: 100, align: 'right' }, { h: 'Nominal', k: 'v', w: 215, align: 'right' }], byStatus, { rowH: 24, size: 10 });
  doc.font('Helvetica-Bold').fontSize(12).fillColor(C.dark).text(`Total Tabungan Emas (posisi): ${fmtRp(k.sudahTabunganEmas)}`, 40, y + 20);
  doc.font('Helvetica').fontSize(10).fillColor(C.ink).text(`Transfer pending: ${fmtRp(k.transferPending)}   •   Nasabah eligible: ${idn.format(k.nasabahEligible)}`, 40, y + 42);
  doc.fontSize(8.5).fillColor(C.soft).text('Tabel status memuat konversi yang diajukan pada periode laporan. Posisi saldo selalu per hari ini.', 40, y + 66, { width: 515 });

  // 6. Baru vs Existing + kualitas data
  y = newPage('Nasabah Baru vs Existing dan Kualitas Data');
  y = hbars(doc, 40, y, 515, [
    { label: 'Baru', value: k.nasabahBaru, text: idn.format(k.nasabahBaru), color: C.teal },
    { label: 'Existing', value: k.nasabahExisting, text: idn.format(k.nasabahExisting), color: C.gold },
  ]);
  y += 10;
  doc.font('Helvetica-Bold').fontSize(12).fillColor(C.dark).text('Jumlah nasabah per jenis', 40, y); y += 22;
  const jn = { individu: 'Individu', usaha: 'Usaha', institusi: 'Institusi' };
  y = table(doc, 40, y, [{ h: 'Jenis nasabah', k: 'j', w: 300 }, { h: 'Jumlah', k: 'n', w: 215, align: 'right' }],
    d.jenisNasabah.length ? d.jenisNasabah.map((x) => ({ j: jn[x.jenis], n: idn.format(x.n) })) : [{ j: 'Belum ada data', n: '-' }], { rowH: 22, size: 9.5 });
  y += 18;
  doc.font('Helvetica-Bold').fontSize(12).fillColor(C.dark).text('Catatan kualitas data', 40, y); y += 20;
  const nonInd = d.jenisNasabah.filter((x) => x.jenis !== 'individu').reduce((a, x) => a + x.n, 0);
  doc.font('Helvetica').fontSize(9.5).fillColor(C.ink).text([
    `• Total Nasabah (${idn.format(k.totalNasabah)}) adalah jumlah record nasabah aktif, bukan jumlah orang unik; satu nomor WhatsApp dapat dipakai beberapa record.`,
    `• ${idn.format(nonInd)} record bertipe Usaha/Institusi. Statistik nasabah sebaiknya dibaca bersama pemisahan jenis ini.`,
    '• Status Baru/Existing dihitung otomatis saat laporan dibuat dari jumlah transaksi sukses nasabah.',
    '• Transaksi dengan tanggal mundur tetap dihitung pada tanggal setoran; waktu input asli tersimpan di Excel Audit Report.',
  ].join('\n\n'), 40, y, { width: 515 });

  // 7. Metodologi
  y = newPage('Metodologi, Definisi KPI, dan Keterbatasan');
  doc.font('Helvetica').fontSize(9).fillColor(C.ink).text([
    'Definisi KPI (satu definisi di seluruh layar, laporan, dan ekspor):',
    '• Total Transaksi = jumlah transaksi berstatus sukses; transaksi void tidak dihitung.',
    '• Total Nasabah = jumlah record nasabah aktif (bukan orang unik).',
    '• Total Berat = jumlah qty item berstatus kg pada transaksi sukses; item berstatus unit dihitung terpisah.',
    '• Nilai Ekonomi = jumlah total transaksi sukses (item kg dan unit). Harga per satuan dikunci saat transaksi disimpan.',
    '• Saldo Tersedia = setoran sukses − konversi berstatus Diajukan, Diverifikasi, atau Transfer Selesai.',
    '• Transfer Pending (saldo tertahan) = konversi Diajukan + Diverifikasi. Tabungan Emas = konversi Transfer Selesai.',
    '• Saldo Belum Dikonversi = Saldo Tersedia + Saldo Tertahan. Nasabah Eligible = saldo tersedia ≥ minimum konversi (inklusif).',
    '• Identitas rekonsiliasi: Nilai Ekonomi = Saldo Belum Dikonversi + Sudah Jadi Tabungan Emas.',
    '',
    'Keterbatasan:',
    '• Estimasi emisi CO2e tidak disajikan karena belum ada sumber faktor emisi resmi.',
    '• Transfer ke Tabungan Emas dilakukan manual di luar sistem (BYOND); sistem mencatat bukti transfer yang diunggah.',
    '• KPI volume (transaksi, berat, nilai) mengikuti filter periode; KPI posisi (saldo, eligible, pending, Tabungan Emas) selalu posisi per hari ini.',
    '• Rekonsiliasi dihitung pada posisi kumulatif dan tidak terpengaruh filter periode atau jenis sampah.',
    '• Estimasi emisi dan metodologinya berada di luar ruang lingkup rilis ini.',
  ].join('\n'), 40, y, { width: 515, lineGap: 3 });

  doc.end();
  return done;
}

// ======================= STRUK =======================
export async function buildReceiptPdf({ title, lines, items, total, footer, saldo }) {
  const d2 = new PDFDocument({ size: [300, 150 + items.length * 24 + lines.length * 16 + 120], margin: 20, info: { Title: title } });
  const chunks = [];
  d2.on('data', (c) => chunks.push(c));
  const end = new Promise((res) => d2.on('end', () => res(Buffer.concat(chunks))));
  d2.save().rect(0, 0, 300, 52).fill(C.dark).restore();
  d2.font('Helvetica-Bold').fontSize(13).fillColor('#fff').text('BSI Kios Daur Ulang', 20, 12);
  d2.font('Helvetica').fontSize(8).fillColor(C.gold).text('Ubah Sampah Jadi Emas — BSI x Kepul', 20, 31);
  let y = 66;
  d2.font('Helvetica-Bold').fontSize(11).fillColor(C.dark).text(title, 20, y); y += 20;
  d2.font('Helvetica').fontSize(8.5).fillColor(C.ink);
  for (const [a, b] of lines) { d2.fillColor(C.soft).text(a, 20, y, { width: 90, lineBreak: false }); d2.fillColor(C.ink).text(b, 110, y, { width: 170, lineBreak: false, ellipsis: true }); y += 15; }
  y += 6;
  if (items.length) {
    d2.save().moveTo(20, y).lineTo(280, y).strokeColor(C.line).stroke().restore(); y += 6;
    for (const it of items) {
      d2.font('Helvetica-Bold').fontSize(8.5).fillColor(C.ink).text(it.nama, 20, y, { width: 160, lineBreak: false, ellipsis: true });
      d2.text(fmtRp(it.subtotal), 180, y, { width: 100, align: 'right', lineBreak: false });
      d2.font('Helvetica').fontSize(7.5).fillColor(C.soft).text(`${idn2.format(it.qty)} ${it.unit} × ${fmtRp(it.price)}`, 20, y + 11, { lineBreak: false });
      y += 24;
    }
  }
  d2.save().moveTo(20, y).lineTo(280, y).strokeColor(C.line).stroke().restore(); y += 8;
  d2.font('Helvetica-Bold').fontSize(11).fillColor(C.dark).text('Total', 20, y, { lineBreak: false });
  d2.text(fmtRp(total), 130, y, { width: 150, align: 'right', lineBreak: false }); y += 22;
  if (saldo != null) { d2.font('Helvetica').fontSize(9).fillColor(C.ink).text(`Saldo terbaru: ${fmtRp(saldo)}`, 20, y); y += 16; }
  d2.font('Helvetica').fontSize(7.5).fillColor(C.soft).text(footer, 20, y + 4, { width: 260 });
  d2.end();
  return end;
}
