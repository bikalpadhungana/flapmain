import React, { useState, useEffect } from 'react';
import { useNavigate } from 'react-router-dom';
import { Plus, Key, Calendar, Shield, Trash2, Check } from 'lucide-react';
import { API_BASE_URL } from '../config';

function ApiKeys() {
  const navigate = useNavigate();
  const token = localStorage.getItem('token');

  const [keys, setKeys] = useState([]);
  const [loading, setLoading] = useState(true);

  // Form states
  const [label, setLabel] = useState('');
  const [scopes, setScopes] = useState({
    'read:devices': true,
    'read:readings': true,
    'write:commands': false,
  });
  const [rateLimit, setRateLimit] = useState(60);
  const [newKeyGenerated, setNewKeyGenerated] = useState('');
  const [error, setError] = useState('');

  useEffect(() => {
    if (!token) {
      navigate('/login');
      return;
    }
    fetchKeys();
  }, [token]);

  const fetchKeys = async () => {
    try {
      const response = await fetch(`${API_BASE_URL}/v1/api-keys`, {
        headers: { Authorization: `Bearer ${token}` },
      });
      const data = await response.json();
      setKeys(Array.isArray(data) ? data : []);
    } catch (err) {
      console.error(err);
    } finally {
      setLoading(false);
    }
  };

  const handleCreateKey = async (e) => {
    e.preventDefault();
    setError('');
    setNewKeyGenerated('');

    // Filter active scopes
    const activeScopes = Object.entries(scopes)
      .filter(([_, val]) => val)
      .map(([key]) => key);

    if (activeScopes.length === 0) {
      setError('Please select at least one scope permission for the API key');
      return;
    }

    try {
      const response = await fetch(`${API_BASE_URL}/v1/api-keys`, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          Authorization: `Bearer ${token}`,
        },
        body: JSON.stringify({
          label: label.trim(),
          scopes: activeScopes,
          rate_limit_rpm: Number(rateLimit),
        }),
      });

      const data = await response.json();
      if (!response.ok) {
        throw new Error(data.message || 'Failed to generate key');
      }

      setNewKeyGenerated(data.apiKey);
      setLabel('');
      fetchKeys();
    } catch (err) {
      setError(err.message);
    }
  };

  const handleDelete = async (id) => {
    if (!window.confirm('Are you sure you want to revoke this API Key? Devices/partners using it will immediately be rejected.')) return;

    try {
      const response = await fetch(`${API_BASE_URL}/v1/api-keys/${id}`, {
        method: 'DELETE',
        headers: { Authorization: `Bearer ${token}` },
      });

      if (response.ok) {
        fetchKeys();
      }
    } catch (err) {
      console.error('Error deleting API Key:', err);
    }
  };

  return (
    <div style={{ flex: 1, display: 'flex', flexDirection: 'column', gap: '30px', textAlign: 'left' }}>
      <header>
        <h1 style={{ fontSize: '2rem', fontWeight: '700' }}>Partner API Keys</h1>
        <p style={{ color: 'var(--text-secondary)' }}>Manage scoped authorization credentials for third-party system integrations.</p>
      </header>

      {/* Banner: New Key */}
      {newKeyGenerated && (
        <div className="glass-panel" style={{ padding: '24px', borderLeft: '4px solid var(--success)', background: 'rgba(16, 185, 129, 0.05)' }}>
          <h4 style={{ color: 'var(--success)', marginBottom: '8px', display: 'flex', alignItems: 'center', gap: '8px' }}>
            <Check size={18} /> API Key Generated Successfully!
          </h4>
          <p style={{ fontSize: '0.9rem', marginBottom: '12px' }}>
            Store this key securely. It represents access to your workspace scoped data and **will not** be displayed again:
          </p>
          <code style={{ background: '#f8fafc', color: '#0f172a', padding: '12px 16px', borderRadius: '4px', display: 'block', fontSize: '0.95rem', overflowX: 'auto', border: '1px solid #cbd5e1' }}>
            {newKeyGenerated}
          </code>
        </div>
      )}

      <div style={{ display: 'grid', gridTemplateColumns: '1.2fr 0.8fr', gap: '30px', alignItems: 'start' }}>
        {/* Keys listing */}
        <div style={{ display: 'flex', flexDirection: 'column', gap: '20px' }}>
          <h3 style={{ fontSize: '1.25rem' }}>Active Keys ({keys.length})</h3>
          {loading ? (
            <div style={{ color: 'var(--text-muted)' }}>Loading keys...</div>
          ) : (
            <div style={{ display: 'flex', flexDirection: 'column', gap: '16px' }}>
              {keys.map((k) => (
                <div key={k._id} className="glass-panel" style={{ padding: '20px', display: 'flex', justifyContent: 'space-between', alignItems: 'start' }}>
                  <div style={{ display: 'flex', gap: '12px', alignItems: 'start' }}>
                    <div style={{ background: 'var(--accent-glow)', borderRadius: '8px', padding: '8px' }}>
                      <Key size={18} color="var(--accent-light)" />
                    </div>
                    <div style={{ display: 'flex', flexDirection: 'column', gap: '6px' }}>
                      <h4 style={{ fontSize: '1.05rem', fontWeight: '600' }}>{k.label}</h4>
                      <div style={{ display: 'flex', flexWrap: 'wrap', gap: '6px' }}>
                        {k.scopes.map((s) => (
                          <span key={s} style={{ background: '#f1f5f9', border: '1px solid #e2e8f0', padding: '1px 6px', borderRadius: '4px', fontSize: '0.75rem', color: 'var(--text-secondary)' }}>
                            {s}
                          </span>
                        ))}
                      </div>
                      <div style={{ display: 'flex', gap: '16px', fontSize: '0.8rem', color: 'var(--text-muted)', marginTop: '4px' }}>
                        <span style={{ display: 'flex', alignItems: 'center', gap: '4px' }}>
                          <Calendar size={12} /> Registered: {new Date(k.createdAt).toLocaleDateString()}
                        </span>
                        <span style={{ display: 'flex', alignItems: 'center', gap: '4px' }}>
                          <Shield size={12} /> Rate limit: {k.rate_limit_rpm} RPM
                        </span>
                      </div>
                    </div>
                  </div>

                  <button
                    onClick={() => handleDelete(k._id)}
                    className="btn btn-secondary"
                    style={{ padding: '6px', borderRadius: '4px', color: 'var(--danger)', borderColor: 'transparent' }}
                  >
                    <Trash2 size={16} />
                  </button>
                </div>
              ))}
            </div>
          )}
        </div>

        {/* Key generator form */}
        <div className="glass-panel" style={{ padding: '24px' }}>
          <h3 style={{ fontSize: '1.25rem', marginBottom: '16px' }}>Generate Scoped Key</h3>
          {error && <p style={{ color: 'var(--danger)', fontSize: '0.85rem', marginBottom: '12px' }}>{error}</p>}
          
          <form onSubmit={handleCreateKey} style={{ display: 'flex', flexDirection: 'column', gap: '20px' }}>
            <div className="form-group">
              <label className="form-label">Key Label / Partner Identifier</label>
              <input
                type="text"
                className="form-input"
                placeholder="e.g. NirmanLink Telemetry Client"
                value={label}
                onChange={(e) => setLabel(e.target.value)}
                required
              />
            </div>

            <div className="form-group">
              <label className="form-label">Permission Scopes</label>
              <div style={{ display: 'flex', flexDirection: 'column', gap: '10px', marginTop: '6px' }}>
                <label style={{ display: 'flex', alignItems: 'center', gap: '10px', cursor: 'pointer', fontSize: '0.9rem' }}>
                  <input
                    type="checkbox"
                    checked={scopes['read:devices']}
                    onChange={(e) => setScopes({ ...scopes, 'read:devices': e.target.checked })}
                    style={{ width: '16px', height: '16px', accentColor: 'var(--accent)' }}
                  />
                  <span>read:devices (List & fetch device registries)</span>
                </label>
                <label style={{ display: 'flex', alignItems: 'center', gap: '10px', cursor: 'pointer', fontSize: '0.9rem' }}>
                  <input
                    type="checkbox"
                    checked={scopes['read:readings']}
                    onChange={(e) => setScopes({ ...scopes, 'read:readings': e.target.checked })}
                    style={{ width: '16px', height: '16px', accentColor: 'var(--accent)' }}
                  />
                  <span>read:readings (Fetch telemetry logs ranges)</span>
                </label>
                <label style={{ display: 'flex', alignItems: 'center', gap: '10px', cursor: 'pointer', fontSize: '0.9rem' }}>
                  <input
                    type="checkbox"
                    checked={scopes['write:commands']}
                    onChange={(e) => setScopes({ ...scopes, 'write:commands': e.target.checked })}
                    style={{ width: '16px', height: '16px', accentColor: 'var(--accent)' }}
                  />
                  <span>write:commands (Trigger actuator commands)</span>
                </label>
              </div>
            </div>

            <div className="form-group">
              <label className="form-label">Rate Limit (Request per Minute)</label>
              <input
                type="number"
                className="form-input"
                value={rateLimit}
                onChange={(e) => setRateLimit(e.target.value)}
                min={1}
                required
              />
            </div>

            <button type="submit" className="btn btn-primary" style={{ width: '100%' }}>
              <Plus size={14} />
              <span>Generate Key</span>
            </button>
          </form>
        </div>
      </div>
    </div>
  );
}

export default ApiKeys;
