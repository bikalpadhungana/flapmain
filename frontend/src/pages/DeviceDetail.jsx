import React, { useState, useEffect, useRef } from 'react';
import { useParams, useNavigate } from 'react-router-dom';
import { ArrowLeft, RefreshCw, Send, Download, Cpu, Copy, Check } from 'lucide-react';
import { LineChart as ReLineChart, Line as ReLine, XAxis as ReXAxis, YAxis as ReYAxis, CartesianGrid as ReCartesianGrid, Tooltip as ReTooltip, ResponsiveContainer as ReResponsiveContainer } from 'recharts';
import { API_BASE_URL } from '../config';

function DeviceDetail() {
  const { device_id } = useParams();
  const navigate = useNavigate();
  const token = localStorage.getItem('token');

  const [device, setDevice] = useState(null);
  const [deviceType, setDeviceType] = useState(null);
  const [readings, setReadings] = useState([]);
  const [loading, setLoading] = useState(true);
  const [limit, setLimit] = useState(10); // Default 10 payloads window
  
  // Hardware Config drawer state
  const [showConfig, setShowConfig] = useState(false);
  const [copied, setCopied] = useState(false);

  // Command panel state
  const [commandForm, setCommandForm] = useState({
    command: '',
    payload: '{}',
  });
  const [commandResponse, setCommandResponse] = useState('');

  // Polling ref
  const pollIntervalRef = useRef(null);

  useEffect(() => {
    if (!token) {
      navigate('/login');
      return;
    }

    loadInitialData();

    // Setup polling every 3 seconds for live ingest updates
    pollIntervalRef.current = setInterval(loadReadings, 3000);

    return () => {
      if (pollIntervalRef.current) clearInterval(pollIntervalRef.current);
    };
  }, [device_id, token, limit]);

  const loadInitialData = async () => {
    setLoading(true);
    try {
      // 1. Fetch device
      const devRes = await fetch(`${API_BASE_URL}/v1/devices/${device_id}`, {
        headers: { Authorization: `Bearer ${token}` },
      });
      if (!devRes.ok) throw new Error('Device not found');
      const devData = await devRes.json();
      setDevice(devData);

      // 2. Fetch all types to match schema details
      const typesRes = await fetch(`${API_BASE_URL}/v1/device-types`, {
        headers: { Authorization: `Bearer ${token}` },
      });
      const typesData = await typesRes.json();
      const matchedType = typesData.find(t => t.device_type === devData.device_type);
      setDeviceType(matchedType);
      if (matchedType && matchedType.commands.length > 0) {
        setCommandForm(prev => ({ ...prev, command: matchedType.commands[0] }));
      }

      // 3. Fetch readings
      await loadReadings();
    } catch (err) {
      console.error(err);
      navigate('/');
    } finally {
      setLoading(false);
    }
  };

  const loadReadings = async () => {
    try {
      const res = await fetch(`${API_BASE_URL}/v1/devices/${device_id}/readings?limit=${limit}`, {
        headers: { Authorization: `Bearer ${token}` },
      });
      const data = await res.json();
      setReadings(Array.isArray(data) ? data : []);
    } catch (err) {
      console.error('Error polling readings:', err);
    }
  };

  const handleSendCommand = async (e) => {
    e.preventDefault();
    setCommandResponse('');

    let parsedPayload = {};
    try {
      parsedPayload = JSON.parse(commandForm.payload);
    } catch (err) {
      setCommandResponse('Error: Payload must be valid JSON');
      return;
    }

    try {
      const response = await fetch(`${API_BASE_URL}/v1/devices/${device_id}/commands`, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          Authorization: `Bearer ${token}`,
        },
        body: JSON.stringify({
          command: commandForm.command,
          payload: parsedPayload,
        }),
      });

      const data = await response.json();
      if (!response.ok) {
        throw new Error(data.message || 'Transmission failed');
      }

      setCommandResponse(`Success: ${data.message}`);
    } catch (err) {
      setCommandResponse(`Error: ${err.message}`);
    }
  };

  const configSnippet = `// --- FlapMain Hardware Config for ${device_id} ---
#define WIFI_SSID "Your_WiFi_SSID"
#define WIFI_PASSWORD "Your_WiFi_Password"

#define FLAPMAIN_SERVER "${API_BASE_URL}"
#define FLAPMAIN_DEVICE_ID "${device_id}"
#define FLAPMAIN_DEVICE_KEY "YOUR_DEVICE_API_KEY" // (Generated at provision time)
`;

  const copyConfig = () => {
    navigator.clipboard.writeText(configSnippet);
    setCopied(true);
    setTimeout(() => setCopied(false), 2500);
  };

  if (loading) {
    return (
      <div style={{ flex: 1, display: 'flex', alignItems: 'center', justifyContent: 'center' }}>
        <RefreshCw className="animate-spin" size={32} color="var(--accent)" />
      </div>
    );
  }

  // Get numeric fields to draw Line Charts for
  const schemaFields = deviceType ? Object.entries(deviceType.fields) : [];
  const numericFields = schemaFields.filter(([_, fieldDef]) => fieldDef.type === 'number');

  // Chart data formatting: reverse readings array to show chronologically (left to right)
  const chartData = [...readings].reverse().map(r => ({
    timestamp: new Date(r.timestamp).toLocaleTimeString(),
    ...r.payload
  }));

  const exportUrl = (format) => `${API_BASE_URL}/v1/devices/${device_id}/export?format=${format}`;

  return (
    <div style={{ flex: 1, display: 'flex', flexDirection: 'column', gap: '30px', textAlign: 'left' }}>
      <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
        <div style={{ display: 'flex', alignItems: 'center', gap: '12px' }}>
          <button onClick={() => navigate('/')} className="btn btn-secondary" style={{ padding: '8px' }}>
            <ArrowLeft size={18} />
          </button>
          <div>
            <h1 style={{ fontSize: '1.75rem', fontWeight: '700', margin: 0 }}>{device?.name}</h1>
            <code style={{ fontSize: '0.8rem', color: 'var(--text-muted)' }}>ID: {device?.device_id} • Schema: {device?.device_type}</code>
          </div>
        </div>

        <button onClick={() => setShowConfig(!showConfig)} className="btn btn-secondary">
          <Cpu size={16} />
          <span>{showConfig ? 'Hide Hardware Code' : 'Hardware C++ Code Config'}</span>
        </button>
      </div>

      {/* Hardware C++ Header Code Modal */}
      {showConfig && (
        <div className="glass-panel" style={{ padding: '20px', borderLeft: '4px solid var(--accent)' }}>
          <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: '10px' }}>
            <h4 style={{ fontSize: '1rem', color: 'var(--accent)', fontWeight: '600' }}>
              Arduino C++ Configuration Header (config.h)
            </h4>
            <button onClick={copyConfig} className="btn btn-primary" style={{ padding: '4px 12px', fontSize: '0.8rem' }}>
              {copied ? <Check size={12} /> : <Copy size={12} />}
              <span>{copied ? 'Copied!' : 'Copy Code'}</span>
            </button>
          </div>
          <pre style={{ background: '#f8fafc', color: '#0f172a', padding: '12px', borderRadius: '4px', fontSize: '0.85rem', fontFamily: 'var(--font-mono)', border: '1px solid #cbd5e1' }}>
            {configSnippet}
          </pre>
        </div>
      )}

      <div style={{ display: 'grid', gridTemplateColumns: '2fr 1fr', gap: '30px' }}>
        {/* Left Column: Line Charts & History Log */}
        <div style={{ display: 'flex', flexDirection: 'column', gap: '30px' }}>
          {/* Dynamic Charts Display */}
          {numericFields.map(([fieldName, fieldDef]) => (
            <div key={fieldName} className="glass-panel" style={{ padding: '24px' }}>
              <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: '16px' }}>
                <h3 style={{ fontSize: '1.15rem' }}>
                  {fieldName} ({fieldDef.unit || 'unit'}) — Sensor Ingestion Window
                </h3>
                <span style={{ fontSize: '0.8rem', color: 'var(--text-muted)' }}>
                  Showing latest {readings.length} payloads
                </span>
              </div>

              <div style={{ width: '100%', height: '220px' }}>
                {chartData.length === 0 ? (
                  <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'center', height: '100%', color: 'var(--text-muted)' }}>
                    No telemetry records. Send readings from ESP8266 to plot graph.
                  </div>
                ) : (
                  <ReResponsiveContainer width="100%" height="100%">
                    <ReLineChart data={chartData}>
                      <ReCartesianGrid strokeDasharray="3 3" stroke="#e2e8f0" />
                      <ReXAxis dataKey="timestamp" stroke="var(--text-muted)" fontSize={11} />
                      <ReYAxis stroke="var(--text-muted)" fontSize={11} />
                      <ReTooltip
                        contentStyle={{ background: '#ffffff', borderColor: '#e2e8f0', borderRadius: '8px', color: '#0f172a', boxShadow: '0 4px 12px rgba(0,0,0,0.08)' }}
                        labelStyle={{ color: '#0f172a', fontWeight: '600' }}
                      />
                      <ReLine type="monotone" dataKey={fieldName} stroke="#1f74b5" strokeWidth={2.5} dot={{ r: 4 }} />
                    </ReLineChart>
                  </ReResponsiveContainer>
                )}
              </div>
            </div>
          ))}

          {/* Readings Logs Table */}
          <div className="glass-panel" style={{ padding: '24px', overflowX: 'auto' }}>
            <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: '16px' }}>
              <div>
                <h3 style={{ fontSize: '1.15rem' }}>Latest Payload Logs</h3>
                <p style={{ fontSize: '0.8rem', color: 'var(--text-muted)' }}>Storage window per sensor payload feed</p>
              </div>

              <div style={{ display: 'flex', gap: '12px', alignItems: 'center' }}>
                <div style={{ display: 'flex', alignItems: 'center', gap: '6px', fontSize: '0.85rem' }}>
                  <span>Payload Window:</span>
                  <select
                    className="form-input"
                    style={{ padding: '4px 8px', height: '32px', fontSize: '0.85rem' }}
                    value={limit}
                    onChange={(e) => setLimit(Number(e.target.value))}
                  >
                    <option value={8}>8 Payloads</option>
                    <option value={10}>10 Payloads (Default)</option>
                    <option value={25}>25 Payloads</option>
                    <option value={50}>50 Payloads</option>
                  </select>
                </div>

                <a href={exportUrl('json')} target="_blank" rel="noreferrer" className="btn btn-secondary" style={{ padding: '6px 12px', fontSize: '0.85rem' }}>
                  <Download size={14} /> JSON
                </a>
                <a href={exportUrl('csv')} target="_blank" rel="noreferrer" className="btn btn-secondary" style={{ padding: '6px 12px', fontSize: '0.85rem' }}>
                  <Download size={14} /> CSV
                </a>
              </div>
            </div>

            <table style={{ width: '100%', borderCollapse: 'collapse', fontSize: '0.9rem' }}>
              <thead>
                <tr style={{ borderBottom: '1px solid var(--card-border)', textAlign: 'left' }}>
                  <th style={{ padding: '12px', color: 'var(--text-secondary)' }}>Timestamp</th>
                  {schemaFields.map(([name]) => (
                    <th key={name} style={{ padding: '12px', color: 'var(--text-secondary)' }}>{name}</th>
                  ))}
                </tr>
              </thead>
              <tbody>
                {readings.map((r, i) => (
                  <tr key={i} style={{ borderBottom: '1px solid #f1f5f9' }}>
                    <td style={{ padding: '10px 12px', color: 'var(--text-muted)', fontSize: '0.85rem' }}>
                      {new Date(r.timestamp).toLocaleString()}
                    </td>
                    {schemaFields.map(([name]) => (
                      <td key={name} style={{ padding: '10px 12px' }}>
                        {String(r.payload[name] !== undefined ? r.payload[name] : '-')}
                      </td>
                    ))}
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </div>

        {/* Right Column: Device Status, Actuator triggers, Rules summary */}
        <div style={{ display: 'flex', flexDirection: 'column', gap: '30px' }}>
          {/* Metadata Stats */}
          <div className="glass-panel" style={{ padding: '24px', display: 'flex', flexDirection: 'column', gap: '16px' }}>
            <h3 style={{ fontSize: '1.15rem' }}>Device Information</h3>
            <div style={{ fontSize: '0.85rem', display: 'flex', flexDirection: 'column', gap: '12px' }}>
              <div>
                <span style={{ color: 'var(--text-secondary)', display: 'block' }}>Friendly Name</span>
                <strong>{device?.name}</strong>
              </div>
              <div>
                <span style={{ color: 'var(--text-secondary)', display: 'block' }}>Connection Status</span>
                <span className={`status-badge ${device?.status}`} style={{ marginTop: '4px' }}>
                  {device?.status.toUpperCase()}
                </span>
              </div>
              <div>
                <span style={{ color: 'var(--text-secondary)', display: 'block' }}>Location</span>
                <strong>{device?.location || 'Not Configured'}</strong>
              </div>
              <div>
                <span style={{ color: 'var(--text-secondary)', display: 'block' }}>Last Seen Telemetry</span>
                <strong>{device?.last_seen ? new Date(device.last_seen).toLocaleString() : 'Never'}</strong>
              </div>
            </div>
          </div>

          {/* Actuator commands */}
          {deviceType && deviceType.commands.length > 0 && (
            <div className="glass-panel" style={{ padding: '24px' }}>
              <h3 style={{ fontSize: '1.15rem', marginBottom: '16px' }}>Transmit Actuator Command</h3>
              {commandResponse && (
                <div style={{ padding: '10px', borderRadius: '4px', background: '#f8fafc', fontSize: '0.85rem', marginBottom: '16px', border: '1px solid #cbd5e1' }}>
                  {commandResponse}
                </div>
              )}
              <form onSubmit={handleSendCommand} style={{ display: 'flex', flexDirection: 'column', gap: '16px' }}>
                <div className="form-group">
                  <label className="form-label">Command Name</label>
                  <select
                    className="form-input"
                    style={{ background: '#ffffff' }}
                    value={commandForm.command}
                    onChange={(e) => setCommandForm({ ...commandForm, command: e.target.value })}
                  >
                    {deviceType.commands.map((cmd) => (
                      <option key={cmd} value={cmd}>
                        {cmd}
                      </option>
                    ))}
                  </select>
                </div>

                <div className="form-group">
                  <label className="form-label">Payload Parameters (JSON)</label>
                  <textarea
                    className="form-input"
                    rows={4}
                    style={{ fontFamily: 'var(--font-mono)', fontSize: '0.85rem' }}
                    value={commandForm.payload}
                    onChange={(e) => setCommandForm({ ...commandForm, payload: e.target.value })}
                  />
                </div>

                <button type="submit" className="btn btn-primary" style={{ width: '100%' }}>
                  <Send size={14} />
                  <span>Transmit Command</span>
                </button>
              </form>
            </div>
          )}
        </div>
      </div>
    </div>
  );
}

export default DeviceDetail;
