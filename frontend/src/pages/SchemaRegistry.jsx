import React, { useState, useEffect } from 'react';
import { useNavigate } from 'react-router-dom';
import { Plus, Database, Cpu, ShieldAlert, Check } from 'lucide-react';
import { API_BASE_URL } from '../config';

function SchemaRegistry() {
  const navigate = useNavigate();
  const token = localStorage.getItem('token');
  const user = JSON.parse(localStorage.getItem('user') || '{}');

  const [schemas, setSchemas] = useState([]);
  const [loading, setLoading] = useState(true);

  // Schema creation states
  const [deviceType, setDeviceType] = useState('');
  const [displayName, setDisplayName] = useState('');
  const [fields, setFields] = useState([{ name: '', type: 'number', unit: '' }]);
  const [commands, setCommands] = useState(['']);
  const [error, setError] = useState('');
  const [success, setSuccess] = useState('');

  useEffect(() => {
    if (!token) {
      navigate('/login');
      return;
    }
    fetchSchemas();
  }, [token]);

  const fetchSchemas = async () => {
    try {
      const response = await fetch(`${API_BASE_URL}/v1/device-types`, {
        headers: { Authorization: `Bearer ${token}` },
      });
      const data = await response.json();
      setSchemas(Array.isArray(data) ? data : []);
    } catch (err) {
      console.error(err);
    } finally {
      setLoading(false);
    }
  };

  const addFieldRow = () => {
    setFields([...fields, { name: '', type: 'number', unit: '' }]);
  };

  const removeFieldRow = (index) => {
    setFields(fields.filter((_, idx) => idx !== index));
  };

  const handleFieldChange = (index, key, val) => {
    const updated = [...fields];
    updated[index][key] = val;
    setFields(updated);
  };

  const addCommandRow = () => {
    setCommands([...commands, '']);
  };

  const removeCommandRow = (index) => {
    setCommands(commands.filter((_, idx) => idx !== index));
  };

  const handleCommandChange = (index, val) => {
    const updated = [...commands];
    updated[index] = val;
    setCommands(updated);
  };

  const handleCreateSchema = async (e) => {
    e.preventDefault();
    setError('');
    setSuccess('');

    // Construct fields object
    const fieldsObj = {};
    for (const f of fields) {
      if (!f.name) continue;
      fieldsObj[f.name.trim()] = {
        type: f.type,
        unit: f.unit ? f.unit.trim() : undefined,
      };
    }

    if (Object.keys(fieldsObj).length === 0) {
      setError('Please define at least one valid schema field parameter.');
      return;
    }

    const filteredCommands = commands.map(c => c.trim()).filter(c => c !== '');

    try {
      const response = await fetch(`${API_BASE_URL}/v1/device-types`, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          Authorization: `Bearer ${token}`,
        },
        body: JSON.stringify({
          device_type: deviceType.trim(),
          display_name: displayName.trim(),
          fields: fieldsObj,
          commands: filteredCommands,
        }),
      });

      const data = await response.json();
      if (!response.ok) {
        throw new Error(data.message || 'Failed to register schema registry configuration');
      }

      setSuccess(`Successfully seeded schema registry with device type '${deviceType}'`);
      setDeviceType('');
      setDisplayName('');
      setFields([{ name: '', type: 'number', unit: '' }]);
      setCommands(['']);
      fetchSchemas();
    } catch (err) {
      setError(err.message);
    }
  };

  return (
    <div style={{ flex: 1, display: 'flex', flexDirection: 'column', gap: '30px', textAlign: 'left' }}>
      <header>
        <h1 style={{ fontSize: '2rem', fontWeight: '700' }}>Schema Registry</h1>
        <p style={{ color: 'var(--text-secondary)' }}>Dynamically define telemetry parameters and validation configurations.</p>
      </header>

      <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: '30px', alignItems: 'start' }}>
        {/* Registry schema lists */}
        <div style={{ display: 'flex', flexDirection: 'column', gap: '20px' }}>
          <h3 style={{ fontSize: '1.25rem' }}>Active Schemas ({schemas.length})</h3>
          {loading ? (
            <div style={{ color: 'var(--text-muted)' }}>Loading registry...</div>
          ) : (
            <div style={{ display: 'flex', flexDirection: 'column', gap: '16px' }}>
              {schemas.map((s) => (
                <div key={s._id} className="glass-panel" style={{ padding: '24px' }}>
                  <div style={{ display: 'flex', alignItems: 'center', gap: '10px', marginBottom: '12px' }}>
                    <div style={{ background: 'var(--accent-glow)', borderRadius: '8px', padding: '6px' }}>
                      <Database size={18} color="var(--accent-light)" />
                    </div>
                    <div>
                      <h4 style={{ fontSize: '1.1rem' }}>{s.display_name}</h4>
                      <code style={{ fontSize: '0.75rem', color: 'var(--text-muted)' }}>{s.device_type} (v{s.version})</code>
                    </div>
                  </div>

                  <div style={{ display: 'flex', flexDirection: 'column', gap: '10px', fontSize: '0.85rem' }}>
                    <div>
                      <span style={{ color: 'var(--text-muted)', display: 'block', marginBottom: '4px' }}>Telemetry Fields</span>
                      <div style={{ display: 'flex', flexWrap: 'wrap', gap: '8px' }}>
                        {Object.entries(s.fields).map(([name, def]) => (
                          <span key={name} style={{ background: '#f1f5f9', border: '1px solid #e2e8f0', color: '#0f172a', padding: '2px 8px', borderRadius: '4px' }}>
                            <strong>{name}</strong>: {def.type} {def.unit && `(${def.unit})`}
                          </span>
                        ))}
                      </div>
                    </div>

                    <div>
                      <span style={{ color: 'var(--text-muted)', display: 'block', marginBottom: '4px' }}>Commands Accepted</span>
                      <div style={{ display: 'flex', flexWrap: 'wrap', gap: '8px' }}>
                        {s.commands.length > 0 ? (
                          s.commands.map((cmd) => (
                            <span key={cmd} style={{ background: 'rgba(26,134,208,0.1)', color: 'var(--accent-light)', padding: '2px 8px', borderRadius: '4px', border: '1px solid rgba(26,134,208,0.2)' }}>
                              {cmd}
                            </span>
                          ))
                        ) : (
                          <span style={{ color: 'var(--text-muted)', fontSize: '0.8rem' }}>None</span>
                        )}
                      </div>
                    </div>
                  </div>
                </div>
              ))}
            </div>
          )}
        </div>

        {/* Schema creation panel */}
        <div>
          {user.role !== 'admin' ? (
            <div className="glass-panel" style={{ padding: '24px', textAlign: 'center', color: 'var(--text-secondary)', display: 'flex', flexDirection: 'column', alignItems: 'center', gap: '12px' }}>
              <ShieldAlert size={36} color="var(--warning)" />
              <h3>Admin Permissions Required</h3>
              <p style={{ fontSize: '0.85rem' }}>Only user accounts registered with the role of `admin` can register new schemas in the central registry registry.</p>
            </div>
          ) : (
            <div className="glass-panel" style={{ padding: '24px' }}>
              <h3 style={{ fontSize: '1.25rem', marginBottom: '16px' }}>Register New Device Schema</h3>
              
              {error && <div style={{ color: 'var(--danger)', fontSize: '0.85rem', marginBottom: '12px' }}>{error}</div>}
              {success && <div style={{ color: 'var(--success)', fontSize: '0.85rem', marginBottom: '12px', display: 'flex', alignItems: 'center', gap: '6px' }}><Check size={14}/> {success}</div>}

              <form onSubmit={handleCreateSchema} style={{ display: 'flex', flexDirection: 'column', gap: '20px' }}>
                <div className="form-group">
                  <label className="form-label">Schema Identifier (Unique ID)</label>
                  <input
                    type="text"
                    className="form-input"
                    placeholder="e.g. air_sensor_v1"
                    value={deviceType}
                    onChange={e => setDeviceType(e.target.value)}
                    required
                  />
                </div>

                <div className="form-group">
                  <label className="form-label">Display Friendly Name</label>
                  <input
                    type="text"
                    className="form-input"
                    placeholder="e.g. Smart PM2.5 Air Quality Sensor"
                    value={displayName}
                    onChange={e => setDisplayName(e.target.value)}
                    required
                  />
                </div>

                {/* Fields Builder */}
                <div style={{ display: 'flex', flexDirection: 'column', gap: '10px' }}>
                  <label className="form-label" style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
                    <span>Telemetry Field Configuration</span>
                    <button type="button" onClick={addFieldRow} className="btn btn-secondary" style={{ padding: '4px 8px', fontSize: '0.8rem' }}>
                      <Plus size={12} /> Add Field
                    </button>
                  </label>

                  {fields.map((f, idx) => (
                    <div key={idx} style={{ display: 'flex', gap: '10px', alignItems: 'center' }}>
                      <input
                        type="text"
                        className="form-input"
                        placeholder="field_name"
                        style={{ flex: 2 }}
                        value={f.name}
                        onChange={e => handleFieldChange(idx, 'name', e.target.value)}
                        required
                      />
                      <select
                        className="form-input"
                        style={{ background: 'var(--bg-secondary)', flex: 1, height: '46px' }}
                        value={f.type}
                        onChange={e => handleFieldChange(idx, 'type', e.target.value)}
                      >
                        <option value="number">number</option>
                        <option value="boolean">boolean</option>
                        <option value="string">string</option>
                      </select>
                      <input
                        type="text"
                        className="form-input"
                        placeholder="unit (optional)"
                        style={{ flex: 1 }}
                        value={f.unit}
                        onChange={e => handleFieldChange(idx, 'unit', e.target.value)}
                      />
                      {fields.length > 1 && (
                        <button type="button" onClick={() => removeFieldRow(idx)} className="btn btn-secondary" style={{ padding: '8px', color: 'var(--danger)' }}>
                          ✕
                        </button>
                      )}
                    </div>
                  ))}
                </div>

                {/* Commands Builder */}
                <div style={{ display: 'flex', flexDirection: 'column', gap: '10px' }}>
                  <label className="form-label" style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
                    <span>Command Interface list</span>
                    <button type="button" onClick={addCommandRow} className="btn btn-secondary" style={{ padding: '4px 8px', fontSize: '0.8rem' }}>
                      <Plus size={12} /> Add Command
                    </button>
                  </label>

                  {commands.map((cmd, idx) => (
                    <div key={idx} style={{ display: 'flex', gap: '10px', alignItems: 'center' }}>
                      <input
                        type="text"
                        className="form-input"
                        placeholder="command_name (e.g. reset_actuator)"
                        style={{ flex: 1 }}
                        value={cmd}
                        onChange={e => handleCommandChange(idx, e.target.value)}
                      />
                      {commands.length > 1 && (
                        <button type="button" onClick={() => removeCommandRow(idx)} className="btn btn-secondary" style={{ padding: '8px', color: 'var(--danger)' }}>
                          ✕
                        </button>
                      )}
                    </div>
                  ))}
                </div>

                <button type="submit" className="btn btn-primary" style={{ width: '100%', marginTop: '10px' }}>
                  Seed Schema Configuration
                </button>
              </form>
            </div>
          )}
        </div>
      </div>
    </div>
  );
}

export default SchemaRegistry;
