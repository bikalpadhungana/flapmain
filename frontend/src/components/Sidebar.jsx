import React from 'react';
import { Link, useLocation, useNavigate } from 'react-router-dom';
import {
  LayoutDashboard, Database, Key, Bell, LogOut, Terminal,
  Server, Activity, Link2, Settings
} from 'lucide-react';

const NAV_SECTIONS = [
  {
    label: 'Monitoring',
    items: [
      { name: 'Fleet Overview', path: '/', icon: LayoutDashboard },
      { name: 'System Monitor', path: '/system-monitor', icon: Server },
      { name: 'Scale Monitor', path: '/scale-monitor', icon: Activity },
    ],
  },
  {
    label: 'IoT Management',
    items: [
      { name: 'Sensor Fusion', path: '/fusion', icon: Link2 },
      { name: 'Hardware & Devices', path: '/devices', icon: Database },
    ],
  },
  {
    label: 'Configuration',
    items: [
      { name: 'API Integrations', path: '/api-keys', icon: Key },
      { name: 'Alert Settings', path: '/alerts', icon: Bell },
    ],
  },
  {
    label: 'System',
    items: [
      { name: 'Activity Logs', path: '/logs', icon: Terminal },
    ],
  },
];

function Sidebar() {
  const location = useLocation();
  const navigate = useNavigate();

  const handleLogout = () => {
    localStorage.removeItem('token');
    localStorage.removeItem('user');
    navigate('/login');
  };

  return (
    <aside className="sidebar-container">
      {/* Logo */}
      <div className="sidebar-header">
        <img src="/flapmainlogo.png" alt="FlapMain Logo" style={{ height: '32px', width: 'auto', objectFit: 'contain' }} />
        <div>
          <h2 style={{ fontSize: '1.125rem', fontWeight: '700', margin: 0, color: 'var(--text-main)', letterSpacing: '-0.02em' }}>
            FlapMain
          </h2>
          <span className="text-xs text-muted" style={{ fontWeight: 500 }}>IoT Platform</span>
        </div>
      </div>

      {/* Nav sections */}
      <nav style={{ display: 'flex', flexDirection: 'column', width: '100%', gap: 'var(--space-2)', flex: 1, overflowY: 'auto' }}>
        {NAV_SECTIONS.map((section) => (
          <div key={section.label} style={{ marginBottom: 6 }}>
            <div style={{
              fontSize: '0.62rem', fontWeight: 800, letterSpacing: '0.1em',
              textTransform: 'uppercase', color: 'var(--text-muted)',
              padding: '8px 10px 4px',
              opacity: 0.7,
            }}>
              {section.label}
            </div>
            {section.items.map((item) => {
              const Icon = item.icon;
              const isActive = location.pathname === item.path;
              return (
                <Link
                  key={item.path}
                  to={item.path}
                  className={`nav-link ${isActive ? 'active' : ''}`}
                >
                  <Icon className="nav-icon" size={17} />
                  <span className="nav-text">{item.name}</span>
                </Link>
              );
            })}
          </div>
        ))}
      </nav>

      {/* Logout */}
      <div className="sidebar-logout">
        <button
          onClick={handleLogout}
          className="btn btn-secondary w-full justify-center text-dim"
        >
          <LogOut size={16} />
          <span>Log Out</span>
        </button>
      </div>
    </aside>
  );
}

export default Sidebar;
