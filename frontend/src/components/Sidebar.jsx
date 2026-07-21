import React from 'react';
import { Link, useLocation, useNavigate } from 'react-router-dom';
import { LayoutDashboard, Database, Key, Bell, LogOut, Radio } from 'lucide-react';

function Sidebar() {
  const location = useLocation();
  const navigate = useNavigate();

  const handleLogout = () => {
    localStorage.removeItem('token');
    localStorage.removeItem('user');
    navigate('/login');
  };

  const navItems = [
    { name: 'Devices Dashboard', path: '/', icon: LayoutDashboard },
    { name: 'Schema Registry', path: '/registry', icon: Database },
    { name: 'API Integrations', path: '/api-keys', icon: Key },
    { name: 'Alert Settings', path: '/alerts', icon: Bell },
  ];

  return (
    <aside className="glass-panel" style={{ width: '260px', height: 'calc(100vh - 48px)', padding: '24px', display: 'flex', flexDirection: 'column', gap: '30px', position: 'sticky', top: '24px' }}>
      <div style={{ display: 'flex', alignItems: 'center', gap: '12px', paddingBottom: '16px', borderBottom: '1px solid var(--card-border)' }}>
        <img src="/flapmainlogo.png" alt="FlapMain Logo" style={{ height: '40px', width: 'auto', objectFit: 'contain' }} />
        <div>
          <h2 style={{ fontSize: '1.25rem', fontWeight: '700', margin: 0, background: 'linear-gradient(to right, #1f74b5, #3892d6)', WebkitBackgroundClip: 'text', WebkitTextFillColor: 'transparent' }}>
            FlapMain
          </h2>
          <span style={{ fontSize: '0.75rem', color: 'var(--text-muted)' }}>IoT Administration</span>
        </div>
      </div>

      <nav style={{ display: 'flex', flexDirection: 'column', gap: '8px', flex: 1 }}>
        {navItems.map((item) => {
          const Icon = item.icon;
          const isActive = location.pathname === item.path;

          return (
            <Link
              key={item.path}
              to={item.path}
              style={{
                display: 'flex',
                alignItems: 'center',
                gap: '12px',
                padding: '12px 16px',
                borderRadius: 'var(--radius-sm)',
                textDecoration: 'none',
                color: isActive ? '#fff' : 'var(--text-secondary)',
                background: isActive ? 'var(--accent)' : 'transparent',
                border: isActive ? '1px solid rgba(255,255,255,0.1)' : '1px solid transparent',
                transition: 'var(--transition-smooth)',
                fontWeight: isActive ? '600' : '400',
              }}
              className={isActive ? '' : 'glass-panel-hover'}
            >
              <Icon size={18} />
              <span>{item.name}</span>
            </Link>
          );
        })}
      </nav>

      <button
        onClick={handleLogout}
        className="btn btn-secondary"
        style={{
          width: '100%',
          display: 'flex',
          alignItems: 'center',
          justifyContent: 'center',
          gap: '10px',
          borderColor: 'rgba(239, 68, 68, 0.2)',
          color: 'var(--danger)',
        }}
      >
        <LogOut size={16} />
        <span>Log Out</span>
      </button>
    </aside>
  );
}

export default Sidebar;
