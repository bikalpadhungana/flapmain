import React, { useState, useEffect } from 'react';
import { useNavigate } from 'react-router-dom';
import { Plus, Bell, Trash2, Cpu, Check, AlertTriangle } from 'lucide-react';
import { API_BASE_URL } from '../config';
import ConfirmModal from '../components/ConfirmModal';

function AlertRules() {
  const navigate = useNavigate();
  const token = localStorage.getItem('token');

  const [rules, setRules] = useState([]);
  const [devices, setDevices] = useState([]);
  const [deviceTypes, setDeviceTypes] = useState([]);
  const [loading, setLoading] = useState(true);

  // Form states
  const [selectedDevice, setSelectedDevice] = useState('');
  const [selectedField, setSelectedField] = useState('');
  const [operator, setOperator] = useState('>');
  const [value, setValue] = useState('');
  const [actionType, setActionType] = useState('webhook');
  const [actionTarget, setActionTarget] = useState('');
  
  const [error, setError] = useState('');
  const [success, setSuccess] = useState('');
  
  const [confirmModal, setConfirmModal] = useState({ isOpen: false, ruleId: null });

  useEffect(() => {
    if (!token) {
      navigate('/login');
      return;
    }
    fetchData();
  }, [token]);

  const fetchData = async () => {
    try {
      // 1. Fetch rules
      const rulesRes = await fetch(`${API_BASE_URL}/v1/alerts/rules`, {
        headers: { Authorization: `Bearer ${token}` },
      });
      const rulesData = await rulesRes.json();
      setRules(Array.isArray(rulesData) ? rulesData : []);

      // 2. Fetch devices
      const devRes = await fetch(`${API_BASE_URL}/v1/devices`, {
        headers: { Authorization: `Bearer ${token}` },
      });
      const devData = await devRes.json();
      setDevices(Array.isArray(devData) ? devData : []);
      if (devData.length > 0) setSelectedDevice(devData[0].device_id);

      // 3. Fetch device types
      const typesRes = await fetch(`${API_BASE_URL}/v1/device-types`, {
        headers: { Authorization: `Bearer ${token}` },
      });
      const typesData = await typesRes.json();
      setDeviceTypes(Array.isArray(typesData) ? typesData : []);
    } catch (err) {
      console.error(err);
    } finally {
      setLoading(false);
    }
  };

  // Get active fields for selected device based on its schema definition
  const getFieldsForSelectedDevice = () => {
    const dev = devices.find(d => d.device_id === selectedDevice);
    if (!dev) return [];
    
    const matchedType = deviceTypes.find(t => t.device_type === dev.device_type);
    if (!matchedType) return [];
    
    return Object.keys(matchedType.fields);
  };

  // Automatically update field selector when selected device changes
  useEffect(() => {
    const fields = getFieldsForSelectedDevice();
    if (fields.length > 0) {
      setSelectedField(fields[0]);
    } else {
      setSelectedField('');
    }
  }, [selectedDevice, devices, deviceTypes]);

  const handleCreateRule = async (e) => {
    e.preventDefault();
    setError('');
    setSuccess('');

    if (!selectedDevice || !selectedField || !value || !actionTarget) {
      setError('Please fill in all rule compilation parameters');
      return;
    }

    try {
      const response = await fetch(`${API_BASE_URL}/v1/alerts/rules`, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          Authorization: `Bearer ${token}`,
        },
        body: JSON.stringify({
          device_id: selectedDevice,
          condition: {
            field: selectedField,
            operator,
            value: isNaN(value) ? value : Number(value), // auto parse number if numeric
          },
          action: {
            type: actionType,
            target: actionTarget,
          },
        }),
      });

      const data = await response.json();
      if (!response.ok) {
        throw new Error(data.message || 'Failed to save rule');
      }

      setSuccess('Alert rule created successfully');
      setValue('');
      setActionTarget('');
      fetchData();
    } catch (err) {
      setError(err.message);
    }
  };

  const handleDeleteClick = (id) => {
    setConfirmModal({ isOpen: true, ruleId: id });
  };

  const handleDeleteConfirm = async () => {
    const id = confirmModal.ruleId;
    if (!id) return;

    try {
      const response = await fetch(`${API_BASE_URL}/v1/alerts/rules/${id}`, {
        method: 'DELETE',
        headers: { Authorization: `Bearer ${token}` },
      });

      if (response.ok) {
        fetchData();
      }
    } catch (err) {
      console.error('Error deleting alert rule:', err);
    }
  };

  return (
    <div className="flex flex-col gap-6 flex-1 h-full">
      <header className="flex justify-between items-center">
        <div>
          <h1 className="text-main" style={{ fontSize: '1.75rem', fontWeight: 600, letterSpacing: '-0.02em' }}>Alert Settings</h1>
          <p className="text-muted text-sm mt-1">Compile real-time threshold conditions and trigger actuator signals or webhooks.</p>
        </div>
      </header>

      <div className="grid" style={{ gridTemplateColumns: '1.2fr 0.8fr', gap: 'var(--space-6)', alignItems: 'start' }}>
        {/* Rules listing */}
        <div className="flex flex-col gap-4">
          <h3 style={{ fontSize: '1.125rem' }}>Active Rules ({rules.length})</h3>
          {loading ? (
            <div className="text-muted text-sm">Loading rules...</div>
          ) : (
            <div className="flex flex-col gap-4">
              {rules.map((r) => (
                <div key={r._id} className="card card-body flex justify-between items-start">
                  <div className="flex gap-3 items-start">
                    <div className="p-2 rounded bg-red-50 text-error" style={{ background: 'var(--status-error-bg)' }}>
                      <AlertTriangle size={18} />
                    </div>
                    <div className="flex flex-col gap-1 text-sm">
                      <h4 className="font-medium text-main m-0">
                        Device: <code className="text-mono text-muted text-xs bg-gray-50 border border-subtle px-1 rounded">{r.device_id}</code>
                      </h4>
                      <p className="m-0 mt-1">
                        <span className="text-dim">IF</span> <strong className="text-main">{r.condition.field}</strong> <span className="text-accent font-mono mx-1">{r.condition.operator}</span> <strong className="text-main">{String(r.condition.value)}</strong>
                      </p>
                      <p className="text-xs text-muted m-0 mt-1">
                        <span className="text-dim">THEN trigger</span> <strong className="text-main">{r.action.type}</strong> &rarr; <code className="text-mono bg-gray-50 border border-subtle px-1 rounded truncate max-w-[200px] inline-block align-bottom">{r.action.target}</code>
                      </p>
                    </div>
                  </div>

                  <button
                    onClick={() => handleDeleteClick(r._id)}
                    className="btn btn-icon text-muted"
                    style={{ background: 'transparent' }}
                    onMouseEnter={(e) => { e.currentTarget.style.color = 'var(--status-error)' }}
                    onMouseLeave={(e) => { e.currentTarget.style.color = 'var(--text-muted)' }}
                  >
                    <Trash2 size={16} />
                  </button>
                </div>
              ))}
            </div>
          )}
        </div>

        {/* Rule Compiler Form */}
        <div className="card">
          <div className="card-header">
            <h3 style={{ fontSize: '1.125rem' }}>Compile Alert Rule</h3>
          </div>
          <div className="card-body">
            {error && <p className="text-error text-sm mb-3">{error}</p>}
            {success && <p className="text-success text-sm mb-3 flex items-center gap-2"><Check size={14}/> {success}</p>}

            <form onSubmit={handleCreateRule} className="flex flex-col gap-4">
              <div className="form-group mb-0">
                <label className="form-label">Target Device</label>
                <select
                  className="form-input form-select"
                  value={selectedDevice}
                  onChange={e => setSelectedDevice(e.target.value)}
                  required
                >
                  <option value="" disabled>Select device</option>
                  {devices.map(d => (
                    <option key={d.device_id} value={d.device_id}>
                      {d.name} ({d.device_id})
                    </option>
                  ))}
                </select>
              </div>

              {/* Condition Row */}
              <div className="flex gap-3">
                <div className="form-group mb-0 flex-1" style={{ flex: 2 }}>
                  <label className="form-label">Telemetry Parameter</label>
                  <select
                    className="form-input form-select"
                    value={selectedField}
                    onChange={e => setSelectedField(e.target.value)}
                    required
                  >
                    <option value="" disabled>Select field</option>
                    {getFieldsForSelectedDevice().map(f => (
                      <option key={f} value={f}>{f}</option>
                    ))}
                  </select>
                </div>

                <div className="form-group mb-0 flex-1">
                  <label className="form-label">Operator</label>
                  <select
                    className="form-input form-select font-mono"
                    value={operator}
                    onChange={e => setOperator(e.target.value)}
                    required
                  >
                    <option value=">">&gt;</option>
                    <option value="<">&lt;</option>
                    <option value="==">==</option>
                    <option value="!=">!=</option>
                  </select>
                </div>

                <div className="form-group mb-0 flex-1" style={{ flex: 2.5 }}>
                  <label className="form-label">Threshold Value</label>
                  <input
                    type="text"
                    className="form-input"
                    placeholder="e.g. 80 or true"
                    value={value}
                    onChange={e => setValue(e.target.value)}
                    required
                  />
                </div>
              </div>

              {/* Action configs */}
              <div className="form-group mb-0">
                <label className="form-label">Action Signal Type</label>
                <select
                  className="form-input form-select"
                  value={actionType}
                  onChange={e => setActionType(e.target.value)}
                  required
                >
                  <option value="webhook">webhook (Post JSON to endpoint)</option>
                  <option value="actuator">actuator (Trigger device command)</option>
                </select>
              </div>

              <div className="form-group mb-0">
                <label className="form-label">
                  {actionType === 'webhook' ? 'Webhook Endpoint URL' : 'Device Command Signal'}
                </label>
                <input
                  type="text"
                  className="form-input"
                  placeholder={actionType === 'webhook' ? 'http://example.com/alert' : 'e.g. set_actuator'}
                  value={actionTarget}
                  onChange={e => setActionTarget(e.target.value)}
                  required
                />
              </div>

              <button type="submit" className="btn btn-primary w-full mt-2" style={{ padding: '0.625rem 1rem' }}>
                <Plus size={14} />
                <span>Register Alert Rule</span>
              </button>
            </form>
          </div>
        </div>
      </div>
      
      <ConfirmModal
        isOpen={confirmModal.isOpen}
        onClose={() => setConfirmModal({ isOpen: false, ruleId: null })}
        onConfirm={handleDeleteConfirm}
        title="Delete Alert Rule"
        message={<><strong>Are you sure you want to delete this alert rule?</strong><br/><br/>It will stop triggering actions.</>}
        confirmText="Delete Rule"
        type="danger"
      />
    </div>
  );
}

export default AlertRules;
