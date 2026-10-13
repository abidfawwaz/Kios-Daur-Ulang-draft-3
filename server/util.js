import crypto from 'node:crypto';
import fs from 'node:fs';
import path from 'node:path';
import { DATA_DIR } from './db.js';

export class HttpError extends Error {
  constructor(status, message, code) {
    super(message);
    this.status = status;
    this.code = code;
  }
}
export const bad = (msg, code) => new HttpError(400, msg, code);
export const forbidden = (msg = 'Anda tidak memiliki akses ke aksi ini.') => new HttpError(403, msg);
export const notFound = (msg = 'Data tidak ditemukan.') => new HttpError(404, msg);
export const conflict = (msg, code) => new HttpError(409, msg, code);

// ---- Waktu (WIB, BR-20) ----
export const nowIso = () => new Date().toISOString();
export const wibDate = (d = new Date()) => new Date(d.getTime() + 7 * 3600e3).toISOString().slice(0, 10);
export const isDate = (s) => typeof s === 'string' && /^\d{4}-\d{2}-\d{2}$/.test(s) && !Number.isNaN(Date.parse(s));
export const addDays = (dateStr, n) => new Date(Date.parse(dateStr) + n * 86400e3).toISOString().slice(0, 10);
export const daysBetween = (a, b) => Math.round((Date.parse(b) - Date.parse(a)) / 86400e3);

// ---- Pengaturan ----
const DEFAULTS = {
  min_conversion: '50000', existing_threshold: '2', backdate_days: '31', session_minutes: '30',
  qty_warn: '500', qty_max: '10000', lock_minutes: '15', max_failed: '5',
};
export function getSettings(db) {
  const out = { ...DEFAULTS };
  for (const r of db.prepare('SELECT key, value FROM app_settings').all()) out[r.key] = r.value;
  return out;
}
export const getNum = (db, key) => Number(getSettings(db)[key]);

// ---- Audit & notifikasi ----
export function audit(db, user, action, entity, entityId, before, after, reason) {
  db.prepare(`INSERT INTO audit_logs (at, user_id, user_nama, role, action, entity, entity_id, before, after, reason)
    VALUES (?,?,?,?,?,?,?,?,?,?)`).run(
    nowIso(), user?.id ?? null, user?.nama ?? null, user?.role ?? null, action, entity,
    entityId == null ? null : String(entityId),
    before == null ? null : JSON.stringify(before), after == null ? null : JSON.stringify(after), reason ?? null);
}
export function notify(db, userIds, type, refEntity, refId, message) {
  const st = db.prepare('INSERT INTO notifications (user_id, type, ref_entity, ref_id, message, created_at) VALUES (?,?,?,?,?,?)');
  for (const uid of userIds) st.run(uid, type, refEntity, refId, message, nowIso());
}
export const superAdminIds = (db) =>
  db.prepare("SELECT id FROM profiles WHERE role='super_admin' AND is_active=1").all().map((r) => r.id);
export const locationAdminIds = (db, locationId) =>
  db.prepare("SELECT id FROM profiles WHERE role='admin_lokasi' AND is_active=1 AND location_id=?").all(locationId).map((r) => r.id);

// ---- Penomoran (BR / Bab 6.2): urutan global, nomor tidak didaur ulang ----
export function nextSeq(db, key) {
  db.prepare(`INSERT INTO app_settings (key, value) VALUES (?, '1')
    ON CONFLICT(key) DO UPDATE SET value = CAST(value AS INTEGER) + 1`).run(key);
  return Number(db.prepare('SELECT value FROM app_settings WHERE key = ?').get(key).value);
}
export const pad4 = (n) => String(n).padStart(4, '0');

// ---- Data pribadi ----
export function normalizeWa(input) {
  let d = String(input ?? '').replace(/\D/g, '');
  if (d.startsWith('0')) d = '62' + d.slice(1);
  else if (d.startsWith('8')) d = '62' + d;
  if (!/^62\d{8,13}$/.test(d)) throw bad('Nomor WhatsApp tidak valid. Gunakan format 08xx atau 628xx.');
  return d;
}
export const maskWa = (wa) => (wa ? `${wa.slice(0, 4)}****${wa.slice(-3)}` : null);
export const maskAccount = (a) => (a ? `${'*'.repeat(Math.max(a.length - 4, 0))}${a.slice(-4)}` : null);
export const rupiah = (n) => 'Rp ' + Math.round(n ?? 0).toString().replace(/\B(?=(\d{3})+(?!\d))/g, '.');
export const round2 = (n) => Math.round((n + Number.EPSILON) * 100) / 100;

// ---- Penandatanganan token (sesi & tautan berkas) ----
function secret() {
  if (process.env.APP_SECRET) return process.env.APP_SECRET;
  const f = path.join(DATA_DIR, '.secret');
  if (!fs.existsSync(f)) fs.writeFileSync(f, crypto.randomBytes(48).toString('hex'), { mode: 0o600 });
  return fs.readFileSync(f, 'utf8');
}
let SECRET;
export function sign(payload) {
  SECRET ??= secret();
  const body = Buffer.from(JSON.stringify(payload)).toString('base64url');
  const sig = crypto.createHmac('sha256', SECRET).update(body).digest('base64url');
  return `${body}.${sig}`;
}
export function verify(token) {
  SECRET ??= secret();
  if (typeof token !== 'string' || !token.includes('.')) return null;
  const [body, sig] = token.split('.');
  const exp = crypto.createHmac('sha256', SECRET).update(body).digest('base64url');
  const a = Buffer.from(sig), b = Buffer.from(exp);
  if (a.length !== b.length || !crypto.timingSafeEqual(a, b)) return null;
  try { return JSON.parse(Buffer.from(body, 'base64url').toString()); } catch { return null; }
}

export function randomPassword(len = 14) {
  const chars = 'ABCDEFGHJKMNPQRSTUVWXYZabcdefghijkmnpqrstuvwxyz23456789';
  let out = '';
  for (const b of crypto.randomBytes(len)) out += chars[b % chars.length];
  return out + '7a'; // menjamin ada huruf dan angka
}
export function validatePassword(pw) {
  if (typeof pw !== 'string' || pw.length < 12 || !/[A-Za-z]/.test(pw) || !/\d/.test(pw))
    throw bad('Kata sandi baru minimal 12 karakter dan berisi huruf serta angka.');
}

export function requireReason(reason, min = 10) {
  const r = String(reason ?? '').trim();
  if (r.length < min) throw bad(`Alasan wajib diisi (minimal ${min} karakter).`);
  return r;
}

// Deteksi tipe berkas dari isi (bukan hanya ekstensi).
export function sniffFile(buf) {
  if (buf.length > 4 && buf[0] === 0xff && buf[1] === 0xd8) return { ext: 'jpg', mime: 'image/jpeg' };
  if (buf.length > 8 && buf.subarray(0, 8).equals(Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a])))
    return { ext: 'png', mime: 'image/png' };
  if (buf.length > 4 && buf.subarray(0, 4).toString() === '%PDF') return { ext: 'pdf', mime: 'application/pdf' };
  if (buf.length > 12 && buf.subarray(0, 4).toString() === 'RIFF' && buf.subarray(8, 12).toString() === 'WEBP')
    return { ext: 'webp', mime: 'image/webp' };
  return null;
}
