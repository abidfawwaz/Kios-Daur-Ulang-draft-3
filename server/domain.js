// Logika bisnis (PRD Bab 4.6 BR-xx dan FR-3/4/5). Dipakai oleh API dan oleh seed demo.
// Setiap fungsi tulis: memeriksa hak akses, memvalidasi aturan, menulis log audit — dalam satu transaksi DB.
import fs from 'node:fs';
import path from 'node:path';
import crypto from 'node:crypto';
import { withTx, UPLOAD_DIR } from './db.js';
import {
  bad, forbidden, notFound, conflict, nowIso, wibDate, isDate, daysBetween, getSettings, audit, notify,
  superAdminIds, locationAdminIds, nextSeq, pad4, normalizeWa, requireReason, round2, rupiah, sniffFile,
} from './util.js';

// ---------------- Pembantu ----------------
export const balanceOf = (db, customerId) =>
  db.prepare('SELECT * FROM v_customer_balance WHERE customer_id = ?').get(customerId);

export function activePrice(db, wasteTypeId, date = wibDate()) {
  const r = db.prepare(`SELECT price_idr FROM waste_price_history WHERE waste_type_id = ? AND effective_from <= ?
    ORDER BY effective_from DESC, id DESC LIMIT 1`).get(wasteTypeId, date);
  return r?.price_idr ?? null;
}

function requireRole(user, ...roles) {
  if (!user || !roles.includes(user.role)) throw forbidden();
}
function ownCustomer(db, user, customerId) {
  const c = db.prepare('SELECT * FROM customers WHERE id = ?').get(customerId);
  if (!c) throw notFound('Nasabah tidak ditemukan.');
  if (user.role === 'admin_lokasi' && c.location_id !== user.location_id) throw notFound('Nasabah tidak ditemukan.');
  return c;
}

export function saveFile(buffer, allowed) {
  const t = sniffFile(buffer);
  if (!t || !allowed.includes(t.ext)) throw bad(`Jenis berkas tidak diizinkan. Gunakan ${allowed.join(', ').toUpperCase()}.`);
  if (buffer.length > 5 * 1024 * 1024) throw bad('Ukuran berkas maksimal 5 MB.');
  const name = `${crypto.randomUUID()}.${t.ext}`;
  fs.mkdirSync(UPLOAD_DIR, { recursive: true });
  fs.writeFileSync(path.join(UPLOAD_DIR, name), buffer, { mode: 0o600 });
  return { file_path: name, ...t };
}

// ---------------- Nasabah ----------------
const norm = (s) => String(s).toLowerCase().replace(/\s+/g, '');

export function similarCustomers(db, locationId, nama, excludeId = 0) {
  const target = norm(nama);
  if (!target) return [];
  return db.prepare('SELECT id, nama FROM customers WHERE location_id = ? AND id <> ?').all(locationId, excludeId)
    .filter((c) => norm(c.nama) === target);
}

function validateAccount(a) {
  if (a == null || a === '') return null;
  if (!/^\d{10}$/.test(String(a))) throw bad('Nomor rekening BSI harus 10 digit angka.');
  return String(a);
}

export function createCustomer(db, user, body) {
  requireRole(user, 'admin_lokasi');
  const nama = String(body.nama ?? '').trim();
  if (nama.length < 2) throw bad('Nama nasabah wajib diisi.');
  const jenis = body.jenis ?? 'individu';
  if (!['individu', 'usaha', 'institusi'].includes(jenis)) throw bad('Jenis nasabah tidak valid.');
  const wa = normalizeWa(body.whatsapp);
  const acc = validateAccount(body.bsi_account_no);
  return withTx(db, () => {
    const id = db.prepare(`INSERT INTO customers (location_id, nama, whatsapp, jenis, bsi_account_no, created_by)
      VALUES (?,?,?,?,?,?)`).run(user.location_id, nama, wa, jenis, acc, user.id).lastInsertRowid;
    audit(db, user, 'customer.create', 'customers', id, null, { nama, jenis, location_id: user.location_id });
    return { id, similar: similarCustomers(db, user.location_id, nama, id) };
  });
}

export function updateCustomer(db, user, id, body) {
  requireRole(user, 'admin_lokasi');
  const c = ownCustomer(db, user, id);
  const patch = {};
  if (body.nama !== undefined) {
    patch.nama = String(body.nama).trim();
    if (patch.nama.length < 2) throw bad('Nama nasabah wajib diisi.');
  }
  if (body.whatsapp !== undefined) patch.whatsapp = normalizeWa(body.whatsapp);
  if (body.jenis !== undefined) {
    if (!['individu', 'usaha', 'institusi'].includes(body.jenis)) throw bad('Jenis nasabah tidak valid.');
    patch.jenis = body.jenis;
  }
  if (body.bsi_account_no !== undefined) patch.bsi_account_no = validateAccount(body.bsi_account_no);
  if (body.is_active !== undefined) {
    const active = body.is_active ? 1 : 0;
    if (!active) {
      const n = db.prepare("SELECT COUNT(*) AS n FROM conversions WHERE customer_id = ? AND status IN ('diajukan','diverifikasi')").get(id).n;
      if (n > 0) throw conflict('Nasabah masih memiliki konversi aktif dan tidak dapat dinonaktifkan.');
    }
    patch.is_active = active;
  }
  const keys = Object.keys(patch);
  if (!keys.length) return { id };
  return withTx(db, () => {
    db.prepare(`UPDATE customers SET ${keys.map((k) => `${k} = ?`).join(', ')} WHERE id = ?`).run(...keys.map((k) => patch[k]), id);
    const mask = (o) => ({ ...o, whatsapp: o.whatsapp ? '(disimpan)' : o.whatsapp, bsi_account_no: o.bsi_account_no ? '(disimpan)' : o.bsi_account_no });
    const before = Object.fromEntries(keys.map((k) => [k, c[k]]));
    audit(db, user, patch.is_active === 0 ? 'customer.deactivate' : 'customer.update', 'customers', id, mask(before), mask(patch));
    return { id, similar: patch.nama ? similarCustomers(db, c.location_id, patch.nama, id) : [] };
  });
}

// ---------------- Transaksi ----------------
function normalizeItems(db, items, st, { existingTypeIds = new Set(), keepPrices = new Map() } = {}) {
  if (!Array.isArray(items) || items.length === 0) throw bad('Tambahkan minimal satu item sampah.');
  const out = [];
  let large = false;
  for (const it of items) {
    const wt = db.prepare('SELECT * FROM waste_types WHERE id = ?').get(Number(it.waste_type_id));
    if (!wt) throw bad('Jenis sampah tidak ditemukan.');
    if (!wt.is_active && !existingTypeIds.has(wt.id)) throw bad(`Jenis sampah "${wt.nama}" sudah tidak aktif.`);
    const qty = Number(it.qty);
    if (!Number.isFinite(qty) || qty <= 0) throw bad(`Jumlah untuk "${wt.nama}" harus lebih dari 0.`);
    if (wt.unit === 'unit') {
      if (!Number.isInteger(qty)) throw bad(`Jumlah untuk "${wt.nama}" harus bilangan bulat (unit).`);
    } else if (Math.abs(qty * 100 - Math.round(qty * 100)) > 1e-6) {
      throw bad(`Jumlah untuk "${wt.nama}" maksimal 2 angka desimal.`);
    }
    if (qty > Number(st.qty_max)) throw bad(`Jumlah untuk "${wt.nama}" melebihi batas ${st.qty_max}.`);
    if (qty > Number(st.qty_warn)) large = true;
    const price = keepPrices.get(wt.id) ?? activePrice(db, wt.id);
    if (price == null) throw bad(`Harga untuk "${wt.nama}" belum diatur.`);
    out.push({ waste_type_id: wt.id, qty: round2(qty), unit: wt.unit, price, subtotal: Math.round(qty * price), nama: wt.nama });
  }
  return { items: out, large, total: out.reduce((a, i) => a + i.subtotal, 0) };
}

function insertItems(db, trxId, items) {
  const st = db.prepare(`INSERT INTO transaction_items (transaction_id, waste_type_id, qty, unit, price_idr_snapshot, subtotal_idr)
    VALUES (?,?,?,?,?,?)`);
  for (const i of items) st.run(trxId, i.waste_type_id, i.qty, i.unit, i.price, i.subtotal);
}

export function createTransaction(db, user, body) {
  requireRole(user, 'admin_lokasi');
  const st = getSettings(db);
  const cust = ownCustomer(db, user, Number(body.customer_id));
  if (!cust.is_active) throw bad('Nasabah nonaktif tidak dapat bertransaksi.');
  const today = wibDate();
  const date = body.trx_date || today;
  if (!isDate(date)) throw bad('Tanggal tidak valid.');
  if (date > today) throw bad('Tanggal transaksi tidak boleh di masa depan.');
  let backdateReason = null;
  if (daysBetween(date, today) > Number(st.backdate_days)) backdateReason = requireReason(body.backdate_reason);
  const { items, large, total } = normalizeItems(db, body.items, st);
  if (large && !body.confirm_large)
    throw conflict(`Jumlah satu item melebihi ${st.qty_warn}. Pastikan angka sudah benar.`, 'LARGE_QTY');
  if (!body.confirm_duplicate) {
    const since = new Date(Date.now() - 10 * 60e3).toISOString();
    for (const i of items) {
      const dup = db.prepare(`SELECT t.id FROM transactions t JOIN transaction_items x ON x.transaction_id = t.id AND x.is_active = 1
        WHERE t.customer_id = ? AND t.status = 'sukses' AND t.created_at >= ? AND x.waste_type_id = ? AND x.qty = ? LIMIT 1`)
        .get(cust.id, since, i.waste_type_id, i.qty);
      if (dup) throw conflict('Transaksi serupa untuk nasabah ini baru saja dicatat. Tetap simpan?', 'DUPLICATE');
    }
  }
  const seq = nextSeq(db, 'seq_trx');
  const trxNo = `TRX-${date.replaceAll('-', '')}-${pad4(seq)}`;
  const min = Number(st.min_conversion);
  return withTx(db, () => {
    const before = balanceOf(db, cust.id);
    const id = db.prepare(`INSERT INTO transactions (trx_no, location_id, customer_id, trx_date, total_idr, backdate_reason, created_by, created_at)
      VALUES (?,?,?,?,?,?,?,?)`).run(trxNo, cust.location_id, cust.id, date, total, backdateReason, user.id, nowIso()).lastInsertRowid;
    insertItems(db, id, items);
    audit(db, user, 'transaction.create', 'transactions', id, null,
      { trx_no: trxNo, customer_id: cust.id, trx_date: date, total_idr: total, items: items.map(({ nama, qty, unit, price }) => ({ nama, qty, unit, price })) },
      backdateReason);
    if (before.available < min && before.available + total >= min)
      notify(db, locationAdminIds(db, cust.location_id), 'eligible', 'customers', cust.id, `${cust.nama} kini eligible untuk konversi Tabungan Emas.`);
    return { id, trx_no: trxNo, total_idr: total, saldoSebelumnya: before.available, saldoTerbaru: before.available + total };
  });
}

export function getTransaction(db, id) {
  const t = db.prepare(`SELECT t.*, c.nama AS customer_nama, l.nama AS location_nama, p.nama AS created_by_nama
    FROM transactions t JOIN customers c ON c.id = t.customer_id JOIN locations l ON l.id = t.location_id
    LEFT JOIN profiles p ON p.id = t.created_by WHERE t.id = ?`).get(id);
  if (!t) return null;
  t.items = db.prepare(`SELECT i.id, i.waste_type_id, wt.nama, i.qty, i.unit, i.price_idr_snapshot AS price, i.subtotal_idr AS subtotal
    FROM transaction_items i JOIN waste_types wt ON wt.id = i.waste_type_id WHERE i.transaction_id = ? AND i.is_active = 1 ORDER BY i.id`).all(id);
  t.saldo = balanceOf(db, t.customer_id);
  return t;
}

function ownTransaction(db, user, id) {
  const t = db.prepare('SELECT * FROM transactions WHERE id = ?').get(id);
  if (!t || (user.role === 'admin_lokasi' && t.location_id !== user.location_id)) throw notFound('Transaksi tidak ditemukan.');
  return t;
}

export function editTransaction(db, user, id, body) {
  requireRole(user, 'admin_lokasi');
  const t = ownTransaction(db, user, id);
  const reason = requireReason(body.reason);
  if (t.status !== 'sukses') throw bad('Transaksi void tidak dapat diedit.');
  const st = getSettings(db);
  const old = db.prepare('SELECT * FROM transaction_items WHERE transaction_id = ? AND is_active = 1').all(id);
  const keepPrices = new Map(old.map((o) => [o.waste_type_id, o.price_idr_snapshot]));
  const { items, large, total } = normalizeItems(db, body.items, st, { existingTypeIds: new Set(old.map((o) => o.waste_type_id)), keepPrices });
  if (large && !body.confirm_large) throw conflict(`Jumlah satu item melebihi ${st.qty_warn}. Pastikan angka sudah benar.`, 'LARGE_QTY');
  const bal = balanceOf(db, t.customer_id);
  if (bal.available - t.total_idr + total < 0)
    throw conflict('Edit ditolak: saldo tersedia nasabah akan menjadi negatif karena dana sudah tertahan atau dikonversi.');
  return withTx(db, () => {
    const beforeItems = old.map((o) => ({ waste_type_id: o.waste_type_id, qty: o.qty, unit: o.unit, price: o.price_idr_snapshot }));
    db.prepare('UPDATE transaction_items SET is_active = 0 WHERE transaction_id = ? AND is_active = 1').run(id);
    insertItems(db, id, items);
    db.prepare('UPDATE transactions SET total_idr = ?, updated_at = ? WHERE id = ?').run(total, nowIso(), id);
    audit(db, user, 'transaction.edit', 'transactions', id, { total_idr: t.total_idr, items: beforeItems },
      { total_idr: total, items: items.map(({ waste_type_id, qty, unit, price }) => ({ waste_type_id, qty, unit, price })) }, reason);
    return { id, total_idr: total };
  });
}

export function voidTransaction(db, user, id, body) {
  requireRole(user, 'admin_lokasi');
  const t = ownTransaction(db, user, id);
  const reason = requireReason(body.reason);
  if (t.status !== 'sukses') throw bad('Transaksi sudah void.');
  const bal = balanceOf(db, t.customer_id);
  if (bal.available - t.total_idr < 0)
    throw conflict('Void ditolak: saldo tersedia nasabah akan menjadi negatif karena dana sudah tertahan atau dikonversi.');
  return withTx(db, () => {
    db.prepare("UPDATE transactions SET status = 'void', void_reason = ?, updated_at = ? WHERE id = ?").run(reason, nowIso(), id);
    audit(db, user, 'transaction.void', 'transactions', id, { status: 'sukses', total_idr: t.total_idr }, { status: 'void' }, reason);
    return { id, status: 'void' };
  });
}

// ---------------- Konversi ----------------
export function createConversion(db, user, body) {
  requireRole(user, 'admin_lokasi');
  const st = getSettings(db);
  const min = Number(st.min_conversion);
  const cust = ownCustomer(db, user, Number(body.customer_id));
  if (!cust.is_active) throw bad('Nasabah nonaktif.');
  const amount = Number(body.amount_idr);
  if (!Number.isInteger(amount)) throw bad('Nominal harus bilangan bulat rupiah.');
  if (amount < min) throw bad(`Nominal minimal ${rupiah(min)}.`);
  const acc = validateAccount(body.bsi_account_no);
  if (!acc) throw bad('Nomor rekening BSI wajib diisi (10 digit).');
  const bal = balanceOf(db, cust.id);
  if (amount > bal.available) throw bad(`Nominal melebihi saldo tersedia (${rupiah(bal.available)}).`);
  const active = db.prepare("SELECT cnv_no FROM conversions WHERE customer_id = ? AND status IN ('diajukan','diverifikasi')").get(cust.id);
  if (active) throw conflict(`Nasabah masih memiliki konversi aktif (${active.cnv_no}).`);
  const seq = nextSeq(db, 'seq_cnv');
  const no = `CNV${wibDate().replaceAll('-', '')}${pad4(seq)}`;
  return withTx(db, () => {
    const id = db.prepare(`INSERT INTO conversions (cnv_no, customer_id, location_id, amount_idr, bsi_account_no, status, requested_by, requested_at)
      VALUES (?,?,?,?,?,'diajukan',?,?)`).run(no, cust.id, cust.location_id, amount, acc, user.id, nowIso()).lastInsertRowid;
    if (!cust.bsi_account_no) db.prepare('UPDATE customers SET bsi_account_no = ? WHERE id = ?').run(acc, cust.id);
    audit(db, user, 'conversion.request', 'conversions', id, null, { cnv_no: no, customer_id: cust.id, amount_idr: amount });
    notify(db, superAdminIds(db), 'conversion_requested', 'conversions', id, `Konversi baru ${no} (${cust.nama}, ${rupiah(amount)}) menunggu verifikasi.`);
    return { id, cnv_no: no, status: 'diajukan' };
  });
}

function getConversionRow(db, id) {
  const c = db.prepare('SELECT * FROM conversions WHERE id = ?').get(id);
  if (!c) throw notFound('Konversi tidak ditemukan.');
  return c;
}
function scopedConversion(db, user, id) {
  const c = getConversionRow(db, id);
  if (user.role === 'admin_lokasi' && c.location_id !== user.location_id) throw notFound('Konversi tidak ditemukan.');
  return c;
}
export { scopedConversion };

export function verifyConversion(db, user, id) {
  requireRole(user, 'super_admin');
  const c = getConversionRow(db, id);
  if (c.status !== 'diajukan') throw conflict('Hanya konversi berstatus Diajukan yang dapat diverifikasi.');
  return withTx(db, () => {
    db.prepare("UPDATE conversions SET status = 'diverifikasi', verified_by = ?, verified_at = ? WHERE id = ?").run(user.id, nowIso(), id);
    audit(db, user, 'conversion.verify', 'conversions', id, { status: 'diajukan' }, { status: 'diverifikasi' });
    notify(db, locationAdminIds(db, c.location_id), 'conversion_verified', 'conversions', id, `Konversi ${c.cnv_no} telah diverifikasi dan menunggu transfer.`);
    return { id, status: 'diverifikasi' };
  });
}

export function rejectConversion(db, user, id, body) {
  requireRole(user, 'super_admin');
  const reason = requireReason(body.reason);
  const c = getConversionRow(db, id);
  if (c.status !== 'diajukan') throw conflict('Hanya konversi berstatus Diajukan yang dapat ditolak.');
  return withTx(db, () => {
    db.prepare("UPDATE conversions SET status = 'ditolak', reject_reason = ?, verified_by = ?, verified_at = ? WHERE id = ?").run(reason, user.id, nowIso(), id);
    audit(db, user, 'conversion.reject', 'conversions', id, { status: 'diajukan' }, { status: 'ditolak' }, reason);
    notify(db, locationAdminIds(db, c.location_id), 'conversion_rejected', 'conversions', id, `Konversi ${c.cnv_no} ditolak: ${reason}`);
    return { id, status: 'ditolak' };
  });
}

export function cancelConversion(db, user, id, body) {
  requireRole(user, 'admin_lokasi', 'super_admin');
  const reason = requireReason(body.reason);
  const c = scopedConversion(db, user, id);
  const ok = user.role === 'admin_lokasi' ? c.status === 'diajukan' : ['diajukan', 'diverifikasi'].includes(c.status);
  if (!ok) throw conflict(user.role === 'admin_lokasi'
    ? 'Admin Lokasi hanya dapat membatalkan konversi berstatus Diajukan.'
    : 'Konversi tidak dapat dibatalkan pada status ini.');
  return withTx(db, () => {
    db.prepare("UPDATE conversions SET status = 'dibatalkan', cancel_reason = ?, cancelled_by = ?, cancelled_at = ? WHERE id = ?").run(reason, user.id, nowIso(), id);
    audit(db, user, 'conversion.cancel', 'conversions', id, { status: c.status }, { status: 'dibatalkan' }, reason);
    if (user.role === 'super_admin') notify(db, locationAdminIds(db, c.location_id), 'conversion_cancelled', 'conversions', id, `Konversi ${c.cnv_no} dibatalkan: ${reason}`);
    return { id, status: 'dibatalkan' };
  });
}

export function completeConversion(db, user, id, { file, transferDate, fileName }) {
  requireRole(user, 'super_admin');
  const c = getConversionRow(db, id);
  if (c.status !== 'diverifikasi') throw conflict('Bukti hanya dapat diunggah untuk konversi berstatus Diverifikasi.');
  if (!isDate(transferDate) || transferDate > wibDate()) throw bad('Tanggal transfer wajib diisi dan tidak boleh di masa depan.');
  if (!file) throw bad('Bukti transfer wajib diunggah.');
  const saved = saveFile(file, ['jpg', 'png', 'pdf']);
  return withTx(db, () => {
    db.prepare('INSERT INTO conversion_proofs (conversion_id, file_path, file_name, version, uploaded_by, uploaded_at) VALUES (?,?,?,?,?,?)')
      .run(id, saved.file_path, fileName || saved.file_path, 1, user.id, nowIso());
    db.prepare("UPDATE conversions SET status = 'transfer_selesai', transferred_by = ?, transferred_at = ?, completed_at = ? WHERE id = ?")
      .run(user.id, transferDate, nowIso(), id);
    audit(db, user, 'conversion.complete', 'conversions', id, { status: 'diverifikasi' }, { status: 'transfer_selesai', transferred_at: transferDate, proof_version: 1 });
    notify(db, locationAdminIds(db, c.location_id), 'conversion_done', 'conversions', id, `Konversi ${c.cnv_no} selesai. Tabungan Emas nasabah bertambah ${rupiah(c.amount_idr)}.`);
    return { id, status: 'transfer_selesai' };
  });
}

export function correctProof(db, user, id, { file, reason, fileName, transferDate }) {
  requireRole(user, 'super_admin');
  const why = requireReason(reason);
  const c = getConversionRow(db, id);
  if (c.status !== 'transfer_selesai') throw conflict('Koreksi bukti hanya untuk konversi berstatus Transfer Selesai.');
  if (!file) throw bad('Berkas bukti baru wajib diunggah.');
  if (transferDate && (!isDate(transferDate) || transferDate > wibDate())) throw bad('Tanggal transfer tidak valid.');
  const saved = saveFile(file, ['jpg', 'png', 'pdf']);
  return withTx(db, () => {
    const v = db.prepare('SELECT MAX(version) AS v FROM conversion_proofs WHERE conversion_id = ?').get(id).v ?? 0;
    db.prepare('INSERT INTO conversion_proofs (conversion_id, file_path, file_name, version, uploaded_by, uploaded_at, correction_reason) VALUES (?,?,?,?,?,?,?)')
      .run(id, saved.file_path, fileName || saved.file_path, v + 1, user.id, nowIso(), why);
    if (transferDate) db.prepare('UPDATE conversions SET transferred_at = ? WHERE id = ?').run(transferDate, id);
    audit(db, user, 'conversion.proof_correct', 'conversions', id, { proof_version: v, transferred_at: c.transferred_at },
      { proof_version: v + 1, transferred_at: transferDate || c.transferred_at }, why);
    return { id, version: v + 1 };
  });
}
