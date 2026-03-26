import { BrowserRouter, Routes, Route, Navigate } from 'react-router-dom';
import { Toaster } from 'react-hot-toast';
import { AgentActivityProvider } from './context/AgentActivityContext';
import { ClientProvider } from './context/ClientContext';
import { LandingPage } from './components/landing/LandingPage';
import { Dashboard } from './components/dashboard/Dashboard';
import { R2RModule } from './components/r2r/R2RModule';
import R2RPatternAnalysisPage from './pages/R2RPatternAnalysisPage';
import { TBVariancePage } from './pages/TBVariancePage';
import { BankReconciliationPage } from './pages/BankReconciliationPage';
import { CloseTrackerPage } from './pages/CloseTrackerPage';
import { NovaAssistant } from './components/nova/NovaAssistant';
import { CFODashboard } from './pages/CFODashboard';
import { IFRSStatementGenerator } from './pages/IFRSStatementGenerator';
import { FPASuite } from './pages/fpa/FPASuite';
import { VarianceAnalysis } from './pages/fpa/VarianceAnalysis';
import { VarianceAnalysisPage } from './pages/fpa/VarianceAnalysisPage';
import BudgetManagement from './pages/fpa/BudgetManagement';
import KPIDashboard from './pages/fpa/KPIDashboard';
import ForecastingEngine from './pages/fpa/ForecastingEngine';
import ScenarioPlanning from './pages/fpa/ScenarioPlanning';
import { ScenarioEngine } from './pages/fpa/ScenarioEngine';
import ManagementReporting from './pages/fpa/ManagementReporting';
import CFOServices from './pages/cfo/CFOServices.tsx';
import CFODecisionIntelligence from './pages/CFODecisionIntelligence';

function App() {
  return (
    <AgentActivityProvider>
      <ClientProvider>
      <BrowserRouter
        future={{
          v7_startTransition: true,
          v7_relativeSplatPath: true,
        }}
      >
        <Routes>
          {/* Landing Page - First page users see */}
          <Route path="/" element={<LandingPage />} />
          
          {/* Auth routes disabled for hackathon - redirect to dashboard */}
          <Route path="/login" element={<Navigate to="/dashboard" replace />} />
          <Route path="/register" element={<Navigate to="/dashboard" replace />} />
          
          {/* Main Dashboard - Module cards after "Launch Dashboard" */}
          <Route path="/dashboard" element={<Dashboard />} />
          <Route path="/cfo-dashboard" element={<CFODashboard />} />
          <Route path="/ifrs-generator" element={<IFRSStatementGenerator />} />
          <Route path="/r2r" element={<R2RModule />} />
          <Route path="/r2r-pattern" element={<R2RPatternAnalysisPage />} />
          <Route path="/tb-variance" element={<TBVariancePage />} />
          <Route path="/bank-recon" element={<BankReconciliationPage />} />
          <Route path="/close-tracker" element={<CloseTrackerPage />} />
          <Route path="/nova" element={<NovaAssistant />} />
          
          {/* FP&A Suite Routes */}
          <Route path="/fpa" element={<FPASuite />} />
          <Route path="/fpa/variance" element={<VarianceAnalysis />} />
          <Route path="/dashboard/fpa/variance-analysis" element={<VarianceAnalysisPage />} />
          <Route path="/fpa/variance-analysis" element={<VarianceAnalysisPage />} />
          <Route path="/fpa/budget" element={<BudgetManagement />} />
          <Route path="/fpa/kpi" element={<KPIDashboard />} />
          <Route path="/fpa/forecast" element={<ForecastingEngine />} />
          <Route path="/fpa/scenario" element={<ScenarioEngine />} />
          <Route path="/fpa/scenarios" element={<ScenarioEngine />} />
          <Route path="/fpa/reports" element={<ManagementReporting />} />
          
          {/* CFO Services Routes */}
          <Route path="/cfo" element={<CFOServices />} />
          <Route path="/cfo/assistant" element={<CFOServices defaultTab="assistant" />} />
          <Route path="/cfo/insights" element={<CFOServices defaultTab="insights" />} />
          <Route path="/cfo/monitor" element={<CFOServices defaultTab="monitor" />} />
          <Route path="/cfo/health" element={<CFOServices defaultTab="health" />} />
          
          {/* CFO Decision Intelligence */}
          <Route path="/cfo-decision" element={<CFODecisionIntelligence />} />
        </Routes>
      </BrowserRouter>
      <Toaster position="top-right" />
      </ClientProvider>
    </AgentActivityProvider>
  );
}

export default App;
