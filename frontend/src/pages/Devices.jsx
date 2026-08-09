import React, { useState, useEffect } from 'react';
import { useNavigate } from 'react-router-dom';
import { Plus, Database, Cpu, Check, Copy, RefreshCw, Trash2, Search, Activity, Box, Edit2, Download } from 'lucide-react';
import { API_BASE_URL } from '../config';
import Modal from '../components/Modal';
import ConfirmModal from '../components/ConfirmModal';

function Devices() {
  const navigate = useNavigate();
  const token = localStorage.getItem('token');
  const user = JSON.parse(localStorage.getItem('user') || '{}');

  const [activeTab, setActiveTab] = useState('active'); // 'active', 'physical', or 'schemas'
  const [loading, setLoading] = useState(true);

  // ---------- SCHEMA (HARDWARE TYPE) STATES ----------
  const [schemas, setSchemas] = useState([]);
  const [isSchemaModalOpen, setIsSchemaModalOpen] = useState(false);
  const [editingSchema, setEditingSchema] = useState(null);

  const [schemaDeviceType, setSchemaDeviceType] = useState('');
  const [schemaDisplayName, setSchemaDisplayName] = useState('');
  const [schemaFields, setSchemaFields] = useState([{ name: '', type: 'number', unit: '' }]);
  const [schemaCommands, setSchemaCommands] = useState(['']);

  const [schemaError, setSchemaError] = useState('');
  const [schemaSuccess, setSchemaSuccess] = useState('');
  const [quickProvision, setQuickProvision] = useState(true);

  // ---------- DEVICE STATES ----------
  const [devices, setDevices] = useState([]);
  const [isDeviceModalOpen, setIsDeviceModalOpen] = useState(false);
  const [editingDevice, setEditingDevice] = useState(null);
  const [searchTerm, setSearchTerm] = useState('');

  const [newDevice, setNewDevice] = useState({ device_id: '', name: '', device_type: '', location: '', category: 'Physical', status: 'Active', ip_address: '', min_usage: '' });
  const [deviceError, setDeviceError] = useState('');
  const [createdConfig, setCreatedConfig] = useState(null);
  const [copied, setCopied] = useState(false);
  
  const [confirmModal, setConfirmModal] = useState({ isOpen: false, deviceId: null, action: null }); // action: 'delete' | 'activate'

  const handleDownloadConfig = () => {
    if (!createdConfig) return;
    const blob = new Blob([createdConfig.configHeader], { type: 'text/plain' });
    const url = URL.createObjectURL(blob);
    const link = document.createElement('a');
    link.href = url;
    link.download = `config_${createdConfig.device_id}.h`;
    document.body.appendChild(link);
    link.click();
    document.body.removeChild(link);
    URL.revokeObjectURL(url);
  };

  useEffect(() => {
    if (!token) {
      navigate('/login');
      return;
    }
    fetchData();
  }, [token]);

  const fetchData = async () => {
    setLoading(true);
    try {
      const devRes = await fetch(`${API_BASE_URL}/v1/devices`, { headers: { Authorization: `Bearer ${token}` } });
      const typesRes = await fetch(`${API_BASE_URL}/v1/device-types`, { headers: { Authorization: `Bearer ${token}` } });

      const devData = await devRes.json();
      const typesData = await typesRes.json();

      setDevices(Array.isArray(devData) ? devData : []);
      const schemasData = Array.isArray(typesData) ? typesData : [];
      setSchemas(schemasData);

      if (schemasData.length > 0 && !newDevice.device_type) {
        setNewDevice(prev => ({
          ...prev,
          device_type: schemasData[0].device_type,
          device_id: prev.device_id || autoGenerateId(schemasData[0].device_type)
        }));
      }
    } catch (err) {
      console.error(err);
    } finally {
      setLoading(false);
    }
  };

  // ----- SCHEMA HELPERS -----
  const openSchemaModal = (schemaToEdit = null) => {
    setSchemaError('');
    setSchemaSuccess('');

    if (schemaToEdit) {
      setEditingSchema(schemaToEdit);
      setSchemaDeviceType(schemaToEdit.device_type);
      setSchemaDisplayName(schemaToEdit.display_name);

      const fieldsArr = Object.entries(schemaToEdit.fields).map(([name, def]) => ({
        name, type: def.type, unit: def.unit || ''
      }));
      setSchemaFields(fieldsArr.length > 0 ? fieldsArr : [{ name: '', type: 'number', unit: '' }]);
      setSchemaCommands(schemaToEdit.commands?.length > 0 ? schemaToEdit.commands : ['']);
      setQuickProvision(false);
    } else {
      setEditingSchema(null);
      setSchemaDeviceType('');
      setSchemaDisplayName('');
      setSchemaFields([{ name: '', type: 'number', unit: '' }]);
      setSchemaCommands(['']);
      setQuickProvision(true);
    }
    setIsSchemaModalOpen(true);
  };

  const handleFieldChange = (index, key, val) => {
    const updated = [...schemaFields];
    updated[index][key] = val;
    setSchemaFields(updated);
  };
  const handleCommandChange = (index, val) => {
    const updated = [...schemaCommands];
    updated[index] = val;
    setSchemaCommands(updated);
  };

  const handleSaveSchema = async (e) => {
    e.preventDefault();
    setSchemaError('');
    setSchemaSuccess('');

    const fieldsObj = {};
    for (const f of schemaFields) {
      if (!f.name) continue;
      fieldsObj[f.name.trim()] = { type: f.type, unit: f.unit ? f.unit.trim() : undefined };
    }

    if (Object.keys(fieldsObj).length === 0) {
      setSchemaError('Please define at least one valid schema field parameter.');
      return;
    }

    const filteredCommands = schemaCommands.map(c => c.trim()).filter(c => c !== '');
    const finalDeviceType = schemaDeviceType.trim();

    const payload = {
      display_name: schemaDisplayName.trim(),
      fields: fieldsObj,
      commands: filteredCommands,
    };
    if (!editingSchema) payload.device_type = finalDeviceType;

    try {
      const url = editingSchema
        ? `${API_BASE_URL}/v1/device-types/${editingSchema.device_type}`
        : `${API_BASE_URL}/v1/device-types`;

      const method = editingSchema ? 'PUT' : 'POST';

      const response = await fetch(url, {
        method,
        headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${token}` },
        body: JSON.stringify(payload),
      });

      const data = await response.json();
      if (!response.ok) throw new Error(data.message || 'Failed to save hardware type configuration');

      // 2. Quick Provision if creating new
      if (!editingSchema && quickProvision) {
        const autoDevId = autoGenerateId(finalDeviceType);
        const devResponse = await fetch(`${API_BASE_URL}/v1/devices`, {
          method: 'POST',
          headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${token}` },
          body: JSON.stringify({
            device_id: autoDevId,
            name: `${schemaDisplayName.trim()} (Node 1)`,
            device_type: finalDeviceType,
            location: 'Default'
          }),
        });
        const devData = await devResponse.json();
        if (devResponse.ok) {
          setIsSchemaModalOpen(false);
          const configHeader = `// --- FlapMain Arduino Hardware Config (config.h) ---\n#define WIFI_SSID "Your_WiFi_SSID"\n#define WIFI_PASSWORD "Your_WiFi_Password"\n\n#define FLAPMAIN_SERVER "${API_BASE_URL}"\n#define FLAPMAIN_DEVICE_ID "${autoDevId}"\n#define FLAPMAIN_DEVICE_KEY "${devData.apiKey}"\n`;
          setCreatedConfig({
            device_id: autoDevId,
            device_type: finalDeviceType,
            name: `${schemaDisplayName.trim()} (Node 1)`,
            apiKey: devData.apiKey,
            configHeader,
          });
          setEditingDevice(null);
          setIsDeviceModalOpen(true);
          fetchData();
          return;
        }
      }

      setSchemaSuccess(`Successfully ${editingSchema ? 'updated' : 'registered'} hardware type '${finalDeviceType}'`);
      fetchData();
      setTimeout(() => { setIsSchemaModalOpen(false); setSchemaSuccess(''); }, 1000);
    } catch (err) {
      setSchemaError(err.message);
    }
  };

  // ----- DEVICE HELPERS -----
  const autoGenerateId = (type) => {
    const prefix = type ? type.split('_')[0] : 'dev';
    const rand = Math.random().toString(36).substring(2, 6);
    return `flap-${prefix}-${rand}`;
  };

  const handleDeviceTypeChange = (type) => {
    if (!editingDevice) {
      setNewDevice(prev => ({ ...prev, device_type: type, device_id: autoGenerateId(type) }));
    }
  };

  const openDeviceModal = (deviceToEdit = null) => {
    setDeviceError('');
    setCreatedConfig(null);

    if (deviceToEdit) {
      setEditingDevice(deviceToEdit);
      setNewDevice({
        device_id: deviceToEdit.device_id,
        name: deviceToEdit.name,
        device_type: deviceToEdit.device_type,
        location: deviceToEdit.location || '',
        category: deviceToEdit.category || 'Physical',
        status: deviceToEdit.status || 'Active',
        ip_address: deviceToEdit.ip_address || '',
        min_usage: deviceToEdit.min_usage || ''
      });
    } else {
      setEditingDevice(null);
      setNewDevice({
        device_id: autoGenerateId(schemas[0]?.device_type || 'dev'),
        name: '',
        device_type: schemas[0]?.device_type || '',
        location: '',
        category: 'Physical',
        status: 'Active',
        ip_address: '',
        min_usage: ''
      });
    }
    setIsDeviceModalOpen(true);
  };

  const handleSaveDevice = async (e) => {
    e.preventDefault();
    setDeviceError('');
    setCreatedConfig(null);

    try {
      const url = editingDevice
        ? `${API_BASE_URL}/v1/devices/${editingDevice.device_id}`
        : `${API_BASE_URL}/v1/devices`;
      const method = editingDevice ? 'PUT' : 'POST';

      const payload = editingDevice ? { 
        name: newDevice.name, 
        location: newDevice.location,
        category: newDevice.category,
        status: newDevice.status,
        ip_address: newDevice.ip_address,
        min_usage: newDevice.min_usage
      } : newDevice;

      const response = await fetch(url, {
        method,
        headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${token}` },
        body: JSON.stringify(payload),
      });

      const data = await response.json();
      if (!response.ok) throw new Error(data.message || `Failed to ${editingDevice ? 'update' : 'register'} device`);

      if (!editingDevice) {
        const configHeader = `// --- FlapMain Arduino Hardware Config (config.h) ---\n#define WIFI_SSID "Your_WiFi_SSID"\n#define WIFI_PASSWORD "Your_WiFi_Password"\n\n#define FLAPMAIN_SERVER "${API_BASE_URL}"\n#define FLAPMAIN_DEVICE_ID "${newDevice.device_id}"\n#define FLAPMAIN_DEVICE_KEY "${data.apiKey}"\n`;
        setCreatedConfig({
          ...newDevice,
          apiKey: data.apiKey,
          configHeader,
        });
      } else {
        setIsDeviceModalOpen(false);
      }

      fetchData();
    } catch (err) {
      setDeviceError(err.message);
    }
  };

  const handleDeleteDeviceClick = (deviceId) => {
    setConfirmModal({ isOpen: true, deviceId, action: 'delete' });
  };

  const handleActivateDeviceClick = (deviceId, e) => {
    e.stopPropagation();
    setConfirmModal({ isOpen: true, deviceId, action: 'activate' });
  };

  const handleConfirmAction = async () => {
    const { deviceId, action } = confirmModal;
    if (!deviceId || !action) return;

    if (action === 'delete') {
      try {
        const response = await fetch(`${API_BASE_URL}/v1/devices/${deviceId}`, {
          method: 'DELETE',
          headers: { Authorization: `Bearer ${token}` },
        });
        if (response.ok) fetchData();
      } catch (err) {
        console.error('Error deleting device:', err);
      }
    } else if (action === 'activate') {
      try {
        const response = await fetch(`${API_BASE_URL}/v1/devices/${deviceId}/activate`, {
          method: 'PATCH',
          headers: { 
            Authorization: `Bearer ${token}`,
            'Content-Type': 'application/json'
          },
          body: JSON.stringify({})
        });
        if (response.ok) fetchData();
      } catch (err) {
        console.error('Error activating device:', err);
      }
    }
  };

  // Filters
  const filteredDevices = devices.filter(
    (d) =>
      d.name.toLowerCase().includes(searchTerm.toLowerCase()) ||
      d.device_id.toLowerCase().includes(searchTerm.toLowerCase()) ||
      d.device_type.toLowerCase().includes(searchTerm.toLowerCase())
  );

  const activeDevices = filteredDevices.filter(d => d.status === 'online');
  const devicesToRender = activeTab === 'active' ? activeDevices : filteredDevices;

  return (
    <div className="flex flex-col gap-6 flex-1 h-full relative">
      <header className="flex justify-between items-center">
        <div>
          <h1 className="text-main" style={{ fontSize: '1.75rem', fontWeight: 600, letterSpacing: '-0.02em' }}>Hardware & Devices</h1>
          <p className="text-muted text-sm mt-1">Manage physical devices and define hardware types (schemas).</p>
        </div>
        <div className="flex gap-3">
          {(activeTab === 'active' || activeTab === 'physical') ? (
            <button onClick={() => openDeviceModal()} className="btn btn-primary">
              <Plus size={16} /> Add Physical Device
            </button>
          ) : (
            user.role === 'admin' && (
              <button onClick={() => openSchemaModal()} className="btn btn-primary">
                <Plus size={16} /> Register Hardware Type
              </button>
            )
          )}
        </div>
      </header>

      {/* TABS */}
      <div className="flex gap-4 border-b border-subtle">
        <button
          onClick={() => setActiveTab('active')}
          style={{ padding: '0.5rem 1rem', borderBottom: activeTab === 'active' ? '2px solid var(--action-primary)' : '2px solid transparent', fontWeight: activeTab === 'active' ? 600 : 500, color: activeTab === 'active' ? 'var(--action-primary)' : 'var(--text-muted)', background: 'transparent', cursor: 'pointer', display: 'flex', alignItems: 'center', gap: '6px' }}
        >
          <Activity size={16} /> Active Devices
        </button>
        <button
          onClick={() => setActiveTab('physical')}
          style={{ padding: '0.5rem 1rem', borderBottom: activeTab === 'physical' ? '2px solid var(--action-primary)' : '2px solid transparent', fontWeight: activeTab === 'physical' ? 600 : 500, color: activeTab === 'physical' ? 'var(--action-primary)' : 'var(--text-muted)', background: 'transparent', cursor: 'pointer', display: 'flex', alignItems: 'center', gap: '6px' }}
        >
          <Box size={16} /> All Physical Devices
        </button>
        <button
          onClick={() => setActiveTab('schemas')}
          style={{ padding: '0.5rem 1rem', borderBottom: activeTab === 'schemas' ? '2px solid var(--action-primary)' : '2px solid transparent', fontWeight: activeTab === 'schemas' ? 600 : 500, color: activeTab === 'schemas' ? 'var(--action-primary)' : 'var(--text-muted)', background: 'transparent', cursor: 'pointer', display: 'flex', alignItems: 'center', gap: '6px' }}
        >
          <Cpu size={16} /> Hardware Types (Schemas)
        </button>
      </div>

      {loading ? (
        <div className="text-muted text-sm mt-4">Loading data...</div>
      ) : (
        <>
          {/* TAB 1 & 2: DEVICES */}
          {(activeTab === 'active' || activeTab === 'physical') && (
            <div className="flex flex-col gap-4 mt-2">
              <div className="flex items-center gap-3 bg-white px-4 py-3 rounded-md border border-subtle w-full max-w-md">
                <Search size={18} className="text-muted" />
                <input type="text" placeholder="Search devices by name, id or type schema..." value={searchTerm} onChange={(e) => setSearchTerm(e.target.value)} className="w-full h-full bg-transparent border-none text-main outline-none text-sm" />
              </div>

              {devicesToRender.length === 0 ? (
                <div className="card card-body text-center text-muted">
                  {activeTab === 'active' ? 'No active devices connected right now.' : 'No devices found. Register a physical device to see it here.'}
                </div>
              ) : (
                <div className="grid" style={{ gridTemplateColumns: 'repeat(auto-fill, minmax(320px, 1fr))', gap: 'var(--space-4)' }}>
                  {devicesToRender.map((device) => (
                    <div key={device.device_id} className={`card ${device.activation_status === 'pending' ? 'card-pending' : 'card-hover'}`} style={{ cursor: 'pointer', border: device.activation_status === 'pending' ? '1px dashed var(--status-warning)' : undefined }} onClick={() => navigate(`/device/${device.device_id}`)}>
                      <div className="card-body flex flex-col gap-4 h-full">
                        <div className="flex justify-between items-start">
                          <div className="flex items-center gap-3">
                            {device.activation_status === 'pending' ? (
                              <div className="status-dot warning" style={{ background: 'var(--status-warning)' }} />
                            ) : (
                              <div className={`status-dot ${device.status === 'online' ? 'online' : 'offline'}`} />
                            )}
                            <div>
                              <div className="flex items-center gap-2">
                                <h3 style={{ fontSize: '1rem', fontWeight: 600, margin: 0 }}>{device.name}</h3>
                                {device.activation_status === 'pending' && <span className="badge badge-warning" style={{ fontSize: '0.65rem', padding: '2px 6px' }}>PENDING</span>}
                              </div>
                              <div className="text-mono text-muted text-xs mt-1">{device.device_id}</div>
                            </div>
                          </div>
                          <div className="flex gap-1" onClick={e => e.stopPropagation()}>
                            <button onClick={() => openDeviceModal(device)} className="btn btn-icon text-muted" style={{ background: 'transparent' }} onMouseEnter={(e) => { e.currentTarget.style.color = 'var(--action-primary)' }} onMouseLeave={(e) => { e.currentTarget.style.color = 'var(--text-muted)' }}>
                              <Edit2 size={16} />
                            </button>
                            <button onClick={() => handleDeleteDeviceClick(device.device_id)} className="btn btn-icon text-muted" style={{ background: 'transparent' }} onMouseEnter={(e) => { e.currentTarget.style.color = 'var(--status-error)' }} onMouseLeave={(e) => { e.currentTarget.style.color = 'var(--text-muted)' }}>
                              <Trash2 size={16} />
                            </button>
                          </div>
                        </div>
                        <div className="text-sm flex flex-col gap-1 mt-2 border-t border-subtle pt-3">
                          <div className="flex justify-between pb-1"><span className="text-muted">Type:</span><code className="text-xs bg-gray-100 px-1 rounded">{device.device_type}</code></div>
                          <div className="flex justify-between"><span className="text-muted">Location:</span><span className="font-medium">{device.location || 'N/A'}</span></div>
                          {device.last_seen && (
                            <div className="flex justify-between mt-1 pt-1 border-t border-subtle border-dashed"><span className="text-muted">Last Seen:</span><span className="text-xs text-dim">{new Date(device.last_seen).toLocaleString()}</span></div>
                          )}
                          {device.activation_status === 'pending' && (
                            <button onClick={(e) => handleActivateDeviceClick(device.device_id, e)} className="btn btn-primary w-full mt-3 flex justify-center text-xs" style={{ padding: '4px 8px' }}>
                              🚀 Activate Device
                            </button>
                          )}
                        </div>
                      </div>
                    </div>
                  ))}
                </div>
              )}
            </div>
          )}

          {/* TAB 3: SCHEMAS */}
          {activeTab === 'schemas' && (
            <div className="flex flex-col gap-4 mt-2">
              <div className="grid gap-4" style={{ gridTemplateColumns: 'repeat(auto-fill, minmax(320px, 1fr))', alignItems: 'start' }}>
                {schemas.map((s) => (
                  <div key={s._id} className="card flex flex-col gap-3" style={{ padding: 'var(--space-4)' }}>
                    <div className="flex justify-between items-start border-b border-subtle pb-2">
                      <div className="flex items-center gap-3">
                        <div className="p-1.5 rounded" style={{ background: '#f3f4f6' }}>
                          <Database size={16} className="text-accent" />
                        </div>
                        <div>
                          <h4 style={{ fontSize: '0.95rem', fontWeight: 600, margin: 0, lineHeight: 1.2 }}>{s.display_name}</h4>
                          <code className="text-mono text-xs text-muted m-0">{s.device_type} (v{s.version})</code>
                        </div>
                      </div>
                      {user.role === 'admin' && (
                        <button onClick={() => openSchemaModal(s)} className="btn btn-icon text-muted" style={{ background: 'transparent' }} onMouseEnter={(e) => { e.currentTarget.style.color = 'var(--action-primary)' }} onMouseLeave={(e) => { e.currentTarget.style.color = 'var(--text-muted)' }}>
                          <Edit2 size={16} />
                        </button>
                      )}
                    </div>
                    <div className="flex flex-col gap-3 text-sm">
                      <div>
                        <span className="text-xs text-dim font-medium uppercase tracking-wider mb-1 block">Telemetry Fields</span>
                        <div className="flex flex-wrap gap-1.5">
                          {Object.entries(s.fields).map(([name, def]) => (
                            <span key={name} className="badge badge-neutral" style={{ padding: '2px 8px', fontSize: '0.7rem' }}>
                              <strong className="text-main">{name}</strong>: {def.type} {def.unit && `(${def.unit})`}
                            </span>
                          ))}
                        </div>
                      </div>
                      <div>
                        <span className="text-xs text-dim font-medium uppercase tracking-wider mb-1 block">Commands</span>
                        <div className="flex flex-wrap gap-1.5">
                          {s.commands.length > 0 ? (
                            s.commands.map((cmd) => <span key={cmd} className="badge badge-accent" style={{ padding: '2px 8px', fontSize: '0.7rem' }}>{cmd}</span>)
                          ) : <span className="text-muted text-xs">None</span>}
                        </div>
                      </div>
                    </div>
                  </div>
                ))}
              </div>
            </div>
          )}
        </>
      )}

      {/* --- DEVICE MODAL --- */}
      <Modal
        open={isDeviceModalOpen}
        onClose={() => setIsDeviceModalOpen(false)}
        title={editingDevice ? 'Edit Physical Device' : 'Provision New Physical Device'}
        maxWidth="800px"
        actions={
          !createdConfig ? (
            <>
              <button type="button" onClick={() => setIsDeviceModalOpen(false)} className="btn btn-secondary">Cancel</button>
              <button type="submit" form="deviceForm" className="btn btn-primary">{editingDevice ? 'Save Changes' : 'Register & Generate Config'}</button>
            </>
          ) : (
            <button type="button" onClick={() => setIsDeviceModalOpen(false)} className="btn btn-primary">Done</button>
          )
        }
      >
        {deviceError && <div className="text-error text-sm mb-3 p-2 rounded" style={{ background: 'var(--status-error-bg)' }}>{deviceError}</div>}

        {createdConfig ? (
          <div className="flex flex-col gap-4 animate-slide-up">
            <div className="flex justify-between items-start mb-2 border-b border-subtle pb-3">
              <h4 className="flex items-center gap-2 text-success" style={{ fontSize: '1rem', fontWeight: 600 }}><Cpu size={18} /> Device Registered: {createdConfig.device_id}</h4>
              <div className="flex gap-2">
                <button onClick={() => { navigator.clipboard.writeText(createdConfig.configHeader); setCopied(true); setTimeout(() => setCopied(false), 2500); }} className="btn btn-secondary btn-sm" style={{ transition: 'all 0.2s' }}>
                  {copied ? <Check size={14} className="text-success" /> : <Copy size={14} />} 
                  <span className={copied ? "text-success" : ""}>{copied ? 'Copied!' : 'Copy Config'}</span>
                </button>
                <button onClick={handleDownloadConfig} className="btn btn-primary btn-sm">
                  <Download size={14} /> Save config.h
                </button>
              </div>
            </div>
            
            <p className="text-sm text-muted m-0">You can save this Arduino hardware config to your local system or copy it into your project. It contains the secret <strong>DEVICE_KEY</strong>.</p>
            
            <div className="premium-code-block glow-border">
              <pre style={{ margin: 0, overflowX: 'auto', background: 'transparent', padding: 0, border: 'none', color: 'inherit' }}>{createdConfig.configHeader}</pre>
            </div>
          </div>
        ) : (
          <form id="deviceForm" onSubmit={handleSaveDevice}>
            {/* Device Details Section */}
            <h4 style={{ color: 'var(--action-primary)', fontSize: '0.9rem', fontWeight: 600, marginBottom: '12px' }}>
              Device Details
            </h4>
            <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: '16px', marginBottom: '24px' }}>
              <div className="form-group mb-0">
                <label className="form-label">Friendly Name *</label>
                <input type="text" className="form-input" placeholder="e.g. Main Door Sensor" value={newDevice.name} onChange={(e) => setNewDevice({ ...newDevice, name: e.target.value })} required />
              </div>
              <div className="form-group mb-0">
                <label className="form-label">Hardware Type Schema *</label>
                <select className="form-input form-select" value={newDevice.device_type} onChange={(e) => handleDeviceTypeChange(e.target.value)} required disabled={!!editingDevice}>
                  {schemas.map((type) => <option key={type.device_type} value={type.device_type}>{type.display_name} ({type.device_type})</option>)}
                </select>
              </div>
              <div className="form-group mb-0">
                <label className="form-label flex justify-between items-center">
                  <span>Device ID *</span>
                  {!editingDevice && (
                    <button type="button" onClick={() => setNewDevice({ ...newDevice, device_id: autoGenerateId(newDevice.device_type) })} className="text-xs text-accent flex items-center gap-1" style={{ background: 'none', border: 'none', cursor: 'pointer' }}><RefreshCw size={10} /> Auto</button>
                  )}
                </label>
                <input type="text" className="form-input bg-gray-50" placeholder="e.g. flap-a1" value={newDevice.device_id} onChange={(e) => setNewDevice({ ...newDevice, device_id: e.target.value })} required disabled={!!editingDevice} />
              </div>
              <div className="form-group mb-0">
                <label className="form-label">Device Category</label>
                <select className="form-input form-select" value={newDevice.category || 'Physical'} onChange={(e) => setNewDevice({ ...newDevice, category: e.target.value })}>
                  <option value="Physical">Physical Device</option>
                  <option value="Active">Active Device</option>
                </select>
              </div>
            </div>

            {/* Additional Info Section */}
            <h4 style={{ color: 'var(--action-primary)', fontSize: '0.9rem', fontWeight: 600, marginBottom: '12px' }}>
              Configuration & Location
            </h4>
            <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: '16px', marginBottom: '16px' }}>
              <div className="form-group mb-0">
                <label className="form-label">Location / Tag</label>
                <input type="text" className="form-input" placeholder="e.g. Lobby Entrance" value={newDevice.location} onChange={(e) => setNewDevice({ ...newDevice, location: e.target.value })} />
              </div>
              <div className="form-group mb-0">
                <label className="form-label">Status</label>
                <select className="form-input form-select" value={newDevice.status || 'Active'} onChange={(e) => setNewDevice({ ...newDevice, status: e.target.value })}>
                  <option value="Active">Active</option>
                  <option value="Inactive">Inactive</option>
                  <option value="Maintenance">Maintenance</option>
                </select>
              </div>
              <div className="form-group mb-0">
                <label className="form-label">IP Address (Optional)</label>
                <input type="text" className="form-input" placeholder="192.168.1.x" value={newDevice.ip_address || ''} onChange={(e) => setNewDevice({ ...newDevice, ip_address: e.target.value })} />
              </div>
              <div className="form-group mb-0">
                <label className="form-label">Minimum Usage Time</label>
                <input type="text" className="form-input" placeholder="e.g. 24 hours" value={newDevice.min_usage || ''} onChange={(e) => setNewDevice({ ...newDevice, min_usage: e.target.value })} />
              </div>
            </div>
          </form>
        )}
      </Modal>

      {/* --- SCHEMA MODAL --- */}
      <Modal
        open={isSchemaModalOpen}
        onClose={() => setIsSchemaModalOpen(false)}
        title={editingSchema ? 'Edit Hardware Type (Schema)' : 'Register New Hardware Type'}
        actions={
          <>
            <button type="button" onClick={() => setIsSchemaModalOpen(false)} className="btn btn-secondary">Cancel</button>
            <button type="submit" form="schemaForm" className="btn btn-primary">{editingSchema ? 'Save Changes' : 'Register Hardware Type'}</button>
          </>
        }
      >
        {schemaError && <div className="text-error text-sm mb-3 p-2 rounded" style={{ background: 'var(--status-error-bg)' }}>{schemaError}</div>}
        {schemaSuccess && <div className="text-success text-sm mb-3 flex items-center gap-2 p-2 rounded" style={{ background: 'var(--status-success-bg)' }}><Check size={14} /> {schemaSuccess}</div>}

        <form id="schemaForm" onSubmit={handleSaveSchema} className="flex flex-col gap-4">
          <div className="grid grid-cols-2 gap-4">
            <div className="form-group mb-0">
              <label className="form-label">Type Identifier (Unique ID)</label>
              <input type="text" className="form-input" placeholder="e.g. air_sensor_v1" value={schemaDeviceType} onChange={e => setSchemaDeviceType(e.target.value)} required disabled={!!editingSchema} />
            </div>
            <div className="form-group mb-0">
              <label className="form-label">Display Friendly Name</label>
              <input type="text" className="form-input" placeholder="e.g. Smart PM2.5 Sensor" value={schemaDisplayName} onChange={e => setSchemaDisplayName(e.target.value)} required />
            </div>
          </div>

          <div className="flex flex-col gap-2 pt-2 border-t border-subtle">
            <label className="form-label flex justify-between items-center">
              <span>Telemetry Field Configuration</span>
              <button type="button" onClick={() => setSchemaFields([...schemaFields, { name: '', type: 'number', unit: '' }])} className="btn btn-secondary btn-sm"><Plus size={12} /> Add Field</button>
            </label>
            {schemaFields.map((f, idx) => (
              <div key={idx} className="flex gap-2 items-center">
                <input type="text" className="form-input flex-1" placeholder="field_name" value={f.name} onChange={e => handleFieldChange(idx, 'name', e.target.value)} required />
                <select className="form-input form-select" style={{ width: '110px' }} value={f.type} onChange={e => handleFieldChange(idx, 'type', e.target.value)}>
                  <option value="number">number</option>
                  <option value="boolean">boolean</option>
                  <option value="string">string</option>
                </select>
                <input type="text" className="form-input" style={{ width: '130px' }} placeholder="unit (optional)" value={f.unit} onChange={e => handleFieldChange(idx, 'unit', e.target.value)} />
                {schemaFields.length > 1 ? (
                  <button type="button" onClick={() => setSchemaFields(schemaFields.filter((_, i) => i !== idx))} className="btn btn-danger btn-icon">✕</button>
                ) : <div style={{ width: '28px' }}></div>}
              </div>
            ))}
          </div>

          <div className="flex flex-col gap-2 pt-2 border-t border-subtle">
            <label className="form-label flex justify-between items-center">
              <span>Command Interface List</span>
              <button type="button" onClick={() => setSchemaCommands([...schemaCommands, ''])} className="btn btn-secondary btn-sm"><Plus size={12} /> Add Command</button>
            </label>
            {schemaCommands.map((cmd, idx) => (
              <div key={idx} className="flex gap-2 items-center">
                <input type="text" className="form-input flex-1" placeholder="command_name (e.g. reset_actuator)" value={cmd} onChange={e => handleCommandChange(idx, e.target.value)} />
                {schemaCommands.length > 1 ? (
                  <button type="button" onClick={() => setSchemaCommands(schemaCommands.filter((_, i) => i !== idx))} className="btn btn-danger btn-icon">✕</button>
                ) : <div style={{ width: '28px' }}></div>}
              </div>
            ))}
          </div>

          <div className="pt-4 border-t border-subtle mt-2 flex flex-col gap-4">
            {!editingSchema && (
              <div className="flex items-center gap-2">
                <input type="checkbox" id="quickProvision" checked={quickProvision} onChange={(e) => setQuickProvision(e.target.checked)} style={{ cursor: 'pointer' }} />
                <label htmlFor="quickProvision" className="text-sm font-medium" style={{ cursor: 'pointer' }}>Automatically provision the first physical device of this type</label>
              </div>
            )}
          </div>
        </form>
      </Modal>

      <ConfirmModal
        isOpen={confirmModal.isOpen}
        onClose={() => setConfirmModal({ isOpen: false, deviceId: null, action: null })}
        onConfirm={handleConfirmAction}
        title={confirmModal.action === 'activate' ? 'Activate Device' : 'Deactivate Device'}
        message={
          confirmModal.action === 'activate' ? (
            <><strong>Are you sure you want to activate {confirmModal.deviceId}?</strong><br/><br/>It will be authorized to communicate with the network.</>
          ) : (
            <><strong>Are you sure you want to deactivate {confirmModal.deviceId}?</strong><br/><br/>This device will be removed from the network.</>
          )
        }
        confirmText={confirmModal.action === 'activate' ? 'Activate' : 'Deactivate'}
        type={confirmModal.action === 'activate' ? 'primary' : 'danger'}
      />

    </div>
  );
}

export default Devices;
