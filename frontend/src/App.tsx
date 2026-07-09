import { lazy, Suspense, type ComponentType } from 'react';
import { BrowserRouter, Routes, Route, Navigate, Outlet, useLocation, useNavigate } from 'react-router-dom';
import { Toaster } from 'react-hot-toast';
import { Toaster as ShadcnToaster } from './components/ui/toaster';
import { ErrorBoundary } from './ErrorBoundary';
import { AgentActivityProvider } from './context/AgentActivityContext';
import { ClientProvider } from './context/ClientContext';
import { WorkspaceProvider } from './context/WorkspaceContext';
import { CompanyProvider } from './context/CompanyContext';
import { SuiteProvider } from './context/SuiteContext';
import { MarketProvider } from './contexts/MarketContext';
import { MarketToggle } from './components/MarketToggle';
import { WorkspaceSelector } from './components/WorkspaceSelector';
import { CompanySelector } from './components/CompanySelector';
import PrivateRoute from './components/PrivateRoute';
import WorkspaceGuard from './components/WorkspaceGuard';
import RoleRoute from './components/RoleRoute';
import { useAuth } from './context/AuthContext';
import { canAccessPath, homePathForRole } from './config/productRole';
import Sidebar from './components/layout/Sidebar';
import { SuiteSidebar } from './components/SuiteSidebar';
import { useAutoSuiteSwitcher } from './hooks/useAutoSuiteSwitcher';
import { LandingPage } from './components/landing/LandingPage';

const PUBLIC_PATHS = new Set(['/', '/login', '/register', '/forgot-password', '/reset-password', '/get-demo']);

/** Cross-app navigation banner — links filtered by product role */
function GnanovaBanner() {
  const { pathname } = useLocation();
  const navigate = useNavigate();
  const { productRole, user, isAuthenticated, logout } = useAuth();
  const showWorkspaceControls = !PUBLIC_PATHS.has(pathname);

  const showAp = !isAuthenticated || canAccessPath(productRole, '/ap-invoices', user?.role);
  const showGulfTax = !isAuthenticated || canAccessPath(productRole, '/gulftax', user?.role);

  const handleLogout = async () => {
    try {
      await logout();
    } finally {
      navigate('/login', { replace: true });
    }
  };

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
      {showWorkspaceControls && (
        <div style={{ display: 'flex', alignItems: 'center', gap: 12 }}>
          <MarketToggle compact />
          <CompanySelector />
        </div>
      )}
      <div style={{ display: 'flex', alignItems: 'center', gap: 16 }}>
        {showWorkspaceControls && <WorkspaceSelector />}
      {showAp && (
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
        📄 AP Invoices →
      </a>
      )}
      {showGulfTax && (
      <a
        href="/gulftax"
        style={{
          color: '#fcd34d',
          textDecoration: 'none',
          fontWeight: 500,
          display: 'flex',
          alignItems: 'center',
          gap: 4,
        }}
        onMouseEnter={(e) => { (e.currentTarget as HTMLAnchorElement).style.color = '#fde68a'; }}
        onMouseLeave={(e) => { (e.currentTarget as HTMLAnchorElement).style.color = '#fcd34d'; }}
      >
        🇦🇪 GulfTax →
      </a>
      )}
      {isAuthenticated && (
        <button
          type="button"
          onClick={() => void handleLogout()}
          style={{
            background: 'rgba(255,255,255,0.08)',
            border: '1px solid rgba(255,255,255,0.2)',
            borderRadius: 6,
            padding: '4px 10px',
            color: '#fca5a5',
            fontSize: 12,
            fontWeight: 500,
            cursor: 'pointer',
          }}
          onMouseEnter={(e) => {
            e.currentTarget.style.background = 'rgba(248,113,113,0.15)';
            e.currentTarget.style.color = '#fecaca';
          }}
          onMouseLeave={(e) => {
            e.currentTarget.style.background = 'rgba(255,255,255,0.08)';
            e.currentTarget.style.color = '#fca5a5';
          }}
        >
          Log out
        </button>
      )}
      </div>
    </div>
  );
}

/** Legacy InvoiceFlow paths → current AP routes */
function LegacyInvoicesRedirect() {
  const { search } = useLocation();
  return <Navigate to={`/ap-invoices/list${search}`} replace />;
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

/** AP InvoiceFlow pages use named exports — map them to default for React.lazy. */
function namedLazy<T extends ComponentType<object>>(
  loader: () => Promise<Record<string, unknown>>,
  exportName: string,
) {
  return safeLazy(() =>
    loader().then((mod) => {
      const Comp = (mod[exportName] ?? mod.default) as T | undefined;
      if (!Comp || typeof Comp !== 'function') {
        throw new Error(`Route module missing export "${exportName}"`);
      }
      return { default: Comp };
    }),
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
const ForgotPassword = safeLazy(() => import('./pages/ForgotPassword'));
const ResetPassword = safeLazy(() => import('./pages/ResetPassword'));
const Unauthorized = safeLazy(() => import('./pages/Unauthorized'));
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
const CompanyOnboarding = safeLazy(() =>
  import('./pages/ifrs/CompanyOnboarding').then((m) => ({ default: m.CompanyOnboarding }))
);
const AgenticGenerator = safeLazy(() => import('./pages/ifrs/AgenticGenerator'));
const IFRS16Layout = safeLazy(() => import('./components/ifrs16/IFRS16Layout'));
const IFRS16Leases = safeLazy(() => import('./pages/ifrs16/IFRS16Leases'));
const LeaseRepository = safeLazy(() => import('./pages/ifrs16/LeaseRepository'));
const IBRTool = safeLazy(() => import('./pages/ifrs16/IBRTool'));
const CPIRemeasure = safeLazy(() => import('./pages/ifrs16/CPIRemeasure'));
const IFRS16Audit = safeLazy(() => import('./pages/ifrs16/IFRS16Audit'));
const IFRS15ComingSoon = safeLazy(() => import('./pages/ifrs/IFRS15ComingSoon'));
const IFRS9ComingSoon = safeLazy(() => import('./pages/ifrs/IFRS9ComingSoon'));
const ContractPortfolio = safeLazy(() => import('./pages/ifrs15/ContractPortfolio'));
const IFRS9Dashboard = safeLazy(() => import('./pages/ifrs9/IFRS9Dashboard'));
const ECLCalculator = safeLazy(() => import('./pages/ifrs9/ECLCalculator'));
const AssetStaging = safeLazy(() => import('./pages/ifrs9/AssetStaging'));
const ECLHistory = safeLazy(() => import('./pages/ifrs9/ECLHistory'));
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
const ARCollections = safeLazy(() => import('./pages/cfo/ARCollectionsLive'));
const O2CDashboard = safeLazy(() => import('./pages/o2c/O2CDashboard'));
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
const CompanySetupWizard       = safeLazy(() => import('./pages/company-setup/CompanySetupWizard'));
const ConsolidationPage        = safeLazy(() => import('./pages/consolidation/ConsolidationPage'));
const UAEChartOfAccounts     = safeLazy(() => import('./pages/uae-accounting/ChartOfAccounts'));
const UAEJournalEntries      = safeLazy(() => import('./pages/uae-accounting/JournalEntries'));
const UAESalesInvoices       = safeLazy(() => import('./pages/uae-accounting/SalesInvoices'));
const ARInvoices             = safeLazy(() => import('./pages/uae-full/ARInvoices'));
const ARCustomerRisk         = safeLazy(() => import('./pages/uae-full/ARCustomerRisk'));
const ARDunning              = safeLazy(() => import('./pages/uae-full/ARDunning'));
const ARRecurringInvoices    = safeLazy(() => import('./pages/uae-full/ARRecurringInvoices'));
const CRMLayout              = safeLazy(() => import('./pages/crm/CRMLayout'));
const CRMDashboard           = safeLazy(() => import('./pages/crm/CRMDashboard'));
const CRMContacts            = safeLazy(() => import('./pages/crm/CRMContacts'));
const CRMDeals               = safeLazy(() => import('./pages/crm/CRMDeals'));
const CRMQuotes              = safeLazy(() => import('./pages/crm/CRMQuotes'));
const CRMActivities          = safeLazy(() => import('./pages/crm/CRMActivities'));
const UAEBankReconciliation  = safeLazy(() => import('./pages/uae-accounting/BankReconciliation'));
const UAEFixedAssets         = safeLazy(() => import('./pages/uae-accounting/FixedAssets'));
const UAEAccruals            = safeLazy(() => import('./pages/uae-accounting/Accruals'));
const UAEPeriodEndClose      = safeLazy(() => import('./pages/uae-accounting/PeriodEndClose'));
const UAEManagementAccounts  = safeLazy(() => import('./pages/uae-accounting/ManagementAccounts'));
const AccountClassification    = safeLazy(() => import('./pages/uae-full/AccountClassification'));
const CITReturn                = safeLazy(() => import('./pages/uae-full/CITReturn'));
const UAEFinanceSuiteDashboard = safeLazy(() => import('./pages/uae-suite/UAEFinanceSuiteDashboard'));
const UAESuiteSelector         = safeLazy(() => import('./pages/uae-suite/UAESuiteSelector'));

// â”€â”€ AP InvoiceFlow (embedded) â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€
const APInvoicesLayout  = safeLazy(() => import('./pages/ap-invoices/APInvoicesLayout'));
const APDashboard       = namedLazy(() => import('./pages/ap-invoices/Dashboard'), 'Dashboard');
const APInvoiceList     = namedLazy(() => import('./pages/ap-invoices/InvoiceList'), 'InvoiceList');
const APInvoiceUpload   = namedLazy(() => import('./pages/ap-invoices/InvoiceUpload'), 'InvoiceUpload');
const APApprovals       = namedLazy(() => import('./pages/ap-invoices/MyApprovals'), 'MyApprovals');
const APVendors         = namedLazy(() => import('./pages/ap-invoices/Vendors'), 'Vendors');
const APPurchaseOrders  = namedLazy(() => import('./pages/ap-invoices/PurchaseOrders'), 'PurchaseOrders');
const APGoodsReceipts   = namedLazy(() => import('./pages/ap-invoices/GoodsReceipts'), 'GoodsReceipts');
const APActionQueue     = namedLazy(() => import('./pages/ap-invoices/ActionQueue'), 'ActionQueue');
const APAgingReport     = safeLazy(() => import('./pages/ap-invoices/ApAging'));
const APBankRecon       = namedLazy(() => import('./pages/ap-invoices/BankRecon'), 'BankRecon');
const APGSTRecon        = namedLazy(() => import('./pages/ap-invoices/GstRecon'), 'GstRecon');
const APCalendar        = namedLazy(() => import('./pages/ap-invoices/PaymentCalendar'), 'PaymentCalendar');
const APGLAccounts      = namedLazy(() => import('./pages/ap-invoices/GLAccounts'), 'GLAccounts');
const APIntegrations    = safeLazy(() => import('./pages/ap-invoices/APIntegrations'));
const APSettings        = namedLazy(() => import('./pages/ap-invoices/Settings'), 'Settings');
// New pages from AP Invoice app
const APCFODashboard    = safeLazy(() => import('./pages/ap-invoices/CFODashboard'));
const APAuditLog        = namedLazy(() => import('./pages/ap-invoices/AuditLog'), 'AuditLog');
const APEmailInvoices   = namedLazy(() => import('./pages/ap-invoices/EmailInvoices'), 'EmailInvoices');
const APMonthEndClose   = namedLazy(() => import('./pages/ap-invoices/MonthEndChecklist'), 'MonthEndChecklist');
const APAnomalyIntel    = namedLazy(() => import('./pages/ap-invoices/AnomalyIntelligence'), 'AnomalyIntelligence');
const APPaymentLog      = namedLazy(() => import('./pages/ap-invoices/PaymentLog'), 'PaymentLog');
const APVendorPortal    = namedLazy(() => import('./pages/ap-invoices/VendorUploadPortal'), 'VendorUploadPortal');
const APCompanyConfig   = namedLazy(() => import('./pages/ap-invoices/CompanyConfig'), 'CompanyConfig');
const APTrainingData    = namedLazy(() => import('./pages/ap-invoices/TrainingData'), 'TrainingData');
const APBankGuarantees  = namedLazy(() => import('./pages/ap-invoices/BankGuarantees'), 'BankGuarantees');
const APVendorRisk      = namedLazy(() => import('./pages/ap-invoices/VendorRisk'), 'VendorRisk');
const APAuditTrail      = namedLazy(() => import('./pages/ap-invoices/AuditTrailExport'), 'AuditTrailExport');
const APChat            = namedLazy(() => import('./pages/ap-invoices/APChat'), 'APChat');
const APAdminClients    = namedLazy(() => import('./pages/ap-invoices/AdminClients'), 'AdminClients');
const APApprovalCallback = namedLazy(() => import('./pages/ap-invoices/ApprovalCallback'), 'ApprovalCallback');
const APOnboarding      = namedLazy(() => import('./pages/ap-invoices/Onboarding'), 'Onboarding');

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

// GulfTax AI (embedded from uaetax)
const GulfTaxLayout       = safeLazy(() => import('./pages/gulftax/GulfTaxLayout'));
const GulfTaxDashboard    = safeLazy(() => import('./pages/gulftax/GulfTaxDashboard'));
const GulfTaxVATClassifier = safeLazy(() => import('./pages/gulftax/VATClassifier'));
const GulfTaxVATReturn    = safeLazy(() => import('./pages/gulftax/VATReturn'));
const GulfTaxReconciliation = safeLazy(() => import('./pages/gulftax/Reconciliation'));
const GulfTaxEInvoicing  = safeLazy(() => import('./pages/gulftax/EInvoicing'));
const GulfTaxCorporateTax = safeLazy(() => import('./pages/gulftax/CorporateTax'));
const GulfTaxESRFiling    = safeLazy(() => import('./pages/gulftax/ESRFiling'));
const GulfTaxTransferPricing = safeLazy(() => import('./pages/gulftax/TransferPricing'));
const GulfTaxCbCR         = safeLazy(() => import('./pages/gulftax/CbCR'));
const GulfTaxSettings     = safeLazy(() => import('./pages/gulftax/GulfTaxSettings'));
const GulfTaxTaxMemo      = safeLazy(() => import('./pages/gulftax/TaxMemo'));
const GulfTaxFTAReports   = safeLazy(() => import('./pages/gulftax/FTAReports'));
const GulfTaxSuppliers    = safeLazy(() => import('./pages/gulftax/Suppliers'));
const GulfTaxInvoiceFlow  = safeLazy(() => import('./pages/gulftax/InvoiceFlow'));
const GulfTaxInvoiceFlowReview = safeLazy(() => import('./pages/gulftax/InvoiceFlowReview'));
const GulfTaxPartialExemption = safeLazy(() => import('./pages/gulftax/PartialExemption'));
const GulfTaxDesignatedZones = safeLazy(() => import('./pages/gulftax/DesignatedZones'));
const GulfTaxBadDebtRelief = safeLazy(() => import('./pages/gulftax/BadDebtRelief'));
const GulfTaxAuditExports = safeLazy(() => import('./pages/gulftax/AuditExports'));

// Workspaces
const WorkspaceList       = safeLazy(() => import('./pages/workspaces/WorkspaceList'));
const WorkspaceCreate     = safeLazy(() => import('./pages/workspaces/WorkspaceCreate'));
const WorkspaceDashboard  = safeLazy(() => import('./pages/workspaces/WorkspaceDashboard'));
const WorkspaceSettings   = safeLazy(() => import('./pages/workspaces/WorkspaceSettings'));
const WorkspaceUsers      = safeLazy(() => import('./pages/workspaces/WorkspaceUsers'));

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

function RootRedirect() {
  const { isAuthenticated, accessToken, bootstrapping, productRole, user } = useAuth();

  if (bootstrapping) {
    return (
      <div className="min-h-screen bg-slate-950 flex items-center justify-center">
        <p className="text-slate-400 text-sm">Loading session…</p>
      </div>
    );
  }

  if (!isAuthenticated || !accessToken) {
    return <LandingPage />;
  }

  return <Navigate to={homePathForRole(productRole, user?.role)} replace />;
}

function App() {
  return (
    <AgentActivityProvider>
      <ClientProvider>
        <WorkspaceProvider>
          <CompanyProvider>
            <MarketProvider>
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
              <Route path="/" element={<RootRedirect />} />
              <Route path="/get-demo" element={<GetDemoPage />} />
              <Route path="/login" element={<Login />} />
              <Route path="/register" element={<Register />} />
              <Route path="/forgot-password" element={<ForgotPassword />} />
              <Route path="/reset-password" element={<ResetPassword />} />
              <Route element={<PrivateRoute />}>
                <Route element={<WorkspaceGuard />}>
                <Route element={<RoleRoute />}>
                <Route path="/unauthorized" element={<Unauthorized />} />
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
                  <Route path="/r2r/rev-rec/contracts" element={<ContractPortfolio />} />
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
                <Route path="/users" element={<UserManagement />} />
                <Route path="/workspaces" element={<WorkspaceList />} />
                <Route path="/workspaces/create" element={<WorkspaceCreate />} />
                <Route path="/workspaces/:id/dashboard" element={<WorkspaceDashboard />} />
                <Route path="/workspaces/:id/settings" element={<WorkspaceSettings />} />
                <Route path="/workspaces/:id/users" element={<WorkspaceUsers />} />
                <Route path="/bookkeeping" element={<BookkeepingLayout />}>
                  <Route index element={<Navigate to="/bookkeeping/upload" replace />} />
                  <Route path="upload" element={<BookkeepingUploadPage />} />
                  <Route path="review" element={<BookkeepingReviewPage />} />
                  <Route path="anomalies" element={<BookkeepingAnomaliesPage />} />
                  <Route path="missing-receipts" element={<BookkeepingMissingReceiptsPage />} />
                  <Route path="reconciliation" element={<BookkeepingReconPage />} />
                  <Route path="monthly" element={<BookkeepingMonthlyPage />} />
                </Route>
                {/* GulfTax AI — own sidebar, workspace-scoped */}
                <Route element={<AutoSwitchOnly />}>
                  <Route path="/gulftax" element={<ErrorBoundary><GulfTaxLayout /></ErrorBoundary>}>
                    <Route index element={<GulfTaxDashboard />} />
                    <Route path="vat-classifier" element={<GulfTaxVATClassifier />} />
                    <Route path="vat-return" element={<GulfTaxVATReturn />} />
                    <Route path="reconciliation" element={<GulfTaxReconciliation />} />
                    <Route path="partial-exemption" element={<GulfTaxPartialExemption />} />
                    <Route path="designated-zones" element={<GulfTaxDesignatedZones />} />
                    <Route path="bad-debt-relief" element={<GulfTaxBadDebtRelief />} />
                    <Route path="e-invoicing" element={<GulfTaxEInvoicing />} />
                    <Route path="corporate-tax" element={<GulfTaxCorporateTax />} />
                    <Route path="corporate-tax/return" element={<CITReturn />} />
                    <Route path="esr-filing" element={<GulfTaxESRFiling />} />
                    <Route path="transfer-pricing" element={<GulfTaxTransferPricing />} />
                    <Route path="cbcr" element={<GulfTaxCbCR />} />
                    <Route path="invoice-flow" element={<GulfTaxInvoiceFlow />} />
                    <Route path="invoice-flow/review" element={<GulfTaxInvoiceFlowReview />} />
                    <Route path="tax-memo" element={<GulfTaxTaxMemo />} />
                    <Route path="fta-reports" element={<GulfTaxFTAReports />} />
                    <Route path="audit-exports" element={<GulfTaxAuditExports />} />
                    <Route path="suppliers" element={<GulfTaxSuppliers />} />
                    <Route path="settings" element={<GulfTaxSettings />} />
                  </Route>
                </Route>
                {/* AP InvoiceFlow — own sidebar, auto-switch suite only */}
              <Route element={<AutoSwitchOnly />}>
                <Route path="/ap-invoices" element={<ErrorBoundary><APInvoicesLayout /></ErrorBoundary>}>
                  <Route index               element={<ErrorBoundary><APDashboard /></ErrorBoundary>} />
                  <Route path="action-queue" element={<ErrorBoundary><APActionQueue /></ErrorBoundary>} />
                  <Route path="list"         element={<ErrorBoundary><APInvoiceList /></ErrorBoundary>} />
                  <Route path="upload"       element={<ErrorBoundary><APInvoiceUpload /></ErrorBoundary>} />
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
                  <Route path="bank-guarantees" element={<APBankGuarantees />} />
                  <Route path="vendor-risk"    element={<APVendorRisk />} />
                  <Route path="audit-trail"    element={<APAuditTrail />} />
                  <Route path="chat"           element={<APChat />} />
                  <Route path="admin/clients"  element={<APAdminClients />} />
                  <Route path="onboarding"     element={<APOnboarding />} />
                </Route>
              <Route path="/ap-invoices/approve" element={<ErrorBoundary><APApprovalCallback /></ErrorBoundary>} />
              </Route>

              {/* â”€â”€ Suite Shell â€” UAE / India / FP&A / CFO / CA Firm â”€â”€ */}
              <Route element={<SuiteShell />}>
                {/* CA Firm Tools */}
                <Route path="/ca-firm" element={<Navigate to="/ca-firm/bank-processor" replace />} />
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
                <Route path="/company-setup" element={<CompanySetupWizard />} />
                <Route path="/uae-select" element={<UAESuiteSelector />} />
                <Route path="/uae-suite" element={<UAEFinanceSuiteDashboard />} />
                <Route path="/consolidation" element={<ConsolidationPage />} />
                <Route path="/uae-full"                                    element={<UAEAccountingOverview />} />
                <Route path="/uae-full/coa"                                element={<UAEChartOfAccounts />} />
                <Route path="/uae-full/journals"                           element={<UAEJournalEntries />} />
                <Route path="/uae-full/invoices"                           element={<UAESalesInvoices />} />
                <Route path="/uae-full/ar"                                 element={<ARInvoices />} />
                <Route path="/uae-full/ar/customer-risk"                 element={<ARCustomerRisk />} />
                <Route path="/uae-full/ar/dunning"                       element={<ARDunning />} />
                <Route path="/uae-full/ar/recurring"                     element={<ARRecurringInvoices />} />
                <Route path="/o2c"                                         element={<O2CDashboard />} />
                <Route path="/crm" element={<CRMLayout />}>
                  <Route index element={<CRMDashboard />} />
                  <Route path="contacts" element={<CRMContacts />} />
                  <Route path="deals" element={<CRMDeals />} />
                  <Route path="quotes" element={<CRMQuotes />} />
                  <Route path="activities" element={<CRMActivities />} />
                </Route>
                <Route path="/uae-full/bank-recon"                        element={<UAEBankReconciliation />} />
                <Route path="/uae-full/fixed-assets"                      element={<UAEFixedAssets />} />
                <Route path="/uae-full/accruals"                          element={<UAEAccruals />} />
                <Route path="/uae-full/period-close"                      element={<UAEPeriodEndClose />} />
                <Route path="/uae-full/management"                        element={<UAEManagementAccounts />} />
                <Route path="/uae-full/classify-accounts"                 element={<AccountClassification />} />
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
                <Route path="/ifrs-statement/onboarding" element={<CompanyOnboarding />} />
                <Route path="/ifrs/agentic"            element={<AgenticGenerator />} />
                {/* IFRS Suite */}
                <Route path="/ifrs/16" element={<IFRS16Layout />}>
                  <Route index element={<IFRS16Leases />} />
                  <Route path="leases" element={<LeaseRepository />} />
                  <Route path="ibr-tool" element={<IBRTool />} />
                  <Route path="remeasure" element={<CPIRemeasure />} />
                  <Route path="audit" element={<IFRS16Audit />} />
                </Route>
                <Route path="/ifrs/15" element={<IFRS15ComingSoon />} />
                <Route path="/ifrs/9" element={<IFRS9ComingSoon />} />
                {/* Legacy IFRS 16 paths → redirect */}
                <Route path="/ifrs16" element={<Navigate to="/ifrs/16" replace />} />
                <Route path="/ifrs16/leases" element={<Navigate to="/ifrs/16/leases" replace />} />
                <Route path="/ifrs16/ibr-tool" element={<Navigate to="/ifrs/16/ibr-tool" replace />} />
                <Route path="/ifrs16/remeasure" element={<Navigate to="/ifrs/16/remeasure" replace />} />
                <Route path="/ifrs16/audit" element={<Navigate to="/ifrs/16/audit" replace />} />
                <Route path="/ifrs9"                  element={<IFRS9Dashboard />} />
                <Route path="/ifrs9/calculator"       element={<ECLCalculator />} />
                <Route path="/ifrs9/staging"          element={<AssetStaging />} />
                <Route path="/ifrs9/history"           element={<ECLHistory />} />
                <Route path="/erp/tally"               element={<TallyIntegrationPage />} />
                {/* Accounting Pipeline */}
                <Route path="/accounting/close-status" element={<CloseStatusPage />} />
                <Route path="/india/accounting/close-status" element={<IndiaCloseStatus />} />
              </Route>
                </Route>
                </Route>
              </Route>

              <Route path="/invoices" element={<LegacyInvoicesRedirect />} />
              <Route path="/invoices/*" element={<LegacyInvoicesRedirect />} />
              <Route path="/onboarding" element={<Navigate to="/workspaces/create" replace />} />
              <Route path="*" element={<Navigate to="/" replace />} />
            </Routes>
          </Suspense>
        </BrowserRouter>
            </SuiteProvider>
            </MarketProvider>
          </CompanyProvider>
        </WorkspaceProvider>
        <Toaster position="top-right" />
        <ShadcnToaster />
      </ClientProvider>
    </AgentActivityProvider>
  );
}

export default App;

