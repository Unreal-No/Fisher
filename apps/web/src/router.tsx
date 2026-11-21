import { lazy, Suspense, type ReactNode } from 'react';
import { createBrowserRouter, Navigate, Outlet, useLocation } from 'react-router';
import type { Permission } from '@fisher/shared';
import { AppLayout } from './components/layout/app-layout';
import { Empty, Spinner } from './components/ui/states';
import { useAuth } from './lib/auth';
import { LoginPage } from './features/auth/login-page';

const L = <T,>(load: () => Promise<T>, name: keyof T) =>
  lazy(() => load().then((m) => ({ default: m[name] as unknown as React.ComponentType })));

const Dashboard = L(() => import('./features/dashboard/dashboard-page'), 'DashboardPage');
const VesselList = L(() => import('./features/vessels/vessel-list-page'), 'VesselListPage');
const VesselDetail = L(() => import('./features/vessels/vessel-detail-page'), 'VesselDetailPage');
const VesselForm = L(() => import('./features/vessels/vessel-form-page'), 'VesselFormPage');
const EmployeeList = L(() => import('./features/employees/employee-list-page'), 'EmployeeListPage');
const EmployeeDetail = L(() => import('./features/employees/employee-detail-page'), 'EmployeeDetailPage');
const EmployeeForm = L(() => import('./features/employees/employee-form-page'), 'EmployeeFormPage');
const DocumentsReport = L(() => import('./features/employees/documents-report-page'), 'DocumentsReportPage');
const TripList = L(() => import('./features/trips/trip-list-page'), 'TripListPage');
const TripDetail = L(() => import('./features/trips/trip-detail-page'), 'TripDetailPage');
const Gps = L(() => import('./features/gps/gps-page'), 'GpsPage');
const Fuel = L(() => import('./features/fuel/fuel-page'), 'FuelPage');
const Catch = L(() => import('./features/catch/catch-page'), 'CatchPage');
const Species = L(() => import('./features/catch/species-page'), 'SpeciesPage');
const Notifications = L(() => import('./features/notifications/notifications-page'), 'NotificationsPage');
const Users = L(() => import('./features/admin/users-page'), 'UsersPage');
const Roles = L(() => import('./features/admin/roles-page'), 'RolesPage');
const Audit = L(() => import('./features/admin/audit-page'), 'AuditPage');
const Settings = L(() => import('./features/admin/settings-page'), 'SettingsPage');
const Account = L(() => import('./features/auth/account-page'), 'AccountPage');

function RequireAuth() {
  const { me, loading } = useAuth();
  const loc = useLocation();
  if (loading) return <Spinner />;
  if (!me) return <Navigate to="/login" replace state={{ from: loc.pathname + loc.search }} />;
  if (me.mustChangePassword && loc.pathname !== '/account') return <Navigate to="/account" replace />;
  return <Outlet />;
}

/** Route-level permission guard (server enforces again). */
function P({ perm, children }: { perm?: Permission[]; children: ReactNode }) {
  const { can } = useAuth();
  if (perm && !can(...perm)) return <Empty title="ไม่มีสิทธิ์เข้าถึงหน้านี้">ติดต่อผู้ดูแลระบบหากต้องการสิทธิ์เพิ่มเติม</Empty>;
  return <Suspense fallback={<Spinner />}>{children}</Suspense>;
}

function Home() {
  const { can } = useAuth();
  if (can('dashboard.view')) return <P><Dashboard /></P>;
  return <Navigate to={can('trip.view') ? '/trips' : '/notifications'} replace />;
}

export const router = createBrowserRouter([
  { path: '/login', element: <LoginPage /> },
  {
    element: <RequireAuth />,
    children: [
      {
        element: <AppLayout />,
        children: [
          { index: true, element: <Home /> },
          { path: 'vessels', element: <P perm={['vessel.view']}><VesselList /></P> },
          { path: 'vessels/new', element: <P perm={['vessel.create']}><VesselForm /></P> },
          { path: 'vessels/:id', element: <P perm={['vessel.view']}><VesselDetail /></P> },
          { path: 'vessels/:id/edit', element: <P perm={['vessel.edit']}><VesselForm /></P> },
          { path: 'employees', element: <P perm={['employee.view']}><EmployeeList /></P> },
          { path: 'employees/new', element: <P perm={['employee.create']}><EmployeeForm /></P> },
          { path: 'employees/:id', element: <P perm={['employee.view']}><EmployeeDetail /></P> },
          { path: 'employees/:id/edit', element: <P perm={['employee.edit']}><EmployeeForm /></P> },
          { path: 'documents', element: <P perm={['employee.view']}><DocumentsReport /></P> },
          { path: 'trips', element: <P perm={['trip.view']}><TripList /></P> },
          { path: 'trips/:id', element: <P perm={['trip.view']}><TripDetail /></P> },
          { path: 'gps', element: <P perm={['gps.view']}><Gps /></P> },
          { path: 'fuel', element: <P perm={['fuel.view']}><Fuel /></P> },
          { path: 'catch', element: <P perm={['catch.view']}><Catch /></P> },
          { path: 'species', element: <P perm={['catch.view']}><Species /></P> },
          { path: 'notifications', element: <P><Notifications /></P> },
          { path: 'account', element: <P><Account /></P> },
          { path: 'admin/users', element: <P perm={['user.manage']}><Users /></P> },
          { path: 'admin/roles', element: <P perm={['role.manage']}><Roles /></P> },
          { path: 'admin/audit', element: <P perm={['audit.view']}><Audit /></P> },
          { path: 'admin/settings', element: <P perm={['settings.manage']}><Settings /></P> },
          { path: '*', element: <Empty title="ไม่พบหน้าที่ต้องการ" /> },
        ],
      },
    ],
  },
]);
