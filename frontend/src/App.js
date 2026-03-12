import { jsx as _jsx, jsxs as _jsxs } from "react/jsx-runtime";
import { BrowserRouter, Routes, Route, Navigate } from 'react-router-dom';
import { Toaster } from 'react-hot-toast';
import { AgentActivityProvider } from './context/AgentActivityContext';
import { LandingPage } from './components/landing/LandingPage';
import { Dashboard } from './components/dashboard/Dashboard';
import { R2RModule } from './components/r2r/R2RModule';
import R2RPatternAnalysisPage from './pages/R2RPatternAnalysisPage';
import { NovaAssistant } from './components/nova/NovaAssistant';
import { CFODashboard } from './pages/CFODashboard';
import { UploadData } from './pages/UploadData';
import { IFRSStatementGenerator } from './pages/IFRSStatementGenerator';
import { FPASuite } from './pages/fpa/FPASuite';
import { VarianceAnalysis } from './pages/fpa/VarianceAnalysis';
import BudgetManagement from './pages/fpa/BudgetManagement';
import KPIDashboard from './pages/fpa/KPIDashboard';
import ForecastingEngine from './pages/fpa/ForecastingEngine';
import { ScenarioEngine } from './pages/fpa/ScenarioEngine';
import ManagementReporting from './pages/fpa/ManagementReporting';
import CFOServices from './pages/cfo/CFOServices';
import CFODecisionIntelligence from './pages/CFODecisionIntelligence';
function App() {
    return (_jsxs(AgentActivityProvider, { children: [_jsx(BrowserRouter, { children: _jsxs(Routes, { children: [_jsx(Route, { path: "/", element: _jsx(LandingPage, {}) }), _jsx(Route, { path: "/login", element: _jsx(Navigate, { to: "/dashboard", replace: true }) }), _jsx(Route, { path: "/register", element: _jsx(Navigate, { to: "/dashboard", replace: true }) }), _jsx(Route, { path: "/dashboard", element: _jsx(Dashboard, {}) }), _jsx(Route, { path: "/cfo-dashboard", element: _jsx(CFODashboard, {}) }), _jsx(Route, { path: "/upload-data", element: _jsx(UploadData, {}) }), _jsx(Route, { path: "/ifrs-generator", element: _jsx(IFRSStatementGenerator, {}) }), _jsx(Route, { path: "/r2r", element: _jsx(R2RModule, {}) }), _jsx(Route, { path: "/r2r-pattern", element: _jsx(R2RPatternAnalysisPage, {}) }), _jsx(Route, { path: "/nova", element: _jsx(NovaAssistant, {}) }), _jsx(Route, { path: "/fpa", element: _jsx(FPASuite, {}) }), _jsx(Route, { path: "/fpa/variance", element: _jsx(VarianceAnalysis, {}) }), _jsx(Route, { path: "/fpa/budget", element: _jsx(BudgetManagement, {}) }), _jsx(Route, { path: "/fpa/kpi", element: _jsx(KPIDashboard, {}) }), _jsx(Route, { path: "/fpa/forecast", element: _jsx(ForecastingEngine, {}) }), _jsx(Route, { path: "/fpa/scenario", element: _jsx(ScenarioEngine, {}) }), _jsx(Route, { path: "/fpa/scenarios", element: _jsx(ScenarioEngine, {}) }), _jsx(Route, { path: "/fpa/reports", element: _jsx(ManagementReporting, {}) }), _jsx(Route, { path: "/cfo", element: _jsx(CFOServices, {}) }), _jsx(Route, { path: "/cfo/assistant", element: _jsx(CFOServices, { defaultTab: "assistant" }) }), _jsx(Route, { path: "/cfo/insights", element: _jsx(CFOServices, { defaultTab: "insights" }) }), _jsx(Route, { path: "/cfo/monitor", element: _jsx(CFOServices, { defaultTab: "monitor" }) }), _jsx(Route, { path: "/cfo/health", element: _jsx(CFOServices, { defaultTab: "health" }) }), _jsx(Route, { path: "/cfo-decision", element: _jsx(CFODecisionIntelligence, {}) })] }) }), _jsx(Toaster, { position: "top-right" })] }));
}
export default App;
