// API Express: autentikasi, hak akses (RBAC Bab 3.2), dan seluruh endpoint aplikasi.
import express from 'express';
import helmet from 'helmet';
import cookieParser from 'cookie-parser';
import multer from 'multer';
import bcrypt from 'bcryptjs';
import fs from 'node:fs';
import path from 'node:path';
import { ROOT, UPLOAD_DIR, withTx } from './db.js';
import {
  HttpError, bad, forbidden, notFound, conflict, nowIso, wibDate, isDate, getSettings, audit, notify, sign, verify,
  maskWa, maskAccount, randomPassword, validatePassword, requireReason, rupiah, round2, sniffFile,
} from './util.js';
import * as K from './kpi.js';
import * as D from './domain.js';
import { buildReportData, buildExcel, buildPdf, buildReceiptPdf, fmtDate, fmtDateTime, fmtRp, STATUS_KONVERSI } from './reports.js';

const COOKIE = 'sid';
const upload = multer({ storage: multer.memoryStorage(), limits: { fileSize: 5 * 1024 * 1024, files: 1 } });
const wrap = (fn) => (req, res, next) => Promise.resolve().then(() => fn(req, res, next)).catch(next);

export function createApp(db) {
  const app = express();
  app.disable('x-powered-by');
  app.set('trust proxy', 1);
  app.use(helmet({
    contentSecurityPolicy: {
      useDefaults: true,
      directives: {
        'img-src': ["'self'", 'data:', 'blob:'],
        'style-src': ["'self'", "'unsafe-inline'"],
        'frame-src': ["'self'", 'blob:'],
        'object-src': ["'self'", 'blob:'],
        'upgrade-insecure-requests': process.env.COOKIE_SECURE === '1' ? [] : null,
      },
    },
    hsts: process.env.COOKIE_SECURE === '1',
  }));
  app.use(express.json({ limit: '1mb' }));
  app.use(cookieParser());

  // ---------- Sesi ----------
  function setSession(res, uid, extra = {}) {
    res.cookie(COOKIE, sign({ uid, act: Date.now(), ...extra }), {
      httpOnly: true, sameSite: 'strict', secure: process.env.COOKIE_SECURE === '1', path: '/',
    });
  }
  const publicUser = (u) => ({
    id: u.id, nama: u.nama, email: u.email, role: u.role, location_id: u.location_id,
    location_nama: u.location_id ? db.prepare('SELECT nama FROM locations WHERE id = ?').get(u.location_id)?.nama : null,
    must_change_password: !!u.must_change_password,
  });

  function auth(req, res, next) {
    const p = verify(req.cookies?.[COOKIE]);
    if (!p) return next(new HttpError(401, 'Silakan masuk terlebih dahulu.', 'unauthenticated'));
    const st = getSettings(db);
    if (Date.now() - p.act > Number(st.session_minutes) * 60e3)
      return next(new HttpError(401, 'Sesi Anda berakhir karena tidak aktif. Silakan masuk kembali.', 'session_expired'));
    const u = db.prepare('SELECT * FROM profiles WHERE id = ?').get(p.uid);
    if (!u || !u.is_active) return next(new HttpError(401, 'Akun tidak aktif.', 'unauthenticated'));
    req.user = u;
    if (req.query.keepalive !== '0') setSession(res, u.id); // sesi bergeser selama ada aktivitas
    if (u.must_change_password && req.path !== '/auth/change-password' && req.path !== '/auth/logout' && req.path !== '/auth/me')
      return next(new HttpError(403, 'Anda wajib mengganti kata sandi sementara.', 'must_change_password'));
    next();
  }
  const allow = (...roles) => (req, res, next) =>
    roles.includes(req.user.role) ? next() : next(forbidden());

  const api = express.Router();

  // ---------- Autentikasi (FR-1) ----------
  api.post('/auth/login', wrap((req, res) => {
    const email = String(req.body.email ?? '').trim().toLowerCase();
    const st = getSettings(db);
    const u = db.prepare('SELECT * FROM profiles WHERE email = ?').get(email);
    const generic = new HttpError(401, 'Email atau kata sandi salah', 'invalid_credentials');
    if (!u || !u.is_active) { bcrypt.compareSync('x', '$2a$10$CwTycUXWue0Thq9StjUM0uJ8.nlcEZ5HLwpZd/9NO64yXrwxMSR6e'); throw generic; }
    if (u.locked_until && u.locked_until > nowIso()) {
      const mins = Math.ceil((Date.parse(u.locked_until) - Date.now()) / 60e3);
      throw new HttpError(423, `Akun terkunci sementara karena terlalu banyak percobaan. Coba lagi dalam ${mins} menit.`, 'locked');
    }
    if (!bcrypt.compareSync(String(req.body.password ?? ''), u.password_hash)) {
      const n = u.failed_attempts + 1;
      if (n >= Number(st.max_failed)) {
        db.prepare('UPDATE profiles SET failed_attempts = 0, locked_until = ? WHERE id = ?')
          .run(new Date(Date.now() + Number(st.lock_minutes) * 60e3).toISOString(), u.id);
        audit(db, u, 'auth.locked', 'profiles', u.id, null, { locked_minutes: Number(st.lock_minutes) });
      } else db.prepare('UPDATE profiles SET failed_attempts = ? WHERE id = ?').run(n, u.id);
      throw generic;
    }
    db.prepare('UPDATE profiles SET failed_attempts = 0, locked_until = NULL, last_login_at = ? WHERE id = ?').run(nowIso(), u.id);
    audit(db, u, 'auth.login', 'profiles', u.id, null, null);
    setSession(res, u.id);
    res.json({ user: publicUser(u) });
  }));
  api.post('/auth/logout', (req, res) => { res.clearCookie(COOKIE, { path: '/' }); res.json({ ok: true }); });

  const secured = express.Router();
  secured.use(auth);
  api.use(secured);

  secured.get('/auth/me', (req, res) => res.json({ user: publicUser(req.user) }));
  secured.post('/auth/change-password', wrap((req, res) => {
    const { current, next: nw } = req.body;
    if (!bcrypt.compareSync(String(current ?? ''), req.user.password_hash)) throw bad('Kata sandi saat ini salah.');
    validatePassword(nw);
    if (bcrypt.compareSync(nw, req.user.password_hash)) throw bad('Kata sandi baru harus berbeda dari kata sandi lama.');
    withTx(db, () => {
      db.prepare('UPDATE profiles SET password_hash = ?, must_change_password = 0 WHERE id = ?').run(bcrypt.hashSync(nw, 10), req.user.id);
      audit(db, req.user, 'auth.change_password', 'profiles', req.user.id, null, null);
    });
    res.json({ ok: true });
  }));
  secured.post('/audit/denied', (req, res) => {
    audit(db, req.user, 'access.denied', 'route', String(req.body.path ?? '').slice(0, 200), null, null);
    res.json({ ok: true });
  });

  // ---------- Meta ----------
  secured.get('/meta', (req, res) => {
    const st = getSettings(db);
    const u = req.user;
    const locs = db.prepare('SELECT id, nama, alamat, is_active, target_kg_bulanan FROM locations ORDER BY id').all()
      .filter((l) => (u.role === 'admin_lokasi' ? l.id === u.location_id : true));
    res.json({
      user: publicUser(u), locations: locs,
      categories: db.prepare('SELECT * FROM waste_categories ORDER BY id').all(),
      settings: { min_conversion: Number(st.min_conversion), existing_threshold: Number(st.existing_threshold), backdate_days: Number(st.backdate_days),
        session_minutes: Number(st.session_minutes), qty_warn: Number(st.qty_warn), qty_max: Number(st.qty_max) },
      lastUpdate: K.lastDataUpdate(db),
      today: wibDate(),
    });
  });

  // ---------- Filter standar ----------
  function filters(req) {
    const q = req.query, u = req.user;
    let locationIds = null;
    if (u.role === 'admin_lokasi') locationIds = [u.location_id];
    else if (q.location_id) locationIds = [Number(q.location_id)];
    return {
      locationIds,
      from: isDate(q.from) ? q.from : null,
      to: isDate(q.to) ? q.to : null,
      customerStatus: ['baru', 'existing'].includes(q.customer_status) ? q.customer_status : null,
      wasteTypeId: q.waste_type_id ? Number(q.waste_type_id) : null,
    };
  }
  const pageOf = (req, size = 25) => {
    const page = Math.max(1, Number(req.query.page) || 1);
    return { page, size, offset: (page - 1) * size };
  };

  // ---------- Ringkasan & analitik (FR-2) ----------
  secured.get('/dashboard', wrap((req, res) => {
    res.json(K.dashboard(db, filters(req), { forLocationUser: req.user.role === 'admin_lokasi' }));
  }));
  secured.get('/dashboard/performa', wrap((req, res) => {
    res.json(K.performaLokasi(db, filters(req)));
  }));
  secured.get('/dashboard/sampah', wrap((req, res) => {
    const f = filters(req);
    const rows = K.wasteBreakdown(db, f);
    res.json({ rows, kategori: K.categoryKg(db, f), total: rows.reduce((a, r) => a + r.nilai, 0) });
  }));

  // ---------- Katalog harga (FR-6) ----------
  function catalog(req) {
    const own = req.user.role === 'admin_lokasi' ? req.user.location_id : null;
    const rows = db.prepare(`SELECT wt.id, wt.nama, wt.unit, wt.is_active, wt.urutan, wc.id AS category_id, wc.nama AS kategori, wc.warna,
        (SELECT COUNT(*) FROM transaction_items i JOIN transactions t ON t.id = i.transaction_id
          WHERE i.waste_type_id = wt.id AND i.is_active = 1 AND (? IS NULL OR t.location_id = ?)) AS freq
      FROM waste_types wt JOIN waste_categories wc ON wc.id = wt.category_id ORDER BY wc.id, wt.urutan, wt.nama`).all(own, own);
    return rows.map((r) => ({ ...r, price: D.activePrice(db, r.id) }));
  }
  secured.get('/waste-types', (req, res) => res.json({ rows: catalog(req) }));
  secured.get('/waste-types/:id/history', (req, res) => {
    res.json({ rows: db.prepare(`SELECT h.id, h.price_idr, h.effective_from, h.reason, h.created_at, p.nama AS changed_by
      FROM waste_price_history h LEFT JOIN profiles p ON p.id = h.changed_by WHERE h.waste_type_id = ?
      ORDER BY h.effective_from DESC, h.id DESC`).all(req.params.id) });
  });
  secured.post('/waste-types', allow('super_admin'), wrap((req, res) => {
    const nama = String(req.body.nama ?? '').trim();
    const price = Number(req.body.price);
    if (nama.length < 2) throw bad('Nama jenis wajib diisi.');
    if (!Number.isInteger(price) || price <= 0) throw bad('Harga harus bilangan bulat lebih dari 0.');
    if (!['kg', 'unit'].includes(req.body.unit)) throw bad('Satuan harus kg atau unit.');
    if (!db.prepare('SELECT 1 FROM waste_categories WHERE id = ?').get(req.body.category_id)) throw bad('Kategori tidak valid.');
    if (db.prepare('SELECT 1 FROM waste_types WHERE lower(nama) = lower(?)').get(nama)) throw conflict('Jenis sampah dengan nama ini sudah ada.');
    const out = withTx(db, () => {
      const max = db.prepare('SELECT COALESCE(MAX(urutan),0) AS m FROM waste_types').get().m;
      const id = db.prepare('INSERT INTO waste_types (nama, category_id, unit, urutan) VALUES (?,?,?,?)').run(nama, req.body.category_id, req.body.unit, max + 1).lastInsertRowid;
      db.prepare('INSERT INTO waste_price_history (waste_type_id, price_idr, effective_from, changed_by, reason) VALUES (?,?,?,?,?)')
        .run(id, price, wibDate(), req.user.id, 'Jenis baru ditambahkan');
      audit(db, req.user, 'waste_type.create', 'waste_types', id, null, { nama, unit: req.body.unit, price });
      return { id };
    });
    res.status(201).json(out);
  }));
  secured.put('/waste-types/:id/price', allow('super_admin'), wrap((req, res) => {
    const id = Number(req.params.id);
    const wt = db.prepare('SELECT * FROM waste_types WHERE id = ?').get(id);
    if (!wt) throw notFound('Jenis sampah tidak ditemukan.');
    const reason = requireReason(req.body.reason);
    const price = Number(req.body.price);
    if (!Number.isInteger(price) || price <= 0) throw bad('Harga harus bilangan bulat lebih dari 0.');
    const eff = req.body.effective_from || wibDate();
    if (!isDate(eff)) throw bad('Tanggal berlaku tidak valid.');
    const old = D.activePrice(db, id);
    if (old && Math.abs(price - old) / old > 0.5 && !req.body.confirm_jump)
      throw conflict(`Harga baru berbeda lebih dari 50% dari harga sebelumnya (${rupiah(old)} → ${rupiah(price)}). Pastikan tidak salah ketik.`, 'PRICE_JUMP');
    withTx(db, () => {
      db.prepare('INSERT INTO waste_price_history (waste_type_id, price_idr, effective_from, changed_by, reason) VALUES (?,?,?,?,?)').run(id, price, eff, req.user.id, reason);
      audit(db, req.user, 'waste_type.price_change', 'waste_types', id, { price: old }, { price, effective_from: eff }, reason);
    });
    res.json({ ok: true });
  }));
  secured.patch('/waste-types/:id', allow('super_admin'), wrap((req, res) => {
    const id = Number(req.params.id);
    const wt = db.prepare('SELECT * FROM waste_types WHERE id = ?').get(id);
    if (!wt) throw notFound('Jenis sampah tidak ditemukan.');
    withTx(db, () => {
      if (req.body.is_active !== undefined) {
        const v = req.body.is_active ? 1 : 0;
        db.prepare('UPDATE waste_types SET is_active = ? WHERE id = ?').run(v, id);
        audit(db, req.user, v ? 'waste_type.activate' : 'waste_type.deactivate', 'waste_types', id, { is_active: wt.is_active }, { is_active: v }, req.body.reason ?? null);
      }
      if (req.body.nama !== undefined || req.body.category_id !== undefined) {
        const nama = String(req.body.nama ?? wt.nama).trim();
        const cat = req.body.category_id ?? wt.category_id;
        db.prepare('UPDATE waste_types SET nama = ?, category_id = ? WHERE id = ?').run(nama, cat, id);
        audit(db, req.user, 'waste_type.update', 'waste_types', id, { nama: wt.nama, category_id: wt.category_id }, { nama, category_id: cat });
      }
    });
    res.json({ ok: true });
  }));

  // ---------- Nasabah (FR-4) ----------
  const customerSelect = `SELECT c.id, c.nama, c.whatsapp, c.jenis, c.bsi_account_no, c.is_active, c.location_id, l.nama AS location_nama,
      vb.deposits, vb.available, vb.held, vb.gold, vb.ntx, vb.cust_status
    FROM customers c JOIN locations l ON l.id = c.location_id JOIN v_customer_balance vb ON vb.customer_id = c.id`;
  const shapeCustomer = (r, min) => ({
    id: r.id, nama: r.nama, whatsapp: maskWa(r.whatsapp), jenis: r.jenis, bsi_account_no: maskAccount(r.bsi_account_no), is_active: !!r.is_active,
    location_id: r.location_id, location_nama: r.location_nama, total_setoran: r.deposits, saldo: r.available, saldo_tertahan: r.held,
    tabungan_emas: r.gold, jumlah_transaksi: r.ntx, status: r.cust_status, eligible: !!r.is_active && r.available >= min,
    progress: Math.min(1, Math.max(0, r.available / min)), kurang: Math.max(0, min - r.available),
  });
  function customerList(req) {
    const min = Number(getSettings(db).min_conversion);
    const w = ['1=1'], p = [];
    if (req.user.role === 'admin_lokasi') { w.push('c.location_id = ?'); p.push(req.user.location_id); }
    else if (req.query.location_id) { w.push('c.location_id = ?'); p.push(Number(req.query.location_id)); }
    const q = String(req.query.q ?? '').trim();
    if (q) {
      const digits = q.replace(/\D/g, '');
      const waq = digits.length >= 4 ? (digits.startsWith('0') ? '62' + digits.slice(1) : digits) : null;
      w.push(waq ? '(c.nama LIKE ? OR c.whatsapp LIKE ?)' : 'c.nama LIKE ?');
      p.push(`%${q}%`); if (waq) p.push(`%${waq}%`);
    }
    if (['baru', 'existing'].includes(req.query.status)) { w.push('vb.cust_status = ?'); p.push(req.query.status); }
    if (req.query.jenis) { w.push('c.jenis = ?'); p.push(req.query.jenis); }
    if (req.query.eligible === '1') { w.push('c.is_active = 1 AND vb.available >= ?'); p.push(min); }
    if (req.query.active !== 'all') w.push('c.is_active = 1');
    const { page, size, offset } = pageOf(req, Number(req.query.size) || 25);
    const total = db.prepare(`SELECT COUNT(*) AS n FROM customers c JOIN v_customer_balance vb ON vb.customer_id = c.id WHERE ${w.join(' AND ')}`).get(...p).n;
    const sorts = { nama: 'c.nama', saldo: 'vb.available DESC', setoran: 'vb.deposits DESC', terbaru: 'c.id DESC' };
    const rows = db.prepare(`${customerSelect} WHERE ${w.join(' AND ')} ORDER BY ${sorts[req.query.sort] ?? 'c.nama'} LIMIT ? OFFSET ?`).all(...p, size, offset);
    return { rows: rows.map((r) => shapeCustomer(r, min)), total, page, size };
  }
  secured.get('/customers', (req, res) => res.json(customerList(req)));
  secured.get('/customers/similar', allow('admin_lokasi'), (req, res) => {
    res.json({ rows: D.similarCustomers(db, req.user.location_id, String(req.query.nama ?? ''), Number(req.query.exclude) || 0) });
  });
  secured.post('/customers', allow('admin_lokasi'), wrap((req, res) => res.status(201).json(D.createCustomer(db, req.user, req.body))));
  function loadCustomer(req) {
    const r = db.prepare(`${customerSelect} WHERE c.id = ?`).get(Number(req.params.id));
    if (!r || (req.user.role === 'admin_lokasi' && r.location_id !== req.user.location_id)) throw notFound('Nasabah tidak ditemukan.');
    return r;
  }
  secured.get('/customers/:id', wrap((req, res) => {
    const r = loadCustomer(req);
    const min = Number(getSettings(db).min_conversion);
    const out = { customer: shapeCustomer(r, min) };
    if (req.user.role !== 'bsi_viewer') {
      out.transactions = db.prepare(`SELECT t.id, t.trx_no, t.trx_date, t.status, t.total_idr FROM transactions t WHERE t.customer_id = ? ORDER BY t.trx_date DESC, t.id DESC LIMIT 200`).all(r.id);
    }
    out.conversions = db.prepare(`SELECT id, cnv_no, amount_idr, status, requested_at, completed_at FROM conversions WHERE customer_id = ? ORDER BY id DESC`).all(r.id);
    res.json(out);
  }));
  // Nomor lengkap hanya pada form ubah milik Admin Lokasi (FR-4.4)
  secured.get('/customers/:id/full', allow('admin_lokasi'), wrap((req, res) => {
    const r = loadCustomer(req);
    res.json({ id: r.id, nama: r.nama, whatsapp: r.whatsapp, jenis: r.jenis, bsi_account_no: r.bsi_account_no, is_active: !!r.is_active });
  }));
  secured.put('/customers/:id', allow('admin_lokasi'), wrap((req, res) => res.json(D.updateCustomer(db, req.user, Number(req.params.id), req.body))));
  secured.get('/customers/:id/export', allow('admin_lokasi', 'super_admin'), wrap(async (req, res) => {
    const r = loadCustomer(req);
    const trx = db.prepare("SELECT trx_no, trx_date, status, total_idr FROM transactions WHERE customer_id = ? ORDER BY trx_date, id").all(r.id);
    const cnv = db.prepare('SELECT cnv_no, amount_idr, status, requested_at FROM conversions WHERE customer_id = ? ORDER BY id').all(r.id);
    if (req.query.format === 'xlsx') {
      const ExcelJS = (await import('exceljs')).default;
      const wb = new ExcelJS.Workbook();
      const s1 = wb.addWorksheet('Ringkasan');
      [['Nasabah', r.nama], ['Lokasi', r.location_nama], ['Status', r.cust_status === 'baru' ? 'Baru' : 'Existing'], ['Total setoran', r.deposits],
        ['Saldo tersedia', r.available], ['Saldo tertahan', r.held], ['Tabungan Emas', r.gold]].forEach((x) => s1.addRow(x));
      s1.columns = [{ width: 24 }, { width: 34 }];
      const s2 = wb.addWorksheet('Transaksi'); s2.addRow(['Nomor', 'Tanggal', 'Status', 'Total']);
      trx.forEach((t) => s2.addRow([t.trx_no, fmtDate(t.trx_date), t.status, t.total_idr])); s2.columns = [{ width: 24 }, { width: 14 }, { width: 10 }, { width: 14 }];
      const s3 = wb.addWorksheet('Konversi'); s3.addRow(['Nomor', 'Nominal', 'Status', 'Diajukan']);
      cnv.forEach((c) => s3.addRow([c.cnv_no, c.amount_idr, STATUS_KONVERSI[c.status], fmtDateTime(c.requested_at)])); s3.columns = [{ width: 24 }, { width: 14 }, { width: 18 }, { width: 24 }];
      audit(db, req.user, 'export.customer', 'customers', r.id, null, { format: 'xlsx' });
      res.setHeader('Content-Type', 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet');
      res.setHeader('Content-Disposition', `attachment; filename="nasabah-${r.id}.xlsx"`);
      return res.send(Buffer.from(await wb.xlsx.writeBuffer()));
    }
    const buf = await buildReceiptPdf({
      title: `Rekap Nasabah — ${r.nama}`,
      lines: [['Lokasi', r.location_nama], ['Status', r.cust_status === 'baru' ? 'Baru' : 'Existing'], ['Total setoran', fmtRp(r.deposits)],
        ['Saldo tersedia', fmtRp(r.available)], ['Saldo tertahan', fmtRp(r.held)], ['Tabungan Emas', fmtRp(r.gold)], ['Jumlah transaksi', String(r.ntx)]],
      items: [], total: r.deposits, saldo: r.available, footer: `Dicetak ${fmtDateTime(nowIso())} oleh ${req.user.nama}.`,
    });
    audit(db, req.user, 'export.customer', 'customers', r.id, null, { format: 'pdf' });
    res.setHeader('Content-Type', 'application/pdf');
    res.setHeader('Content-Disposition', `attachment; filename="nasabah-${r.id}.pdf"`);
    res.send(buf);
  }));

  // ---------- Transaksi (FR-3) ----------
  secured.post('/transactions', allow('admin_lokasi'), wrap((req, res) => res.status(201).json(D.createTransaction(db, req.user, req.body))));
  function txFilterSql(req) {
    const w = ['1=1'], p = [];
    if (req.user.role === 'admin_lokasi') { w.push('t.location_id = ?'); p.push(req.user.location_id); }
    else if (req.query.location_id) { w.push('t.location_id = ?'); p.push(Number(req.query.location_id)); }
    const q = String(req.query.q ?? '').trim();
    if (q) { w.push('(t.trx_no LIKE ? OR c.nama LIKE ?)'); p.push(`%${q}%`, `%${q}%`); }
    if (isDate(req.query.from)) { w.push('t.trx_date >= ?'); p.push(req.query.from); }
    if (isDate(req.query.to)) { w.push('t.trx_date <= ?'); p.push(req.query.to); }
    if (['sukses', 'void'].includes(req.query.status)) { w.push('t.status = ?'); p.push(req.query.status); }
    return { where: w.join(' AND '), p };
  }
  const trxBase = `FROM transactions t JOIN customers c ON c.id = t.customer_id JOIN locations l ON l.id = t.location_id`;
  secured.get('/transactions', allow('admin_lokasi', 'super_admin'), (req, res) => {
    const { where, p } = txFilterSql(req);
    const { page, size, offset } = pageOf(req);
    const total = db.prepare(`SELECT COUNT(*) AS n ${trxBase} WHERE ${where}`).get(...p).n;
    const sum = db.prepare(`SELECT COALESCE(SUM(CASE WHEN t.status='sukses' THEN t.total_idr END),0) AS nilai ${trxBase} WHERE ${where}`).get(...p).nilai;
    const order = req.query.sort === 'nilai' ? 't.total_idr DESC' : 't.trx_date DESC, t.id DESC';
    const rows = db.prepare(`SELECT t.id, t.trx_no, t.trx_date, t.status, t.total_idr, t.void_reason, c.nama AS customer_nama, l.nama AS location_nama,
        (SELECT group_concat(wt.nama, ', ') FROM transaction_items i JOIN waste_types wt ON wt.id = i.waste_type_id WHERE i.transaction_id = t.id AND i.is_active = 1) AS ringkasan
      ${trxBase} WHERE ${where} ORDER BY ${order} LIMIT ? OFFSET ?`).all(...p, size, offset);
    res.json({ rows, total, page, size, nilai: sum });
  });
  secured.get('/transactions/export', allow('admin_lokasi', 'super_admin'), wrap(async (req, res) => {
    const { where, p } = txFilterSql(req);
    const ExcelJS = (await import('exceljs')).default;
    const wb = new ExcelJS.Workbook(); const ws = wb.addWorksheet('Transaksi');
    ws.columns = [['Nomor', 22], ['Tanggal', 12], ['Lokasi', 30], ['Nasabah', 24], ['Item', 40], ['Status', 10], ['Total', 14]].map(([header, width]) => ({ header, width }));
    const rows = db.prepare(`SELECT t.trx_no, t.trx_date, t.status, t.total_idr, c.nama AS c, l.nama AS l,
      (SELECT group_concat(wt.nama, ', ') FROM transaction_items i JOIN waste_types wt ON wt.id = i.waste_type_id WHERE i.transaction_id = t.id AND i.is_active = 1) AS r
      ${trxBase} WHERE ${where} ORDER BY t.trx_date, t.id`).all(...p);
    rows.forEach((r) => ws.addRow([r.trx_no, fmtDate(r.trx_date), r.l, r.c, r.r, r.status, r.total_idr]));
    ws.addRow([]); ws.addRow(['Jumlah baris', rows.length, '', '', '', 'Total sukses', rows.filter((r) => r.status === 'sukses').reduce((a, r) => a + r.total_idr, 0)]);
    res.setHeader('Content-Type', 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet');
    res.setHeader('Content-Disposition', 'attachment; filename="riwayat-transaksi.xlsx"');
    res.send(Buffer.from(await wb.xlsx.writeBuffer()));
  }));
  function scopedTrx(req) {
    const t = D.getTransaction(db, Number(req.params.id));
    if (!t || (req.user.role === 'admin_lokasi' && t.location_id !== req.user.location_id)) throw notFound('Transaksi tidak ditemukan.');
    return t;
  }
  secured.get('/transactions/:id', allow('admin_lokasi', 'super_admin'), wrap((req, res) => {
    const t = scopedTrx(req);
    res.json({ ...t, saldo: { available: t.saldo.available, held: t.saldo.held, gold: t.saldo.gold } });
  }));
  secured.put('/transactions/:id', allow('admin_lokasi'), wrap((req, res) => res.json(D.editTransaction(db, req.user, Number(req.params.id), req.body))));
  secured.post('/transactions/:id/void', allow('admin_lokasi'), wrap((req, res) => res.json(D.voidTransaction(db, req.user, Number(req.params.id), req.body))));
  secured.get('/transactions/:id/receipt.pdf', allow('admin_lokasi', 'super_admin'), wrap(async (req, res) => {
    const t = scopedTrx(req);
    const buf = await buildReceiptPdf({
      title: `Struk Setoran ${t.trx_no}`,
      lines: [['Tanggal', fmtDate(t.trx_date)], ['Lokasi', t.location_nama], ['Nasabah', t.customer_nama], ['Status', t.status === 'sukses' ? 'Sukses' : 'VOID']],
      items: t.items, total: t.total_idr, saldo: t.saldo.available,
      footer: 'Terima kasih telah berpartisipasi dalam program Ubah Sampah Jadi Emas — BSI x Kepul.',
    });
    res.setHeader('Content-Type', 'application/pdf');
    res.setHeader('Content-Disposition', `attachment; filename="${t.trx_no}.pdf"`);
    res.send(buf);
  }));

  // ---------- Konversi (FR-5) ----------
  const cnvBase = `FROM conversions v JOIN customers c ON c.id = v.customer_id JOIN locations l ON l.id = v.location_id
    LEFT JOIN profiles pr ON pr.id = v.requested_by LEFT JOIN profiles pv ON pv.id = v.verified_by`;
  const shapeCnv = (r, user) => ({
    id: r.id, cnv_no: r.cnv_no, customer_id: r.customer_id, customer_nama: r.customer_nama, location_nama: r.location_nama,
    amount_idr: r.amount_idr, status: r.status,
    // Rekening penuh hanya di layar verifikasi Super Admin (FR-5.7)
    bsi_account_no: user.role === 'super_admin' && req_detail(r) ? r.bsi_account_no : maskAccount(r.bsi_account_no),
    requested_at: r.requested_at, requested_by_nama: r.requested_by_nama, verified_at: r.verified_at, verified_by_nama: r.verified_by_nama,
    reject_reason: r.reject_reason, cancel_reason: r.cancel_reason, transferred_at: r.transferred_at, completed_at: r.completed_at,
  });
  const req_detail = (r) => r.__detail === true;
  secured.get('/conversions', allow('admin_lokasi', 'super_admin'), (req, res) => {
    const w = ['1=1'], p = [];
    if (req.user.role === 'admin_lokasi') { w.push('v.location_id = ?'); p.push(req.user.location_id); }
    else if (req.query.location_id) { w.push('v.location_id = ?'); p.push(Number(req.query.location_id)); }
    if (req.query.status === 'perlu_tindakan') w.push("v.status IN ('diajukan','diverifikasi')");
    else if (STATUS_KONVERSI[req.query.status]) { w.push('v.status = ?'); p.push(req.query.status); }
    const q = String(req.query.q ?? '').trim();
    if (q) { w.push('(v.cnv_no LIKE ? OR c.nama LIKE ?)'); p.push(`%${q}%`, `%${q}%`); }
    const { page, size, offset } = pageOf(req);
    const total = db.prepare(`SELECT COUNT(*) AS n ${cnvBase} WHERE ${w.join(' AND ')}`).get(...p).n;
    const rows = db.prepare(`SELECT v.*, c.nama AS customer_nama, l.nama AS location_nama, pr.nama AS requested_by_nama, pv.nama AS verified_by_nama
      ${cnvBase} WHERE ${w.join(' AND ')} ORDER BY v.id DESC LIMIT ? OFFSET ?`).all(...p, size, offset);
    const counts = db.prepare(`SELECT status, COUNT(*) AS n FROM conversions v WHERE ${req.user.role === 'admin_lokasi' ? 'v.location_id = ?' : '1=1'} GROUP BY status`)
      .all(...(req.user.role === 'admin_lokasi' ? [req.user.location_id] : []));
    res.json({ rows: rows.map((r) => shapeCnv(r, req.user)), total, page, size, counts: Object.fromEntries(counts.map((c) => [c.status, c.n])) });
  });
  secured.post('/conversions', allow('admin_lokasi'), wrap((req, res) => res.status(201).json(D.createConversion(db, req.user, req.body))));
  secured.get('/conversions/:id', allow('admin_lokasi', 'super_admin'), wrap((req, res) => {
    D.scopedConversion(db, req.user, Number(req.params.id));
    const r = db.prepare(`SELECT v.*, c.nama AS customer_nama, l.nama AS location_nama, pr.nama AS requested_by_nama, pv.nama AS verified_by_nama
      ${cnvBase} WHERE v.id = ?`).get(Number(req.params.id));
    r.__detail = true;
    const out = shapeCnv(r, req.user);
    out.saldo = D.balanceOf(db, r.customer_id)?.available;
    if (req.user.role === 'super_admin') {
      out.proofs = db.prepare(`SELECT p.id, p.version, p.file_name, p.uploaded_at, p.correction_reason, u.nama AS uploaded_by_nama
        FROM conversion_proofs p LEFT JOIN profiles u ON u.id = p.uploaded_by WHERE p.conversion_id = ? ORDER BY p.version DESC`).all(r.id);
    } else {
      out.proofs = [];
      out.has_proof = !!db.prepare('SELECT 1 FROM conversion_proofs WHERE conversion_id = ?').get(r.id);
    }
    res.json(out);
  }));
  secured.post('/conversions/:id/verify', allow('super_admin'), wrap((req, res) => res.json(D.verifyConversion(db, req.user, Number(req.params.id)))));
  secured.post('/conversions/:id/reject', allow('super_admin'), wrap((req, res) => res.json(D.rejectConversion(db, req.user, Number(req.params.id), req.body))));
  secured.post('/conversions/:id/cancel', allow('admin_lokasi', 'super_admin'), wrap((req, res) => res.json(D.cancelConversion(db, req.user, Number(req.params.id), req.body))));
  secured.post('/conversions/:id/proof', allow('super_admin'), upload.single('file'), wrap((req, res) => {
    res.json(D.completeConversion(db, req.user, Number(req.params.id), { file: req.file?.buffer, fileName: req.file?.originalname, transferDate: req.body.transfer_date }));
  }));
  secured.post('/conversions/:id/proof/correct', allow('super_admin'), upload.single('file'), wrap((req, res) => {
    res.json(D.correctProof(db, req.user, Number(req.params.id), { file: req.file?.buffer, fileName: req.file?.originalname, reason: req.body.reason, transferDate: req.body.transfer_date }));
  }));
  // Tautan bertanda tangan berumur pendek (maks. 5 menit) untuk berkas privat (Bab 8.2)
  secured.get('/conversions/:id/proofs/:pid/link', allow('super_admin'), wrap((req, res) => {
    const p = db.prepare('SELECT file_path FROM conversion_proofs WHERE id = ? AND conversion_id = ?').get(Number(req.params.pid), Number(req.params.id));
    if (!p) throw notFound('Bukti tidak ditemukan.');
    res.json({ url: `/api/files/${sign({ p: p.file_path, uid: req.user.id, exp: Date.now() + 5 * 60e3 })}` });
  }));
  secured.get('/conversions/:id/receipt.pdf', allow('admin_lokasi', 'super_admin'), wrap(async (req, res) => {
    const c = D.scopedConversion(db, req.user, Number(req.params.id));
    if (c.status !== 'transfer_selesai') throw conflict('Struk konversi tersedia setelah Transfer Selesai.');
    const info = db.prepare('SELECT c.nama, l.nama AS lokasi FROM customers c JOIN locations l ON l.id = c.location_id WHERE c.id = ?').get(c.customer_id);
    const buf = await buildReceiptPdf({
      title: `Struk Konversi ${c.cnv_no}`,
      lines: [['Tanggal transfer', fmtDate(c.transferred_at)], ['Lokasi', info.lokasi], ['Nasabah', info.nama], ['Rekening BSI', maskAccount(c.bsi_account_no)], ['Status', 'Transfer Selesai']],
      items: [], total: c.amount_idr, footer: 'Saldo telah dikonversi menjadi Tabungan Emas BSI. Terima kasih.',
    });
    res.setHeader('Content-Type', 'application/pdf');
    res.setHeader('Content-Disposition', `attachment; filename="${c.cnv_no}.pdf"`);
    res.send(buf);
  }));
  secured.get('/receipts/conversions', allow('admin_lokasi', 'super_admin'), (req, res) => {
    const w = ["v.status = 'transfer_selesai'"], p = [];
    if (req.user.role === 'admin_lokasi') { w.push('v.location_id = ?'); p.push(req.user.location_id); }
    const q = String(req.query.q ?? '').trim();
    if (q) { w.push('(v.cnv_no LIKE ? OR c.nama LIKE ?)'); p.push(`%${q}%`, `%${q}%`); }
    res.json({ rows: db.prepare(`SELECT v.id, v.cnv_no, v.amount_idr, v.transferred_at, c.nama AS customer_nama, l.nama AS location_nama
      FROM conversions v JOIN customers c ON c.id = v.customer_id JOIN locations l ON l.id = v.location_id WHERE ${w.join(' AND ')} ORDER BY v.id DESC LIMIT 100`).all(...p) });
  });

  // ---------- Berkas privat ----------
  secured.get('/files/:token', wrap((req, res) => {
    const t = verify(req.params.token);
    if (!t || t.exp < Date.now() || t.uid !== req.user.id) throw new HttpError(403, 'Tautan tidak valid atau sudah kedaluwarsa.');
    const f = path.join(UPLOAD_DIR, path.basename(t.p));
    if (!fs.existsSync(f)) throw notFound('Berkas tidak ditemukan.');
    const sn = sniffFile(fs.readFileSync(f).subarray(0, 16));
    res.setHeader('Content-Type', sn?.mime ?? 'application/octet-stream');
    res.setHeader('Cache-Control', 'private, no-store');
    res.setHeader('X-Content-Type-Options', 'nosniff');
    res.sendFile(f);
  }));

  // ---------- Dokumentasi (FR-7.7) ----------
  const KATEGORI = ['Kegiatan Kios', 'Penyerahan Tabungan Emas', 'Edukasi', 'Lainnya'];
  secured.get('/documents', (req, res) => {
    const w = ['d.is_archived = 0'], p = [];
    if (req.user.role === 'admin_lokasi') { w.push('d.location_id = ?'); p.push(req.user.location_id); }
    else if (req.query.location_id) { w.push('d.location_id = ?'); p.push(Number(req.query.location_id)); }
    if (KATEGORI.includes(req.query.kategori)) { w.push('d.kategori = ?'); p.push(req.query.kategori); }
    if (isDate(req.query.from)) { w.push('d.tanggal >= ?'); p.push(req.query.from); }
    if (isDate(req.query.to)) { w.push('d.tanggal <= ?'); p.push(req.query.to); }
    const rows = db.prepare(`SELECT d.id, d.judul, d.caption, d.kategori, d.tanggal, d.file_path, d.location_id, l.nama AS location_nama, u.nama AS uploaded_by_nama, d.uploaded_at
      FROM documents d JOIN locations l ON l.id = d.location_id LEFT JOIN profiles u ON u.id = d.uploaded_by WHERE ${w.join(' AND ')}
      ORDER BY d.tanggal DESC, d.id DESC LIMIT 200`).all(...p);
    res.json({ rows: rows.map(({ file_path, ...r }) => ({ ...r, url: `/api/files/${sign({ p: file_path, uid: req.user.id, exp: Date.now() + 5 * 60e3 })}` })) });
  });
  secured.post('/documents', allow('admin_lokasi', 'super_admin'), upload.single('file'), wrap((req, res) => {
    const judul = String(req.body.judul ?? '').trim();
    if (!judul) throw bad('Judul wajib diisi.');
    if (!KATEGORI.includes(req.body.kategori)) throw bad('Kategori tidak valid.');
    const tanggal = req.body.tanggal || wibDate();
    if (!isDate(tanggal)) throw bad('Tanggal tidak valid.');
    if (!req.file) throw bad('Berkas foto wajib diunggah.');
    const locationId = req.user.role === 'admin_lokasi' ? req.user.location_id : Number(req.body.location_id);
    if (!locationId || !db.prepare('SELECT 1 FROM locations WHERE id = ?').get(locationId)) throw bad('Lokasi wajib dipilih.');
    const saved = D.saveFile(req.file.buffer, ['jpg', 'png', 'webp']);
    const id = withTx(db, () => {
      const id = db.prepare(`INSERT INTO documents (location_id, judul, caption, kategori, tanggal, file_path, uploaded_by, uploaded_at)
        VALUES (?,?,?,?,?,?,?,?)`).run(locationId, judul, req.body.caption || null, req.body.kategori, tanggal, saved.file_path, req.user.id, nowIso()).lastInsertRowid;
      audit(db, req.user, 'document.upload', 'documents', id, null, { judul, kategori: req.body.kategori, location_id: locationId });
      return id;
    });
    res.status(201).json({ id });
  }));
  secured.post('/documents/:id/archive', allow('admin_lokasi', 'super_admin'), wrap((req, res) => {
    const reason = requireReason(req.body.reason);
    const d = db.prepare('SELECT * FROM documents WHERE id = ?').get(Number(req.params.id));
    if (!d || (req.user.role === 'admin_lokasi' && d.location_id !== req.user.location_id)) throw notFound('Dokumen tidak ditemukan.');
    withTx(db, () => {
      db.prepare('UPDATE documents SET is_archived = 1, archive_reason = ? WHERE id = ?').run(reason, d.id);
      audit(db, req.user, 'document.archive', 'documents', d.id, { is_archived: 0 }, { is_archived: 1 }, reason);
    });
    res.json({ ok: true });
  }));

  // ---------- Laporan (FR-7) ----------
  function reportFilters(req) {
    const f = filters(req);
    const extra = { transferStatus: STATUS_KONVERSI[req.query.transfer_status] ? req.query.transfer_status : null };
    return { f, extra };
  }
  secured.get('/reports/summary', wrap((req, res) => {
    const { f, extra } = reportFilters(req);
    const d = buildReportData(db, req.user, f, extra);
    res.json({
      filterText: d.filterText, kpis: d.kpis, recon: d.recon, perfTotal: d.perf.total,
      konversiPerStatus: Object.keys(STATUS_KONVERSI).map((s) => ({ status: s, jumlah: d.konversi.filter((c) => c.status === s).length,
        nominal: d.konversi.filter((c) => c.status === s).reduce((a, c) => a + c.amount_idr, 0) })),
    });
  }));
  secured.get('/reports/excel', wrap(async (req, res) => {
    const { f, extra } = reportFilters(req);
    const buf = await buildExcel(buildReportData(db, req.user, f, extra));
    audit(db, req.user, 'report.excel', 'reports', null, null, { filters: f });
    res.setHeader('Content-Type', 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet');
    res.setHeader('Content-Disposition', `attachment; filename="BSI-Kios-Audit-Report-${wibDate()}.xlsx"`);
    res.send(buf);
  }));
  secured.get('/reports/pdf', wrap(async (req, res) => {
    const { f, extra } = reportFilters(req);
    const buf = await buildPdf(buildReportData(db, req.user, f, extra));
    audit(db, req.user, req.query.preview === '1' ? 'report.preview' : 'report.pdf', 'reports', null, null, { filters: f });
    res.setHeader('Content-Type', 'application/pdf');
    res.setHeader('Content-Disposition', `${req.query.preview === '1' ? 'inline' : 'attachment'}; filename="BSI-Kios-Executive-Summary-${wibDate()}.pdf"`);
    res.send(buf);
  }));
  secured.get('/reports/snapshots', (req, res) => {
    const rows = db.prepare(`SELECT s.id, s.label, s.created_at, u.nama AS created_by_nama, s.filters FROM report_snapshots s LEFT JOIN profiles u ON u.id = s.created_by
      ${req.user.role === 'admin_lokasi' ? 'WHERE s.created_by = ?' : ''} ORDER BY s.id DESC LIMIT 100`).all(...(req.user.role === 'admin_lokasi' ? [req.user.id] : []));
    res.json({ rows: rows.map((r) => ({ ...r, filters: JSON.parse(r.filters) })) });
  });
  secured.post('/reports/snapshots', wrap((req, res) => {
    const { f, extra } = reportFilters(req);
    const label = String(req.body.label ?? '').trim() || `Snapshot ${wibDate()}`;
    const d = buildReportData(db, req.user, f, extra);
    const id = withTx(db, () => {
      const id = db.prepare('INSERT INTO report_snapshots (label, filters, kpis, created_by, created_at) VALUES (?,?,?,?,?)')
        .run(label, JSON.stringify({ ...f, ...extra, text: d.filterText }), JSON.stringify({ kpis: d.kpis, recon: d.recon }), req.user.id, nowIso()).lastInsertRowid;
      audit(db, req.user, 'report.snapshot', 'report_snapshots', id, null, { label });
      return id;
    });
    res.status(201).json({ id });
  }));
  secured.get('/reports/snapshots/:id', wrap((req, res) => {
    const s = db.prepare('SELECT * FROM report_snapshots WHERE id = ?').get(Number(req.params.id));
    if (!s || (req.user.role === 'admin_lokasi' && s.created_by !== req.user.id)) throw notFound('Snapshot tidak ditemukan.');
    res.json({ id: s.id, label: s.label, created_at: s.created_at, filters: JSON.parse(s.filters), ...JSON.parse(s.kpis) });
  }));

  // ---------- Notifikasi (FR-9) ----------
  secured.get('/notifications', (req, res) => {
    const rows = db.prepare('SELECT * FROM notifications WHERE user_id = ? ORDER BY id DESC LIMIT 30').all(req.user.id);
    const unread = db.prepare('SELECT COUNT(*) AS n FROM notifications WHERE user_id = ? AND is_read = 0').get(req.user.id).n;
    res.json({ rows, unread });
  });
  secured.post('/notifications/read-all', (req, res) => {
    db.prepare('UPDATE notifications SET is_read = 1 WHERE user_id = ?').run(req.user.id);
    res.json({ ok: true });
  });
  secured.post('/notifications/:id/read', (req, res) => {
    db.prepare('UPDATE notifications SET is_read = 1 WHERE id = ? AND user_id = ?').run(Number(req.params.id), req.user.id);
    res.json({ ok: true });
  });

  // ---------- Administrasi (FR-8) — hanya Super Admin ----------
  const admin = express.Router();
  admin.use(allow('super_admin'));
  secured.use('/admin', admin);

  const userRow = (u) => ({ id: u.id, nama: u.nama, email: u.email, role: u.role, location_id: u.location_id, location_nama: u.location_nama,
    is_active: !!u.is_active, last_login_at: u.last_login_at, must_change_password: !!u.must_change_password });
  admin.get('/users', (req, res) => {
    res.json({ rows: db.prepare(`SELECT p.*, l.nama AS location_nama FROM profiles p LEFT JOIN locations l ON l.id = p.location_id ORDER BY p.id`).all().map(userRow) });
  });
  function checkUserBody(b, partial = false) {
    if (!partial || b.role !== undefined) if (!['super_admin', 'admin_lokasi', 'bsi_viewer'].includes(b.role)) throw bad('Peran tidak valid.');
  }
  admin.post('/users', wrap((req, res) => {
    const b = req.body;
    const email = String(b.email ?? '').trim().toLowerCase();
    if (!/^\S+@\S+\.\S+$/.test(email)) throw bad('Email tidak valid.');
    if (String(b.nama ?? '').trim().length < 2) throw bad('Nama wajib diisi.');
    checkUserBody(b);
    if (b.role === 'admin_lokasi' && !db.prepare('SELECT 1 FROM locations WHERE id = ?').get(b.location_id ?? null)) throw bad('Admin Lokasi wajib memiliki lokasi.');
    if (db.prepare('SELECT 1 FROM profiles WHERE email = ?').get(email)) throw conflict('Email sudah terdaftar.');
    const pw = randomPassword();
    const id = withTx(db, () => {
      const id = db.prepare('INSERT INTO profiles (email, nama, role, location_id, password_hash, must_change_password) VALUES (?,?,?,?,?,1)')
        .run(email, b.nama.trim(), b.role, b.role === 'admin_lokasi' ? b.location_id : null, bcrypt.hashSync(pw, 10)).lastInsertRowid;
      audit(db, req.user, 'user.create', 'profiles', id, null, { email, role: b.role, location_id: b.location_id ?? null });
      return id;
    });
    res.status(201).json({ id, temporary_password: pw });
  }));
  admin.put('/users/:id', wrap((req, res) => {
    const id = Number(req.params.id), b = req.body;
    const u = db.prepare('SELECT * FROM profiles WHERE id = ?').get(id);
    if (!u) throw notFound('Pengguna tidak ditemukan.');
    checkUserBody(b, true);
    const role = b.role ?? u.role;
    const locId = role === 'admin_lokasi' ? (b.location_id ?? u.location_id) : null;
    if (role === 'admin_lokasi' && !locId) throw bad('Admin Lokasi wajib memiliki lokasi.');
    const active = b.is_active === undefined ? u.is_active : b.is_active ? 1 : 0;
    const losesSuper = u.role === 'super_admin' && u.is_active && (role !== 'super_admin' || !active);
    if (losesSuper && db.prepare("SELECT COUNT(*) AS n FROM profiles WHERE role='super_admin' AND is_active=1").get().n <= 1)
      throw conflict('Super Admin terakhir tidak dapat dinonaktifkan atau diubah perannya.');
    withTx(db, () => {
      db.prepare('UPDATE profiles SET nama = ?, role = ?, location_id = ?, is_active = ? WHERE id = ?').run(String(b.nama ?? u.nama).trim(), role, locId, active, id);
      audit(db, req.user, active ? 'user.update' : 'user.deactivate', 'profiles', id,
        { nama: u.nama, role: u.role, location_id: u.location_id, is_active: u.is_active }, { nama: b.nama ?? u.nama, role, location_id: locId, is_active: active });
    });
    res.json({ ok: true });
  }));
  admin.post('/users/:id/reset-password', wrap((req, res) => {
    const id = Number(req.params.id);
    if (!db.prepare('SELECT 1 FROM profiles WHERE id = ?').get(id)) throw notFound('Pengguna tidak ditemukan.');
    const pw = randomPassword();
    withTx(db, () => {
      db.prepare('UPDATE profiles SET password_hash = ?, must_change_password = 1, failed_attempts = 0, locked_until = NULL WHERE id = ?').run(bcrypt.hashSync(pw, 10), id);
      audit(db, req.user, 'user.reset_password', 'profiles', id, null, null);
    });
    res.json({ temporary_password: pw });
  }));

  admin.get('/locations', (req, res) => res.json({ rows: db.prepare('SELECT * FROM locations ORDER BY id').all() }));
  admin.post('/locations', wrap((req, res) => {
    const nama = String(req.body.nama ?? '').trim();
    if (nama.length < 2) throw bad('Nama lokasi wajib diisi.');
    if (db.prepare('SELECT 1 FROM locations WHERE lower(nama) = lower(?)').get(nama)) throw conflict('Lokasi sudah ada.');
    const id = withTx(db, () => {
      const id = db.prepare('INSERT INTO locations (nama, alamat, target_kg_bulanan) VALUES (?,?,?)').run(nama, req.body.alamat || null, req.body.target_kg_bulanan || null).lastInsertRowid;
      audit(db, req.user, 'location.create', 'locations', id, null, { nama });
      return id;
    });
    res.status(201).json({ id });
  }));
  admin.put('/locations/:id', wrap((req, res) => {
    const id = Number(req.params.id), b = req.body;
    const l = db.prepare('SELECT * FROM locations WHERE id = ?').get(id);
    if (!l) throw notFound('Lokasi tidak ditemukan.');
    const target = b.target_kg_bulanan === '' || b.target_kg_bulanan == null ? null : Number(b.target_kg_bulanan);
    if (target != null && (!Number.isFinite(target) || target < 0)) throw bad('Target bulanan tidak valid.');
    const active = b.is_active === undefined ? l.is_active : b.is_active ? 1 : 0;
    withTx(db, () => {
      db.prepare('UPDATE locations SET nama = ?, alamat = ?, target_kg_bulanan = ?, is_active = ? WHERE id = ?')
        .run(String(b.nama ?? l.nama).trim(), b.alamat ?? l.alamat, b.target_kg_bulanan === undefined ? l.target_kg_bulanan : target, active, id);
      audit(db, req.user, active ? 'location.update' : 'location.deactivate', 'locations', id, l, { ...b });
    });
    res.json({ ok: true });
  }));

  admin.get('/audit', (req, res) => {
    const w = ['1=1'], p = [];
    if (isDate(req.query.from)) { w.push('substr(at,1,10) >= ?'); p.push(req.query.from); }
    if (isDate(req.query.to)) { w.push('substr(at,1,10) <= ?'); p.push(req.query.to); }
    if (req.query.user_id) { w.push('user_id = ?'); p.push(Number(req.query.user_id)); }
    if (req.query.action) { w.push('action LIKE ?'); p.push(`%${req.query.action}%`); }
    if (req.query.entity) { w.push('entity = ?'); p.push(req.query.entity); }
    const { page, size, offset } = pageOf(req, 50);
    const total = db.prepare(`SELECT COUNT(*) AS n FROM audit_logs WHERE ${w.join(' AND ')}`).get(...p).n;
    const rows = db.prepare(`SELECT * FROM audit_logs WHERE ${w.join(' AND ')} ORDER BY id DESC LIMIT ? OFFSET ?`).all(...p, size, offset);
    res.json({ rows, total, page, size });
  });
  admin.get('/audit/export', (req, res) => {
    const rows = db.prepare('SELECT * FROM audit_logs ORDER BY id').all();
    const esc = (v) => `"${String(v ?? '').replaceAll('"', '""')}"`;
    const csv = ['id,waktu,pengguna,peran,aksi,entitas,id_entitas,sebelum,sesudah,alasan',
      ...rows.map((r) => [r.id, r.at, r.user_nama, r.role, r.action, r.entity, r.entity_id, r.before, r.after, r.reason].map(esc).join(','))].join('\n');
    res.setHeader('Content-Type', 'text/csv; charset=utf-8');
    res.setHeader('Content-Disposition', 'attachment; filename="audit-log.csv"');
    res.send('﻿' + csv);
  });
  admin.get('/settings', (req, res) => {
    const st = getSettings(db);
    res.json({ settings: Object.fromEntries(['min_conversion', 'existing_threshold', 'backdate_days', 'session_minutes'].map((k) => [k, Number(st[k])])) });
  });
  admin.put('/settings', wrap((req, res) => {
    const allowed = { min_conversion: [1000, 100000000], existing_threshold: [2, 100], backdate_days: [0, 365], session_minutes: [5, 480] };
    const before = getSettings(db), changes = {};
    for (const [k, [lo, hi]] of Object.entries(allowed)) {
      if (req.body[k] === undefined) continue;
      const v = Number(req.body[k]);
      if (!Number.isInteger(v) || v < lo || v > hi) throw bad(`Nilai ${k} harus bilangan bulat antara ${lo} dan ${hi}.`);
      changes[k] = v;
    }
    withTx(db, () => {
      for (const [k, v] of Object.entries(changes))
        db.prepare('INSERT INTO app_settings (key, value, updated_by, updated_at) VALUES (?,?,?,?) ON CONFLICT(key) DO UPDATE SET value=excluded.value, updated_by=excluded.updated_by, updated_at=excluded.updated_at')
          .run(k, String(v), req.user.id, nowIso());
      audit(db, req.user, 'settings.update', 'app_settings', null, Object.fromEntries(Object.keys(changes).map((k) => [k, before[k]])), changes);
    });
    res.json({ ok: true });
  }));

  app.use('/api', api);
  app.use('/api', (req, res, next) => next(notFound('Endpoint tidak ditemukan.')));

  // ---------- Frontend statis ----------
  const dist = path.join(ROOT, 'dist');
  if (fs.existsSync(dist)) {
    app.use(express.static(dist, { index: false, maxAge: '1h' }));
    app.get(/^\/(?!api\/).*/, (req, res) => res.sendFile(path.join(dist, 'index.html')));
  }

  // ---------- Penanganan galat ----------
  app.use((err, req, res, next) => {
    if (err instanceof multer.MulterError) err = bad(err.code === 'LIMIT_FILE_SIZE' ? 'Ukuran berkas maksimal 5 MB.' : 'Berkas tidak valid.');
    if (err.type === 'entity.parse.failed') err = bad('Permintaan tidak valid.');
    if (err instanceof HttpError) {
      if (err.status === 403 && req.user) { try { audit(db, req.user, 'access.denied', 'api', `${req.method} ${req.originalUrl}`.slice(0, 200), null, null); } catch { /* abaikan */ } }
      return res.status(err.status).json({ error: err.message, code: err.code });
    }
    if (/Penghapusan permanen|tidak dapat diubah/.test(err.message)) return res.status(403).json({ error: err.message });
    console.error(err);
    res.status(500).json({ error: 'Terjadi kesalahan pada server.' });
  });
  return app;
}
