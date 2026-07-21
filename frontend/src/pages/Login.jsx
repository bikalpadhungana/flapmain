import React, { useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { API_BASE_URL } from '../config';

function Login() {
  const [email, setEmail] = useState('admin@flap.com');
  const [password, setPassword] = useState('adminpassword123');
  const [error, setError] = useState('');
  const [loading, setLoading] = useState(false);
  const navigate = useNavigate();

  const handleLogin = async (e) => {
    e.preventDefault();
    setError('');
    setLoading(true);

    try {
      const response = await fetch(`${API_BASE_URL}/v1/auth/login`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ email, password }),
      });

      const data = await response.json();

      if (!response.ok) {
        throw new Error(data.message || 'Login failed');
      }

      localStorage.setItem('token', data.token);
      localStorage.setItem('user', JSON.stringify(data.user));
      navigate('/');
    } catch (err) {
      setError(err.message || 'Failed to authenticate');
    } finally {
      setLoading(false);
    }
  };

  return (
    <div style={{ minHeight: '100vh', display: 'flex', alignItems: 'center', justifyContent: 'center', position: 'relative' }}>
      <div className="glow-spot" style={{ top: '20%', left: '20%' }}></div>
      <div className="glow-spot" style={{ bottom: '20%', right: '20%' }}></div>

      <div className="glass-panel" style={{ width: '420px', padding: '40px', textAlign: 'center', zIndex: 1 }}>
        <div style={{ display: 'flex', flexDirection: 'column', alignItems: 'center', gap: '12px', marginBottom: '32px' }}>
          <img src="/flapmainlogo.png" alt="FlapMain Logo" style={{ height: '70px', width: 'auto', objectFit: 'contain' }} />
          <div>
            <h1 style={{ fontSize: '2rem', fontWeight: '700', margin: 0, background: 'linear-gradient(to right, #1f74b5, #3892d6)', WebkitBackgroundClip: 'text', WebkitTextFillColor: 'transparent' }}>
              FlapMain
            </h1>
            <p style={{ color: 'var(--text-secondary)', fontSize: '0.9rem', marginTop: '4px' }}>IoT Management Dashboard</p>
          </div>
        </div>

        {error && (
          <div style={{ background: 'var(--danger-glow)', border: '1px solid rgba(239, 68, 68, 0.3)', color: 'var(--danger)', padding: '12px', borderRadius: 'var(--radius-sm)', fontSize: '0.85rem', marginBottom: '20px', textAlign: 'left' }}>
            {error}
          </div>
        )}

        <form onSubmit={handleLogin}>
          <div className="form-group">
            <label className="form-label">Email Address</label>
            <input
              type="email"
              className="form-input"
              value={email}
              onChange={(e) => setEmail(e.target.value)}
              required
            />
          </div>

          <div className="form-group">
            <label className="form-label">Password</label>
            <input
              type="password"
              className="form-input"
              value={password}
              onChange={(e) => setPassword(e.target.value)}
              required
            />
          </div>

          <button
            type="submit"
            className="btn btn-primary"
            style={{ width: '100%', padding: '12px', marginTop: '10px' }}
            disabled={loading}
          >
            {loading ? 'Authenticating...' : 'Sign In'}
          </button>
        </form>
      </div>
    </div>
  );
}

export default Login;
