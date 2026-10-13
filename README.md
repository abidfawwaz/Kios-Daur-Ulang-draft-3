# BSI Kios Daur Ulang Dashboard

Implementasi PRD v4.0 (program Ubah Sampah Jadi Emas — BSI x Kepul). Node 22.13+ diperlukan.

## Menjalankan

```bash
npm install
npm run build        # membangun frontend ke dist/
npm start            # http://localhost:3000
```

Pada start pertama, database `data/kios.db` dibuat otomatis berisi 5 lokasi, 16 jenis sampah (Lampiran A), parameter, dan
7 akun (Lampiran B). **Kata sandi sementara acak** dicetak di terminal dan disimpan di `data/KREDENSIAL-AWAL.txt`
(hapus berkas setelah dibagikan). Setiap akun wajib mengganti kata sandi saat login pertama.
Email akun default memakai domain `bsi-kios.local`; ganti dengan `ACCOUNT_DOMAIN=bsi.co.id npm start` pada start pertama.

| Perintah | Fungsi |
|---|---|
| `npm run dev` | API + Vite dev server (hot reload) |
| `npm test` | 18 uji penerimaan otomatis (F-01..F-10, T-01..T-13, rekonsiliasi) |
| `npm run typecheck` | Pemeriksaan tipe frontend |
| `npm run seed:demo` | Data demo sintetis (jangan di produksi; pakai `DATA_DIR=...` terpisah) |

## Konfigurasi (variabel lingkungan)

`PORT`, `HOST`, `DATA_DIR` (lokasi database & unggahan), `APP_SECRET` (kunci tanda tangan sesi; bila kosong dibuat di `data/.secret`),
`COOKIE_SECURE=1` (wajib di belakang HTTPS: cookie secure + HSTS), `ACCOUNT_DOMAIN`.

## Produksi (HTTPS)

Jalankan di belakang reverse proxy HTTPS (Nginx/Caddy/Cloudflare) dengan `COOKIE_SECURE=1`. **Cadangkan folder `DATA_DIR`** setiap hari
(database SQLite + `uploads/` + `.secret`), simpan 30 hari, dan uji pemulihan sebelum go-live. Tambahkan Super Admin kedua lewat
Pengaturan → Pengguna.

## Arsitektur

- `server/` — Express + SQLite (`node:sqlite`). `kpi.js` adalah **satu-satunya** tempat rumus KPI (dipakai dashboard, laporan, PDF, Excel).
  `domain.js` memuat aturan bisnis BR-xx. `db.js` memasang trigger yang menolak DELETE di semua tabel dan UPDATE pada `audit_logs`,
  `report_snapshots`, `conversion_proofs`.
- `src/` — React + Vite + TypeScript + Tailwind + Recharts. Token desain di `src/styles/tokens.css`.
- Berkas bukti & foto disimpan privat di `DATA_DIR/uploads`, diakses lewat tautan bertanda tangan (5 menit) + sesi login.

## Catatan penyimpangan dari PRD

- Backend Node + SQLite (alternatif PRD 8.1), bukan Supabase; pembatasan per peran/lokasi ditegakkan di lapisan API dan trigger DB, bukan RLS Postgres.
- Logo BSI/Kepul di `public/assets/` adalah **placeholder**; ganti dengan aset resmi.
- Teal tombol memakai `#00786F` (varian gelap `#00978C`) agar kontras teks putih memenuhi WCAG AA; ubah di `tokens.css` bila perlu.
- PDF memakai Helvetica (setara Arial); font Lato dipakai di antarmuka web.
- Impor data existing (A-12) belum tersedia karena Excel Audit Report existing tidak disertakan; aplikasi dapat dimulai dari data kosong.
- Rekonsiliasi dihitung pada posisi kumulatif (tidak terpengaruh filter periode) agar identitas bermakna.
