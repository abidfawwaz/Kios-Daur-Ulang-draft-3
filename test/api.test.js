// Uji penerimaan otomatis: F-01..F-10 dan uji negatif hak akses T-01..T-13 (PRD Bab 10).
import { test, before, after } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';

const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'kios-test-'));
process.env.DATA_DIR = dir;
const { openDb } = await import('../server/db.js');
const { seedBase } = await import('../server/seed.js');
const { createApp } = await import('../server/app.js');
const { wibDate, addDays } = await import('../server/util.js');

let server, base, db, creds;
const PNG = Buffer.from('iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR4nGP4z8DwHwAFAAH/q842iQAAAABJRU5ErkJggg==', 'base64');

class Client {
  cookie = '';
  async req(method, url, body, raw) {
    const headers = { cookie: this.cookie };
    let payload;
    if (raw) payload = raw; else if (body !== undefined) { headers['content-type'] = 'application/json'; payload = JSON.stringify(body); }
    const r = await fetch(base + url, { method, headers, body: payload });
    const sc = r.headers.get('set-cookie');
    if (sc) this.cookie = sc.split(';')[0];
    const ct = r.headers.get('content-type') ?? '';
    const data = ct.includes('json') ? await r.json() : Buffer.from(await r.arrayBuffer());
    return { status: r.status, data };
  }
  get = (u) => this.req('GET', u);
  post = (u, b) => this.req('POST', u, b ?? {});
  put = (u, b) => this.req('PUT', u, b);
}
async function login(role, locationLike) {
  const c = creds.find((x) => x.role === role && (!locationLike || x.lokasi.includes(locationLike)));
  const cl = new Client();
  let r = await cl.post('/api/auth/login', { email: c.email, password: c.password });
  assert.equal(r.status, 200);
  const np = 'KataSandiBaru2026x';
  r = await cl.post('/api/auth/change-password', { current: c.password, next: np });
  assert.equal(r.status, 200, JSON.stringify(r.data));
  cl.email = c.email; cl.password = np;
  return cl;
}
const form = (fields, file, fname = 'bukti.png') => {
  const fd = new FormData();
  for (const [k, v] of Object.entries(fields)) fd.append(k, v);
  if (file) fd.append('file', new Blob([file]), fname);
  return fd;
};
const wt = (name) => db.prepare('SELECT id FROM waste_types WHERE nama = ?').get(name).id;

let malibu, hafidz, sa, viewer, custA, custB;

before(async () => {
  db = openDb();
  creds = seedBase(db).creds;
  const app = createApp(db);
  await new Promise((res) => { server = app.listen(0, res); });
  base = `http://localhost:${server.address().port}`;
  malibu = await login('admin_lokasi', 'Malibu');
  hafidz = await login('admin_lokasi', 'Hafidz');
  sa = await login('super_admin');
  viewer = await login('bsi_viewer');
  custA = (await malibu.post('/api/customers', { nama: 'Rudi Hartono', whatsapp: '081234567890', jenis: 'individu' })).data.id;
  custB = (await hafidz.post('/api/customers', { nama: 'Siti Aminah', whatsapp: '081234567890' })).data.id;
});
after(() => { server?.close(); db?.close(); fs.rmSync(dir, { recursive: true, force: true }); });

test('FR-1.1/1.2 login generik, penguncian, wajib ganti kata sandi', async () => {
  const c = new Client();
  const v = creds.find((x) => x.role === 'bsi_viewer');
  let r = await c.post('/api/auth/login', { email: v.email, password: 'salah' });
  assert.equal(r.status, 401); assert.equal(r.data.error, 'Email atau kata sandi salah');
  r = await c.post('/api/auth/login', { email: 'tidak.ada@x.id', password: 'salah' });
  assert.equal(r.data.error, 'Email atau kata sandi salah');
  const lockUser = creds.find((x) => x.role === 'admin_lokasi' && x.lokasi.includes('Dago'));
  for (let i = 0; i < 5; i++) await c.post('/api/auth/login', { email: lockUser.email, password: 'salah' });
  r = await c.post('/api/auth/login', { email: lockUser.email, password: lockUser.password });
  assert.equal(r.status, 423);
  const fresh = creds.find((x) => x.role === 'admin_lokasi' && x.lokasi.includes('Samara'));
  const f = new Client();
  await f.post('/api/auth/login', { email: fresh.email, password: fresh.password });
  r = await f.get('/api/dashboard');
  assert.equal(r.status, 403); assert.equal(r.data.code, 'must_change_password');
  r = await f.post('/api/auth/change-password', { current: fresh.password, next: 'pendek1' });
  assert.equal(r.status, 400);
});

test('F-01 transaksi 3 item termasuk unit; total berat hanya kg', async () => {
  const r = await malibu.post('/api/transactions', { customer_id: custA, items: [
    { waste_type_id: wt('Kardus'), qty: 10.5 }, { waste_type_id: wt('Aluminium'), qty: 2 }, { waste_type_id: wt('Mesin Cuci'), qty: 1 }] });
  assert.equal(r.status, 201, JSON.stringify(r.data));
  assert.match(r.data.trx_no, /^TRX-\d{8}-\d{4}$/);
  assert.equal(r.data.total_idr, 10.5 * 1800 + 2 * 5000 + 20000);
  const d = (await malibu.get('/api/dashboard')).data;
  assert.equal(d.kpis.totalBeratKg, 12.5); assert.equal(d.kpis.totalUnit, 1); assert.equal(d.kpis.totalTransaksi, 1);
  const pdf = await malibu.get(`/api/transactions/${r.data.id}/receipt.pdf`);
  assert.equal(pdf.status, 200); assert.equal(pdf.data.subarray(0, 4).toString(), '%PDF');
});

test('BR-02/13/14 validasi jumlah, tanggal, duplikat', async () => {
  const b1 = { customer_id: custA, items: [{ waste_type_id: wt('Kardus'), qty: 1 }] };
  assert.equal((await malibu.post('/api/transactions', { ...b1, items: [{ waste_type_id: wt('Kardus'), qty: 0 }] })).status, 400);
  assert.equal((await malibu.post('/api/transactions', { ...b1, items: [{ waste_type_id: wt('Mesin Cuci'), qty: 1.5 }] })).status, 400);
  assert.equal((await malibu.post('/api/transactions', { ...b1, trx_date: addDays(wibDate(), 1) })).status, 400);
  assert.equal((await malibu.post('/api/transactions', { ...b1, trx_date: addDays(wibDate(), -40) })).status, 400);
  assert.equal((await malibu.post('/api/transactions', { ...b1, items: [{ waste_type_id: wt('Kardus'), qty: 600 }] })).data.code, 'LARGE_QTY');
  assert.equal((await malibu.post('/api/transactions', { ...b1, items: [{ waste_type_id: wt('Kardus'), qty: 20000 }], confirm_large: true })).status, 400);
  assert.equal((await malibu.post('/api/transactions', b1)).status, 201);
  const dup = await malibu.post('/api/transactions', b1);
  assert.equal(dup.status, 409); assert.equal(dup.data.code, 'DUPLICATE');
  assert.equal((await malibu.post('/api/transactions', { ...b1, confirm_duplicate: true })).status, 201);
});

test('F-02/F-03 eligible tepat Rp 50.000 dan status Baru -> Existing', async () => {
  const id = (await malibu.post('/api/customers', { nama: 'Nasabah Batas', whatsapp: '0812999111' })).data.id;
  await malibu.post('/api/transactions', { customer_id: id, items: [{ waste_type_id: wt('Aluminium'), qty: 9 }] });
  let c = (await malibu.get(`/api/customers/${id}`)).data.customer;
  assert.equal(c.eligible, false); assert.equal(c.status, 'baru'); assert.equal(c.kurang, 5000);
  const r = await malibu.post('/api/transactions', { customer_id: id, items: [{ waste_type_id: wt('Aluminium'), qty: 1 }] });
  assert.equal(r.status, 201);
  c = (await malibu.get(`/api/customers/${id}`)).data.customer;
  assert.equal(c.saldo, 50000); assert.equal(c.eligible, true); assert.equal(c.status, 'existing');
  assert.ok((await malibu.get('/api/notifications')).data.rows.some((n) => n.type === 'eligible'));
});

test('F-04/F-05/T-03/T-09/T-11 alur konversi lengkap dan rekonsiliasi seimbang', async () => {
  const id = (await malibu.post('/api/customers', { nama: 'Nasabah Emas', whatsapp: '0812777000' })).data.id;
  await malibu.post('/api/transactions', { customer_id: id, items: [{ waste_type_id: wt('Aluminium'), qty: 19.57 }] });
  const bal = (await malibu.get(`/api/customers/${id}`)).data.customer.saldo;
  let r = await malibu.post('/api/conversions', { customer_id: id, amount_idr: 49000, bsi_account_no: '1234567890' });
  assert.equal(r.status, 400);
  r = await malibu.post('/api/conversions', { customer_id: id, amount_idr: bal + 1000, bsi_account_no: '1234567890' });
  assert.equal(r.status, 400);
  r = await malibu.post('/api/conversions', { customer_id: id, amount_idr: bal, bsi_account_no: '12345' });
  assert.equal(r.status, 400);
  r = await malibu.post('/api/conversions', { customer_id: id, amount_idr: bal, bsi_account_no: '1234567890' });
  assert.equal(r.status, 201); const cnv = r.data.id;
  let c = (await malibu.get(`/api/customers/${id}`)).data.customer;
  assert.equal(c.saldo, 0); assert.equal(c.saldo_tertahan, bal);
  assert.equal((await malibu.post('/api/conversions', { customer_id: id, amount_idr: 50000, bsi_account_no: '1234567890' })).status, 400);
  assert.ok((await sa.get('/api/notifications')).data.unread >= 1);
  assert.equal((await malibu.post(`/api/conversions/${cnv}/verify`)).status, 403);
  assert.equal((await malibu.req('POST', `/api/conversions/${cnv}/proof`, undefined, form({ transfer_date: wibDate() }, PNG))).status, 403);
  assert.equal((await malibu.get(`/api/conversions/${cnv}`)).data.bsi_account_no, '******7890');
  assert.equal((await sa.get(`/api/conversions/${cnv}`)).data.bsi_account_no, '1234567890');
  assert.equal((await sa.get('/api/conversions')).data.rows[0].bsi_account_no, '******7890');
  assert.equal((await sa.req('POST', `/api/conversions/${cnv}/proof`, undefined, form({ transfer_date: wibDate() }, PNG))).status, 409);
  assert.equal((await sa.post(`/api/conversions/${cnv}/verify`)).status, 200);
  assert.equal((await sa.req('POST', `/api/conversions/${cnv}/proof`, undefined, form({ transfer_date: wibDate() }))).status, 400);
  assert.equal((await sa.req('POST', `/api/conversions/${cnv}/proof`, undefined, form({ transfer_date: wibDate() }, Buffer.from('MZ-bukan-gambar-exe'), 'x.png'))).status, 400);
  r = await sa.req('POST', `/api/conversions/${cnv}/proof`, undefined, form({ transfer_date: wibDate() }, PNG));
  assert.equal(r.status, 200, JSON.stringify(r.data));
  c = (await malibu.get(`/api/customers/${id}`)).data.customer;
  assert.equal(c.tabungan_emas, bal); assert.equal(c.saldo_tertahan, 0);
  const rec = (await sa.get('/api/reports/summary')).data.recon;
  assert.equal(rec.status, 'seimbang'); assert.equal(rec.selisih, 0);
  assert.equal((await malibu.get(`/api/conversions/${cnv}/receipt.pdf`)).status, 200);
  assert.equal((await sa.post(`/api/conversions/${cnv}/cancel`, { reason: 'mencoba membatalkan' })).status, 409);
  assert.equal((await sa.req('POST', `/api/conversions/${cnv}/proof/correct`, undefined, form({ reason: 'pendek' }, PNG))).status, 400);
  r = await sa.req('POST', `/api/conversions/${cnv}/proof/correct`, undefined, form({ reason: 'Salah unggah berkas awal' }, PNG));
  assert.equal(r.data.version, 2);
  const det = (await sa.get(`/api/conversions/${cnv}`)).data;
  assert.equal(det.proofs.length, 2);
  const link = (await sa.get(`/api/conversions/${cnv}/proofs/${det.proofs[0].id}/link`)).data.url;
  assert.equal((await sa.get(link)).status, 200);
  assert.equal((await new Client().get(link)).status, 401);
  assert.equal((await malibu.get(link)).status, 403);
  assert.equal((await sa.get('/api/files/abc.def')).status, 403);
});

test('BR-18 tolak dan batalkan mengembalikan dana', async () => {
  const id = (await hafidz.post('/api/customers', { nama: 'Nasabah Tolak', whatsapp: '0812555000' })).data.id;
  await hafidz.post('/api/transactions', { customer_id: id, items: [{ waste_type_id: wt('Aluminium'), qty: 20 }] });
  let r = await hafidz.post('/api/conversions', { customer_id: id, amount_idr: 60000, bsi_account_no: '0987654321' });
  assert.equal((await sa.post(`/api/conversions/${r.data.id}/reject`, { reason: 'x' })).status, 400);
  assert.equal((await sa.post(`/api/conversions/${r.data.id}/reject`, { reason: 'Rekening tidak sesuai' })).status, 200);
  assert.equal((await hafidz.get(`/api/customers/${id}`)).data.customer.saldo, 100000);
  r = await hafidz.post('/api/conversions', { customer_id: id, amount_idr: 60000, bsi_account_no: '0987654321' });
  assert.equal((await hafidz.post(`/api/conversions/${r.data.id}/cancel`, { reason: 'Nasabah menunda konversi' })).status, 200);
  assert.equal((await hafidz.get(`/api/customers/${id}`)).data.customer.saldo, 100000);
  assert.ok((await hafidz.get('/api/notifications')).data.rows.some((n) => n.type === 'conversion_rejected'));
});

test('F-06/T-04 harga dikunci; riwayat harga; peringatan lonjakan >50%', async () => {
  const kardus = wt('Kardus');
  assert.equal((await malibu.put(`/api/waste-types/${kardus}/price`, { price: 2000, reason: 'Penyesuaian harga pasar' })).status, 403);
  assert.equal((await sa.put(`/api/waste-types/${kardus}/price`, { price: 2000, reason: 'x' })).status, 400);
  const r = await sa.put(`/api/waste-types/${kardus}/price`, { price: 100, reason: 'Salah ketik harga kardus' });
  assert.equal(r.data.code, 'PRICE_JUMP');
  const id = (await malibu.post('/api/customers', { nama: 'Nasabah Harga', whatsapp: '0812333000' })).data.id;
  const t1 = await malibu.post('/api/transactions', { customer_id: id, items: [{ waste_type_id: kardus, qty: 10 }] });
  assert.equal(t1.data.total_idr, 18000);
  assert.equal((await sa.put(`/api/waste-types/${kardus}/price`, { price: 2000, reason: 'Penyesuaian harga pasar' })).status, 200);
  const t2 = await malibu.post('/api/transactions', { customer_id: id, items: [{ waste_type_id: kardus, qty: 10 }], confirm_duplicate: true });
  assert.equal(t2.data.total_idr, 20000);
  assert.equal((await malibu.get(`/api/transactions/${t1.data.id}`)).data.total_idr, 18000);
  const h = (await sa.get(`/api/waste-types/${kardus}/history`)).data.rows;
  assert.equal(h[0].reason, 'Penyesuaian harga pasar'); assert.ok(h.length >= 2);
});

test('F-07/T-10/BR-11/12 void & edit transaksi', async () => {
  const id = (await malibu.post('/api/customers', { nama: 'Nasabah Void', whatsapp: '0812000999' })).data.id;
  const t = await malibu.post('/api/transactions', { customer_id: id, items: [{ waste_type_id: wt('Aluminium'), qty: 12 }] });
  assert.equal((await malibu.post('/api/conversions', { customer_id: id, amount_idr: 50000, bsi_account_no: '1234500000' })).status, 201);
  let r = await malibu.post(`/api/transactions/${t.data.id}/void`, { reason: 'Salah input jumlah sampah' });
  assert.equal(r.status, 409); assert.match(r.data.error, /negatif/);
  r = await malibu.put(`/api/transactions/${t.data.id}`, { reason: 'Koreksi jumlah menjadi kecil', items: [{ waste_type_id: wt('Aluminium'), qty: 1 }] });
  assert.equal(r.status, 409);
  r = await malibu.put(`/api/transactions/${t.data.id}`, { reason: 'Koreksi jumlah lebih besar', items: [{ waste_type_id: wt('Aluminium'), qty: 14 }] });
  assert.equal(r.status, 200); assert.equal(r.data.total_idr, 70000);
  const id2 = (await malibu.post('/api/customers', { nama: 'Nasabah Void2', whatsapp: '0812000888' })).data.id;
  const t2 = await malibu.post('/api/transactions', { customer_id: id2, items: [{ waste_type_id: wt('Aluminium'), qty: 1 }] });
  assert.equal((await malibu.post(`/api/transactions/${t2.data.id}/void`, { reason: 'pendek' })).status, 400);
  assert.equal((await malibu.post(`/api/transactions/${t2.data.id}/void`, { reason: 'Salah input nasabah' })).status, 200);
  assert.ok((await malibu.get('/api/transactions?status=void')).data.rows.some((x) => x.id === t2.data.id));
  const a = db.prepare("SELECT before, after, reason FROM audit_logs WHERE action = 'transaction.edit' ORDER BY id DESC LIMIT 1").get();
  assert.ok(a.before && a.after && a.reason);
});

test('F-10/FR-4 satu WhatsApp banyak nasabah, data disamarkan', async () => {
  const r = (await malibu.get('/api/customers?q=081234567890')).data;
  assert.ok(r.rows.length >= 1);
  assert.equal(r.rows[0].whatsapp, '6281****890');
  const all = (await sa.get('/api/customers?q=081234567890')).data;
  assert.equal(all.rows.length, 2);
  assert.ok(!JSON.stringify(all).includes('6281234567890'));
  assert.equal((await malibu.get(`/api/customers/${custA}/full`)).data.whatsapp, '6281234567890');
  assert.equal((await sa.get(`/api/customers/${custA}/full`)).status, 403);
});

test('T-01 admin lokasi tidak bisa membaca lokasi lain', async () => {
  assert.equal((await malibu.get(`/api/customers/${custB}`)).status, 404);
  assert.equal((await malibu.get(`/api/customers/${custB}/full`)).status, 404);
  await hafidz.post('/api/transactions', { customer_id: custB, items: [{ waste_type_id: wt('Kardus'), qty: 3 }] });
  const hid = db.prepare('SELECT id FROM transactions WHERE customer_id = ?').get(custB).id;
  assert.equal((await malibu.get(`/api/transactions/${hid}`)).status, 404);
  assert.equal((await malibu.post(`/api/transactions/${hid}/void`, { reason: 'bukan milik saya' })).status, 404);
  const hafidzLoc = db.prepare('SELECT id FROM locations WHERE nama LIKE ?').get('%Hafidz%').id;
  assert.ok((await malibu.get(`/api/transactions?location_id=${hafidzLoc}`)).data.rows.every((x) => x.location_nama.includes('Malibu')));
  assert.deepEqual((await malibu.get(`/api/dashboard?location_id=${hafidzLoc}`)).data.kpis, (await malibu.get('/api/dashboard')).data.kpis);
  assert.equal((await malibu.post('/api/transactions', { customer_id: custB, items: [{ waste_type_id: wt('Kardus'), qty: 1 }] })).status, 404);
});

test('T-02/BR-10 tidak ada penghapusan permanen (API dan database)', async () => {
  assert.equal((await malibu.req('DELETE', '/api/transactions/1')).status, 404);
  assert.equal((await malibu.req('DELETE', `/api/customers/${custA}`)).status, 404);
  assert.equal((await malibu.req('DELETE', '/api/conversions/1')).status, 404);
  for (const t of ['transactions', 'customers', 'conversions', 'transaction_items', 'profiles', 'locations', 'waste_types', 'audit_logs', 'app_settings'])
    assert.throws(() => db.prepare(`DELETE FROM ${t}`).run(), /Penghapusan permanen/);
});

test('T-05/T-06 Super Admin baca saja', async () => {
  assert.equal((await sa.post('/api/transactions', { customer_id: custA, items: [{ waste_type_id: wt('Kardus'), qty: 1 }] })).status, 403);
  assert.equal((await sa.post('/api/customers', { nama: 'Tidak Boleh', whatsapp: '0812111222' })).status, 403);
  assert.equal((await sa.put(`/api/customers/${custA}`, { nama: 'Ubah' })).status, 403);
  assert.equal((await sa.post('/api/conversions', { customer_id: custA, amount_idr: 50000, bsi_account_no: '1234567890' })).status, 403);
  assert.equal((await sa.get('/api/transactions')).status, 200);
  assert.equal((await sa.get('/api/customers')).status, 200);
});

test('T-07/T-08 BSI Viewer hanya baca & agregat', async () => {
  assert.equal((await viewer.get('/api/transactions')).status, 403);
  assert.equal((await viewer.get('/api/conversions')).status, 403);
  assert.equal((await viewer.post('/api/transactions', {})).status, 403);
  assert.equal((await viewer.post('/api/customers', { nama: 'x', whatsapp: '0812' })).status, 403);
  assert.equal((await viewer.put('/api/waste-types/1/price', { price: 5, reason: 'tidak boleh ubah' })).status, 403);
  assert.equal((await viewer.post('/api/waste-types', { nama: 'X' })).status, 403);
  assert.equal((await viewer.get('/api/admin/users')).status, 403);
  assert.equal((await viewer.get('/api/admin/audit')).status, 403);
  assert.equal((await viewer.get('/api/waste-types')).status, 200);
  const cs = (await viewer.get('/api/customers')).data;
  assert.ok(cs.rows.length > 0);
  assert.ok(cs.rows.every((c) => c.whatsapp.includes('****')));
  assert.equal((await viewer.get(`/api/customers/${cs.rows[0].id}`)).data.transactions, undefined);
  assert.equal((await viewer.get('/api/dashboard')).status, 200);
  assert.ok(db.prepare("SELECT COUNT(*) AS n FROM audit_logs WHERE action = 'access.denied'").get().n > 0);
});

test('T-12/F-09 audit_logs tidak dapat diubah/dihapus; aksi tulis tercatat', async () => {
  assert.throws(() => db.prepare('UPDATE audit_logs SET reason = ?').run('x'), /tidak dapat diubah/);
  assert.throws(() => db.prepare('DELETE FROM audit_logs').run(), /Penghapusan permanen/);
  const before = db.prepare('SELECT COUNT(*) AS n FROM audit_logs').get().n;
  const id = (await malibu.post('/api/customers', { nama: 'Audit Satu', whatsapp: '0812444000' })).data.id;
  await malibu.put(`/api/customers/${id}`, { nama: 'Audit Dua' });
  const t = await malibu.post('/api/transactions', { customer_id: id, items: [{ waste_type_id: wt('Kardus'), qty: 2 }] });
  await malibu.post(`/api/transactions/${t.data.id}/void`, { reason: 'Salah input nasabah' });
  assert.equal(db.prepare('SELECT COUNT(*) AS n FROM audit_logs').get().n - before, 4);
  const rows = (await sa.get('/api/admin/audit?action=transaction')).data.rows;
  assert.ok(rows.length >= 2 && rows[0].user_nama && rows[0].role);
});

test('T-13/FR-8.1 Super Admin terakhir tidak dapat dinonaktifkan; kelola pengguna', async () => {
  const me = (await sa.get('/api/auth/me')).data.user;
  assert.equal((await sa.put(`/api/admin/users/${me.id}`, { is_active: false })).status, 409);
  assert.equal((await sa.put(`/api/admin/users/${me.id}`, { role: 'bsi_viewer' })).status, 409);
  const r = await sa.post('/api/admin/users', { nama: 'Super Admin Dua', email: 'sa2@bsi-kios.local', role: 'super_admin' });
  assert.equal(r.status, 201); assert.ok(r.data.temporary_password.length >= 12);
  assert.equal((await sa.post('/api/admin/users', { nama: 'Admin Tanpa Lokasi', email: 'x@y.id', role: 'admin_lokasi' })).status, 400);
  const rp = await sa.post(`/api/admin/users/${r.data.id}/reset-password`);
  assert.equal(rp.status, 200); assert.notEqual(rp.data.temporary_password, r.data.temporary_password);
  assert.equal((await sa.put(`/api/admin/users/${r.data.id}`, { is_active: false })).status, 200); // masih ada Super Admin lain
  assert.equal((await sa.put(`/api/admin/users/${me.id}`, { nama: 'Super Admin' })).status, 200);
});

test('FR-2/F-08/G1 angka identik di dashboard, performa lokasi, laporan, dan Excel', async () => {
  const k = (await sa.get('/api/dashboard')).data.kpis;
  const p = (await sa.get('/api/dashboard/performa')).data;
  assert.equal(p.total.transaksi, k.totalTransaksi); assert.equal(p.total.nilai, k.nilaiEkonomi);
  assert.equal(p.total.nasabah, k.totalNasabah); assert.equal(p.total.eligible, k.nasabahEligible);
  assert.equal(p.total.tabunganEmas, k.sudahTabunganEmas);
  assert.ok(p.rows.some((r) => r.transaksi === 0 && r.nama.includes('Dago')));
  const rep = (await sa.get('/api/reports/summary')).data;
  assert.deepEqual(rep.kpis, k);
  assert.equal(k.nilaiEkonomi, k.saldoBelumDikonversi + k.sudahTabunganEmas);
  assert.equal(rep.recon.status, 'seimbang');
  const w = (await sa.get('/api/dashboard/sampah')).data;
  assert.equal(w.rows.reduce((a, r) => a + r.nilai, 0), k.nilaiEkonomi);
  const dist = db.prepare(`SELECT COUNT(DISTINCT t.id) AS n FROM transactions t JOIN transaction_items i ON i.transaction_id = t.id AND i.is_active = 1
    WHERE t.status = 'sukses' AND i.waste_type_id = ?`).get(wt('Kardus')).n;
  assert.equal(w.rows.find((r) => r.nama === 'Kardus').transaksi, dist);
  const xlsx = await sa.get('/api/reports/excel');
  assert.equal(xlsx.status, 200);
  const ExcelJS = (await import('exceljs')).default;
  const wb = new ExcelJS.Workbook(); await wb.xlsx.load(xlsx.data);
  assert.equal(wb.worksheets.length, 10);
  let found = false;
  wb.getWorksheet('Ringkasan').eachRow((row) => { if (row.getCell(1).value === 'Total Transaksi') { found = true; assert.equal(row.getCell(2).value, k.totalTransaksi); } });
  assert.ok(found);
  const pdf = await sa.get('/api/reports/pdf');
  assert.equal(pdf.data.subarray(0, 4).toString(), '%PDF');
  assert.equal((pdf.data.toString('latin1').match(/\/Type\s*\/Page[^s]/g) ?? []).length, 7);
  for (const l of [1, 2, 5]) assert.notEqual((await sa.get(`/api/reports/summary?location_id=${l}`)).data.recon.status, 'tidak_seimbang');
  assert.equal((await viewer.get('/api/reports/excel')).status, 200);
});

test('FR-7.6/7.7 snapshot dan dokumentasi', async () => {
  const s = await sa.post('/api/reports/snapshots', { label: 'Uji snapshot' });
  assert.equal(s.status, 201);
  assert.equal((await sa.get(`/api/reports/snapshots/${s.data.id}`)).data.label, 'Uji snapshot');
  assert.throws(() => db.prepare('UPDATE report_snapshots SET label = ?').run('x'));
  const r = await malibu.req('POST', '/api/documents', undefined, form({ judul: 'Kegiatan Pilah', kategori: 'Kegiatan Kios', tanggal: wibDate(), location_id: 5 }, PNG, 'f.png'));
  assert.equal(r.status, 201);
  const docs = (await malibu.get('/api/documents')).data.rows;
  assert.equal(docs.length, 1); assert.ok(docs[0].location_nama.includes('Malibu'));
  assert.equal((await hafidz.get('/api/documents')).data.rows.length, 0);
  assert.equal((await viewer.get('/api/documents')).data.rows.length, 1);
  assert.equal((await viewer.req('POST', '/api/documents', undefined, form({ judul: 'x', kategori: 'Lainnya' }, PNG))).status, 403);
  assert.equal((await malibu.get(docs[0].url)).status, 200);
  assert.equal((await malibu.post(`/api/documents/${docs[0].id}/archive`, { reason: 'Foto salah lokasi unggah' })).status, 200);
  assert.equal((await malibu.get('/api/documents')).data.rows.length, 0);
});

test('FR-1.3 sesi berakhir setelah tidak aktif', async () => {
  const c = new Client();
  await c.post('/api/auth/login', { email: malibu.email, password: malibu.password });
  assert.equal((await c.get('/api/meta')).status, 200);
  db.prepare("UPDATE app_settings SET value = '0' WHERE key = 'session_minutes'").run();
  await new Promise((r) => setTimeout(r, 20));
  const r = await c.get('/api/meta');
  assert.equal(r.status, 401); assert.equal(r.data.code, 'session_expired');
  db.prepare("UPDATE app_settings SET value = '30' WHERE key = 'session_minutes'").run();
});
