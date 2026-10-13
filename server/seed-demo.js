// Data demo sintetis untuk uji dan pelatihan. JANGAN dijalankan pada database produksi.
// Pemakaian: npm run seed:demo  (tambahkan --force bila database sudah berisi transaksi)
import { openDb } from './db.js';
import { seedBase } from './seed.js';
import * as D from './domain.js';
import { addDays, wibDate } from './util.js';

const db = openDb();
seedBase(db);
if (db.prepare('SELECT COUNT(*) AS n FROM transactions').get().n > 0 && !process.argv.includes('--force')) {
  console.error('Database sudah berisi transaksi. Gunakan --force bila Anda yakin.');
  process.exit(1);
}
let s = 42;
const rnd = () => ((s = (s * 1664525 + 1013904223) % 4294967296) / 4294967296);
const pick = (a) => a[Math.floor(rnd() * a.length)];

const NAMES = ['Siti Aminah', 'Budi Santoso', 'Rudi Hartono', 'Dewi Lestari', 'Agus Salim', 'Rina Marlina', 'Ahmad Fauzi', 'Nur Hidayah',
  'Eko Prasetyo', 'Fitri Handayani', 'Yusuf Maulana', 'Lina Wati', 'Hasan Basri', 'Maya Sari', 'Dedi Kurniawan', 'Tuti Alawiyah',
  'Joko Widodo', 'Sri Rahayu', 'Irfan Hakim', 'Wulan Dari', 'Umar Said', 'Aisyah Putri', 'Zainal Abidin', 'Ratna Sari'];
const waste = db.prepare('SELECT id, nama, unit FROM waste_types').all();
const kgTypes = waste.filter((w) => w.unit === 'kg');
const unitTypes = waste.filter((w) => w.unit === 'unit');
const locs = db.prepare('SELECT id FROM locations ORDER BY id').all();
const today = wibDate();
const weights = [3, 1, 1.2, 2, 6]; // Hafidz dominan, Dago sepi

locs.forEach((loc, li) => {
  const admin = db.prepare("SELECT * FROM profiles WHERE role='admin_lokasi' AND location_id = ?").get(loc.id);
  const nCust = [10, 4, 8, 12, 22][li];
  const custIds = [];
  for (let i = 0; i < nCust; i++) {
    const nm = `${pick(NAMES)} ${li + 1}${String.fromCharCode(65 + i)}`;
    const wa = `08${String(1000000000 + Math.floor(rnd() * 8999999999)).slice(0, 10)}`;
    custIds.push(D.createCustomer(db, admin, { nama: nm, whatsapp: wa, jenis: i === 0 && li === 4 ? 'institusi' : 'individu' }).id);
  }
  const nTrx = Math.round(weights[li] * 14);
  for (let i = 0; i < nTrx; i++) {
    const items = [];
    const k = 1 + Math.floor(rnd() * 3);
    for (let j = 0; j < k; j++) items.push({ waste_type_id: pick(kgTypes).id, qty: Math.round((1 + rnd() * 25) * 100) / 100 });
    if (rnd() < 0.05 && unitTypes.length) items.push({ waste_type_id: pick(unitTypes).id, qty: 1 });
    try {
      D.createTransaction(db, admin, { customer_id: pick(custIds), trx_date: addDays(today, -Math.floor(rnd() * 60)), items, confirm_duplicate: true, confirm_large: true, backdate_reason: 'Setoran dicatat terlambat (data demo)' });
    } catch (e) { console.warn('lewati:', e.message); }
  }
});

// Alur konversi: satu tiap status
const sa = db.prepare("SELECT * FROM profiles WHERE role='super_admin'").get();
const PNG = Buffer.from('iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR4nGP4z8DwHwAFAAH/q842iQAAAABJRU5ErkJggg==', 'base64');
const eligible = db.prepare('SELECT customer_id, location_id, available FROM v_customer_balance WHERE available >= 50000 AND is_active = 1 ORDER BY available DESC').all();
const seen = new Set();
let n = 0;
for (const e of eligible) {
  if (n >= 5) break;
  const admin = db.prepare("SELECT * FROM profiles WHERE role='admin_lokasi' AND location_id = ?").get(e.location_id);
  try {
    const c = D.createConversion(db, admin, { customer_id: e.customer_id, amount_idr: 50000 + Math.floor((e.available - 50000) / 1000) * 1000, bsi_account_no: String(7000000000 + e.customer_id).padStart(10, '0') });
    if (n === 1) D.verifyConversion(db, sa, c.id);
    if (n === 2) { D.verifyConversion(db, sa, c.id); D.completeConversion(db, sa, c.id, { file: PNG, fileName: 'bukti-transfer.png', transferDate: today }); }
    if (n === 3) D.rejectConversion(db, sa, c.id, { reason: 'Nomor rekening tidak sesuai data.' });
    if (n === 4) D.cancelConversion(db, admin, c.id, { reason: 'Nasabah menunda konversi.' });
    n++;
  } catch (err) { console.warn('lewati konversi:', err.message); }
}
const t = db.prepare("SELECT COUNT(*) AS n FROM transactions").get().n;
console.log(`Data demo dibuat: ${t} transaksi, ${n} konversi.`);
