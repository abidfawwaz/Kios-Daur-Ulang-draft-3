// Database SQLite (node:sqlite). Skema mengikuti PRD Bab 6.1 (15 tabel).
// Kebijakan "tanpa penghapusan permanen" (BR-10) dan "audit_logs hanya INSERT/SELECT" (T-12)
// ditegakkan di level database lewat trigger, bukan hanya di API.
import { DatabaseSync } from 'node:sqlite';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
export const ROOT = path.resolve(__dirname, '..');
export const DATA_DIR = process.env.DATA_DIR ? path.resolve(process.env.DATA_DIR) : path.join(ROOT, 'data');
export const UPLOAD_DIR = path.join(DATA_DIR, 'uploads');

const SCHEMA = `
CREATE TABLE IF NOT EXISTS locations (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  nama TEXT NOT NULL UNIQUE,
  alamat TEXT,
  is_active INTEGER NOT NULL DEFAULT 1,
  target_kg_bulanan REAL
);
CREATE TABLE IF NOT EXISTS profiles (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  email TEXT NOT NULL UNIQUE,
  nama TEXT NOT NULL,
  role TEXT NOT NULL CHECK (role IN ('super_admin','admin_lokasi','bsi_viewer')),
  location_id INTEGER REFERENCES locations(id),
  password_hash TEXT NOT NULL,
  is_active INTEGER NOT NULL DEFAULT 1,
  must_change_password INTEGER NOT NULL DEFAULT 1,
  failed_attempts INTEGER NOT NULL DEFAULT 0,
  locked_until TEXT,
  last_login_at TEXT,
  created_at TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ','now')),
  CHECK (role <> 'admin_lokasi' OR location_id IS NOT NULL)
);
CREATE TABLE IF NOT EXISTS waste_categories (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  nama TEXT NOT NULL UNIQUE,
  warna TEXT NOT NULL
);
CREATE TABLE IF NOT EXISTS waste_types (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  nama TEXT NOT NULL UNIQUE,
  category_id INTEGER NOT NULL REFERENCES waste_categories(id),
  unit TEXT NOT NULL CHECK (unit IN ('kg','unit')),
  is_active INTEGER NOT NULL DEFAULT 1,
  urutan INTEGER NOT NULL DEFAULT 0
);
CREATE TABLE IF NOT EXISTS waste_price_history (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  waste_type_id INTEGER NOT NULL REFERENCES waste_types(id),
  price_idr INTEGER NOT NULL CHECK (price_idr > 0),
  effective_from TEXT NOT NULL,
  changed_by INTEGER REFERENCES profiles(id),
  reason TEXT,
  created_at TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ','now'))
);
CREATE TABLE IF NOT EXISTS customers (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  location_id INTEGER NOT NULL REFERENCES locations(id),
  nama TEXT NOT NULL,
  whatsapp TEXT NOT NULL,
  jenis TEXT NOT NULL DEFAULT 'individu' CHECK (jenis IN ('individu','usaha','institusi')),
  bsi_account_no TEXT,
  is_active INTEGER NOT NULL DEFAULT 1,
  created_by INTEGER REFERENCES profiles(id),
  created_at TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ','now'))
);
CREATE TABLE IF NOT EXISTS transactions (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  trx_no TEXT NOT NULL UNIQUE,
  location_id INTEGER NOT NULL REFERENCES locations(id),
  customer_id INTEGER NOT NULL REFERENCES customers(id),
  trx_date TEXT NOT NULL,
  status TEXT NOT NULL DEFAULT 'sukses' CHECK (status IN ('sukses','void')),
  total_idr INTEGER NOT NULL,
  void_reason TEXT,
  backdate_reason TEXT,
  created_by INTEGER REFERENCES profiles(id),
  created_at TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ','now')),
  updated_at TEXT
);
CREATE TABLE IF NOT EXISTS transaction_items (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  transaction_id INTEGER NOT NULL REFERENCES transactions(id),
  waste_type_id INTEGER NOT NULL REFERENCES waste_types(id),
  qty REAL NOT NULL CHECK (qty > 0),
  unit TEXT NOT NULL CHECK (unit IN ('kg','unit')),
  price_idr_snapshot INTEGER NOT NULL,
  subtotal_idr INTEGER NOT NULL,
  is_active INTEGER NOT NULL DEFAULT 1
);
CREATE TABLE IF NOT EXISTS conversions (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  cnv_no TEXT NOT NULL UNIQUE,
  customer_id INTEGER NOT NULL REFERENCES customers(id),
  location_id INTEGER NOT NULL REFERENCES locations(id),
  amount_idr INTEGER NOT NULL CHECK (amount_idr > 0),
  bsi_account_no TEXT NOT NULL,
  status TEXT NOT NULL CHECK (status IN ('diajukan','diverifikasi','transfer_selesai','ditolak','dibatalkan')),
  requested_by INTEGER REFERENCES profiles(id),
  requested_at TEXT NOT NULL,
  verified_by INTEGER REFERENCES profiles(id),
  verified_at TEXT,
  reject_reason TEXT,
  transferred_by INTEGER REFERENCES profiles(id),
  transferred_at TEXT,
  completed_at TEXT,
  cancel_reason TEXT,
  cancelled_by INTEGER REFERENCES profiles(id),
  cancelled_at TEXT
);
CREATE TABLE IF NOT EXISTS conversion_proofs (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  conversion_id INTEGER NOT NULL REFERENCES conversions(id),
  file_path TEXT NOT NULL,
  file_name TEXT NOT NULL,
  version INTEGER NOT NULL,
  uploaded_by INTEGER REFERENCES profiles(id),
  uploaded_at TEXT NOT NULL,
  correction_reason TEXT
);
CREATE TABLE IF NOT EXISTS documents (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  location_id INTEGER NOT NULL REFERENCES locations(id),
  judul TEXT NOT NULL,
  caption TEXT,
  kategori TEXT NOT NULL CHECK (kategori IN ('Kegiatan Kios','Penyerahan Tabungan Emas','Edukasi','Lainnya')),
  tanggal TEXT NOT NULL,
  file_path TEXT NOT NULL,
  uploaded_by INTEGER REFERENCES profiles(id),
  uploaded_at TEXT NOT NULL,
  is_archived INTEGER NOT NULL DEFAULT 0,
  archive_reason TEXT
);
CREATE TABLE IF NOT EXISTS report_snapshots (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  label TEXT NOT NULL,
  filters TEXT NOT NULL,
  kpis TEXT NOT NULL,
  created_by INTEGER REFERENCES profiles(id),
  created_at TEXT NOT NULL
);
CREATE TABLE IF NOT EXISTS audit_logs (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  at TEXT NOT NULL,
  user_id INTEGER,
  user_nama TEXT,
  role TEXT,
  action TEXT NOT NULL,
  entity TEXT NOT NULL,
  entity_id TEXT,
  before TEXT,
  after TEXT,
  reason TEXT
);
CREATE TABLE IF NOT EXISTS notifications (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  user_id INTEGER NOT NULL REFERENCES profiles(id),
  type TEXT NOT NULL,
  ref_entity TEXT,
  ref_id INTEGER,
  message TEXT NOT NULL,
  is_read INTEGER NOT NULL DEFAULT 0,
  created_at TEXT NOT NULL
);
CREATE TABLE IF NOT EXISTS app_settings (
  key TEXT PRIMARY KEY,
  value TEXT NOT NULL,
  updated_by INTEGER,
  updated_at TEXT
);

CREATE INDEX IF NOT EXISTS ix_trx_cust ON transactions(customer_id, status);
CREATE INDEX IF NOT EXISTS ix_trx_loc_date ON transactions(location_id, trx_date);
CREATE INDEX IF NOT EXISTS ix_items_trx ON transaction_items(transaction_id, is_active);
CREATE INDEX IF NOT EXISTS ix_cnv_cust ON conversions(customer_id, status);
CREATE INDEX IF NOT EXISTS ix_cust_loc ON customers(location_id);
CREATE INDEX IF NOT EXISTS ix_audit_at ON audit_logs(at);
CREATE INDEX IF NOT EXISTS ix_notif_user ON notifications(user_id, is_read);

-- Satu-satunya definisi saldo per nasabah (BR-03). Dipakai oleh seluruh KPI, laporan, dan ekspor.
DROP VIEW IF EXISTS v_customer_balance;
CREATE VIEW v_customer_balance AS
SELECT c.id AS customer_id, c.location_id, c.is_active,
  d.deposits, d.ntx,
  COALESCE(h.held, 0) AS held,
  COALESCE(g.gold, 0) AS gold,
  d.deposits - COALESCE(h.held, 0) - COALESCE(g.gold, 0) AS available,
  CASE WHEN d.ntx >= (SELECT CAST(value AS INTEGER) FROM app_settings WHERE key = 'existing_threshold')
       THEN 'existing' ELSE 'baru' END AS cust_status
FROM customers c
JOIN (SELECT c2.id AS cid,
        COALESCE((SELECT SUM(t.total_idr) FROM transactions t WHERE t.customer_id = c2.id AND t.status = 'sukses'), 0) AS deposits,
        (SELECT COUNT(*) FROM transactions t WHERE t.customer_id = c2.id AND t.status = 'sukses') AS ntx
      FROM customers c2) d ON d.cid = c.id
LEFT JOIN (SELECT customer_id, SUM(amount_idr) AS held FROM conversions
           WHERE status IN ('diajukan','diverifikasi') GROUP BY customer_id) h ON h.customer_id = c.id
LEFT JOIN (SELECT customer_id, SUM(amount_idr) AS gold FROM conversions
           WHERE status = 'transfer_selesai' GROUP BY customer_id) g ON g.customer_id = c.id;
`;

const DATA_TABLES = [
  'locations', 'profiles', 'waste_categories', 'waste_types', 'waste_price_history', 'customers',
  'transactions', 'transaction_items', 'conversions', 'conversion_proofs', 'documents',
  'report_snapshots', 'audit_logs', 'notifications', 'app_settings',
];
const IMMUTABLE_TABLES = ['audit_logs', 'report_snapshots', 'conversion_proofs'];

export function openDb(file) {
  fs.mkdirSync(DATA_DIR, { recursive: true });
  fs.mkdirSync(UPLOAD_DIR, { recursive: true });
  const db = new DatabaseSync(file ?? path.join(DATA_DIR, 'kios.db'));
  db.exec('PRAGMA journal_mode = WAL; PRAGMA foreign_keys = ON; PRAGMA busy_timeout = 5000;');
  db.exec(SCHEMA);
  for (const t of DATA_TABLES) {
    db.exec(`CREATE TRIGGER IF NOT EXISTS no_delete_${t} BEFORE DELETE ON ${t}
      BEGIN SELECT RAISE(ABORT, 'Penghapusan permanen tidak diizinkan'); END;`);
  }
  for (const t of IMMUTABLE_TABLES) {
    db.exec(`CREATE TRIGGER IF NOT EXISTS no_update_${t} BEFORE UPDATE ON ${t}
      BEGIN SELECT RAISE(ABORT, 'Data ini tidak dapat diubah'); END;`);
  }
  return db;
}

/** Jalankan fn dalam satu transaksi database; rollback bila melempar galat. */
export function withTx(db, fn) {
  db.exec('BEGIN IMMEDIATE');
  try {
    const out = fn();
    db.exec('COMMIT');
    return out;
  } catch (e) {
    try { db.exec('ROLLBACK'); } catch { /* sudah rollback */ }
    throw e;
  }
}
