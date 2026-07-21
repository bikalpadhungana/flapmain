import React, { useState, useEffect } from 'react';
import { useNavigate } from 'react-router-dom';
import { Search, Radio, Plus, Trash2, Copy, Check, Cpu, RefreshCw } from 'lucide-react';
import { API_BASE_URL } from '../config';

function Dashboard() {
  const [devices, setDevices] = useState([]);
  const [deviceTypes, setDeviceTypes] = useState([]);
  const [searchTerm, setSearchTerm] = useState('');
  
  // Form states
  const [newDevice, setNewDevice] = useState({
    device_id: '',
    name: '',
    device_type: '',
    location: '',
  });

  // Modal / Created Device Config banner
  const [createdConfig, setCreatedConfig] = useState(null);
  const [copied, setCopied] = useState(false);
  const [showForm, setShowForm] = useState(false);
  const [error, setError] = useState('');

  const navigate = useNavigate();
  const token = localStorage.getItem('token');

  useEffect(() => {
    if (!token) {
      navigate('/login');
      return;
    }
    fetchData();
  }, [token]);

  const fetchData = async () => {
    try {
      // 1. Fetch devices
      const devRes = await fetch(`${API_BASE_URL}/v1/devices`, {
        headers: { Authorization: `Bearer ${token}` },
      });
      if (devRes.status === 401) {
        navigate('/login');
        return;
      }
      const devData = await devRes.json();
      setDevices(Array.isArray(devData) ? devData : []);

      // 2. Fetch device types
      const typesRes = await fetch(`${API_BASE_URL}/v1/device-types`, {
        headers: { Authorization: `Bearer ${token}` },
      });
      const typesData = await typesRes.json();
      setDeviceTypes(Array.isArray(typesData) ? typesData : []);
      
      if (typesData.length > 0) {
        setNewDevice(prev => ({ 
          ...prev, 
          device_type: typesData[0].device_type,
          device_id: prev.device_id || autoGenerateId(typesData[0].device_type)
        }));
      }
    } catch (err) {
      console.error('Error fetching dashboard data:', err);
    }
  };

  const autoGenerateId = (type) => {
    const prefix = type ? type.split('_')[0] : 'dev';
    const rand = Math.random().toString(36).substring(2, 6);
    return `flap-${prefix}-${rand}`;
  };

  const handleDeviceTypeChange = (type) => {
    setNewDevice(prev => ({
      ...prev,
      device_type: type,
      device_id: autoGenerateId(type)
    }));
  };

  const handleRegister = async (e) => {
    e.preventDefault();
    setError('');
    setCreatedConfig(null);

    try {
      const response = await fetch(`${API_BASE_URL}/v1/devices`, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          Authorization: `Bearer ${token}`,
        },
        body: JSON.stringify(newDevice),
      });

      const data = await response.json();
      if (!response.ok) {
        throw new Error(data.message || 'Failed to register device');
      }

      const configHeader = `// --- FlapMain Arduino Hardware Config (config.h) ---
#define WIFI_SSID "Your_WiFi_SSID"
#define WIFI_PASSWORD "Your_WiFi_Password"

#define FLAPMAIN_SERVER "${API_BASE_URL}"
#define FLAPMAIN_DEVICE_ID "${newDevice.device_id}"
#define FLAPMAIN_DEVICE_KEY "${data.apiKey}"
`;

      setCreatedConfig({
        device_id: newDevice.device_id,
        device_type: newDevice.device_type,
        name: newDevice.name,
        apiKey: data.apiKey,
        configHeader,
      });

      setNewDevice({
        device_id: autoGenerateId(deviceTypes[0]?.device_type || 'dev'),
        name: '',
        device_type: deviceTypes[0]?.device_type || '',
        location: '',
      });
      fetchData(); // reload
    } catch (err) {
      setError(err.message);
    }
  };

  const handleCopyConfig = (code) => {
    navigator.clipboard.writeText(code);
    setCopied(true);
    setTimeout(() => setCopied(false), 2500);
  };

  const handleDelete = async (deviceId) => {
    if (!window.confirm(`Are you sure you want to deactivate ${deviceId}?`)) return;

    try {
      const response = await fetch(`${API_BASE_URL}/v1/devices/${deviceId}`, {
        method: 'DELETE',
        headers: { Authorization: `Bearer ${token}` },
      });

      if (response.ok) {
        fetchData();
      }
    } catch (err) {
      console.error('Error deleting device:', err);
    }
  };

  const filteredDevices = devices.filter(
    (d) =>
      d.name.toLowerCase().includes(searchTerm.toLowerCase()) ||
      d.device_id.toLowerCase().includes(searchTerm.toLowerCase()) ||
      d.device_type.toLowerCase().includes(searchTerm.toLowerCase())
  );

  return (
    <div style={{ flex: 1, display: 'flex', flexDirection: 'column', gap: '30px' }}>
      <header style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
        <div>
          <h1 style={{ fontSize: '2rem', fontWeight: '700' }}>Devices Panel</h1>
          <p style={{ color: 'var(--text-secondary)' }}>Manage hardware profiles and generate Arduino flash configurations.</p>
        </div>

        <button onClick={() => setShowForm(!showForm)} className="btn btn-primary">
          <Plus size={16} />
          <span>Provision Device</span>
        </button>
      </header>

      {/* Generated Device Flash Config Banner */}
      {createdConfig && (
        <div className="glass-panel" style={{ padding: '24px', borderLeft: '4px solid var(--success)', background: 'rgba(16, 185, 129, 0.05)', textAlign: 'left' }}>
          <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'start', marginBottom: '12px' }}>
            <h4 style={{ color: 'var(--success)', fontSize: '1.1rem', display: 'flex', alignItems: 'center', gap: '8px' }}>
              <Cpu size={20} /> Device Registered: {createdConfig.device_id}
            </h4>
            <button
              onClick={() => handleCopyConfig(createdConfig.configHeader)}
              className="btn btn-primary"
              style={{ padding: '6px 14px', fontSize: '0.85rem' }}
            >
              {copied ? <Check size={14} /> : <Copy size={14} />}
              <span>{copied ? 'Config Copied!' : 'Copy config.h Snippet'}</span>
            </button>
          </div>

          <p style={{ fontSize: '0.9rem', color: 'var(--text-primary)', marginBottom: '12px' }}>
            Device API key generated! Copy the hardware config header snippet below directly into your <code>config.h</code> Arduino code:
          </p>

          <pre style={{ background: '#f8fafc', color: '#0f172a', padding: '14px', borderRadius: '6px', fontSize: '0.85rem', overflowX: 'auto', border: '1px solid #cbd5e1', fontFamily: 'var(--font-mono)' }}>
            {createdConfig.configHeader}
          </pre>
        </div>
      )}

      {/* Provision Device Form */}
      {showForm && (
        <div className="glass-panel" style={{ padding: '24px', textAlign: 'left' }}>
          <h3 style={{ fontSize: '1.25rem', marginBottom: '16px' }}>Provision New IoT Device</h3>
          {error && <p style={{ color: 'var(--danger)', fontSize: '0.85rem', marginBottom: '12px' }}>{error}</p>}
          <form onSubmit={handleRegister} style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(200px, 1fr))', gap: '20px', alignItems: 'end' }}>
            <div className="form-group">
              <label className="form-label">Device Type Schema</label>
              <select
                className="form-input"
                style={{ background: '#ffffff', height: '46px' }}
                value={newDevice.device_type}
                onChange={(e) => handleDeviceTypeChange(e.target.value)}
                required
              >
                {deviceTypes.map((type) => (
                  <option key={type.device_type} value={type.device_type}>
                    {type.display_name} ({type.device_type})
                  </option>
                ))}
              </select>
            </div>

            <div className="form-group">
              <label className="form-label" style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
                <span>Device ID</span>
                <button
                  type="button"
                  onClick={() => setNewDevice({ ...newDevice, device_id: autoGenerateId(newDevice.device_type) })}
                  style={{ background: 'none', border: 'none', color: 'var(--accent)', cursor: 'pointer', fontSize: '0.75rem', display: 'flex', alignItems: 'center', gap: '4px' }}
                >
                  <RefreshCw size={10} /> Auto ID
                </button>
              </label>
              <input
                type="text"
                className="form-input"
                placeholder="e.g. flap-ultrasonic-a1"
                value={newDevice.device_id}
                onChange={(e) => setNewDevice({ ...newDevice, device_id: e.target.value })}
                required
              />
            </div>

            <div className="form-group">
              <label className="form-label">Friendly Name</label>
              <input
                type="text"
                className="form-input"
                placeholder="e.g. Water Tank Ultrasonic Sensor"
                value={newDevice.name}
                onChange={(e) => setNewDevice({ ...newDevice, name: e.target.value })}
                required
              />
            </div>

            <div className="form-group">
              <label className="form-label">Location / Tag</label>
              <input
                type="text"
                className="form-input"
                placeholder="e.g. Roof Top Tank #1"
                value={newDevice.location}
                onChange={(e) => setNewDevice({ ...newDevice, location: e.target.value })}
              />
            </div>

            <button type="submit" className="btn btn-primary" style={{ height: '46px', width: '100%' }}>
              Submit & Generate Code Snippet
            </button>
          </form>
        </div>
      )}

      {/* Devices grid */}
      <div style={{ display: 'flex', flexDirection: 'column', gap: '16px' }}>
        <div style={{ display: 'flex', gap: '12px', background: '#ffffff', padding: '12px 16px', borderRadius: 'var(--radius-sm)', border: '1px solid var(--card-border)', alignItems: 'center' }}>
          <Search size={18} color="var(--text-muted)" />
          <input
            type="text"
            placeholder="Search devices by name, id or type schema..."
            value={searchTerm}
            onChange={(e) => setSearchTerm(e.target.value)}
            style={{ background: 'transparent', border: 'none', color: 'var(--text-primary)', fontSize: '0.95rem', width: '100%', outline: 'none' }}
          />
        </div>

        {filteredDevices.length === 0 ? (
          <div className="glass-panel" style={{ padding: '60px', color: 'var(--text-secondary)' }}>
            No devices matched your query.
          </div>
        ) : (
          <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fill, minmax(320px, 1fr))', gap: '20px' }}>
            {filteredDevices.map((device) => (
              <div
                key={device.device_id}
                className="glass-panel glass-panel-hover"
                style={{ padding: '24px', textAlign: 'left', display: 'flex', flexDirection: 'column', gap: '16px', cursor: 'pointer' }}
                onClick={() => navigate(`/device/${device.device_id}`)}
              >
                <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'start' }}>
                  <div style={{ display: 'flex', gap: '12px', alignItems: 'center' }}>
                    <div style={{ background: device.status === 'online' ? 'var(--success-glow)' : 'var(--danger-glow)', borderRadius: '50%', padding: '8px', display: 'flex', alignItems: 'center', justifyContent: 'center' }}>
                      <Radio size={18} color={device.status === 'online' ? 'var(--success)' : 'var(--danger)'} />
                    </div>
                    <div>
                      <h3 style={{ fontSize: '1.15rem' }}>{device.name}</h3>
                      <code style={{ fontSize: '0.75rem', color: 'var(--text-muted)' }}>{device.device_id}</code>
                    </div>
                  </div>

                  <button
                    onClick={(e) => {
                      e.stopPropagation(); // prevent card click navigation
                      handleDelete(device.device_id);
                    }}
                    className="btn btn-secondary"
                    style={{ padding: '6px', borderRadius: '4px', borderColor: 'transparent', color: 'var(--text-muted)' }}
                  >
                    <Trash2 size={16} />
                  </button>
                </div>

                <div style={{ fontSize: '0.85rem', color: 'var(--text-secondary)', display: 'flex', flexDirection: 'column', gap: '4px' }}>
                  <div><strong>Schema:</strong> {device.device_type}</div>
                  <div><strong>Location:</strong> {device.location || 'Not Specified'}</div>
                  <div><strong>Status:</strong> {device.status}</div>
                </div>

                <div style={{ marginTop: 'auto', paddingTop: '12px', borderTop: '1px solid var(--card-border)', display: 'flex', justifyContent: 'space-between', fontSize: '0.75rem', color: 'var(--text-muted)' }}>
                  <span>Last Seen: {device.last_seen ? new Date(device.last_seen).toLocaleString() : 'Never'}</span>
                  <span style={{ color: 'var(--accent)' }}>View Graphs & Logs →</span>
                </div>
              </div>
            ))}
          </div>
        )}
      </div>
    </div>
  );
}

export default Dashboard;
