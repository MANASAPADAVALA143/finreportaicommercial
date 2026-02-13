import React from 'react';
import { BrowserRouter, Routes, Route, Navigate } from 'react-router-dom';
import { Toaster } from 'react-hot-toast';
import { LandingPage } from './components/landing/LandingPage';
import { Dashboard } from './components/dashboard/Dashboard';
import { R2RModule } from './components/r2r/R2RModule';
import { NovaAssistant } from './components/nova/NovaAssistant';
import { Login } from './pages/Login';
import { Register } from './pages/Register';
import { useAuthStore } from './services/auth';
import { useEffect } from 'react';

const ProtectedRoute: React.FC<{ children: React.ReactNode }> = ({ children }) => {
  const { isAuthenticated, isLoading } = useAuthStore();

  if (isLoading) {
    return (
      <div className="flex items-center justify-center min-h-screen">
        <div className="animate-spin rounded-full h-12 w-12 border-b-2 border-blue-600"></div>
      </div>
    );
  }

  return isAuthenticated ? <>{children}</> : <Navigate to="/login" />;
};

function App() {
  const { checkAuth } = useAuthStore();

  useEffect(() => {
    // DEMO MODE - Auto-login with demo credentials
    const token = localStorage.getItem('access_token');
    if (!token) {
      // Set demo token for testing
      localStorage.setItem('access_token', 'demo-token-' + Date.now());
      localStorage.setItem('demo_user', JSON.stringify({
        id: 'demo-user',
        email: 'demo@finreportai.com',
        full_name: 'Demo User',
        company: 'FinReport AI',
        role: 'admin'
      }));
    }
    checkAuth();
  }, []); // Empty dependency array - only run once on mount

  return (
    <>
      <BrowserRouter>
        <Routes>
          <Route path="/" element={<LandingPage />} />
          <Route path="/login" element={<Login />} />
          <Route path="/register" element={<Register />} />
          
          {/* DEMO MODE - No authentication required */}
          <Route path="/dashboard" element={<Dashboard />} />
          <Route path="/r2r" element={<R2RModule />} />
          <Route path="/nova" element={<NovaAssistant />} />
        </Routes>
      </BrowserRouter>
      <Toaster position="top-right" />
    </>
  );
}

export default App;
