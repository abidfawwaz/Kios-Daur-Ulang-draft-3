// Data awal (PRD Bab 6.4, Lampiran A dan B). Dijalankan otomatis saat database masih kosong.
import fs from 'node:fs';
import path from 'node:path';
import bcrypt from 'bcryptjs';
import { DATA_DIR, withTx } from './db.js';
import { randomPassword, wibDate, nowIso } from './util.js';

const LOCATIONS = [
  ['Malibu Village Gading Serpong', 'Gading Serpong, Tangerang'],
  ['Vila Dago Pamulang', 'Pamulang, Tangerang Selatan'],
  ['Samara Village Serpong', 'Serpong, Tangerang Selatan'],
  ['Pasar Modern Paramount', 'Gading Serpong, Tangerang'],
  ['Pesantren Hafidz Indonesia Centre', 'Tangerang'],
];

const CATEGORIES = [
  ['Kertas', '#F8AD3C'], ['Plastik', '#00978C'], ['Logam', '#5B7083'], ['Kaca', '#56B4D3'],
  ['Minyak', '#E07A5F'], ['Elektronik', '#6C63B5'], ['Campuran', '#9AA5B1'],
];

// [nama, kategori, satuan, harga] — Lampiran A (A-02, A-10)
const WASTE = [
  ['Aluminium', 'Logam', 'kg', 5000], ['Botol Plastik Bersih', 'Plastik', 'kg', 5000],
  ['Botol Plastik Kotor', 'Plastik', 'kg', 2000], ['Elektronik Campur', 'Elektronik', 'kg', 1000],
  ['Ember', 'Plastik', 'kg', 1000], ['Kabin', 'Plastik', 'kg', 1500], ['Kaca', 'Kaca', 'kg', 100],
  ['Kaleng', 'Logam', 'kg', 2000], ['Kardus', 'Kertas', 'kg', 1800], ['Kertas / Buku', 'Kertas', 'kg', 1500],
  ['Logam Berat', 'Logam', 'kg', 3500], ['Logam Ringan', 'Logam', 'kg', 2500],
  ['Mesin Cuci', 'Elektronik', 'unit', 20000], ['Minyak Jelantah', 'Minyak', 'kg', 5000],
  ['Sampah Campur', 'Campuran', 'kg', 1000], ['TV/LCD', 'Elektronik', 'unit', 10000],
];

const SETTINGS = {
  min_conversion: '50000', existing_threshold: '2', backdate_days: '31', session_minutes: '30',
  qty_warn: '500', qty_max: '10000', lock_minutes: '15', max_failed: '5',
};

// Lampiran B. Alamat email diisi saat deployment (dapat diganti lewat env ACCOUNT_DOMAIN).
const ACCOUNTS = (domain) => [
  ['Admin Malibu Village', `admin.malibu@${domain}`, 'admin_lokasi', 'Malibu Village Gading Serpong'],
  ['Admin Vila Dago', `admin.viladago@${domain}`, 'admin_lokasi', 'Vila Dago Pamulang'],
  ['Admin Samara Village', `admin.samara@${domain}`, 'admin_lokasi', 'Samara Village Serpong'],
  ['Admin Pasar Modern', `admin.pasarmodern@${domain}`, 'admin_lokasi', 'Pasar Modern Paramount'],
  ['Admin Hafidz Indonesia', `admin.hafidz@${domain}`, 'admin_lokasi', 'Pesantren Hafidz Indonesia Centre'],
  ['BSI Viewer', `viewer@${domain}`, 'bsi_viewer', null],
  ['Super Admin', `superadmin@${domain}`, 'super_admin', null],
];

export function seedBase(db) {
  const has = db.prepare('SELECT COUNT(*) AS n FROM profiles').get().n;
  if (has > 0) return null;
  const domain = process.env.ACCOUNT_DOMAIN || 'bsi-kios.local';
  const creds = [];
  withTx(db, () => {
    for (const [k, v] of Object.entries(SETTINGS))
      db.prepare('INSERT OR IGNORE INTO app_settings (key, value, updated_at) VALUES (?,?,?)').run(k, v, nowIso());
    const insLoc = db.prepare('INSERT INTO locations (nama, alamat) VALUES (?,?)');
    for (const [n, a] of LOCATIONS) insLoc.run(n, a);
    const insCat = db.prepare('INSERT INTO waste_categories (nama, warna) VALUES (?,?)');
    for (const [n, c] of CATEGORIES) insCat.run(n, c);
    const cat = Object.fromEntries(db.prepare('SELECT id, nama FROM waste_categories').all().map((r) => [r.nama, r.id]));
    const insW = db.prepare('INSERT INTO waste_types (nama, category_id, unit, urutan) VALUES (?,?,?,?)');
    const insP = db.prepare('INSERT INTO waste_price_history (waste_type_id, price_idr, effective_from, reason) VALUES (?,?,?,?)');
    WASTE.forEach(([n, c, u, p], i) => {
      const id = insW.run(n, cat[c], u, i + 1).lastInsertRowid;
      insP.run(id, p, '2026-10-06', 'Data awal dari katalog existing (6 Oktober 2026)');
    });
    const loc = Object.fromEntries(db.prepare('SELECT id, nama FROM locations').all().map((r) => [r.nama, r.id]));
    const insU = db.prepare(`INSERT INTO profiles (email, nama, role, location_id, password_hash, must_change_password)
      VALUES (?,?,?,?,?,1)`);
    for (const [nama, email, role, lokasi] of ACCOUNTS(domain)) {
      const pw = randomPassword();
      insU.run(email, nama, role, lokasi ? loc[lokasi] : null, bcrypt.hashSync(pw, 10));
      creds.push({ nama, email, role, lokasi: lokasi ?? 'Semua lokasi', password: pw });
    }
  });
  const file = path.join(DATA_DIR, 'KREDENSIAL-AWAL.txt');
  const lines = [
    `Kredensial awal — dibuat ${wibDate()} (WIB)`,
    'Kata sandi bersifat sementara dan WAJIB diganti saat login pertama. Hapus berkas ini setelah dibagikan.',
    '',
    ...creds.map((c) => `${c.nama} | ${c.role} | ${c.lokasi}\n  email: ${c.email}\n  kata sandi sementara: ${c.password}\n`),
  ];
  fs.writeFileSync(file, lines.join('\n'), { mode: 0o600 });
  return { file, creds };
}
