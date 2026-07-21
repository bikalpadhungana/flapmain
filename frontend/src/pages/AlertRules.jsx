import React, { useState, useEffect } from 'react';
import { useNavigate } from 'react-router-dom';
import { Plus, Bell, Trash2, Cpu, Check, AlertTriangle } from 'lucide-react';
import { API_BASE_URL } from '../config';

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

  const handleDelete = async (id) => {
    if (!window.confirm('Are you sure you want to delete this alert rule?')) return;

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
    <div style={{ flex: 1, display: 'flex', flexDirection: 'column', gap: '30px', textAlign: 'left' }}>
      <header>
        <h1 style={{ fontSize: '2rem', fontWeight: '700' }}>Alert Settings</h1>
        <p style={{ color: 'var(--text-secondary)' }}>Compile real-time threshold conditions and trigger actuator signals or webhooks.</p>
      </header>

      <div style={{ display: 'grid', gridTemplateColumns: '1.2fr 0.8fr', gap: '30px', alignItems: 'start' }}>
        {/* Rules listing */}
        <div style={{ display: 'flex', flexDirection: 'column', gap: '20px' }}>
          <h3 style={{ fontSize: '1.25rem' }}>Active Rules ({rules.length})</h3>
          {loading ? (
            <div style={{ color: 'var(--text-muted)' }}>Loading rules...</div>
          ) : (
            <div style={{ display: 'flex', flexDirection: 'column', gap: '16px' }}>
              {rules.map((r) => (
                <div key={r._id} className="glass-panel" style={{ padding: '20px', display: 'flex', justifyContent: 'space-between', alignItems: 'start' }}>
                  <div style={{ display: 'flex', gap: '12px', alignItems: 'start' }}>
                    <div style={{ background: 'var(--danger-glow)', borderRadius: '8px', padding: '8px' }}>
                      <AlertTriangle size={18} color="var(--danger)" />
                    </div>
                    <div style={{ display: 'flex', flexDirection: 'column', gap: '4px' }}>
                      <h4 style={{ fontSize: '1.05rem', fontWeight: '600' }}>
                        Device: <code style={{ fontSize: '0.85rem' }}>{r.device_id}</code>
                      </h4>
                      <p style={{ fontSize: '0.9rem', color: 'var(--text-primary)', marginTop: '4px' }}>
                        IF <strong>{r.condition.field}</strong> {r.condition.operator} <strong>{String(r.condition.value)}</strong>
                      </p>
                      <p style={{ fontSize: '0.8rem', color: 'var(--text-secondary)' }}>
                        THEN trigger <strong>{r.action.type}</strong> ➜ <code style={{ fontSize: '0.75rem' }}>{r.action.target}</code>
                      </p>
                    </div>
                  </div>

                  <button
                    onClick={() => handleDelete(r._id)}
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

        {/* Rule Compiler Form */}
        <div className="glass-panel" style={{ padding: '24px' }}>
          <h3 style={{ fontSize: '1.25rem', marginBottom: '16px' }}>Compile Alert Rule</h3>
          {error && <p style={{ color: 'var(--danger)', fontSize: '0.85rem', marginBottom: '12px' }}>{error}</p>}
          {success && <p style={{ color: 'var(--success)', fontSize: '0.85rem', marginBottom: '12px', display: 'flex', alignItems: 'center', gap: '4px' }}><Check size={14}/> {success}</p>}

          <form onSubmit={handleCreateRule} style={{ display: 'flex', flexDirection: 'column', gap: '16px' }}>
            <div className="form-group">
              <label className="form-label">Target Device</label>
              <select
                className="form-input"
                style={{ background: 'var(--bg-secondary)', height: '46px' }}
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
            <div style={{ display: 'flex', gap: '10px' }}>
              <div className="form-group" style={{ flex: 2 }}>
                <label className="form-label">Telemetry Parameter</label>
                <select
                  className="form-input"
                  style={{ background: 'var(--bg-secondary)', height: '46px' }}
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

              <div className="form-group" style={{ flex: 1 }}>
                <label className="form-label">Operator</label>
                <select
                  className="form-input"
                  style={{ background: 'var(--bg-secondary)', height: '46px' }}
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

              <div className="form-group" style={{ flex: 2.5 }}>
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
            <div className="form-group">
              <label className="form-label">Action Signal Type</label>
              <select
                className="form-input"
                style={{ background: 'var(--bg-secondary)', height: '46px' }}
                value={actionType}
                onChange={e => setActionType(e.target.value)}
                required
              >
                <option value="webhook">webhook (Post JSON to endpoint)</option>
                <option value="actuator">actuator (Trigger device command)</option>
              </select>
            </div>

            <div className="form-group">
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

            <button type="submit" className="btn btn-primary" style={{ width: '100%', marginTop: '10px' }}>
              <Plus size={14} />
              <span>Register Alert Rule</span>
            </button>
          </form>
        </div>
      </div>
    </div>
  );
}

export default AlertRules;
