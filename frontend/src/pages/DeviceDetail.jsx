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
      // 1. Fetch latest telemetry readings
      const res = await fetch(`${API_BASE_URL}/v1/devices/${device_id}/readings?limit=${limit}`, {
        headers: { Authorization: `Bearer ${token}` },
      });
      const data = await res.json();
      setReadings(Array.isArray(data) ? data : []);

      // 2. Fetch updated device metadata (status & last_seen timestamp)
      const devRes = await fetch(`${API_BASE_URL}/v1/devices/${device_id}`, {
        headers: { Authorization: `Bearer ${token}` },
      });
      if (devRes.ok) {
        const devData = await devRes.json();
        setDevice(devData);
      }
    } catch (err) {
      console.error('Error polling readings and device info:', err);
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

#define FLAPMAIN_SERVER "${API_BASE_URL.replace(/\/api$/, '')}"
#define FLAPMAIN_DEVICE_ID "${device_id}"
#define FLAPMAIN_DEVICE_KEY "YOUR_DEVICE_API_KEY" // (Generated at provision time)
`;

  const handleDownloadConfig = () => {
    const blob = new Blob([configSnippet], { type: 'text/plain' });
    const url = URL.createObjectURL(blob);
    const link = document.createElement('a');
    link.href = url;
    link.download = `config_${device_id}.h`;
    document.body.appendChild(link);
    link.click();
    document.body.removeChild(link);
    URL.revokeObjectURL(url);
  };

  const copyConfig = () => {
    navigator.clipboard.writeText(configSnippet);
    setCopied(true);
    setTimeout(() => setCopied(false), 2500);
  };

  if (loading) {
    return (
      <div className="flex-1 flex items-center justify-center">
        <RefreshCw className="animate-spin text-accent" size={32} />
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
    <div className="flex flex-col gap-6 flex-1 h-full">
      <div className="flex justify-between items-center">
        <div className="flex items-center gap-4">
          <button onClick={() => navigate('/')} className="btn btn-secondary btn-icon">
            <ArrowLeft size={18} />
          </button>
          <div>
            <h1 className="text-main m-0" style={{ fontSize: '1.5rem', fontWeight: 600, letterSpacing: '-0.02em' }}>{device?.name}</h1>
            <code className="text-muted text-xs">ID: {device?.device_id} • Schema: {device?.device_type}</code>
          </div>
        </div>

        <button onClick={() => setShowConfig(!showConfig)} className="btn btn-secondary btn-sm">
          <Cpu size={14} />
          <span>{showConfig ? 'Hide Hardware Code' : 'Hardware C++ Code Config'}</span>
        </button>
      </div>

      {/* Hardware C++ Header Code Modal */}
      {showConfig && (
        <div className="premium-card animate-slide-up mb-6" style={{ borderLeft: '4px solid var(--accent)' }}>
          <div className="card-header flex justify-between items-center bg-gray-50/50">
            <div>
              <h4 className="text-accent flex items-center gap-2" style={{ fontSize: '1.05rem', fontWeight: 600, margin: 0 }}>
                <Cpu size={18} /> Arduino Configuration (config.h)
              </h4>
              <p className="text-xs text-muted mt-1 m-0">Includes your unique FLAPMAIN_DEVICE_KEY.</p>
            </div>
            <div className="flex gap-2">
              <button onClick={copyConfig} className="btn btn-secondary btn-sm" style={{ transition: 'all 0.2s' }}>
                {copied ? <Check size={14} className="text-success" /> : <Copy size={14} />}
                <span className={copied ? "text-success" : ""}>{copied ? 'Copied!' : 'Copy Code'}</span>
              </button>
              <button onClick={handleDownloadConfig} className="btn btn-primary btn-sm">
                <Download size={14} />
                <span>Save to Local System</span>
              </button>
            </div>
          </div>
          <div className="card-body bg-slate-900 p-0">
            <div className="premium-code-block" style={{ border: 'none', borderRadius: 0, boxShadow: 'none' }}>
              <pre style={{ margin: 0, padding: 0, overflowX: 'auto', background: 'transparent', border: 'none', color: 'inherit' }}>
                {configSnippet}
              </pre>
            </div>
          </div>
        </div>
      )}

      <div className="grid" style={{ gridTemplateColumns: '2fr 1fr', gap: 'var(--space-6)' }}>
        {/* Left Column: Line Charts & History Log */}
        <div className="flex flex-col gap-6">
          {/* Dynamic Charts Display */}
          {numericFields.map(([fieldName, fieldDef]) => (
            <div key={fieldName} className="card card-body">
              <div className="flex justify-between items-center mb-4">
                <h3 style={{ fontSize: '1rem', fontWeight: 600 }}>
                  {fieldName} ({fieldDef.unit || 'unit'}) — Sensor Ingestion Window
                </h3>
                <span className="text-xs text-muted">
                  Showing latest {readings.length} payloads
                </span>
              </div>

              <div style={{ width: '100%', height: '220px' }}>
                {chartData.length === 0 ? (
                  <div className="flex items-center justify-center h-full text-muted text-sm">
                    No telemetry records. Send readings from ESP8266 to plot graph.
                  </div>
                ) : (
                  <ReResponsiveContainer width="100%" height="100%">
                    <ReLineChart data={chartData}>
                      <ReCartesianGrid strokeDasharray="3 3" stroke="var(--subtle)" />
                      <ReXAxis dataKey="timestamp" stroke="var(--text-muted)" fontSize={10} tickLine={false} axisLine={false} />
                      <ReYAxis stroke="var(--text-muted)" fontSize={10} tickLine={false} axisLine={false} />
                      <ReTooltip
                        contentStyle={{ background: '#ffffff', borderColor: 'var(--subtle)', borderRadius: '6px', color: 'var(--text-main)', boxShadow: '0 4px 6px -1px rgb(0 0 0 / 0.1)' }}
                        labelStyle={{ color: 'var(--text-main)', fontWeight: '500', fontSize: '0.85rem' }}
                        itemStyle={{ fontSize: '0.85rem' }}
                      />
                      <ReLine type="monotone" dataKey={fieldName} stroke="var(--primary)" strokeWidth={2} dot={{ r: 3, fill: 'var(--primary)' }} activeDot={{ r: 5 }} />
                    </ReLineChart>
                  </ReResponsiveContainer>
                )}
              </div>
            </div>
          ))}

          {/* Readings Logs Table */}
          <div className="card" style={{ overflowX: 'auto' }}>
            <div className="card-header flex justify-between items-center flex-wrap gap-4">
              <div>
                <h3 style={{ fontSize: '1rem', fontWeight: 600 }}>Latest Payload Logs</h3>
                <p className="text-xs text-muted mt-1">Storage window per sensor payload feed</p>
              </div>

              <div className="flex gap-3 items-center">
                <div className="flex items-center gap-2 text-xs">
                  <span className="text-muted">Window:</span>
                  <select
                    className="form-input form-select text-xs py-1"
                    style={{ width: 'auto' }}
                    value={limit}
                    onChange={(e) => setLimit(Number(e.target.value))}
                  >
                    <option value={8}>8 Payloads</option>
                    <option value={10}>10 Payloads (Default)</option>
                    <option value={25}>25 Payloads</option>
                    <option value={50}>50 Payloads</option>
                  </select>
                </div>

                <div className="flex gap-2">
                  <a href={exportUrl('json')} target="_blank" rel="noreferrer" className="btn btn-secondary btn-sm">
                    <Download size={14} /> JSON
                  </a>
                  <a href={exportUrl('csv')} target="_blank" rel="noreferrer" className="btn btn-secondary btn-sm">
                    <Download size={14} /> CSV
                  </a>
                </div>
              </div>
            </div>

            <table className="table" style={{ width: '100%', minWidth: '400px' }}>
              <thead>
                <tr>
                  <th>Timestamp</th>
                  {schemaFields.map(([name]) => (
                    <th key={name}>{name}</th>
                  ))}
                </tr>
              </thead>
              <tbody>
                {readings.map((r, i) => (
                  <tr key={i}>
                    <td className="text-mono text-muted text-xs">
                      {new Date(r.timestamp).toLocaleString()}
                    </td>
                    {schemaFields.map(([name]) => (
                      <td key={name}>
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
        <div className="flex flex-col gap-6">
          {/* Metadata Stats */}
          <div className="card">
            <div className="card-header">
              <h3 style={{ fontSize: '1rem', fontWeight: 600 }}>Device Information</h3>
            </div>
            <div className="card-body flex flex-col gap-4 text-sm">
              <div className="flex flex-col gap-1">
                <span className="text-dim">Friendly Name</span>
                <strong className="text-main">{device?.name}</strong>
              </div>
              <div className="flex flex-col gap-1">
                <span className="text-dim">Connection Status</span>
                <div>
                  <span className={`status-badge ${device?.status}`}>
                    {device?.status.toUpperCase()}
                  </span>
                </div>
              </div>
              <div className="flex flex-col gap-1">
                <span className="text-dim">Location</span>
                <strong className="text-main">{device?.location || 'Not Configured'}</strong>
              </div>
              <div className="flex flex-col gap-1">
                <span className="text-dim">Last Seen Telemetry</span>
                <strong className="text-main text-xs">
                  {readings.length > 0 && readings[0].timestamp
                    ? new Date(readings[0].timestamp).toLocaleString()
                    : device?.last_seen
                    ? new Date(device.last_seen).toLocaleString()
                    : 'Never'}
                </strong>
              </div>
            </div>
          </div>

          {/* Actuator commands */}
          {deviceType && deviceType.commands.length > 0 && (
            <div className="card">
              <div className="card-header">
                <h3 style={{ fontSize: '1rem', fontWeight: 600 }}>Transmit Actuator Command</h3>
              </div>
              <div className="card-body">
                {commandResponse && (
                  <div className="text-sm p-3 mb-4 rounded text-mono" style={{ background: '#f8fafc', border: '1px solid #e2e8f0', wordBreak: 'break-all' }}>
                    {commandResponse}
                  </div>
                )}
                <form onSubmit={handleSendCommand} className="flex flex-col gap-4">
                  <div className="form-group mb-0">
                    <label className="form-label">Command Name</label>
                    <select
                      className="form-input form-select"
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

                  <div className="form-group mb-0">
                    <label className="form-label">Payload Parameters (JSON)</label>
                    <textarea
                      className="form-input text-mono text-xs"
                      rows={4}
                      value={commandForm.payload}
                      onChange={(e) => setCommandForm({ ...commandForm, payload: e.target.value })}
                    />
                  </div>

                  <button type="submit" className="btn btn-primary w-full" style={{ padding: '0.625rem 1rem' }}>
                    <Send size={14} />
                    <span>Transmit Command</span>
                  </button>
                </form>
              </div>
            </div>
          )}
        </div>
      </div>
    </div>
  );
}

export default DeviceDetail;
