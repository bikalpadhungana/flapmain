import React, { useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { API_BASE_URL } from '../config';

function Login() {
  const [email, setEmail] = useState('');
  const [password, setPassword] = useState('');
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
    <div className="flex items-center justify-center relative" style={{ minHeight: '100vh', background: 'var(--bg-app)' }}>
      <div className="card shadow-md" style={{ width: '420px', padding: 'var(--space-8)', textAlign: 'center', zIndex: 1, margin: '16px' }}>
        <div className="flex flex-col items-center gap-3 mb-8">
          <img src="/flapmainlogo.png" alt="FlapMain Logo" style={{ height: '70px', width: 'auto', objectFit: 'contain' }} />
          <div style={{ textAlign: 'center', width: '100%' }}>
            <h1 className="m-0 text-main" style={{ fontSize: '2rem', fontWeight: 700, letterSpacing: '-0.02em', textAlign: 'center' }}>
              FlapMain
            </h1>
            <p className="text-muted text-sm mt-1 m-0" style={{ textAlign: 'center' }}>IoT Management Dashboard</p>
          </div>
        </div>

        {error && (
          <div className="text-left text-sm text-error bg-red-50 border border-red-200 p-3 rounded mb-5" style={{ background: 'var(--status-error-bg)', color: 'var(--status-error)', borderColor: '#fecaca' }}>
            {error}
          </div>
        )}

        <form onSubmit={handleLogin} className="flex flex-col gap-5" style={{ textAlign: 'left' }}>
          <div className="form-group mb-0">
            <label className="form-label">Email Address</label>
            <input
              type="email"
              className="form-input"
              value={email}
              onChange={(e) => setEmail(e.target.value)}
              required
            />
          </div>

          <div className="form-group mb-0">
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
            className="btn btn-primary w-full mt-2"
            style={{ padding: '0.75rem 1rem' }}
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
