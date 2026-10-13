import { ReactNode, useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { Area, AreaChart, Bar, BarChart, CartesianGrid, Cell, LabelList, Pie, PieChart, ResponsiveContainer, Tooltip, XAxis, YAxis } from 'recharts';
import { ArrowRight, Award, Banknote, Clock, Coins, Receipt, Scale, UserCheck, Users } from 'lucide-react';
import { useAuth } from '../lib/auth';
import { qs, useApi } from '../lib/api';
import { fmtDate, kg, num, pct, rp } from '../lib/format';
import { Badge, Card, DataTable, EmptyState, Col, KpiCard, Loadable, Progress, Tabs } from '../components/ui';
import { LocationSelect, PeriodFilter, periodRange, usePeriod } from '../components/Filters';

const TEAL = '#00978C', GOLD = '#F8AD3C';
type Tab = 'ringkasan' | 'performa' | 'sampah';

function ChartCard({ title, subtitle, children, empty, emptyText = 'Belum ada data pada filter ini.', className = '' }: { title: string; subtitle?: string; children: ReactNode; empty?: boolean; emptyText?: string; className?: string }) {
  return (
    <Card className={`p-4 ${className}`}>
      <h3 className="font-bold text-ink">{title}</h3>
      {subtitle && <p className="text-xs text-ink-soft mb-2">{subtitle}</p>}
      {empty ? <EmptyState title="Belum ada data" text={emptyText} /> : <div className="mt-2">{children}</div>}
    </Card>
  );
}

function Greeting() {
  const { user } = useAuth();
  return (
    <div className="mb-4">
      <p className="text-lg font-bold text-teal-dark">Assalamu'alaikum, {user?.nama}</p>
      <p className="text-sm text-ink-soft">{user?.role === 'admin_lokasi' ? `Berikut ringkasan program di ${user.location_nama}.` : 'Berikut ringkasan program Ubah Sampah Jadi Emas.'}</p>
    </div>
  );
}

export default function Dashboard() {
  const { user } = useAuth();
  const [tab, setTab] = useState<Tab>('ringkasan');
  const [period, setPeriod] = usePeriod();
  const [loc, setLoc] = useState('');
  const [waste, setWaste] = useState('');
  const { from, to } = periodRange(period);
  const params = qs({ from, to, location_id: loc });
  const wasteTypes = useApi<{ rows: any[] }>(tab === 'sampah' ? '/waste-types' : null);

  return (
    <div className="space-y-4">
      <Greeting />
      <Card className="p-4">
        <div className="flex flex-wrap items-end gap-3">
          <PeriodFilter value={period} onChange={setPeriod} />
          <LocationSelect value={loc} onChange={setLoc} />
          {tab === 'sampah' && (
            <div><label className="label" htmlFor="f-jenis">Jenis sampah</label>
              <select id="f-jenis" className="input" value={waste} onChange={(e) => setWaste(e.target.value)}>
                <option value="">Semua jenis</option>{wasteTypes.data?.rows.map((w) => <option key={w.id} value={w.id}>{w.nama}</option>)}
              </select></div>
          )}
        </div>
        <p className="text-xs text-ink-soft mt-2">Periode memengaruhi transaksi, berat, dan nilai. Saldo, eligible, pending, dan Tabungan Emas selalu menunjukkan posisi <strong>per hari ini</strong>.</p>
      </Card>
      <Tabs<Tab> value={tab} onChange={setTab} tabs={[{ id: 'ringkasan', label: 'Ringkasan' }, { id: 'performa', label: 'Performa Lokasi' }, { id: 'sampah', label: 'Sampah & Nilai Ekonomi' }]} />
      {tab === 'ringkasan' && <Overview params={params} role={user!.role} />}
      {tab === 'performa' && <Performa params={params} />}
      {tab === 'sampah' && <Sampah params={params + (waste ? `${params ? '&' : '?'}waste_type_id=${waste}` : '')} />}
    </div>
  );
}

/* ------------------------------ Ringkasan ------------------------------ */
function Overview({ params, role }: { params: string; role: string }) {
  const nav = useNavigate();
  const { data, loading, error, reload } = useApi<any>(`/dashboard${params}`);
  const k = data?.kpis;
  const canTrx = role !== 'bsi_viewer';
  const cards = k ? [
    { icon: <Receipt size={20} />, label: 'Total Transaksi', value: num(k.totalTransaksi), hint: 'transaksi sukses', to: canTrx ? '/transaksi' : undefined },
    { icon: <Users size={20} />, label: 'Total Nasabah', value: num(k.totalNasabah), hint: 'record aktif • per hari ini', to: '/nasabah' },
    { icon: <Scale size={20} />, label: 'Total Berat', value: kg(k.totalBeratKg), hint: k.totalUnit ? `+ ${num(k.totalUnit)} unit` : 'sampah kiloan' },
    { icon: <Banknote size={20} />, label: 'Nilai Ekonomi', value: rp(k.nilaiEkonomi), hint: 'kg + unit' },
    { icon: <Coins size={20} />, label: 'Saldo Belum Dikonversi', value: rp(k.saldoBelumDikonversi), hint: 'per hari ini', to: '/nasabah' },
    { icon: <Award size={20} />, label: 'Sudah Jadi Tabungan Emas', value: rp(k.sudahTabunganEmas), hint: 'per hari ini', gold: true, to: canTrx ? '/konversi?status=transfer_selesai' : undefined },
    { icon: <UserCheck size={20} />, label: 'Nasabah Eligible', value: num(k.nasabahEligible), hint: 'saldo ≥ minimum • per hari ini', gold: true, to: '/nasabah?eligible=1' },
    { icon: <Clock size={20} />, label: 'Transfer Pending', value: rp(k.transferPending), hint: 'per hari ini', to: canTrx ? '/konversi?status=perlu_tindakan' : undefined },
  ] : [];

  return (
    <Loadable loading={loading} error={error} reload={reload} hasData={!!data} rows={6}>
      {data && (
        <div className="space-y-4">
          <div className="grid grid-cols-2 lg:grid-cols-4 gap-3">
            {cards.map((c) => <KpiCard key={c.label} icon={c.icon} label={c.label} value={c.value} hint={c.hint} tone={c.gold ? 'gold' : 'teal'} onClick={c.to ? () => nav(c.to!) : undefined} />)}
          </div>
          <div className="grid lg:grid-cols-3 gap-4">
            <ChartCard className="lg:col-span-2" title="Tren transaksi" subtitle={data.trend.granularity === 'month' ? 'Jumlah transaksi per bulan' : 'Jumlah transaksi per hari'} empty={!data.trend.points.some((p: any) => p.transaksi > 0)}>
              <div style={{ height: 260 }}>
                <ResponsiveContainer>
                  <AreaChart data={data.trend.points} margin={{ left: -10, right: 8, top: 8 }}>
                    <defs><linearGradient id="gT" x1="0" y1="0" x2="0" y2="1"><stop offset="0%" stopColor={TEAL} stopOpacity={0.35} /><stop offset="100%" stopColor={TEAL} stopOpacity={0.02} /></linearGradient></defs>
                    <CartesianGrid stroke="#E5E7EB" vertical={false} />
                    <XAxis dataKey="key" tick={{ fontSize: 11, fill: '#5B6670' }} tickFormatter={(v) => (data.trend.granularity === 'month' ? `${v.slice(5, 7)}/${v.slice(0, 4)}` : `${v.slice(8, 10)}/${v.slice(5, 7)}`)} minTickGap={24} />
                    <YAxis allowDecimals={false} tick={{ fontSize: 11, fill: '#5B6670' }} />
                    <Tooltip labelFormatter={(v) => (data.trend.granularity === 'month' ? v : fmtDate(String(v)))} formatter={(v: any, n: any) => (n === 'transaksi' ? [`${num(v)} transaksi`, 'Transaksi'] : [rp(v), 'Nilai'])} />
                    <Area type="monotone" dataKey="transaksi" stroke={TEAL} strokeWidth={2.5} fill="url(#gT)" />
                  </AreaChart>
                </ResponsiveContainer>
              </div>
            </ChartCard>
            <ChartCard title="Nasabah Baru vs Existing" subtitle="Record nasabah aktif" empty={k.nasabahBaru + k.nasabahExisting === 0}>
              <div style={{ height: 190 }} className="relative">
                <ResponsiveContainer>
                  <PieChart>
                    <Pie data={data.baruExisting} dataKey="value" nameKey="name" innerRadius={58} outerRadius={82} paddingAngle={2} stroke="none">
                      <Cell fill={TEAL} /><Cell fill={GOLD} />
                    </Pie>
                    <Tooltip formatter={(v: any, n: any) => [`${num(v)} nasabah`, n]} />
                  </PieChart>
                </ResponsiveContainer>
                <div className="absolute inset-0 flex flex-col items-center justify-center pointer-events-none"><span className="text-2xl font-bold text-teal-dark kpi-value">{num(k.nasabahBaru + k.nasabahExisting)}</span><span className="text-xs text-ink-soft">nasabah</span></div>
              </div>
              <ul className="flex justify-center gap-5 text-sm mt-1">
                <li className="flex items-center gap-2"><span className="h-3 w-3 rounded-sm" style={{ background: TEAL }} />Baru <strong className="tnum">{num(k.nasabahBaru)}</strong></li>
                <li className="flex items-center gap-2"><span className="h-3 w-3 rounded-sm" style={{ background: GOLD }} />Existing <strong className="tnum">{num(k.nasabahExisting)}</strong></li>
              </ul>
            </ChartCard>
          </div>

          <div className="grid lg:grid-cols-2 gap-4">
            <ChartCard title="Komposisi per kategori" subtitle="Berat dalam kilogram (kg)" empty={!data.kategori.some((c: any) => c.kg > 0)}>
              <BarsH data={data.kategori.filter((c: any) => c.kg > 0).map((c: any) => ({ name: c.kategori, value: c.kg, color: c.warna }))} unit="kg" />
              {k.totalUnit > 0 && <p className="text-xs text-ink-soft mt-2">Item berstatus unit ({num(k.totalUnit)} unit) dihitung terpisah dan tidak termasuk grafik ini.</p>}
            </ChartCard>
            {role === 'admin_lokasi' ? (
              <ChartCard title="Top 5 nasabah" subtitle="Berdasarkan nilai setoran" empty={!data.top.rows.length}>
                <TopList rows={data.top.rows} />
              </ChartCard>
            ) : (
              <ChartCard title="Berat sampah per lokasi" subtitle="Kilogram (kg)" empty={!data.beratPerLokasi.some((l: any) => l.berat > 0)}>
                <BarsH data={data.beratPerLokasi.map((l: any) => ({ name: l.nama, value: l.berat, color: TEAL }))} unit="kg" />
              </ChartCard>
            )}
          </div>

          <Card className="p-4">
            <h3 className="font-bold mb-3">Alur program</h3>
            <ol className="grid grid-cols-2 lg:grid-cols-4 gap-3">
              {data.flow.map((s: any, i: number) => (
                <li key={s.label} className="relative rounded-ctl bg-teal-tint p-3">
                  <span className="text-xs font-bold text-teal-dark">Langkah {i + 1}</span>
                  <p className="font-bold">{s.label}</p>
                  <p className="kpi-value text-xl font-bold text-teal-dark">{s.unit === 'rupiah' ? rp(s.value) : `${num(s.value)} ${s.unit}`}</p>
                  {i < 3 && <ArrowRight size={18} className="hidden lg:block absolute -right-3.5 top-1/2 -translate-y-1/2 text-teal z-10 bg-white rounded-full" aria-hidden />}
                </li>
              ))}
            </ol>
          </Card>

          {role !== 'admin_lokasi' && (
            <ChartCard title="Top 5 lokasi" subtitle="Berdasarkan nilai ekonomi" empty={!data.top.rows.length}>
              <TopList rows={data.top.rows} />
            </ChartCard>
          )}
        </div>
      )}
    </Loadable>
  );
}

function BarsH({ data, unit }: { data: { name: string; value: number; color: string }[]; unit: string }) {
  return (
    <div style={{ height: Math.max(180, data.length * 42) }}>
      <ResponsiveContainer>
        <BarChart data={data} layout="vertical" margin={{ left: 8, right: 70, top: 4, bottom: 4 }}>
          <XAxis type="number" hide />
          <YAxis type="category" dataKey="name" width={130} tick={{ fontSize: 12, fill: '#1F2933' }} tickLine={false} axisLine={false} />
          <Tooltip formatter={(v: any) => [`${num(v)} ${unit}`, 'Berat']} cursor={{ fill: '#F7FAFA' }} />
          <Bar dataKey="value" radius={[0, 6, 6, 0]} barSize={20}>
            {data.map((d) => <Cell key={d.name} fill={d.color} />)}
            <LabelList dataKey="value" position="right" formatter={(v: any) => `${num(v)} ${unit}`} style={{ fontSize: 12, fill: '#1F2933' }} />
          </Bar>
        </BarChart>
      </ResponsiveContainer>
    </div>
  );
}
function TopList({ rows }: { rows: { nama: string; nilai: number; transaksi: number }[] }) {
  const max = Math.max(...rows.map((r) => r.nilai), 1);
  return (
    <ol className="space-y-3">
      {rows.map((r, i) => (
        <li key={r.nama} className="flex items-center gap-3">
          <span className="h-7 w-7 rounded-full bg-teal-tint text-teal-dark text-sm font-bold flex items-center justify-center shrink-0">{i + 1}</span>
          <div className="min-w-0 flex-1">
            <div className="flex justify-between gap-2 text-sm"><span className="font-bold truncate">{r.nama}</span><span className="kpi-value">{rp(r.nilai)}</span></div>
            <div className="h-2 rounded-full bg-[#EEF1F3] mt-1"><div className="h-2 rounded-full" style={{ width: `${(r.nilai / max) * 100}%`, background: TEAL }} /></div>
            <span className="text-xs text-ink-soft">{num(r.transaksi)} transaksi</span>
          </div>
        </li>
      ))}
    </ol>
  );
}

/* ------------------------------ Performa lokasi ------------------------------ */
function Performa({ params }: { params: string }) {
  const { data, loading, error, reload } = useApi<any>(`/dashboard/performa${params}`);
  const cols: Col<any>[] = [
    { key: 'nama', header: 'Lokasi', mobile: 'title', render: (r) => (<span>{r.nama}{r.transaksi === 0 && <><br /><span className="text-xs text-ink-soft font-normal">Belum ada transaksi</span></>}</span>) },
    { key: 'transaksi', header: 'Transaksi', align: 'right', render: (r) => num(r.transaksi) },
    { key: 'nasabah', header: 'Nasabah', align: 'right', render: (r) => num(r.nasabah) },
    { key: 'baru', header: 'Baru', align: 'right', render: (r) => num(r.baru) },
    { key: 'existing', header: 'Existing', align: 'right', render: (r) => num(r.existing) },
    { key: 'berat', header: 'Berat', align: 'right', render: (r) => <>{kg(r.berat)}{r.unit > 0 && <span className="block text-xs text-ink-soft">+ {num(r.unit)} unit</span>}</> },
    { key: 'nilai', header: 'Nilai', align: 'right', render: (r) => rp(r.nilai) },
    { key: 'eligible', header: 'Eligible', align: 'right', render: (r) => num(r.eligible) },
    { key: 'te', header: 'Tabungan Emas', align: 'right', render: (r) => rp(r.tabunganEmas) },
    { key: 'target', header: 'Target bulanan', render: (r) => (r.targetKg ? (<div className="min-w-[120px]"><div className="text-xs mb-1 tnum">{kg(r.kgBulanIni)} / {kg(r.targetKg)}</div><Progress value={r.kgBulanIni / r.targetKg} tone="teal" /></div>) : <span className="text-ink-soft text-xs">Belum diatur</span>) },
  ];
  const t = data?.total;
  return (
    <Card className="p-4">
      <Loadable loading={loading} error={error} reload={reload} hasData={!!data} empty={!data?.rows.length} emptyNode={<EmptyState title="Belum ada lokasi" text="Tambahkan lokasi di menu Pengaturan." />}>
        {data && (
          <>
            <DataTable cols={cols} rows={data.rows} rowKey={(r) => r.id} />
            <div className="mt-3 rounded-ctl bg-teal-tint p-3 text-sm grid grid-cols-2 md:grid-cols-6 gap-2 font-bold text-teal-dark" aria-label="Total seluruh lokasi">
              <span>TOTAL</span><span>{num(t.transaksi)} transaksi</span><span>{num(t.nasabah)} nasabah</span><span>{kg(t.berat)}</span><span>{rp(t.nilai)}</span><span>{num(t.eligible)} eligible • {rp(t.tabunganEmas)}</span>
            </div>
          </>
        )}
      </Loadable>
    </Card>
  );
}

/* ------------------------------ Sampah & nilai ------------------------------ */
function Sampah({ params }: { params: string }) {
  const { data, loading, error, reload } = useApi<any>(`/dashboard/sampah${params}`);
  const cols: Col<any>[] = [
    { key: 'nama', header: 'Jenis', mobile: 'title', render: (r) => <span className="flex items-center gap-2"><span className="h-3 w-3 rounded-sm shrink-0" style={{ background: r.warna }} />{r.nama}</span> },
    { key: 'kategori', header: 'Kategori', render: (r) => <Badge tone="slate">{r.kategori}</Badge> },
    { key: 'qty', header: 'Jumlah', align: 'right', render: (r) => `${num(r.qty)} ${r.unit}` },
    { key: 'nilai', header: 'Nilai', align: 'right', render: (r) => rp(r.nilai) },
    { key: 'persen', header: '% Nilai', align: 'right', render: (r) => pct(r.persen) },
    { key: 'trx', header: 'Transaksi', align: 'right', render: (r) => num(r.transaksi) },
    { key: 'lokasi', header: 'Lokasi teratas', render: (r) => r.lokasiTeratas },
  ];
  return (
    <div className="space-y-4">
      <Loadable loading={loading} error={error} reload={reload} hasData={!!data} empty={!data?.rows.length} emptyNode={<Card><EmptyState title="Belum ada data" text="Tidak ada setoran sampah pada filter ini." /></Card>}>
        {data && (
          <>
            <ChartCard title="Komposisi per kategori" subtitle="Berat dalam kilogram (kg)" empty={!data.kategori.some((c: any) => c.kg > 0)}>
              <BarsH data={data.kategori.filter((c: any) => c.kg > 0).map((c: any) => ({ name: c.kategori, value: c.kg, color: c.warna }))} unit="kg" />
            </ChartCard>
            <Card className="p-4">
              <h3 className="font-bold mb-1">Rincian per jenis sampah</h3>
              <p className="text-xs text-ink-soft mb-3">Kolom Transaksi menghitung transaksi berbeda, bukan jumlah baris item. Satuan kg dan unit tidak dijumlahkan.</p>
              <DataTable cols={cols} rows={data.rows} rowKey={(r) => r.id} />
              <p className="text-sm font-bold text-teal-dark mt-3">Total nilai: {rp(data.total)}</p>
            </Card>
          </>
        )}
      </Loadable>
    </div>
  );
}
