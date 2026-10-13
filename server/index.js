import { openDb } from './db.js';
import { seedBase } from './seed.js';
import { createApp } from './app.js';

const db = openDb();
const seeded = seedBase(db);
const app = createApp(db);
const port = Number(process.env.PORT) || 3000;
app.listen(port, process.env.HOST || '0.0.0.0', () => {
  console.log(`BSI Kios Daur Ulang Dashboard berjalan di http://localhost:${port}`);
  if (seeded) {
    console.log('\nData awal dibuat. Kredensial sementara (wajib diganti saat login pertama) disimpan di:');
    console.log('  ' + seeded.file);
    for (const c of seeded.creds) console.log(`  ${c.role.padEnd(13)} ${c.email.padEnd(34)} ${c.password}`);
  }
});
