// Lapisan perhitungan tunggal (PRD G1 / Bab 6.3).
// Semua angka di Ringkasan, Performa Lokasi, Laporan, PDF, dan Excel berasal dari fungsi di berkas ini.
import { getNum, wibDate, addDays, daysBetween, round2 } from './util.js';

/**
 * Filter standar:
 *  locationIds: number[] | null (null = semua lokasi)
 *  from, to: 'YYYY-MM-DD' | null (tanggal transaksi)
 *  customerStatus: 'baru' | 'existing' | null
 *  wasteTypeId: number | null
 */
function txWhere(f, { withItems = true } = {}) {
  const w = ["t.status = 'sukses'"];
  const p = [];
  if (withItems) w.push('i.is_active = 1');
  if (f.locationIds) {
    if (f.locationIds.length === 0) w.push('1 = 0');
    else { w.push(`t.location_id IN (${f.locationIds.map(() => '?').join(',')})`); p.push(...f.locationIds); }
  }
  if (f.from) { w.push('t.trx_date >= ?'); p.push(f.from); }
  if (f.to) { w.push('t.trx_date <= ?'); p.push(f.to); }
  if (f.customerStatus) { w.push('vb.cust_status = ?'); p.push(f.customerStatus); }
  if (f.wasteTypeId && withItems) { w.push('i.waste_type_id = ?'); p.push(Number(f.wasteTypeId)); }
  return { where: w.join(' AND '), params: p };
}
const FROM_ITEMS = `FROM transactions t
  JOIN transaction_items i ON i.transaction_id = t.id
  JOIN v_customer_balance vb ON vb.customer_id = t.customer_id`;

export function volume(db, f) {
  const { where, params } = txWhere(f);
  const r = db.prepare(`SELECT COUNT(DISTINCT t.id) AS transaksi,
      COALESCE(SUM(CASE WHEN i.unit = 'kg' THEN i.qty END), 0) AS berat,
      COALESCE(SUM(CASE WHEN i.unit = 'unit' THEN i.qty END), 0) AS unit,
      COALESCE(SUM(i.subtotal_idr), 0) AS nilai
    ${FROM_ITEMS} WHERE ${where}`).get(...params);
  return { transaksi: r.transaksi, berat: round2(r.berat), unit: round2(r.unit), nilai: r.nilai };
}

export function positions(db, f) {
  const min = getNum(db, 'min_conversion');
  const w = ['1 = 1'];
  const p = [];
  if (f.locationIds) {
    if (f.locationIds.length === 0) w.push('1 = 0');
    else { w.push(`location_id IN (${f.locationIds.map(() => '?').join(',')})`); p.push(...f.locationIds); }
  }
  if (f.customerStatus) { w.push('cust_status = ?'); p.push(f.customerStatus); }
  const r = db.prepare(`SELECT
      COUNT(CASE WHEN is_active = 1 THEN 1 END) AS totalNasabah,
      COALESCE(SUM(available), 0) AS tersedia, COALESCE(SUM(held), 0) AS held, COALESCE(SUM(gold), 0) AS gold,
      COUNT(CASE WHEN is_active = 1 AND available >= ? THEN 1 END) AS eligible,
      COUNT(CASE WHEN is_active = 1 AND cust_status = 'baru' THEN 1 END) AS baru,
      COUNT(CASE WHEN is_active = 1 AND cust_status = 'existing' THEN 1 END) AS existing
    FROM v_customer_balance WHERE ${w.join(' AND ')}`).get(min, ...p);
  return r;
}

/** Delapan KPI utama (FR-2.1) + pelengkap. */
export function getKpis(db, f) {
  const v = volume(db, f);
  const pos = positions(db, f);
  return {
    totalTransaksi: v.transaksi,
    totalNasabah: pos.totalNasabah,
    totalBeratKg: v.berat,
    totalUnit: v.unit,
    nilaiEkonomi: v.nilai,
    saldoBelumDikonversi: pos.tersedia + pos.held,
    sudahTabunganEmas: pos.gold,
    nasabahEligible: pos.eligible,
    transferPending: pos.held,
    saldoTersedia: pos.tersedia,
    nasabahBaru: pos.baru,
    nasabahExisting: pos.existing,
  };
}

/** Identitas rekonsiliasi: Nilai Ekonomi = Saldo Belum Dikonversi + Sudah Jadi Tabungan Emas (FR-7.2).
 * Dihitung pada posisi kumulatif (tanpa filter periode/jenis sampah) agar identitas bermakna. */
export function reconciliation(db, f) {
  const base = { locationIds: f.locationIds, customerStatus: f.customerStatus };
  const { where, params } = txWhere(base, { withItems: false });
  const headers = db.prepare(`SELECT COALESCE(SUM(t.total_idr),0) AS nilai, COUNT(*) AS n
    FROM transactions t JOIN v_customer_balance vb ON vb.customer_id = t.customer_id WHERE ${where}`).get(...params);
  const { where: w2, params: p2 } = txWhere(base);
  const items = db.prepare(`SELECT COALESCE(SUM(i.subtotal_idr),0) AS nilai ${FROM_ITEMS} WHERE ${w2}`).get(...p2);
  const pos = positions(db, base);
  const saldoBelum = pos.tersedia + pos.held;
  const selisih = headers.nilai - (saldoBelum + pos.gold);
  const selisihItem = headers.nilai - items.nilai;
  let status = 'seimbang';
  if (headers.n === 0 && pos.gold === 0 && saldoBelum === 0) status = 'belum_ada_data';
  else if (selisih !== 0 || selisihItem !== 0) status = 'tidak_seimbang';
  return { status, nilaiEkonomi: headers.nilai, saldoBelumDikonversi: saldoBelum, tabunganEmas: pos.gold,
    selisih: selisih || selisihItem, basis: 'Posisi kumulatif per hari ini (tanpa filter periode)' };
}

// ---------------- Grafik & tabel analitik ----------------
export function trend(db, f) {
  const { where, params } = txWhere({ ...f, wasteTypeId: f.wasteTypeId }, {});
  const rows = db.prepare(`SELECT t.trx_date AS d, COUNT(DISTINCT t.id) AS transaksi, SUM(i.subtotal_idr) AS nilai
    ${FROM_ITEMS} WHERE ${where} GROUP BY t.trx_date ORDER BY t.trx_date`).all(...params);
  const today = wibDate();
  const from = f.from || rows[0]?.d;
  const to = f.to || today;
  if (!from) return { granularity: 'day', points: [] };
  const span = daysBetween(from, to);
  const map = new Map(rows.map((r) => [r.d, r]));
  if (span <= 92) {
    const pts = [];
    for (let i = 0; i <= span; i++) {
      const d = addDays(from, i);
      const r = map.get(d);
      pts.push({ key: d, transaksi: r?.transaksi ?? 0, nilai: r?.nilai ?? 0 });
    }
    return { granularity: 'day', points: pts };
  }
  const months = new Map();
  for (const r of rows) {
    const k = r.d.slice(0, 7);
    const m = months.get(k) ?? { key: k, transaksi: 0, nilai: 0 };
    m.transaksi += r.transaksi; m.nilai += r.nilai; months.set(k, m);
  }
  return { granularity: 'month', points: [...months.values()] };
}

export function categoryKg(db, f) {
  const { where, params } = txWhere(f);
  return db.prepare(`SELECT wc.nama AS kategori, wc.warna AS warna,
      SUM(CASE WHEN i.unit = 'kg' THEN i.qty ELSE 0 END) AS kg,
      SUM(CASE WHEN i.unit = 'unit' THEN i.qty ELSE 0 END) AS unit
    ${FROM_ITEMS} JOIN waste_types wt ON wt.id = i.waste_type_id JOIN waste_categories wc ON wc.id = wt.category_id
    WHERE ${where} GROUP BY wc.id ORDER BY kg DESC`).all(...params)
    .map((r) => ({ ...r, kg: round2(r.kg) }));
}

function allLocations(db, ids) {
  const rows = db.prepare('SELECT id, nama, is_active, target_kg_bulanan FROM locations ORDER BY id').all();
  return ids ? rows.filter((r) => ids.includes(r.id)) : rows;
}

export function performaLokasi(db, f) {
  const monthStart = wibDate().slice(0, 8) + '01';
  const rows = allLocations(db, f.locationIds).map((l) => {
    const k = getKpis(db, { ...f, locationIds: [l.id] });
    const kgBulanIni = volume(db, { locationIds: [l.id], from: monthStart, to: wibDate() }).berat;
    return {
      id: l.id, nama: l.nama, aktif: !!l.is_active, transaksi: k.totalTransaksi, nasabah: k.totalNasabah,
      baru: k.nasabahBaru, existing: k.nasabahExisting, berat: k.totalBeratKg, unit: k.totalUnit,
      nilai: k.nilaiEkonomi, eligible: k.nasabahEligible, tabunganEmas: k.sudahTabunganEmas,
      saldoBelum: k.saldoBelumDikonversi, pending: k.transferPending,
      targetKg: l.target_kg_bulanan, kgBulanIni,
    };
  }).filter((r) => r.aktif || r.transaksi > 0 || r.nasabah > 0);
  const sum = (key) => rows.reduce((a, r) => a + r[key], 0);
  const total = {
    transaksi: sum('transaksi'), nasabah: sum('nasabah'), baru: sum('baru'), existing: sum('existing'),
    berat: round2(sum('berat')), unit: round2(sum('unit')), nilai: sum('nilai'), eligible: sum('eligible'),
    tabunganEmas: sum('tabunganEmas'), saldoBelum: sum('saldoBelum'), pending: sum('pending'),
  };
  return { rows, total };
}

export function topCustomers(db, f, limit = 5) {
  const { where, params } = txWhere(f);
  return db.prepare(`SELECT c.id, c.nama, SUM(i.subtotal_idr) AS nilai, COUNT(DISTINCT t.id) AS transaksi
    ${FROM_ITEMS} JOIN customers c ON c.id = t.customer_id WHERE ${where}
    GROUP BY c.id ORDER BY nilai DESC LIMIT ?`).all(...params, limit);
}

export function wasteBreakdown(db, f) {
  const { where, params } = txWhere(f);
  const rows = db.prepare(`SELECT wt.id, wt.nama, wc.nama AS kategori, wc.warna, wt.unit,
      SUM(i.qty) AS qty, SUM(i.subtotal_idr) AS nilai, COUNT(DISTINCT t.id) AS transaksi
    ${FROM_ITEMS} JOIN waste_types wt ON wt.id = i.waste_type_id JOIN waste_categories wc ON wc.id = wt.category_id
    WHERE ${where} GROUP BY wt.id ORDER BY nilai DESC`).all(...params);
  const byLoc = db.prepare(`SELECT i.waste_type_id AS wid, l.nama AS lokasi, SUM(i.subtotal_idr) AS nilai
    ${FROM_ITEMS} JOIN locations l ON l.id = t.location_id WHERE ${where}
    GROUP BY i.waste_type_id, l.id ORDER BY nilai DESC`).all(...params);
  const topLoc = new Map();
  for (const r of byLoc) if (!topLoc.has(r.wid)) topLoc.set(r.wid, r.lokasi);
  const total = rows.reduce((a, r) => a + r.nilai, 0);
  return rows.map((r) => ({
    ...r, qty: round2(r.qty), persen: total ? (r.nilai / total) * 100 : 0, lokasiTeratas: topLoc.get(r.id) ?? '-',
  }));
}

/** Paket lengkap Ringkasan (dashboard) — satu panggilan, satu sumber. */
export function dashboard(db, f, { forLocationUser }) {
  const k = getKpis(db, f);
  const perf = performaLokasi(db, f);
  const flow = [
    { label: 'Setoran Sampah', value: k.totalTransaksi, unit: 'transaksi' },
    { label: 'Saldo Nasabah', value: k.saldoBelumDikonversi, unit: 'rupiah' },
    { label: 'Eligible Konversi', value: k.nasabahEligible, unit: 'nasabah' },
    { label: 'Tabungan Emas', value: k.sudahTabunganEmas, unit: 'rupiah' },
  ];
  return {
    kpis: k,
    trend: trend(db, f),
    baruExisting: [
      { name: 'Baru', value: k.nasabahBaru }, { name: 'Existing', value: k.nasabahExisting },
    ],
    kategori: categoryKg(db, f),
    beratPerLokasi: forLocationUser ? [] : perf.rows.map((r) => ({ nama: r.nama, berat: r.berat })),
    flow,
    top: forLocationUser
      ? { jenis: 'nasabah', rows: topCustomers(db, f).map((r) => ({ nama: r.nama, nilai: r.nilai, transaksi: r.transaksi })) }
      : { jenis: 'lokasi', rows: [...perf.rows].sort((a, b) => b.nilai - a.nilai).slice(0, 5).map((r) => ({ nama: r.nama, nilai: r.nilai, transaksi: r.transaksi })) },
  };
}

export function lastDataUpdate(db) {
  const r = db.prepare(`SELECT MAX(x) AS t FROM (
    SELECT MAX(COALESCE(updated_at, created_at)) AS x FROM transactions
    UNION ALL SELECT MAX(COALESCE(completed_at, cancelled_at, verified_at, requested_at)) FROM conversions
    UNION ALL SELECT MAX(created_at) FROM customers)`).get();
  return r.t;
}
