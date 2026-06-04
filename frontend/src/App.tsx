import { lazy, Suspense, type ComponentType } from 'react';
import { BrowserRouter, Routes, Route, Navigate, Outlet } from 'react-router-dom';
import { Toaster } from 'react-hot-toast';
import { AgentActivityProvider } from './context/AgentActivityContext';
import { ClientProvider } from './context/ClientContext';
import { AuthProvider } from './context/AuthContext';
import { SuiteProvider } from './context/SuiteContext';
import { LandingPage } from './components/landing/LandingPage';
import PrivateRoute from './components/PrivateRoute';
import Sidebar from './components/layout/Sidebar';
import { SuiteSidebar } from './components/SuiteSidebar';
import { useAutoSuiteSwitcher } from './hooks/useAutoSuiteSwitcher';

/** Cross-app navigation banner â€” links to InvoiceFlow (AP Automation) */
function GnanovaBanner() {
  return (
    <div
      style={{
        height: 36,
        background: '#0f2d5e',
        display: 'flex',
        alignItems: 'center',
        justifyContent: 'space-between',
        padding: '0 20px',
        fontFamily: 'system-ui, sans-serif',
        fontSize: 13,
        color: '#e2e8f0',
        position: 'sticky',
        top: 0,
        zIndex: 9999,
        flexShrink: 0,
      }}
    >
      <span style={{ fontWeight: 600, letterSpacing: '0.02em' }}>Gnanova Finance OS</span>
      <a
        href="/ap-invoices"
        style={{
          color: '#93c5fd',
          textDecoration: 'none',
          fontWeight: 500,
          display: 'flex',
          alignItems: 'center',
          gap: 4,
        }}
        onMouseEnter={(e) => { (e.currentTarget as HTMLAnchorElement).style.color = '#bfdbfe'; }}
        onMouseLeave={(e) => { (e.currentTarget as HTMLAnchorElement).style.color = '#93c5fd'; }}
      >
        ðŸ“„ AP Invoices â†’
      </a>
    </div>
  );
}

function chunkLoadErrorMessage(err: unknown) {
  return err instanceof Error ? err.message : String(err);
}

function ChunkLoadErrorScreen({ message }: { message: string }) {
  return (
    <div
      style={{
        minHeight: '100vh',
        padding: 24,
        background: '#0f172a',
        color: '#e2e8f0',
        fontFamily: 'system-ui, sans-serif',
      }}
    >
      <h1 style={{ fontSize: 18, marginBottom: 12 }}>This page failed to load</h1>
      <p style={{ color: '#94a3b8', marginBottom: 16, maxWidth: 560, lineHeight: 1.5 }}>
        This usually means the browser cached an old build or the dev server moved ports. Try{' '}
        <strong>Ctrl+Shift+R</strong> (hard refresh). Use the exact URL from the terminal where you ran{' '}
        <code style={{ color: '#f8fafc' }}>npm run dev</code> (this app uses port{' '}
        <code style={{ color: '#f8fafc' }}>3006</code>). Do not open <code style={{ color: '#f8fafc' }}>dist/index.html</code>{' '}
        directly.
      </p>
      <pre
        style={{
          background: '#020617',
          padding: 16,
          borderRadius: 8,
          fontSize: 12,
          color: '#fca5a5',
          whiteSpace: 'pre-wrap',
        }}
      >
        {message}
      </pre>
    </div>
  );
}

/** Lazy route imports that reject (network, stale cache) bypass React Error Boundaries; recover with a visible screen. */
function safeLazy<T extends ComponentType<object>>(loader: () => Promise<{ default: T }>) {
  return lazy(() =>
    loader().catch((err: unknown) => {
      console.error('Route chunk failed to load:', err);
      const message = chunkLoadErrorMessage(err);
      const Fallback = () => <ChunkLoadErrorScreen message={message} />;
      return { default: Fallback as unknown as T };
    })
  );
}

// Home is eager so a failed lazy chunk canâ€™t leave `/` blank (lazy rejections bypass Error Boundaries).
const Dashboard = safeLazy(() =>
  import('./components/dashboard/Dashboard').then((m) => ({ default: m.Dashboard }))
);
const R2RModule = safeLazy(() =>
  import('./components/r2r/R2RModule').then((m) => ({ default: m.R2RModule }))
);
const R2RPatternAnalysisPage = safeLazy(() => import('./pages/R2RPatternAnalysisPage'));
const JournalPageWithHistoricalTabs = safeLazy(() => import('./pages/journal'));
const RevRecReconciliationPage = safeLazy(() => import('./pages/r2r/RevRecReconciliationPage'));
const TBVariancePage = safeLazy(() =>
  import('./pages/TBVariancePage').then((m) => ({ default: m.TBVariancePage }))
);
const BankReconciliationPage = safeLazy(() =>
  import('./pages/BankReconciliationPage').then((m) => ({ default: m.BankReconciliationPage }))
);
const CloseTrackerPage = safeLazy(() =>
  import('./pages/CloseTrackerPage').then((m) => ({ default: m.CloseTrackerPage }))
);
const MonthEndClose = safeLazy(() => import('./pages/MonthEndClose'));
const EarningsReviewer = safeLazy(() => import('./pages/EarningsReviewer'));
const GLReconciler = safeLazy(() => import('./pages/GLReconciler'));
const ModelBuilder = safeLazy(() => import('./pages/ModelBuilder'));
const Login = safeLazy(() => import('./pages/Login'));
const Register = safeLazy(() => import('./pages/Register'));
const UserManagement = safeLazy(() => import('./pages/UserManagement'));
const NovaAssistant = safeLazy(() =>
  import('./components/nova/NovaAssistant').then((m) => ({ default: m.NovaAssistant }))
);
const CFODashboard = safeLazy(() =>
  import('./pages/CFODashboard').then((m) => ({ default: m.CFODashboard }))
);
const IFRSStatementGenerator = safeLazy(() =>
  import('./pages/IFRSStatementGenerator').then((m) => ({ default: m.IFRSStatementGenerator }))
);
const IFRSStatementPage = safeLazy(() => import('./pages/ifrs-statement/IFRSStatementPage'));
const AgenticGenerator = safeLazy(() => import('./pages/ifrs/AgenticGenerator'));
const TallyIntegrationPage = safeLazy(() => import('./pages/erp/TallyIntegrationPage'));
const ConnectionsPage      = safeLazy(() => import('./pages/Connections/ConnectionsPage'));
const ZohoCallback         = safeLazy(() => import('./pages/Connections/ZohoCallback'));
const FPASuite = safeLazy(() =>
  import('./pages/fpa/FPASuite').then((m) => ({ default: m.FPASuite }))
);
const ExcelSuite = safeLazy(() =>
  import('./pages/excel/ExcelSuite').then((m) => ({ default: m.ExcelSuite }))
);
const ExcelSuiteToolPage = safeLazy(() =>
  import('./pages/excel/ExcelSuiteToolPage').then((m) => ({ default: m.ExcelSuiteToolPage }))
);
const VarianceAnalysis = safeLazy(() =>
  import('./pages/fpa/VarianceAnalysis').then((m) => ({ default: m.VarianceAnalysis }))
);
const VarianceAnalysisPage = safeLazy(() =>
  import('./pages/fpa/VarianceAnalysisPage').then((m) => ({ default: m.VarianceAnalysisPage }))
);
const BudgetManagement = safeLazy(() => import('./pages/fpa/BudgetManagement'));
const KPIDashboard = safeLazy(() => import('./pages/fpa/KPIDashboard'));
const ForecastingEngine = safeLazy(() => import('./pages/fpa/ForecastingEngine'));
const ScenarioEngine = safeLazy(() =>
  import('./pages/fpa/ScenarioEngine').then((m) => ({ default: m.ScenarioEngine }))
);
const ManagementReporting = safeLazy(() => import('./pages/fpa/ManagementReporting'));
const PVMAnalysis = safeLazy(() => import('./pages/fpa/PVMAnalysis'));
const ThreeStatement = safeLazy(() => import('./pages/fpa/ThreeStatement'));
const MonteCarlo = safeLazy(() => import('./pages/fpa/MonteCarlo'));
const ARRDashboard = safeLazy(() => import('./pages/fpa/ARRDashboard'));
const HeadcountPlanning = safeLazy(() => import('./pages/fpa/HeadcountPlanning'));
const SensitivityAnalysis = safeLazy(() => import('./pages/fpa/SensitivityAnalysis'));
const BoardPack = safeLazy(() => import('./pages/reports/BoardPack'));
const CFOServices = safeLazy(() => import('./pages/cfo/CFOServices.tsx'));
const EntityHealth = safeLazy(() => import('./pages/cfo/EntityHealth'));
const PaymentCalendar = safeLazy(() => import('./pages/cfo/PaymentCalendar'));
const CovenantTracker = safeLazy(() => import('./pages/cfo/CovenantTracker'));
const ARCollections = safeLazy(() => import('./pages/cfo/ARCollectionsEnhanced'));
const CFODecisionIntelligence = safeLazy(() => import('./pages/CFODecisionIntelligence'));
const BookkeepingLayout = safeLazy(() =>
  import('./pages/bookkeeping/BookkeepingLayout').then((m) => ({ default: m.BookkeepingLayout }))
);
const BookkeepingUploadPage = safeLazy(() =>
  import('./pages/bookkeeping/BookkeepingUploadPage').then((m) => ({
    default: m.BookkeepingUploadPage,
  }))
);
const BookkeepingReviewPage = safeLazy(() =>
  import('./pages/bookkeeping/BookkeepingReviewPage').then((m) => ({
    default: m.BookkeepingReviewPage,
  }))
);
const BookkeepingAnomaliesPage = safeLazy(() =>
  import('./pages/bookkeeping/BookkeepingAnomaliesPage').then((m) => ({
    default: m.BookkeepingAnomaliesPage,
  }))
);
const BookkeepingMissingReceiptsPage = safeLazy(() =>
  import('./pages/bookkeeping/BookkeepingMissingReceiptsPage').then((m) => ({
    default: m.BookkeepingMissingReceiptsPage,
  }))
);
const BookkeepingReconPage = safeLazy(() =>
  import('./pages/bookkeeping/BookkeepingReconPage').then((m) => ({
    default: m.BookkeepingReconPage,
  }))
);
const BookkeepingMonthlyPage = safeLazy(() =>
  import('./pages/bookkeeping/BookkeepingMonthlyPage').then((m) => ({
    default: m.BookkeepingMonthlyPage,
  }))
);
const GetDemoPage = safeLazy(() => import('./pages/GetDemoPage'));
const CommandCenter = safeLazy(() => import('./pages/CommandCenter'));
const AgentStatus = safeLazy(() => import('./pages/AgentStatus'));
const AuditIntelligencePage = safeLazy(() => import('./pages/audit/AuditIntelligencePage'));
// CA Firm Tools
const BankStatementProcessor = safeLazy(() => import('./pages/ca-firm/BankStatementProcessor'));
const TBToFinancials = safeLazy(() => import('./pages/ca-firm/TBToFinancials'));
const CABankRecon = safeLazy(() => import('./pages/ca-firm/CABankRecon'));
// UAE Accounting
const UAEAccountingDashboard = safeLazy(() => import('./pages/uae-accounting/UAEAccountingDashboard'));
const UAEConnectedAccounts   = safeLazy(() => import('./pages/uae-accounting/ConnectedAccounts'));
const UAEZohoConnect         = safeLazy(() => import('./pages/uae-accounting/ZohoConnect'));
const UAEQBOConnect          = safeLazy(() => import('./pages/uae-accounting/QBOConnect'));
const UAETrialBalanceList    = safeLazy(() => import('./pages/uae-accounting/TrialBalanceList'));
const UAETrialBalanceViewer  = safeLazy(() => import('./pages/uae-accounting/TrialBalanceViewer'));
// UAE Full Accounting Suite (Phase C)
const UAEAccountingOverview  = safeLazy(() => import('./pages/uae-accounting/UAEAccountingOverview'));
const UAEChartOfAccounts     = safeLazy(() => import('./pages/uae-accounting/ChartOfAccounts'));
const UAEJournalEntries      = safeLazy(() => import('./pages/uae-accounting/JournalEntries'));
const UAESalesInvoices       = safeLazy(() => import('./pages/uae-accounting/SalesInvoices'));
const UAEBankReconciliation  = safeLazy(() => import('./pages/uae-accounting/BankReconciliation'));
const UAEFixedAssets         = safeLazy(() => import('./pages/uae-accounting/FixedAssets'));
const UAEAccruals            = safeLazy(() => import('./pages/uae-accounting/Accruals'));
const UAEPeriodEndClose      = safeLazy(() => import('./pages/uae-accounting/PeriodEndClose'));
const UAEManagementAccounts  = safeLazy(() => import('./pages/uae-accounting/ManagementAccounts'));

// â”€â”€ AP InvoiceFlow (embedded) â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€
const APInvoicesLayout  = safeLazy(() => import('./pages/ap-invoices/APInvoicesLayout'));
const APDashboard       = safeLazy(() => import('./pages/ap-invoices/Dashboard'));
const APInvoiceList     = safeLazy(() => import('./pages/ap-invoices/InvoiceList'));
const APInvoiceUpload   = safeLazy(() => import('./pages/ap-invoices/InvoiceUpload'));
const APApprovals       = safeLazy(() => import('./pages/ap-invoices/MyApprovals'));
const APVendors         = safeLazy(() => import('./pages/ap-invoices/Vendors'));
const APPurchaseOrders  = safeLazy(() => import('./pages/ap-invoices/PurchaseOrders'));
const APGoodsReceipts   = safeLazy(() => import('./pages/ap-invoices/GoodsReceipts'));
const APActionQueue     = safeLazy(() => import('./pages/ap-invoices/ActionQueue'));
const APAgingReport     = safeLazy(() => import('./pages/ap-invoices/ApAging'));
const APBankRecon       = safeLazy(() => import('./pages/ap-invoices/BankRecon'));
const APGSTRecon        = safeLazy(() => import('./pages/ap-invoices/GstRecon'));
const APCalendar        = safeLazy(() => import('./pages/ap-invoices/PaymentCalendar'));
const APGLAccounts      = safeLazy(() => import('./pages/ap-invoices/GLAccounts'));
const APIntegrations    = safeLazy(() => import('./pages/ap-invoices/APIntegrations'));
const APSettings        = safeLazy(() => import('./pages/ap-invoices/Settings'));
// New pages from AP Invoice app
const APCFODashboard    = safeLazy(() => import('./pages/ap-invoices/CFODashboard'));
const APAuditLog        = safeLazy(() => import('./pages/ap-invoices/AuditLog'));
const APEmailInvoices   = safeLazy(() => import('./pages/ap-invoices/EmailInvoices'));
const APMonthEndClose   = safeLazy(() => import('./pages/ap-invoices/MonthEndChecklist'));
const APAnomalyIntel    = safeLazy(() => import('./pages/ap-invoices/AnomalyIntelligence'));
const APPaymentLog      = safeLazy(() => import('./pages/ap-invoices/PaymentLog'));
const APVendorPortal    = safeLazy(() => import('./pages/ap-invoices/VendorUploadPortal'));
const APCompanyConfig   = safeLazy(() => import('./pages/ap-invoices/CompanyConfig'));
const APTrainingData    = safeLazy(() => import('./pages/ap-invoices/TrainingData'));

// â”€â”€ Accounting Pipeline â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€
const CloseStatusPage = safeLazy(() => import('./pages/accounting/CloseStatus'));
const IndiaCloseStatus = safeLazy(() => import('./pages/accounting/IndiaCloseStatus'));

// â”€â”€ India Accounting â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€
const IndiaAccountingOverview = safeLazy(() => import('./pages/india-accounting/IndiaAccountingOverview'));
const IndiaChartOfAccounts    = safeLazy(() => import('./pages/india-accounting/IndiaChartOfAccounts'));
const IndiaJournalEntries     = safeLazy(() => import('./pages/india-accounting/IndiaJournalEntries'));
const IndiaSalesInvoices      = safeLazy(() => import('./pages/india-accounting/IndiaSalesInvoices'));
const IndiaPurchaseInvoices   = safeLazy(() => import('./pages/india-accounting/IndiaPurchaseInvoices'));
const IndiaTDS                = safeLazy(() => import('./pages/india-accounting/IndiaTDS'));
const IndiaGSTReturns         = safeLazy(() => import('./pages/india-accounting/IndiaGSTReturns'));
const IndiaPayroll            = safeLazy(() => import('./pages/india-accounting/IndiaPayroll'));
const IndiaFixedAssets        = safeLazy(() => import('./pages/india-accounting/IndiaFixedAssets'));
const IndiaPeriodClose        = safeLazy(() => import('./pages/india-accounting/IndiaPeriodClose'));
const IndiaManagementAccounts = safeLazy(() => import('./pages/india-accounting/IndiaManagementAccounts'));

/** Matches Vite `base` (root vs GitHub Pages subpath). */
const normalizedBase = (import.meta.env.BASE_URL ?? '/').replace(/\/$/, '') || '/';
const routerBasename = normalizedBase === '/' ? undefined : normalizedBase;

function RouteFallback() {
  return (
    <div
      style={{
        minHeight: '100vh',
        background: '#0f172a',
        color: '#e2e8f0',
        display: 'flex',
        alignItems: 'center',
        justifyContent: 'center',
        fontFamily: 'system-ui, sans-serif',
        fontSize: 14,
      }}
    >
      Loadingâ€¦
    </div>
  );
}

/** Legacy R2R shell â€” keeps Sidebar for R2R-specific routes (unchanged) */
function R2rShell() {
  return (
    <div className="flex min-h-screen w-full">
      <Sidebar />
      <div className="flex-1 min-w-0">
        <Outlet />
      </div>
    </div>
  );
}

/** Suite shell â€” SuiteSidebar for UAE / India / FP&A routes */
function SuiteShell() {
  useAutoSuiteSwitcher();
  return (
    <div className="flex h-screen overflow-hidden w-full">
      <SuiteSidebar />
      <main className="flex-1 min-w-0 overflow-y-auto">
        <Outlet />
      </main>
    </div>
  );
}

/** Auto-switcher only â€” no extra layout, used inside nested layouts that have their own sidebar */
function AutoSwitchOnly() {
  useAutoSuiteSwitcher();
  return <Outlet />;
}

function App() {
  return (
    <AgentActivityProvider>
      <ClientProvider>
        <AuthProvider>
        <SuiteProvider>
        <BrowserRouter
          basename={routerBasename}
          future={{
            v7_startTransition: true,
            v7_relativeSplatPath: true,
          }}
        >
          <GnanovaBanner />
          <Suspense fallback={<RouteFallback />}>
            <Routes>
              <Route path="/" element={<LandingPage />} />
              <Route path="/get-demo" element={<GetDemoPage />} />
              <Route path="/login" element={<Login />} />
              <Route path="/register" element={<Register />} />
              <Route element={<PrivateRoute><Outlet /></PrivateRoute>}>
                <Route path="/dashboard" element={<Dashboard />} />
                <Route path="/command-center" element={<CommandCenter />} />
                <Route path="/agent-status" element={<AgentStatus />} />
                <Route path="/audit" element={<AuditIntelligencePage />} />
                {/* Non-suite pages (no SuiteSidebar) */}
                <Route path="/cfo-dashboard" element={<CFODashboard />} />
                <Route path="/ifrs-generator" element={<IFRSStatementGenerator />} />
                <Route path="/board-pack" element={<IFRSStatementPage />} />
                <Route path="/connections" element={<ConnectionsPage />} />
                <Route path="/connections/zoho/callback" element={<ZohoCallback />} />
                <Route path="/cfo-decision" element={<CFODecisionIntelligence />} />
                {/* R2R shell â€” legacy sidebar for R2R tools */}
                <Route element={<R2rShell />}>
                  <Route path="/r2r" element={<R2RModule />} />
                  <Route path="/r2r-pattern" element={<JournalPageWithHistoricalTabs />} />
                  <Route path="/r2r/pattern" element={<JournalPageWithHistoricalTabs />} />
                  <Route path="/r2r/learning" element={<R2RPatternAnalysisPage />} />
                  <Route path="/r2r/history" element={<JournalPageWithHistoricalTabs />} />
                  <Route path="/r2r/rev-rec" element={<RevRecReconciliationPage />} />
                  <Route path="/close" element={<MonthEndClose />} />
                  <Route path="/earnings" element={<EarningsReviewer />} />
                  <Route path="/recon/gl" element={<GLReconciler />} />
                  <Route path="/model" element={<ModelBuilder />} />
                </Route>
                <Route path="/bank-recon" element={<BankReconciliationPage />} />
                <Route path="/bank-recon/analytics" element={<BankReconciliationPage />} />
                <Route path="/bank-recon/workspace/:workspaceId" element={<BankReconciliationPage />} />
                <Route path="/close-tracker" element={<CloseTrackerPage />} />
                <Route path="/nova" element={<NovaAssistant />} />
                <Route path="/excel-suite" element={<ExcelSuite />} />
                <Route path="/excel-suite/:slug" element={<ExcelSuiteToolPage />} />
                <Route path="/users" element={<PrivateRoute roles={['super_admin']}><UserManagement /></PrivateRoute>} />
                <Route path="/bookkeeping" element={<BookkeepingLayout />}>
                  <Route index element={<Navigate to="/bookkeeping/upload" replace />} />
                  <Route path="upload" element={<BookkeepingUploadPage />} />
                  <Route path="review" element={<BookkeepingReviewPage />} />
                  <Route path="anomalies" element={<BookkeepingAnomaliesPage />} />
                  <Route path="missing-receipts" element={<BookkeepingMissingReceiptsPage />} />
                  <Route path="reconciliation" element={<BookkeepingReconPage />} />
                  <Route path="monthly" element={<BookkeepingMonthlyPage />} />
                </Route>
              </Route>
              {/* AP InvoiceFlow â€” has its own sidebar, auto-switch suite only */}
              <Route element={<AutoSwitchOnly />}>
                <Route path="/ap-invoices" element={<APInvoicesLayout />}>
                  <Route index               element={<APDashboard />} />
                  <Route path="action-queue" element={<APActionQueue />} />
                  <Route path="list"         element={<APInvoiceList />} />
                  <Route path="upload"       element={<APInvoiceUpload />} />
                  <Route path="approvals"    element={<APApprovals />} />
                  <Route path="po"           element={<APPurchaseOrders />} />
                  <Route path="grn"          element={<APGoodsReceipts />} />
                  <Route path="vendors"      element={<APVendors />} />
                  <Route path="aging"        element={<APAgingReport />} />
                  <Route path="bank-recon"   element={<APBankRecon />} />
                  <Route path="gst-recon"    element={<APGSTRecon />} />
                  <Route path="calendar"     element={<APCalendar />} />
                  <Route path="gl-accounts"  element={<APGLAccounts />} />
                  <Route path="integrations"   element={<APIntegrations />} />
                  <Route path="settings"       element={<APSettings />} />
                  <Route path="cfo"            element={<APCFODashboard />} />
                  <Route path="audit-log"      element={<APAuditLog />} />
                  <Route path="email-invoices" element={<APEmailInvoices />} />
                  <Route path="month-end"      element={<APMonthEndClose />} />
                  <Route path="anomaly"        element={<APAnomalyIntel />} />
                  <Route path="payment-log"    element={<APPaymentLog />} />
                  <Route path="vendor-portal"  element={<APVendorPortal />} />
                  <Route path="company-config" element={<APCompanyConfig />} />
                  <Route path="training"       element={<APTrainingData />} />
                </Route>
              </Route>

              {/* â”€â”€ Suite Shell â€” UAE / India / FP&A / CFO / CA Firm â”€â”€ */}
              <Route element={<SuiteShell />}>
                {/* CA Firm Tools */}
                <Route path="/ca-firm/bank-processor" element={<BankStatementProcessor />} />
                <Route path="/ca-firm/tb-financials"  element={<TBToFinancials />} />
                <Route path="/ca-firm/bank-recon"     element={<CABankRecon />} />
                {/* UAE Accounting (legacy) */}
                <Route path="/uae-accounting"                              element={<UAEAccountingDashboard />} />
                <Route path="/uae-accounting/accounts"                     element={<UAEConnectedAccounts />} />
                <Route path="/uae-accounting/connect/zoho"                 element={<UAEZohoConnect />} />
                <Route path="/uae-accounting/connect/qbo"                  element={<UAEQBOConnect />} />
                <Route path="/uae-accounting/trial-balances"               element={<UAETrialBalanceList />} />
                <Route path="/uae-accounting/trial-balances/:id"           element={<UAETrialBalanceViewer />} />
                {/* UAE Full Accounting Suite */}
                <Route path="/uae-full"                                    element={<UAEAccountingOverview />} />
                <Route path="/uae-full/coa"                                element={<UAEChartOfAccounts />} />
                <Route path="/uae-full/journals"                           element={<UAEJournalEntries />} />
                <Route path="/uae-full/invoices"                           element={<UAESalesInvoices />} />
                <Route path="/uae-full/bank-recon"                        element={<UAEBankReconciliation />} />
                <Route path="/uae-full/fixed-assets"                      element={<UAEFixedAssets />} />
                <Route path="/uae-full/accruals"                          element={<UAEAccruals />} />
                <Route path="/uae-full/period-close"                      element={<UAEPeriodEndClose />} />
                <Route path="/uae-full/management"                        element={<UAEManagementAccounts />} />
                {/* India Accounting */}
                <Route path="/india-full"                                 element={<IndiaAccountingOverview />} />
                <Route path="/india-full/coa"                             element={<IndiaChartOfAccounts />} />
                <Route path="/india-full/journals"                        element={<IndiaJournalEntries />} />
                <Route path="/india-full/sales"                           element={<IndiaSalesInvoices />} />
                <Route path="/india-full/purchases"                       element={<IndiaPurchaseInvoices />} />
                <Route path="/india-full/tds"                             element={<IndiaTDS />} />
                <Route path="/india-full/gst"                             element={<IndiaGSTReturns />} />
                <Route path="/india-full/payroll"                         element={<IndiaPayroll />} />
                <Route path="/india-full/assets"                          element={<IndiaFixedAssets />} />
                <Route path="/india-full/close"                           element={<IndiaPeriodClose />} />
                <Route path="/india-full/management"                      element={<IndiaManagementAccounts />} />
                {/* FP&A Suite */}
                <Route path="/fpa"                     element={<FPASuite />} />
                <Route path="/fpa/variance"            element={<VarianceAnalysis />} />
                <Route path="/fpa/variance-analysis"   element={<VarianceAnalysisPage />} />
                <Route path="/dashboard/fpa/variance-analysis" element={<VarianceAnalysisPage />} />
                <Route path="/fpa/budget"              element={<BudgetManagement />} />
                <Route path="/fpa/kpi"                 element={<KPIDashboard />} />
                <Route path="/fpa/forecast"            element={<ForecastingEngine />} />
                <Route path="/fpa/scenario"            element={<ScenarioEngine />} />
                <Route path="/fpa/scenarios"           element={<ScenarioEngine />} />
                <Route path="/fpa/reports"             element={<ManagementReporting />} />
                <Route path="/fpa/pvm"                 element={<PVMAnalysis />} />
                <Route path="/fpa/three-statement"     element={<ThreeStatement />} />
                <Route path="/fpa/monte-carlo"         element={<MonteCarlo />} />
                <Route path="/fpa/arr-dashboard"       element={<ARRDashboard />} />
                <Route path="/fpa/headcount"           element={<HeadcountPlanning />} />
                <Route path="/fpa/sensitivity"         element={<SensitivityAnalysis />} />
                {/* CFO Suite */}
                <Route path="/cfo"                     element={<CFOServices />} />
                <Route path="/cfo/assistant"           element={<CFOServices defaultTab="assistant" />} />
                <Route path="/cfo/insights"            element={<CFOServices defaultTab="insights" />} />
                <Route path="/cfo/monitor"             element={<CFOServices defaultTab="monitor" />} />
                <Route path="/cfo/health"              element={<CFOServices defaultTab="health" />} />
                <Route path="/cfo/entity-health"       element={<EntityHealth />} />
                <Route path="/cfo/payment-calendar"    element={<PaymentCalendar />} />
                <Route path="/cfo/covenant-tracker"    element={<CovenantTracker />} />
                <Route path="/cfo/ar-collections"      element={<ARCollections />} />
                {/* Reports */}
                <Route path="/reports/board-pack"      element={<BoardPack />} />
                {/* Other shared pages */}
                <Route path="/tb-variance"             element={<TBVariancePage />} />
                <Route path="/audit"                   element={<AuditIntelligencePage />} />
                <Route path="/ifrs-statement"          element={<IFRSStatementPage />} />
                <Route path="/ifrs/agentic"            element={<AgenticGenerator />} />
                <Route path="/erp/tally"               element={<TallyIntegrationPage />} />
                {/* Accounting Pipeline */}
                <Route path="/accounting/close-status" element={<CloseStatusPage />} />
                <Route path="/india/accounting/close-status" element={<IndiaCloseStatus />} />
              </Route>

              <Route path="*" element={<Navigate to="/" replace />} />
            </Routes>
          </Suspense>
        </BrowserRouter>
        </SuiteProvider>
        </AuthProvider>
        <Toaster position="top-right" />
      </ClientProvider>
    </AgentActivityProvider>
  );
}

export default App;

