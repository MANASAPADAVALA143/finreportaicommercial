import { jsx as _jsx, jsxs as _jsxs } from "react/jsx-runtime";
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
import { ScenarioEngine } from './pages/fpa/ScenarioEngine';
import ManagementReporting from './pages/fpa/ManagementReporting';
import CFOServices from './pages/cfo/CFOServices.tsx';
import CFODecisionIntelligence from './pages/CFODecisionIntelligence';
function App() {
    return (_jsx(AgentActivityProvider, { children: _jsxs(ClientProvider, { children: [_jsx(BrowserRouter, { future: {
                        v7_startTransition: true,
                        v7_relativeSplatPath: true,
                    }, children: _jsxs(Routes, { children: [_jsx(Route, { path: "/", element: _jsx(LandingPage, {}) }), _jsx(Route, { path: "/login", element: _jsx(Navigate, { to: "/dashboard", replace: true }) }), _jsx(Route, { path: "/register", element: _jsx(Navigate, { to: "/dashboard", replace: true }) }), _jsx(Route, { path: "/dashboard", element: _jsx(Dashboard, {}) }), _jsx(Route, { path: "/cfo-dashboard", element: _jsx(CFODashboard, {}) }), _jsx(Route, { path: "/ifrs-generator", element: _jsx(IFRSStatementGenerator, {}) }), _jsx(Route, { path: "/r2r", element: _jsx(R2RModule, {}) }), _jsx(Route, { path: "/r2r-pattern", element: _jsx(R2RPatternAnalysisPage, {}) }), _jsx(Route, { path: "/tb-variance", element: _jsx(TBVariancePage, {}) }), _jsx(Route, { path: "/bank-recon", element: _jsx(BankReconciliationPage, {}) }), _jsx(Route, { path: "/close-tracker", element: _jsx(CloseTrackerPage, {}) }), _jsx(Route, { path: "/nova", element: _jsx(NovaAssistant, {}) }), _jsx(Route, { path: "/fpa", element: _jsx(FPASuite, {}) }), _jsx(Route, { path: "/fpa/variance", element: _jsx(VarianceAnalysis, {}) }), _jsx(Route, { path: "/dashboard/fpa/variance-analysis", element: _jsx(VarianceAnalysisPage, {}) }), _jsx(Route, { path: "/fpa/variance-analysis", element: _jsx(VarianceAnalysisPage, {}) }), _jsx(Route, { path: "/fpa/budget", element: _jsx(BudgetManagement, {}) }), _jsx(Route, { path: "/fpa/kpi", element: _jsx(KPIDashboard, {}) }), _jsx(Route, { path: "/fpa/forecast", element: _jsx(ForecastingEngine, {}) }), _jsx(Route, { path: "/fpa/scenario", element: _jsx(ScenarioEngine, {}) }), _jsx(Route, { path: "/fpa/scenarios", element: _jsx(ScenarioEngine, {}) }), _jsx(Route, { path: "/fpa/reports", element: _jsx(ManagementReporting, {}) }), _jsx(Route, { path: "/cfo", element: _jsx(CFOServices, {}) }), _jsx(Route, { path: "/cfo/assistant", element: _jsx(CFOServices, { defaultTab: "assistant" }) }), _jsx(Route, { path: "/cfo/insights", element: _jsx(CFOServices, { defaultTab: "insights" }) }), _jsx(Route, { path: "/cfo/monitor", element: _jsx(CFOServices, { defaultTab: "monitor" }) }), _jsx(Route, { path: "/cfo/health", element: _jsx(CFOServices, { defaultTab: "health" }) }), _jsx(Route, { path: "/cfo-decision", element: _jsx(CFODecisionIntelligence, {}) })] }) }), _jsx(Toaster, { position: "top-right" })] }) }));
}
export default App;
