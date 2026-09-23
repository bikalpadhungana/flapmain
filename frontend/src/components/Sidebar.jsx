import React, { useState, useEffect } from 'react';
import { Link, useLocation, useNavigate } from 'react-router-dom';
import {
  LayoutDashboard, Database, Key, Bell, LogOut, Terminal,
  Server, Activity, Link2, CloudSun, Camera, Menu, X, ChevronRight, AlertTriangle
} from 'lucide-react';

const NAV_SECTIONS = [
  {
    label: 'Monitoring',
    items: [
      { name: 'Fleet Overview', path: '/', icon: LayoutDashboard },
      { name: 'System Monitor', path: '/system-monitor', icon: Server },
      { name: 'Scale Monitor', path: '/scale-monitor', icon: Activity },
      { name: 'Weather Station', path: '/weather-monitor', icon: CloudSun },
      { name: 'SOS & LoRa Mesh', path: '/sos-alert', icon: AlertTriangle },
      { name: 'Camera Section', path: '/cameras', icon: Camera },
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

const MOBILE_BOTTOM_TABS = [
  { name: 'Overview', path: '/', icon: LayoutDashboard },
  { name: 'Weather', path: '/weather-monitor', icon: CloudSun },
  { name: 'Cameras', path: '/cameras', icon: Camera },
  { name: 'Devices', path: '/devices', icon: Database },
];

function Sidebar() {
  const location = useLocation();
  const navigate = useNavigate();
  const [mobileDrawerOpen, setMobileDrawerOpen] = useState(false);

  // Close mobile drawer when location changes
  useEffect(() => {
    setMobileDrawerOpen(false);
  }, [location.pathname]);

  const handleLogout = () => {
    localStorage.removeItem('token');
    localStorage.removeItem('user');
    navigate('/login');
  };

  // Get current page title for mobile header
  const getCurrentPageTitle = () => {
    for (const sec of NAV_SECTIONS) {
      const match = sec.items.find(i => i.path === location.pathname);
      if (match) return match.name;
    }
    if (location.pathname.startsWith('/device/')) return 'Device Detail';
    return 'FlapMain IoT';
  };

  return (
    <>
      {/* 1. Mobile Top Header (< 768px) */}
      <header className="mobile-header">
        <div style={{ display: 'flex', alignItems: 'center', gap: 10 }}>
          <img src="/flapmainlogo.png" alt="FlapMain Logo" style={{ height: 28, width: 'auto', objectFit: 'contain' }} />
          <div>
            <div style={{ fontSize: '0.95rem', fontWeight: 800, color: 'var(--text-main)', lineHeight: 1.1 }}>
              {getCurrentPageTitle()}
            </div>
            <span style={{ fontSize: '0.65rem', color: 'var(--text-muted)', fontWeight: 600 }}>FlapMain IoT Platform</span>
          </div>
        </div>
        <button
          onClick={() => setMobileDrawerOpen(true)}
          className="btn btn-icon btn-secondary"
          style={{ padding: 8, borderRadius: 10 }}
          aria-label="Open Navigation Menu"
        >
          <Menu size={20} color="var(--text-main)" />
        </button>
      </header>

      {/* 2. Desktop Sidebar (≥ 768px) */}
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

        {/* Desktop Nav sections */}
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

        {/* Desktop Logout */}
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

      {/* 3. Mobile Bottom Navigation Bar (< 768px) */}
      <nav className="mobile-bottom-nav">
        {MOBILE_BOTTOM_TABS.map((tab) => {
          const Icon = tab.icon;
          const isActive = location.pathname === tab.path;
          return (
            <Link
              key={tab.path}
              to={tab.path}
              className={`mobile-bottom-link ${isActive ? 'active' : ''}`}
            >
              <Icon size={18} className="mobile-bottom-icon" />
              <span>{tab.name}</span>
            </Link>
          );
        })}
        <button
          onClick={() => setMobileDrawerOpen(true)}
          className={`mobile-bottom-link ${mobileDrawerOpen ? 'active' : ''}`}
          style={{ background: 'transparent', border: 'none', cursor: 'pointer' }}
        >
          <Menu size={18} className="mobile-bottom-icon" />
          <span>More</span>
        </button>
      </nav>

      {/* 4. Mobile Slide-Over Drawer Navigation */}
      {mobileDrawerOpen && (
        <>
          <div
            className="mobile-drawer-overlay"
            onClick={() => setMobileDrawerOpen(false)}
          />
          <div className="mobile-drawer">
            {/* Drawer Header */}
            <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', paddingBottom: 16, borderBottom: '1px solid var(--border-subtle)', marginBottom: 16 }}>
              <div style={{ display: 'flex', alignItems: 'center', gap: 10 }}>
                <img src="/flapmainlogo.png" alt="FlapMain Logo" style={{ height: 28, width: 'auto' }} />
                <div>
                  <div style={{ fontWeight: 800, fontSize: '1rem', color: 'var(--text-main)' }}>FlapMain</div>
                  <span style={{ fontSize: '0.68rem', color: 'var(--text-muted)' }}>IoT Control Platform</span>
                </div>
              </div>
              <button
                onClick={() => setMobileDrawerOpen(false)}
                className="btn btn-icon btn-secondary"
                style={{ borderRadius: '50%', padding: 6 }}
              >
                <X size={18} />
              </button>
            </div>

            {/* Nav Sections inside Drawer */}
            <div style={{ flex: 1, overflowY: 'auto', display: 'flex', flexDirection: 'column', gap: 16 }}>
              {NAV_SECTIONS.map((section) => (
                <div key={section.label}>
                  <div style={{
                    fontSize: '0.65rem', fontWeight: 800, letterSpacing: '0.1em',
                    textTransform: 'uppercase', color: 'var(--text-muted)',
                    marginBottom: 6, paddingLeft: 4,
                  }}>
                    {section.label}
                  </div>
                  <div style={{ display: 'flex', flexDirection: 'column', gap: 4 }}>
                    {section.items.map((item) => {
                      const Icon = item.icon;
                      const isActive = location.pathname === item.path;
                      return (
                        <Link
                          key={item.path}
                          to={item.path}
                          className={`nav-link ${isActive ? 'active' : ''}`}
                          style={{ fontSize: '0.9rem', padding: '10px 12px' }}
                        >
                          <Icon size={18} className="nav-icon" />
                          <span style={{ flex: 1 }}>{item.name}</span>
                          <ChevronRight size={14} style={{ opacity: 0.4 }} />
                        </Link>
                      );
                    })}
                  </div>
                </div>
              ))}
            </div>

            {/* Drawer Logout Footer */}
            <div style={{ paddingTop: 16, borderTop: '1px solid var(--border-subtle)', marginTop: 16 }}>
              <button
                onClick={handleLogout}
                className="btn btn-secondary w-full justify-center"
                style={{ padding: '10px 16px', color: 'var(--status-error)' }}
              >
                <LogOut size={18} />
                <span style={{ fontWeight: 600 }}>Log Out</span>
              </button>
            </div>
          </div>
        </>
      )}
    </>
  );
}

export default Sidebar;

