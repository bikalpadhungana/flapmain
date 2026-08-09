import React, { useState, useEffect } from 'react';
import { useNavigate } from 'react-router-dom';
import { Plus, Key, Calendar, Shield, Trash2, Check, Copy, AlertTriangle } from 'lucide-react';
import { API_BASE_URL } from '../config';
import Modal from '../components/Modal';
import ConfirmModal from '../components/ConfirmModal';
function ApiKeys() {
  const navigate = useNavigate();
  const token = localStorage.getItem('token');

  const [keys, setKeys] = useState([]);
  const [loading, setLoading] = useState(true);

  // Form states
  const [isModalOpen, setIsModalOpen] = useState(false);
  const [label, setLabel] = useState('');
  const [scopes, setScopes] = useState({
    'read:devices': true,
    'read:readings': true,
    'write:commands': false,
  });
  const [rateLimit, setRateLimit] = useState(60);
  const [newKeyGenerated, setNewKeyGenerated] = useState('');
  const [copied, setCopied] = useState(false);
  const [error, setError] = useState('');
  
  // Confirmation Modal State
  const [confirmModal, setConfirmModal] = useState({ isOpen: false, id: null });

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
    setCopied(false);

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
      // Keep modal open to show the key
    } catch (err) {
      setError(err.message);
    }
  };

  const copyToClipboard = () => {
    navigator.clipboard.writeText(newKeyGenerated);
    setCopied(true);
    setTimeout(() => setCopied(false), 2500);
  };

  const closeAndResetModal = () => {
    setIsModalOpen(false);
    setNewKeyGenerated('');
    setError('');
    setLabel('');
  };

  const handleDeleteClick = (id) => {
    setConfirmModal({ isOpen: true, id });
  };

  const handleDeleteConfirm = async () => {
    const id = confirmModal.id;
    if (!id) return;

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
    <div className="flex flex-col gap-6 flex-1 h-full relative animate-slide-up">
      <header className="flex justify-between items-center">
        <div>
          <h1 className="text-main" style={{ fontSize: '1.75rem', fontWeight: 600, letterSpacing: '-0.02em' }}>Partner API Keys</h1>
          <p className="text-muted text-sm mt-1">Manage scoped authorization credentials for third-party system integrations.</p>
        </div>
        <button onClick={() => setIsModalOpen(true)} className="btn btn-primary" style={{ boxShadow: '0 4px 12px rgba(99, 91, 255, 0.3)' }}>
          <Plus size={16} /> Generate New Key
        </button>
      </header>

      <div className="flex flex-col gap-4">
        {loading ? (
          <div className="text-muted text-sm">Loading keys...</div>
        ) : keys.length === 0 ? (
          <div className="card card-body text-center text-muted py-10" style={{ borderStyle: 'dashed' }}>
            No API Keys generated yet. Create one to allow external systems to securely connect.
          </div>
        ) : (
          <div className="grid" style={{ gridTemplateColumns: 'repeat(auto-fill, minmax(350px, 1fr))', gap: 'var(--space-4)' }}>
            {keys.map((k) => (
              <div key={k._id} className="premium-card card-body flex flex-col justify-between gap-4">
                <div className="flex justify-between items-start">
                  <div className="flex gap-3 items-start">
                    <div className="p-2.5 rounded-lg" style={{ background: 'linear-gradient(135deg, var(--accent-light) 0%, #e0e7ff 100%)', color: 'var(--action-primary)' }}>
                      <Key size={20} />
                    </div>
                    <div className="flex flex-col gap-1">
                      <h4 className="font-semibold text-main m-0" style={{ fontSize: '1.1rem' }}>{k.label}</h4>
                      <div className="flex items-center gap-1.5 text-xs text-muted">
                        <Calendar size={12} /> {new Date(k.createdAt).toLocaleDateString()}
                        <span className="mx-1">•</span>
                        <Shield size={12} /> {k.rate_limit_rpm} RPM
                      </div>
                    </div>
                  </div>
                  <button
                    onClick={() => handleDeleteClick(k._id)}
                    className="btn btn-icon text-muted hover:text-error hover:bg-red-50"
                    style={{ background: 'transparent' }}
                  >
                    <Trash2 size={18} />
                  </button>
                </div>
                
                <div className="pt-3 border-t border-subtle">
                  <span className="text-xs text-dim font-medium uppercase tracking-wider mb-2 block">Scopes</span>
                  <div className="flex flex-wrap gap-1.5">
                    {k.scopes.map((s) => (
                      <span key={s} className="badge badge-neutral" style={{ padding: '3px 8px', fontSize: '0.75rem' }}>
                        {s}
                      </span>
                    ))}
                  </div>
                </div>
              </div>
            ))}
          </div>
        )}
      </div>

      <Modal
        open={isModalOpen}
        onClose={closeAndResetModal}
        title={newKeyGenerated ? "Key Generated Successfully" : "Generate Scoped Key"}
        maxWidth="500px"
      >
        {error && <div className="text-error text-sm mb-4 p-3 rounded" style={{ background: 'var(--status-error-bg)' }}>{error}</div>}
        
        {newKeyGenerated ? (
          <div className="flex flex-col gap-4 animate-slide-up">
            <div className="flex items-start gap-3 p-4 rounded-lg" style={{ background: 'var(--status-warn-bg)', border: '1px solid #fde68a' }}>
              <AlertTriangle size={20} className="text-amber-600 shrink-0 mt-0.5" />
              <p className="text-amber-900 text-sm m-0">
                <strong>Copy this key now.</strong> For your security, it will never be displayed again. If you lose it, you will need to revoke it and generate a new one.
              </p>
            </div>
            
            <div className="premium-code-block glow-border flex justify-between items-center group">
              <code className="text-sm tracking-wider" style={{ wordBreak: 'break-all' }}>{newKeyGenerated}</code>
              <button 
                onClick={copyToClipboard} 
                className="btn btn-primary btn-sm shrink-0 ml-4 transition-all"
                style={{ opacity: copied ? 1 : 0.9 }}
              >
                {copied ? <Check size={16} /> : <Copy size={16} />}
                <span>{copied ? 'Copied!' : 'Copy Key'}</span>
              </button>
            </div>
            
            <button onClick={closeAndResetModal} className="btn btn-secondary w-full mt-2">
              Done
            </button>
          </div>
        ) : (
          <form onSubmit={handleCreateKey} className="flex flex-col gap-5">
            <div className="form-group mb-0">
              <label className="form-label">Key Label / Partner Identifier *</label>
              <input
                type="text"
                className="form-input"
                placeholder="e.g. ERP System Telemetry Access"
                value={label}
                onChange={(e) => setLabel(e.target.value)}
                required
              />
            </div>

            <div className="form-group mb-0">
              <label className="form-label">Permission Scopes</label>
              <div className="flex flex-col gap-3 mt-2 p-4 rounded-lg border border-subtle bg-gray-50">
                <label className="flex items-center gap-3 cursor-pointer text-sm text-main">
                  <input
                    type="checkbox"
                    checked={scopes['read:devices']}
                    onChange={(e) => setScopes({ ...scopes, 'read:devices': e.target.checked })}
                    style={{ width: '18px', height: '18px', accentColor: 'var(--action-primary)' }}
                  />
                  <span><strong className="font-medium">read:devices</strong> <span className="text-muted block text-xs mt-0.5">List and fetch device registries</span></span>
                </label>
                <div className="h-px bg-gray-200 w-full"></div>
                <label className="flex items-center gap-3 cursor-pointer text-sm text-main">
                  <input
                    type="checkbox"
                    checked={scopes['read:readings']}
                    onChange={(e) => setScopes({ ...scopes, 'read:readings': e.target.checked })}
                    style={{ width: '18px', height: '18px', accentColor: 'var(--action-primary)' }}
                  />
                  <span><strong className="font-medium">read:readings</strong> <span className="text-muted block text-xs mt-0.5">Fetch historical telemetry logs</span></span>
                </label>
                <div className="h-px bg-gray-200 w-full"></div>
                <label className="flex items-center gap-3 cursor-pointer text-sm text-main">
                  <input
                    type="checkbox"
                    checked={scopes['write:commands']}
                    onChange={(e) => setScopes({ ...scopes, 'write:commands': e.target.checked })}
                    style={{ width: '18px', height: '18px', accentColor: 'var(--action-primary)' }}
                  />
                  <span><strong className="font-medium">write:commands</strong> <span className="text-muted block text-xs mt-0.5">Trigger actuator commands via API</span></span>
                </label>
              </div>
            </div>

            <div className="form-group mb-0">
              <label className="form-label">Rate Limit (Requests per Minute)</label>
              <input
                type="number"
                className="form-input"
                value={rateLimit}
                onChange={(e) => setRateLimit(e.target.value)}
                min={1}
                required
              />
            </div>

            <div className="flex gap-3 justify-end mt-2 pt-4 border-t border-subtle">
              <button type="button" onClick={closeAndResetModal} className="btn btn-secondary">
                Cancel
              </button>
              <button type="submit" className="btn btn-primary" style={{ padding: '0.5rem 1.25rem' }}>
                <Plus size={16} />
                <span>Generate Secure Key</span>
              </button>
            </div>
          </form>
        )}
      </Modal>

      <ConfirmModal
        isOpen={confirmModal.isOpen}
        onClose={() => setConfirmModal({ isOpen: false, id: null })}
        onConfirm={handleDeleteConfirm}
        title="Revoke API Key"
        message={<><strong>Are you sure you want to revoke this API Key?</strong><br/><br/>Devices and partners using it will immediately be rejected. This action cannot be undone.</>}
        confirmText="Revoke Key"
        type="danger"
      />
    </div>
  );
}

export default ApiKeys;
