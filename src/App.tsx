import type { ReactElement } from 'react';
import { Navigate, Route, Routes } from 'react-router-dom';
import { useAuth } from './lib/auth';
import Layout, { Denied, NAV } from './components/Layout';
import { Skeleton } from './components/ui';
import Login from './pages/Login';
import ChangePassword from './pages/ChangePassword';
import Dashboard from './pages/Dashboard';
import Transactions from './pages/Transactions';
import Customers from './pages/Customers';
import Conversions from './pages/Conversions';
import Catalog from './pages/Catalog';
import Reports from './pages/Reports';
import Settings from './pages/Settings';

const PAGES: Record<string, ReactElement> = {
  '/': <Dashboard />, '/transaksi': <Transactions />, '/nasabah': <Customers />, '/konversi': <Conversions />,
  '/katalog': <Catalog />, '/laporan': <Reports />, '/pengaturan': <Settings />,
};

export default function App() {
  const { user, ready, meta } = useAuth();
  if (!ready) return <div className="p-10 max-w-md mx-auto space-y-3" aria-busy="true"><Skeleton className="h-10" /><Skeleton className="h-40" /></div>;
  if (!user) return <Login />;
  if (user.must_change_password) return <ChangePassword />;
  if (!meta) return <div className="p-10 max-w-md mx-auto space-y-3" aria-busy="true"><Skeleton className="h-10" /><Skeleton className="h-40" /></div>;
  const allowed = new Set(NAV[user.role].map((n) => n.to));
  return (
    <Layout>
      <Routes>
        {Object.entries(PAGES).map(([path, el]) => <Route key={path} path={path} element={allowed.has(path) ? el : <Denied />} />)}
        <Route path="/login" element={<Navigate to="/" replace />} />
        <Route path="*" element={<Denied />} />
      </Routes>
    </Layout>
  );
}
