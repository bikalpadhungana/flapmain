import React from 'react';
import { BrowserRouter as Router, Routes, Route, Navigate } from 'react-router-dom';
import Sidebar from './components/Sidebar';
import Login from './pages/Login';
import Dashboard from './pages/Dashboard';
import DeviceDetail from './pages/DeviceDetail';
import SystemLogs from './pages/SystemLogs';
import Devices from './pages/Devices';
import ApiKeys from './pages/ApiKeys';
import AlertRules from './pages/AlertRules';
import SystemMonitor from './pages/SystemMonitor';
import ScaleMonitor from './pages/ScaleMonitor';
import SensorFusion from './pages/SensorFusion';
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
    <div className="app-layout">
      <Sidebar />
      <main className="main-content">
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
          path="/logs"
          element={
            <ProtectedRoute>
              <DashboardLayout>
                <SystemLogs />
              </DashboardLayout>
            </ProtectedRoute>
          }
        />
        <Route
          path="/devices"

          element={
            <ProtectedRoute>
              <DashboardLayout>
                <Devices />
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
        <Route
          path="/system-monitor"
          element={
            <ProtectedRoute>
              <DashboardLayout>
                <SystemMonitor />
              </DashboardLayout>
            </ProtectedRoute>
          }
        />
        <Route
          path="/scale-monitor"
          element={
            <ProtectedRoute>
              <DashboardLayout>
                <ScaleMonitor />
              </DashboardLayout>
            </ProtectedRoute>
          }
        />
        <Route
          path="/fusion"
          element={
            <ProtectedRoute>
              <DashboardLayout>
                <SensorFusion />
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
