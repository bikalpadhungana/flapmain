import React from 'react';
import { BrowserRouter as Router, Routes, Route, Navigate } from 'react-router-dom';
import Sidebar from './components/Sidebar';
import Login from './pages/Login';
import Dashboard from './pages/Dashboard';
import DeviceDetail from './pages/DeviceDetail';
import SchemaRegistry from './pages/SchemaRegistry';
import ApiKeys from './pages/ApiKeys';
import AlertRules from './pages/AlertRules';
import './App.css';

// Guard wrapper
const ProtectedRoute = ({ children }) => {
  const token = localStorage.getItem('token');
  if (!token) {
    return <Navigate to="/login" replace />;
  }
  return children;
};

// Main Layout Wrapper
const DashboardLayout = ({ children }) => {
  return (
    <div style={{ display: 'flex', gap: '30px', padding: '24px', minHeight: '100vh', background: 'var(--bg-primary)' }}>
      <Sidebar />
      <main style={{ flex: 1, minWidth: 0 }}>
        {children}
      </main>
    </div>
  );
};

function App() {
  return (
    <Router>
      <Routes>
        <Route path="/login" element={<Login />} />
        
        {/* Protected Dashboard Routes */}
        <Route
          path="/"
          element={
            <ProtectedRoute>
              <DashboardLayout>
                <Dashboard />
              </DashboardLayout>
            </ProtectedRoute>
          }
        />
        <Route
          path="/device/:device_id"
          element={
            <ProtectedRoute>
              <DashboardLayout>
                <DeviceDetail />
              </DashboardLayout>
            </ProtectedRoute>
          }
        />
        <Route
          path="/registry"
          element={
            <ProtectedRoute>
              <DashboardLayout>
                <SchemaRegistry />
              </DashboardLayout>
            </ProtectedRoute>
          }
        />
        <Route
          path="/api-keys"
          element={
            <ProtectedRoute>
              <DashboardLayout>
                <ApiKeys />
              </DashboardLayout>
            </ProtectedRoute>
          }
        />
        <Route
          path="/alerts"
          element={
            <ProtectedRoute>
              <DashboardLayout>
                <AlertRules />
              </DashboardLayout>
            </ProtectedRoute>
          }
        />

        {/* Fallback */}
        <Route path="*" element={<Navigate to="/" replace />} />
      </Routes>
    </Router>
  );
}

export default App;
