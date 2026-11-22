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
const Inventory = L(() => import('./features/inventory/inventory-page'), 'InventoryPage');
const Purchasing = L(() => import('./features/purchasing/purchasing-page'), 'PurchasingPage');
const PurchaseRequest = L(() => import('./features/purchasing/pr-detail-page'), 'PurchaseRequestPage');
const PurchaseOrder = L(() => import('./features/purchasing/po-detail-page'), 'PurchaseOrderPage');
const Sales = L(() => import('./features/sales/sales-page'), 'SalesPage');
const SalesInvoice = L(() => import('./features/sales/invoice-detail-page'), 'SalesInvoicePage');
const Maintenance = L(() => import('./features/maintenance/maintenance-page'), 'MaintenancePage');
const Payroll = L(() => import('./features/payroll/payroll-page'), 'PayrollPage');
const PayrollPeriod = L(() => import('./features/payroll/period-detail-page'), 'PayrollPeriodPage');
const Accounting = L(() => import('./features/accounting/accounting-page'), 'AccountingPage');
const VendorBill = L(() => import('./features/accounting/vendor-bill-page'), 'VendorBillPage');
const BankRec = L(() => import('./features/accounting/bank-rec-page'), 'BankRecPage');
const Journal = L(() => import('./features/accounting/journal-detail-page'), 'JournalPage');
const Asset = L(() => import('./features/accounting/asset-page'), 'AssetPage');
const Payslip = L(() => import('./features/payroll/payslip-page'), 'PayslipPage');
const MaintenanceOrder = L(() => import('./features/maintenance/order-detail-page'), 'MaintenanceOrderPage');
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
  if (me.mustEnable2fa && loc.pathname !== '/account') return <Navigate to="/account" replace />;
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
          { path: 'inventory', element: <P perm={['inventory.view']}><Inventory /></P> },
          { path: 'purchasing', element: <P perm={['purchase.view']}><Purchasing /></P> },
          { path: 'purchasing/requests/:id', element: <P perm={['purchase.view']}><PurchaseRequest /></P> },
          { path: 'purchasing/orders/:id', element: <P perm={['purchase.view']}><PurchaseOrder /></P> },
          { path: 'sales', element: <P perm={['sales.view']}><Sales /></P> },
          { path: 'sales/invoices/:id', element: <P perm={['sales.view']}><SalesInvoice /></P> },
          { path: 'payroll', element: <P perm={['payroll.view']}><Payroll /></P> },
          { path: 'payroll/periods/:id', element: <P perm={['payroll.view']}><PayrollPeriod /></P> },
          { path: 'payroll/periods/:id/slips/:recordId', element: <P perm={['payroll.view']}><Payslip /></P> },
          { path: 'accounting', element: <P perm={['finance.view']}><Accounting /></P> },
          { path: 'accounting/journals/:id', element: <P perm={['finance.view']}><Journal /></P> },
          { path: 'accounting/bills/:id', element: <P perm={['finance.view']}><VendorBill /></P> },
          { path: 'accounting/assets/:id', element: <P perm={['finance.view']}><Asset /></P> },
          { path: 'accounting/bank-recs/:id', element: <P perm={['finance.view']}><BankRec /></P> },
          { path: 'maintenance', element: <P perm={['maintenance.view']}><Maintenance /></P> },
          { path: 'maintenance/orders/:id', element: <P perm={['maintenance.view']}><MaintenanceOrder /></P> },
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
