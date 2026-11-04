import React, { useState, useEffect, useMemo } from 'react';
import { useNavigate } from 'react-router-dom';
import {
  Plus, Database, Cpu, Check, Copy, RefreshCw, Trash2, Search,
  Activity, Edit2, Download, CloudSun, Camera, Scale, Radio,
  ArrowRight, Wifi, WifiOff, AlertTriangle, ChevronRight, Settings
} from 'lucide-react';
import { API_BASE_URL } from '../config';
import Modal from '../components/Modal';
import ConfirmModal from '../components/ConfirmModal';
import DiscoveredDevices from '../components/DiscoveredDevices';

// ─── Theme definitions ────────────────────────────────────────────────────────
const HARDWARE_THEMES = [
  {
    key: 'weather',
    label: 'Weather Stations',
    icon: CloudSun,
    color: '#0284c7',
    colorBg: '#f0f9ff',
    colorBorder: 'rgba(2,132,199,0.2)',
    description: 'LoRa Mesh AWS Nodes — environmental telemetry',
    deviceTypes: ['weather_station_v1'],
    monitorPath: '/weather-monitor',
    monitorLabel: 'Open Weather Monitor',
    emptyMsg: 'No weather stations provisioned. Add a station node to get started.',
  },
  {
    key: 'cameras',
    label: 'Surveillance Cameras',
    icon: Camera,
    color: '#7c3aed',
    colorBg: '#faf5ff',
    colorBorder: 'rgba(124,58,237,0.2)',
    description: 'ESP32-CAM based visual monitoring nodes',
    deviceTypes: ['esp32_cam_v1'],
    monitorPath: '/cameras',
    monitorLabel: 'Open Camera Section',
    emptyMsg: 'No camera devices registered. Add an ESP32-CAM node to get started.',
  },
  {
    key: 'scales',
    label: 'Scale & Bio-Sensors',
    icon: Scale,
    color: '#059669',
    colorBg: '#f0fdf4',
    colorBorder: 'rgba(5,150,105,0.2)',
    description: 'Weight scales and bio-sensor hardware',
    deviceTypes: ['weight_scale_v1'],
    monitorPath: '/scale-monitor',
    monitorLabel: 'Open Scale Monitor',
    emptyMsg: 'No scale or bio-sensor devices registered.',
  },
  {
    key: 'gateways',
    label: 'LoRa Gateways',
    icon: Radio,
    color: '#d97706',
    colorBg: '#fffbeb',
    colorBorder: 'rgba(217,119,6,0.2)',
    description: 'ESP32 LoRa gateway nodes — mesh uplink to cloud',
    deviceTypes: ['lora_gateway_v1'],
    monitorPath: '/sos-alert',
    monitorLabel: 'Open SOS & LoRa Mesh',
    emptyMsg: 'No gateway devices registered.',
  },
  {
    key: 'schemas',
    label: 'Hardware Types',
    icon: Database,
    color: '#635bff',
    colorBg: '#eff2ff',
    colorBorder: 'rgba(99,91,255,0.2)',
    description: 'Schema registry for hardware device types',
    deviceTypes: [],
    monitorPath: null,
    monitorLabel: null,
    emptyMsg: 'No hardware type schemas defined yet.',
  },
];

// ─── Status badge ─────────────────────────────────────────────────────────────
function StatusPill({ status, activation_status }) {
  if (activation_status === 'pending') {
    return (
      <span style={{
        display: 'inline-flex', alignItems: 'center', gap: 4,
        fontSize: '0.65rem', fontWeight: 700, padding: '2px 7px',
        borderRadius: 99, background: 'var(--status-warn-bg)',
        color: 'var(--status-warn)', letterSpacing: '0.04em'
      }}>
        <AlertTriangle size={9} /> PENDING
      </span>
    );
  }
  const isOnline = status === 'online';
  return (
    <span style={{
      display: 'inline-flex', alignItems: 'center', gap: 4,
      fontSize: '0.65rem', fontWeight: 700, padding: '2px 7px',
      borderRadius: 99,
      background: isOnline ? 'var(--status-success-bg)' : '#f1f5f9',
      color: isOnline ? 'var(--status-success)' : 'var(--text-muted)',
      letterSpacing: '0.04em'
    }}>
      {isOnline ? <Wifi size={9} /> : <WifiOff size={9} />}
      {isOnline ? 'ONLINE' : 'OFFLINE'}
    </span>
  );
}

// ─── Device card ──────────────────────────────────────────────────────────────
function DeviceCard({ device, theme, onEdit, onDelete, onActivate, onClick }) {
  const ThemeIcon = theme.icon;
  return (
    <div
      onClick={onClick}
      style={{
        background: '#fff',
        border: device.activation_status === 'pending'
          ? '1px dashed var(--status-warn)'
          : '1px solid var(--border-subtle)',
        borderRadius: 12,
        padding: '16px',
        cursor: 'pointer',
        transition: 'all 0.18s ease',
        display: 'flex',
        flexDirection: 'column',
        gap: 12,
        boxShadow: '0 1px 3px rgba(0,0,0,0.04)',
        position: 'relative',
        overflow: 'hidden',
      }}
      onMouseEnter={e => {
        e.currentTarget.style.boxShadow = `0 4px 20px rgba(0,0,0,0.08), 0 0 0 1px ${theme.colorBorder}`;
        e.currentTarget.style.transform = 'translateY(-1px)';
      }}
      onMouseLeave={e => {
        e.currentTarget.style.boxShadow = '0 1px 3px rgba(0,0,0,0.04)';
        e.currentTarget.style.transform = 'translateY(0)';
      }}
    >
      {/* Color accent strip */}
      <div style={{
        position: 'absolute', top: 0, left: 0, right: 0, height: 3,
        background: `linear-gradient(90deg, ${theme.color}, ${theme.color}88)`,
        borderRadius: '12px 12px 0 0',
      }} />

      {/* Header row */}
      <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'flex-start', marginTop: 4 }}>
        <div style={{ display: 'flex', alignItems: 'center', gap: 10, flex: 1, minWidth: 0 }}>
          <div style={{
            background: theme.colorBg,
            border: `1px solid ${theme.colorBorder}`,
            borderRadius: 8,
            padding: 7,
            flexShrink: 0
          }}>
            <ThemeIcon size={15} color={theme.color} />
          </div>
          <div style={{ minWidth: 0 }}>
            <div style={{ fontWeight: 700, fontSize: '0.9rem', color: 'var(--text-main)', lineHeight: 1.2, whiteSpace: 'nowrap', overflow: 'hidden', textOverflow: 'ellipsis' }}>
              {device.name}
            </div>
            <div style={{ fontFamily: 'var(--font-mono)', fontSize: '0.68rem', color: 'var(--text-muted)', marginTop: 2, whiteSpace: 'nowrap', overflow: 'hidden', textOverflow: 'ellipsis' }}>
              {device.device_id}
            </div>
          </div>
        </div>

        {/* Action buttons */}
        <div style={{ display: 'flex', gap: 2, flexShrink: 0, marginLeft: 8 }} onClick={e => e.stopPropagation()}>
          <button
            onClick={() => onEdit(device)}
            style={{ background: 'transparent', border: 'none', cursor: 'pointer', padding: 5, borderRadius: 6, color: 'var(--text-muted)', transition: 'all 0.15s' }}
            title="Edit device"
            onMouseEnter={e => { e.currentTarget.style.color = theme.color; e.currentTarget.style.background = theme.colorBg; }}
            onMouseLeave={e => { e.currentTarget.style.color = 'var(--text-muted)'; e.currentTarget.style.background = 'transparent'; }}
          >
            <Edit2 size={13} />
          </button>
          <button
            onClick={() => onDelete(device.device_id)}
            style={{ background: 'transparent', border: 'none', cursor: 'pointer', padding: 5, borderRadius: 6, color: 'var(--text-muted)', transition: 'all 0.15s' }}
            title="Delete device"
            onMouseEnter={e => { e.currentTarget.style.color = 'var(--status-error)'; e.currentTarget.style.background = 'var(--status-error-bg)'; }}
            onMouseLeave={e => { e.currentTarget.style.color = 'var(--text-muted)'; e.currentTarget.style.background = 'transparent'; }}
          >
            <Trash2 size={13} />
          </button>
        </div>
      </div>

      {/* Meta info */}
      <div style={{ display: 'flex', flexDirection: 'column', gap: 5, borderTop: '1px solid var(--border-subtle)', paddingTop: 10 }}>
        <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
          <StatusPill status={device.status} activation_status={device.activation_status} />
          {device.node_id && (
            <span style={{ fontSize: '0.68rem', fontFamily: 'var(--font-mono)', color: 'var(--text-muted)', background: 'var(--bg-app)', padding: '2px 6px', borderRadius: 4 }}>
              Node #{device.node_id}
            </span>
          )}
        </div>
        {device.location && (
          <div style={{ fontSize: '0.75rem', color: 'var(--text-muted)' }}>
            📍 {device.location}
          </div>
        )}
        {device.last_seen && (
          <div style={{ fontSize: '0.68rem', color: 'var(--text-dim)', display: 'flex', justifyContent: 'space-between' }}>
            <span>Last seen</span>
            <span>{new Date(device.last_seen).toLocaleString()}</span>
          </div>
        )}
      </div>

      {/* Pending activation CTA */}
      {device.activation_status === 'pending' && (
        <button
          onClick={e => { e.stopPropagation(); onActivate(device.device_id, e); }}
          style={{
            marginTop: 2,
            background: `linear-gradient(135deg, ${theme.color}, ${theme.color}cc)`,
            color: '#fff', border: 'none', borderRadius: 8, padding: '7px 12px',
            fontSize: '0.75rem', fontWeight: 700, cursor: 'pointer',
            display: 'flex', alignItems: 'center', justifyContent: 'center', gap: 5,
          }}
        >
          🚀 Activate Device
        </button>
      )}
    </div>
  );
}

// ─── Schema card ──────────────────────────────────────────────────────────────
function SchemaCard({ schema, onEdit, userRole }) {
  const associatedTheme = HARDWARE_THEMES.find(t => t.deviceTypes.includes(schema.device_type));
  return (
    <div style={{
      background: '#fff',
      border: '1px solid var(--border-subtle)',
      borderRadius: 12,
      padding: 16,
      display: 'flex',
      flexDirection: 'column',
      gap: 12,
      boxShadow: '0 1px 3px rgba(0,0,0,0.04)',
    }}>
      <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'flex-start' }}>
        <div style={{ display: 'flex', alignItems: 'center', gap: 10 }}>
          <div style={{
            background: associatedTheme?.colorBg || '#f1f5f9',
            borderRadius: 8, padding: 7,
            border: `1px solid ${associatedTheme?.colorBorder || 'var(--border-subtle)'}`,
          }}>
            <Database size={15} color={associatedTheme?.color || '#635bff'} />
          </div>
          <div>
            <div style={{ fontWeight: 700, fontSize: '0.9rem', color: 'var(--text-main)' }}>{schema.display_name}</div>
            <code style={{ fontFamily: 'var(--font-mono)', fontSize: '0.68rem', color: 'var(--text-muted)' }}>
              {schema.device_type} · v{schema.version}
            </code>
          </div>
        </div>
        {userRole === 'admin' && (
          <button
            onClick={() => onEdit(schema)}
            style={{ background: 'transparent', border: 'none', cursor: 'pointer', padding: 5, borderRadius: 6, color: 'var(--text-muted)', transition: 'all 0.15s' }}
            onMouseEnter={e => { e.currentTarget.style.color = '#635bff'; e.currentTarget.style.background = '#eff2ff'; }}
            onMouseLeave={e => { e.currentTarget.style.color = 'var(--text-muted)'; e.currentTarget.style.background = 'transparent'; }}
          >
            <Edit2 size={13} />
          </button>
        )}
      </div>

      <div style={{ borderTop: '1px solid var(--border-subtle)', paddingTop: 10, display: 'flex', flexDirection: 'column', gap: 8 }}>
        <div>
          <span style={{ fontSize: '0.63rem', fontWeight: 700, textTransform: 'uppercase', letterSpacing: '0.08em', color: 'var(--text-muted)' }}>
            Telemetry Fields
          </span>
          <div style={{ display: 'flex', flexWrap: 'wrap', gap: 4, marginTop: 5 }}>
            {Object.entries(schema.fields).map(([name, def]) => (
              <span key={name} style={{
                fontSize: '0.68rem', padding: '2px 7px', borderRadius: 99,
                background: 'var(--bg-app)', border: '1px solid var(--border-subtle)',
                color: 'var(--text-dim)',
              }}>
                <strong style={{ color: 'var(--text-main)' }}>{name}</strong>
                {def.unit ? ` (${def.unit})` : ''} · {def.type}
              </span>
            ))}
          </div>
        </div>
        {schema.commands?.length > 0 && (
          <div>
            <span style={{ fontSize: '0.63rem', fontWeight: 700, textTransform: 'uppercase', letterSpacing: '0.08em', color: 'var(--text-muted)' }}>
              Commands
            </span>
            <div style={{ display: 'flex', flexWrap: 'wrap', gap: 4, marginTop: 5 }}>
              {schema.commands.map(cmd => (
                <span key={cmd} style={{
                  fontSize: '0.68rem', padding: '2px 7px', borderRadius: 99,
                  background: '#eff2ff', border: '1px solid rgba(99,91,255,0.15)', color: '#635bff',
                  fontFamily: 'var(--font-mono)',
                }}>
                  {cmd}
                </span>
              ))}
            </div>
          </div>
        )}
      </div>
    </div>
  );
}

// ═══════════════════════════════════════════════════════════════════════════════
// Main Devices Page
// ═══════════════════════════════════════════════════════════════════════════════
function Devices() {
  const navigate = useNavigate();
  const token = localStorage.getItem('token');
  const user = JSON.parse(localStorage.getItem('user') || '{}');

  const [activeTab, setActiveTab] = useState('weather');
  const [loading, setLoading] = useState(true);
  const [searchTerm, setSearchTerm] = useState('');

  // ── Schema states ──────────────────────────────────────────────────────────
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

  // ── Device states ──────────────────────────────────────────────────────────
  const [devices, setDevices] = useState([]);
  const [isDeviceModalOpen, setIsDeviceModalOpen] = useState(false);
  const [editingDevice, setEditingDevice] = useState(null);
  const [newDevice, setNewDevice] = useState({ device_id: '', name: '', device_type: '', location: '', category: 'Physical', status: 'Active', ip_address: '', min_usage: '', node_id: '', latitude: '', longitude: '' });
  const [deviceError, setDeviceError] = useState('');
  const [createdConfig, setCreatedConfig] = useState(null);
  const [copied, setCopied] = useState(false);
  const [confirmModal, setConfirmModal] = useState({ isOpen: false, deviceId: null, action: null });

  // ── Auth guard ─────────────────────────────────────────────────────────────
  useEffect(() => {
    if (!token) { navigate('/login'); return; }
    fetchData();
  }, [token]);

  // Reset search when tab changes
  useEffect(() => { setSearchTerm(''); }, [activeTab]);

  const fetchData = async () => {
    setLoading(true);
    try {
      const [devRes, typesRes] = await Promise.all([
        fetch(`${API_BASE_URL}/v1/devices`, { headers: { Authorization: `Bearer ${token}` } }),
        fetch(`${API_BASE_URL}/v1/device-types`, { headers: { Authorization: `Bearer ${token}` } }),
      ]);
      const devData = await devRes.json();
      const typesData = await typesRes.json();
      setDevices(Array.isArray(devData) ? devData : []);
      setSchemas(Array.isArray(typesData) ? typesData : []);
    } catch (err) {
      console.error(err);
    } finally {
      setLoading(false);
    }
  };

  // ── Theme-filtered devices ─────────────────────────────────────────────────
  const currentTheme = HARDWARE_THEMES.find(t => t.key === activeTab);

  const themeDevices = useMemo(() => {
    if (!currentTheme || currentTheme.key === 'schemas') return [];
    return devices.filter(d =>
      currentTheme.deviceTypes.includes(d.device_type) &&
      (
        d.name?.toLowerCase().includes(searchTerm.toLowerCase()) ||
        d.device_id?.toLowerCase().includes(searchTerm.toLowerCase()) ||
        d.location?.toLowerCase().includes(searchTerm.toLowerCase())
      )
    );
  }, [devices, currentTheme, searchTerm]);

  const onlineCount = useMemo(() =>
    themeDevices.filter(d => d.status === 'online').length,
    [themeDevices]
  );

  // ── Stats bar ──────────────────────────────────────────────────────────────
  const globalStats = useMemo(() => ({
    total: devices.length,
    online: devices.filter(d => d.status === 'online').length,
    pending: devices.filter(d => d.activation_status === 'pending').length,
  }), [devices]);

  // Lowest LoRa node number (1..255) not used by another device.
  const nextFreeNodeId = () => {
    const used = new Set(devices.map(d => Number(d.node_id)).filter(Boolean));
    for (let i = 1; i <= 255; i++) if (!used.has(i)) return i;
    return '';
  };

  // ── Auto generate device ID ────────────────────────────────────────────────
  const autoGenerateId = (type) => {
    if (type === 'weather_station_v1') {
      const nextId = nextFreeNodeId() || 1;
      return `flap-flap-aws-${String(nextId).padStart(3, '0')}-node`;
    }
    const prefix = type ? type.split('_')[0] : 'dev';
    const rand = Math.random().toString(36).substring(2, 6);
    return `flap-${prefix}-${rand}`;
  };

  // ── Device type change ─────────────────────────────────────────────────────
  const handleDeviceTypeChange = (type) => {
    if (!editingDevice) {
      const isWeather = type === 'weather_station_v1';
      const nextNodeId = isWeather ? nextFreeNodeId() : '';
      setNewDevice(prev => ({ ...prev, device_type: type, device_id: autoGenerateId(type), node_id: nextNodeId }));
    }
  };

  // ── Open device modal ──────────────────────────────────────────────────────
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
        min_usage: deviceToEdit.min_usage || '',
        node_id: deviceToEdit.node_id != null ? String(deviceToEdit.node_id) : '',
        latitude: deviceToEdit.latitude != null ? String(deviceToEdit.latitude) : '',
        longitude: deviceToEdit.longitude != null ? String(deviceToEdit.longitude) : '',
      });
    } else {
      setEditingDevice(null);
      // Pre-select the device type matching the current tab's theme
      const themeType = currentTheme?.deviceTypes[0] || schemas[0]?.device_type || '';
      const isWeather = themeType === 'weather_station_v1';
      const nextNodeId = isWeather ? nextFreeNodeId() : '';
      setNewDevice({
        device_id: autoGenerateId(themeType || 'dev'),
        name: '',
        device_type: themeType,
        location: '',
        category: 'Physical',
        status: 'Active',
        ip_address: '',
        min_usage: '',
        node_id: nextNodeId,
        latitude: '',
        longitude: '',
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
      const payload = editingDevice
        ? { name: newDevice.name, location: newDevice.location, category: newDevice.category, status: newDevice.status, ip_address: newDevice.ip_address, min_usage: newDevice.min_usage, node_id: newDevice.node_id ? Number(newDevice.node_id) : undefined, latitude: newDevice.latitude, longitude: newDevice.longitude }
        : { ...newDevice, node_id: newDevice.node_id ? Number(newDevice.node_id) : undefined };

      const response = await fetch(url, {
        method,
        headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${token}` },
        body: JSON.stringify(payload),
      });
      const data = await response.json();
      if (!response.ok) throw new Error(data.message || `Failed to ${editingDevice ? 'update' : 'register'} device`);

      if (!editingDevice) {
        let configHeader = '';
        if (newDevice.device_type === 'weather_station_v1') {
          configHeader = `/*\n * FlapMain Arduino Nano AWS LoRa Station Configuration (config.h)\n * Deploy this file to: hardwarecode/lora_mesh/nano_aws_node/config.h\n */\n#ifndef AWS_CONFIG_H\n#define AWS_CONFIG_H\n\n#define AWS_NODE_ID        ${Number(newDevice.node_id) || 1}      // Unique LoRa Mesh Origin Node (1..255)\n#define FLAPMAIN_DEVICE_ID "${newDevice.device_id}"\n#define FLAPMAIN_DEVICE_KEY "${data.apiKey}"\n#define TELEMETRY_INTERVAL 5000\n#define LORA_FREQ_CONFIG   433E6\n\n#endif // AWS_CONFIG_H\n`;
        } else {
          configHeader = `// --- FlapMain Arduino Hardware Config (config.h) ---\n#define WIFI_SSID "Your_WiFi_SSID"\n#define WIFI_PASSWORD "Your_WiFi_Password"\n\n#define FLAPMAIN_SERVER "${API_BASE_URL}"\n#define FLAPMAIN_DEVICE_ID "${newDevice.device_id}"\n#define FLAPMAIN_DEVICE_KEY "${data.apiKey}"\n`;
        }
        setCreatedConfig({ ...newDevice, apiKey: data.apiKey, configHeader });
      } else {
        setIsDeviceModalOpen(false);
      }
      fetchData();
    } catch (err) {
      setDeviceError(err.message);
    }
  };

  const handleDeleteDeviceClick = (deviceId) => setConfirmModal({ isOpen: true, deviceId, action: 'delete' });
  const handleActivateDeviceClick = (deviceId, e) => { e?.stopPropagation(); setConfirmModal({ isOpen: true, deviceId, action: 'activate' }); };
  const handleDownloadConfig = () => {
    if (!createdConfig) return;
    const blob = new Blob([createdConfig.configHeader], { type: 'text/plain' });
    const url = URL.createObjectURL(blob);
    const link = document.createElement('a');
    link.href = url; link.download = `config_${createdConfig.device_id}.h`;
    document.body.appendChild(link); link.click();
    document.body.removeChild(link); URL.revokeObjectURL(url);
  };

  const handleConfirmAction = async () => {
    const { deviceId, action } = confirmModal;
    if (!deviceId || !action) return;
    if (action === 'delete') {
      const res = await fetch(`${API_BASE_URL}/v1/devices/${deviceId}`, { method: 'DELETE', headers: { Authorization: `Bearer ${token}` } });
      if (res.ok) fetchData();
    } else if (action === 'activate') {
      const res = await fetch(`${API_BASE_URL}/v1/devices/${deviceId}/activate`, { method: 'PATCH', headers: { Authorization: `Bearer ${token}`, 'Content-Type': 'application/json' }, body: JSON.stringify({}) });
      if (res.ok) fetchData();
    }
  };

  // ── Schema helpers ─────────────────────────────────────────────────────────
  const openSchemaModal = (schemaToEdit = null) => {
    setSchemaError(''); setSchemaSuccess('');
    if (schemaToEdit) {
      setEditingSchema(schemaToEdit);
      setSchemaDeviceType(schemaToEdit.device_type);
      setSchemaDisplayName(schemaToEdit.display_name);
      const fieldsArr = Object.entries(schemaToEdit.fields).map(([name, def]) => ({ name, type: def.type, unit: def.unit || '' }));
      setSchemaFields(fieldsArr.length > 0 ? fieldsArr : [{ name: '', type: 'number', unit: '' }]);
      setSchemaCommands(schemaToEdit.commands?.length > 0 ? schemaToEdit.commands : ['']);
      setQuickProvision(false);
    } else {
      setEditingSchema(null);
      setSchemaDeviceType(''); setSchemaDisplayName('');
      setSchemaFields([{ name: '', type: 'number', unit: '' }]);
      setSchemaCommands(['']); setQuickProvision(true);
    }
    setIsSchemaModalOpen(true);
  };

  const handleSaveSchema = async (e) => {
    e.preventDefault();
    setSchemaError(''); setSchemaSuccess('');
    const fieldsObj = {};
    for (const f of schemaFields) {
      if (!f.name) continue;
      fieldsObj[f.name.trim()] = { type: f.type, unit: f.unit ? f.unit.trim() : undefined };
    }
    if (Object.keys(fieldsObj).length === 0) { setSchemaError('Please define at least one valid schema field parameter.'); return; }
    const filteredCommands = schemaCommands.map(c => c.trim()).filter(c => c !== '');
    const finalDeviceType = schemaDeviceType.trim();
    const payload = { display_name: schemaDisplayName.trim(), fields: fieldsObj, commands: filteredCommands };
    if (!editingSchema) payload.device_type = finalDeviceType;
    try {
      const url = editingSchema ? `${API_BASE_URL}/v1/device-types/${editingSchema.device_type}` : `${API_BASE_URL}/v1/device-types`;
      const response = await fetch(url, { method: editingSchema ? 'PUT' : 'POST', headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${token}` }, body: JSON.stringify(payload) });
      const data = await response.json();
      if (!response.ok) throw new Error(data.message || 'Failed to save hardware type');

      if (!editingSchema && quickProvision) {
        const autoDevId = autoGenerateId(finalDeviceType);
        const devResponse = await fetch(`${API_BASE_URL}/v1/devices`, {
          method: 'POST',
          headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${token}` },
          body: JSON.stringify({ device_id: autoDevId, name: `${schemaDisplayName.trim()} (Node 1)`, device_type: finalDeviceType, location: 'Default' }),
        });
        const devData = await devResponse.json();
        if (devResponse.ok) {
          setIsSchemaModalOpen(false);
          const configHeader = `// --- FlapMain Arduino Hardware Config (config.h) ---\n#define WIFI_SSID "Your_WiFi_SSID"\n#define WIFI_PASSWORD "Your_WiFi_Password"\n\n#define FLAPMAIN_SERVER "${API_BASE_URL}"\n#define FLAPMAIN_DEVICE_ID "${autoDevId}"\n#define FLAPMAIN_DEVICE_KEY "${devData.apiKey}"\n`;
          setCreatedConfig({ device_id: autoDevId, device_type: finalDeviceType, name: `${schemaDisplayName.trim()} (Node 1)`, apiKey: devData.apiKey, configHeader });
          setEditingDevice(null); setIsDeviceModalOpen(true); fetchData(); return;
        }
      }
      setSchemaSuccess(`Successfully ${editingSchema ? 'updated' : 'registered'} hardware type '${finalDeviceType}'`);
      fetchData();
      setTimeout(() => { setIsSchemaModalOpen(false); setSchemaSuccess(''); }, 1000);
    } catch (err) {
      setSchemaError(err.message);
    }
  };

  // ══════════════════════════════════════════════════════════════════════════
  // RENDER
  // ══════════════════════════════════════════════════════════════════════════
  return (
    <div style={{ display: 'flex', flexDirection: 'column', gap: 20, flex: 1, height: '100%', position: 'relative' }}>

      {/* ── Page Header ─────────────────────────────────────────────────────── */}
      <header className="responsive-page-header">
        <div>
          <h1 style={{ fontSize: '1.75rem', fontWeight: 700, letterSpacing: '-0.02em', color: 'var(--text-main)' }}>
            Hardware &amp; Devices
          </h1>
          <p style={{ color: 'var(--text-muted)', fontSize: '0.85rem', marginTop: 3 }}>
            Manage physical hardware organized by system category.
          </p>
        </div>

        {/* Global stats chips */}
        <div style={{ display: 'flex', alignItems: 'center', gap: 8, flexWrap: 'wrap' }}>
          <div style={{ display: 'flex', gap: 6 }}>
            <span style={{ fontSize: '0.75rem', fontWeight: 600, padding: '4px 10px', borderRadius: 99, background: 'var(--bg-app)', border: '1px solid var(--border-subtle)', color: 'var(--text-dim)' }}>
              {globalStats.total} total
            </span>
            <span style={{ fontSize: '0.75rem', fontWeight: 600, padding: '4px 10px', borderRadius: 99, background: 'var(--status-success-bg)', border: '1px solid rgba(5,150,105,0.2)', color: 'var(--status-success)' }}>
              {globalStats.online} online
            </span>
            {globalStats.pending > 0 && (
              <span style={{ fontSize: '0.75rem', fontWeight: 600, padding: '4px 10px', borderRadius: 99, background: 'var(--status-warn-bg)', border: '1px solid rgba(217,119,6,0.2)', color: 'var(--status-warn)' }}>
                {globalStats.pending} pending
              </span>
            )}
          </div>

          {/* Action button — context-sensitive */}
          {activeTab === 'schemas' ? (
            user.role === 'admin' && (
              <button onClick={() => openSchemaModal()} className="btn btn-primary">
                <Plus size={15} /> Register Hardware Type
              </button>
            )
          ) : (
            <button onClick={() => openDeviceModal()} className="btn btn-primary">
              <Plus size={15} /> Add Device
            </button>
          )}
        </div>
      </header>

      <DiscoveredDevices token={token} devices={devices} schemas={schemas} onChanged={fetchData} />

      {/* ── Category Tabs ───────────────────────────────────────────────────── */}
      <div style={{
        display: 'flex', gap: 0,
        borderBottom: '1px solid var(--border-subtle)',
        overflowX: 'auto',
        WebkitOverflowScrolling: 'touch',
        scrollbarWidth: 'none',
        paddingBottom: 0,
      }}>
        {HARDWARE_THEMES.map(theme => {
          const Icon = theme.icon;
          const isActive = activeTab === theme.key;
          const count = theme.key === 'schemas'
            ? schemas.length
            : devices.filter(d => theme.deviceTypes.includes(d.device_type)).length;
          const onlineInTheme = theme.key !== 'schemas'
            ? devices.filter(d => theme.deviceTypes.includes(d.device_type) && d.status === 'online').length
            : 0;
          return (
            <button
              key={theme.key}
              onClick={() => setActiveTab(theme.key)}
              style={{
                display: 'flex', alignItems: 'center', gap: 7,
                padding: '10px 16px',
                whiteSpace: 'nowrap',
                borderBottom: isActive ? `2.5px solid ${theme.color}` : '2.5px solid transparent',
                background: 'transparent',
                cursor: 'pointer',
                color: isActive ? theme.color : 'var(--text-muted)',
                fontWeight: isActive ? 700 : 500,
                fontSize: '0.82rem',
                transition: 'all 0.15s',
                borderTop: 'none', borderLeft: 'none', borderRight: 'none',
                marginBottom: -1,
              }}
            >
              <Icon size={15} />
              {theme.label}
              {count > 0 && (
                <span style={{
                  fontSize: '0.65rem', fontWeight: 700,
                  padding: '1px 6px', borderRadius: 99,
                  background: isActive ? theme.color : 'var(--bg-app)',
                  color: isActive ? '#fff' : 'var(--text-muted)',
                  border: isActive ? 'none' : '1px solid var(--border-subtle)',
                  minWidth: 18, textAlign: 'center',
                }}>
                  {count}
                </span>
              )}
              {onlineInTheme > 0 && (
                <span style={{
                  width: 6, height: 6, borderRadius: '50%',
                  background: '#059669',
                  boxShadow: '0 0 4px rgba(5,150,105,0.6)',
                  flexShrink: 0,
                }} />
              )}
            </button>
          );
        })}
      </div>

      {/* ── Content Area ────────────────────────────────────────────────────── */}
      {loading ? (
        <div style={{ color: 'var(--text-muted)', fontSize: '0.875rem', paddingTop: 8 }}>Loading devices...</div>
      ) : activeTab === 'schemas' ? (
        /* ── Schemas Tab ─────────────────────────────────────────────────── */
        <div style={{ display: 'flex', flexDirection: 'column', gap: 16 }}>
          {/* Schema category header */}
          <div style={{
            background: '#fff',
            border: '1px solid rgba(99,91,255,0.15)',
            borderRadius: 12,
            padding: '14px 18px',
            display: 'flex',
            alignItems: 'center',
            justifyContent: 'space-between',
            gap: 12,
          }}>
            <div style={{ display: 'flex', alignItems: 'center', gap: 12 }}>
              <div style={{ background: '#eff2ff', borderRadius: 8, padding: 8 }}>
                <Settings size={16} color="#635bff" />
              </div>
              <div>
                <div style={{ fontWeight: 700, fontSize: '0.9rem', color: 'var(--text-main)' }}>Hardware Type Registry</div>
                <div style={{ fontSize: '0.75rem', color: 'var(--text-muted)' }}>
                  {schemas.length} schema{schemas.length !== 1 ? 's' : ''} defined — defines telemetry fields &amp; commands for each device class
                </div>
              </div>
            </div>
          </div>

          <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fill, minmax(320px, 1fr))', gap: 12 }}>
            {schemas.length === 0 ? (
              <div style={{ gridColumn: '1/-1', textAlign: 'center', color: 'var(--text-muted)', fontSize: '0.875rem', padding: '32px 0' }}>
                No hardware type schemas defined yet.
              </div>
            ) : schemas.map(s => (
              <SchemaCard key={s._id} schema={s} onEdit={openSchemaModal} userRole={user.role} />
            ))}
          </div>
        </div>
      ) : (
        /* ── Device Theme Tab ────────────────────────────────────────────── */
        <div style={{ display: 'flex', flexDirection: 'column', gap: 16 }}>
          {/* Theme banner */}
          {currentTheme && (
            <div style={{
              background: '#fff',
              border: `1px solid ${currentTheme.colorBorder}`,
              borderRadius: 12,
              padding: '14px 18px',
              display: 'flex',
              alignItems: 'center',
              justifyContent: 'space-between',
              flexWrap: 'wrap',
              gap: 12,
            }}>
              <div style={{ display: 'flex', alignItems: 'center', gap: 12 }}>
                <div style={{ background: currentTheme.colorBg, borderRadius: 8, padding: 8, border: `1px solid ${currentTheme.colorBorder}` }}>
                  <currentTheme.icon size={16} color={currentTheme.color} />
                </div>
                <div>
                  <div style={{ fontWeight: 700, fontSize: '0.9rem', color: 'var(--text-main)' }}>{currentTheme.label}</div>
                  <div style={{ fontSize: '0.75rem', color: 'var(--text-muted)' }}>
                    {themeDevices.length} device{themeDevices.length !== 1 ? 's' : ''} · {onlineCount} online · {currentTheme.description}
                  </div>
                </div>
              </div>

              {currentTheme.monitorPath && (
                <button
                  onClick={() => navigate(currentTheme.monitorPath)}
                  style={{
                    display: 'flex', alignItems: 'center', gap: 6,
                    background: currentTheme.colorBg,
                    color: currentTheme.color,
                    border: `1px solid ${currentTheme.colorBorder}`,
                    borderRadius: 8,
                    padding: '7px 14px',
                    fontSize: '0.78rem',
                    fontWeight: 700,
                    cursor: 'pointer',
                    transition: 'all 0.15s',
                    flexShrink: 0,
                  }}
                  onMouseEnter={e => { e.currentTarget.style.background = currentTheme.color; e.currentTarget.style.color = '#fff'; }}
                  onMouseLeave={e => { e.currentTarget.style.background = currentTheme.colorBg; e.currentTarget.style.color = currentTheme.color; }}
                >
                  {currentTheme.monitorLabel}
                  <ArrowRight size={13} />
                </button>
              )}
            </div>
          )}

          {/* Search bar */}
          <div style={{
            display: 'flex', alignItems: 'center', gap: 10,
            background: '#fff', border: '1px solid var(--border-subtle)',
            borderRadius: 8, padding: '8px 14px',
            maxWidth: 380,
          }}>
            <Search size={15} color="var(--text-muted)" />
            <input
              type="text"
              placeholder={`Search ${currentTheme?.label?.toLowerCase() || 'devices'}...`}
              value={searchTerm}
              onChange={e => setSearchTerm(e.target.value)}
              style={{ background: 'transparent', border: 'none', outline: 'none', fontSize: '0.85rem', color: 'var(--text-main)', width: '100%' }}
            />
            {searchTerm && (
              <button onClick={() => setSearchTerm('')} style={{ background: 'none', border: 'none', cursor: 'pointer', color: 'var(--text-muted)', padding: 0 }}>
                ✕
              </button>
            )}
          </div>

          {/* Device grid */}
          {themeDevices.length === 0 ? (
            <div style={{
              background: '#fff', border: '1px dashed var(--border-subtle)',
              borderRadius: 12, padding: '48px 24px',
              textAlign: 'center', display: 'flex', flexDirection: 'column', alignItems: 'center', gap: 12
            }}>
              {currentTheme && <currentTheme.icon size={36} color={currentTheme.color} style={{ opacity: 0.3 }} />}
              <div style={{ color: 'var(--text-muted)', fontSize: '0.875rem' }}>
                {searchTerm ? `No devices match "${searchTerm}"` : currentTheme?.emptyMsg}
              </div>
              {!searchTerm && (
                <button onClick={() => openDeviceModal()} className="btn btn-primary" style={{ marginTop: 4 }}>
                  <Plus size={14} /> Add First Device
                </button>
              )}
            </div>
          ) : (
            <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fill, minmax(280px, 1fr))', gap: 12 }}>
              {themeDevices.map(device => (
                <DeviceCard
                  key={device.device_id}
                  device={device}
                  theme={currentTheme}
                  onEdit={openDeviceModal}
                  onDelete={handleDeleteDeviceClick}
                  onActivate={handleActivateDeviceClick}
                  onClick={() => navigate(`/device/${device.device_id}`)}
                />
              ))}
            </div>
          )}
        </div>
      )}

      {/* ─────────────────────────────────────────────────────────────────────
          DEVICE MODAL
      ───────────────────────────────────────────────────────────────────── */}
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
              <h4 className="flex items-center gap-2 text-success" style={{ fontSize: '1rem', fontWeight: 600 }}>
                <Cpu size={18} /> Device Registered: {createdConfig.device_id}
              </h4>
              <div className="flex gap-2">
                <button onClick={() => { navigator.clipboard.writeText(createdConfig.configHeader); setCopied(true); setTimeout(() => setCopied(false), 2500); }} className="btn btn-secondary btn-sm">
                  {copied ? <Check size={14} className="text-success" /> : <Copy size={14} />}
                  <span className={copied ? 'text-success' : ''}>{copied ? 'Copied!' : 'Copy Config'}</span>
                </button>
                <button onClick={handleDownloadConfig} className="btn btn-primary btn-sm">
                  <Download size={14} /> Save config.h
                </button>
              </div>
            </div>
            <p className="text-sm text-muted m-0">Save this Arduino config to your project. It contains the secret <strong>DEVICE_KEY</strong>.</p>
            <div className="premium-code-block glow-border">
              <pre style={{ margin: 0, overflowX: 'auto', background: 'transparent', padding: 0, border: 'none', color: 'inherit' }}>{createdConfig.configHeader}</pre>
            </div>
          </div>
        ) : (
          <form id="deviceForm" onSubmit={handleSaveDevice}>
            <h4 style={{ color: 'var(--action-primary)', fontSize: '0.9rem', fontWeight: 600, marginBottom: 12 }}>Device Details</h4>
            <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 16, marginBottom: 24 }}>
              <div className="form-group mb-0">
                <label className="form-label">Friendly Name *</label>
                <input type="text" className="form-input" placeholder="e.g. Manung Dada Weather Station" value={newDevice.name} onChange={e => setNewDevice({ ...newDevice, name: e.target.value })} required />
              </div>
              <div className="form-group mb-0">
                <label className="form-label">Hardware Type Schema *</label>
                <select className="form-input form-select" value={newDevice.device_type} onChange={e => handleDeviceTypeChange(e.target.value)} required disabled={!!editingDevice}>
                  {schemas.map(type => <option key={type.device_type} value={type.device_type}>{type.display_name} ({type.device_type})</option>)}
                </select>
              </div>
              <div className="form-group mb-0">
                <label className="form-label flex justify-between items-center">
                  <span>Device ID *</span>
                  {!editingDevice && (
                    <button type="button" onClick={() => setNewDevice({ ...newDevice, device_id: autoGenerateId(newDevice.device_type) })} className="text-xs text-accent flex items-center gap-1" style={{ background: 'none', border: 'none', cursor: 'pointer' }}><RefreshCw size={10} /> Auto</button>
                  )}
                </label>
                <input type="text" className="form-input bg-gray-50" placeholder="e.g. flap-flap-aws-001-node" value={newDevice.device_id} onChange={e => setNewDevice({ ...newDevice, device_id: e.target.value })} required disabled={!!editingDevice} />
              </div>
              <div className="form-group mb-0">
                <label className="form-label">Device Category</label>
                <select className="form-input form-select" value={newDevice.category || 'Physical'} onChange={e => setNewDevice({ ...newDevice, category: e.target.value })}>
                  <option value="Physical">Physical Device</option>
                  <option value="Active">Active Device</option>
                </select>
              </div>
            </div>

            {/* LoRa Mesh section for weather stations */}
            {newDevice.device_type === 'weather_station_v1' && (
              <div style={{ background: 'rgba(99,91,255,0.04)', border: '1px solid rgba(99,91,255,0.18)', borderRadius: 10, padding: 14, marginBottom: 20 }}>
                <div className="form-group mb-2">
                  <label className="form-label" style={{ color: 'var(--action-primary)', fontWeight: 700 }}>
                    LoRa Mesh Station Node ID (1..255)
                  </label>
                  <input type="number" min="1" max="255" className="form-input"
                    placeholder="e.g. 1 (Manung Dada), 2 (Damauli), 3 (Kalupada), 4 (Chandragiri)"
                    value={newDevice.node_id || ''}
                    onChange={e => setNewDevice({ ...newDevice, node_id: e.target.value })}
                  />
                </div>
                <p style={{ margin: 0, fontSize: '0.78rem', color: 'var(--text-dim)', lineHeight: 1.4 }}>
                  💡 <strong>Automatic Multi-AWS Gateway Routing:</strong> Packets broadcast by this Node ID over LoRa Mesh will automatically resolve to this weather station on the gateway and dashboard.
                </p>
              </div>
            )}

            <h4 style={{ color: 'var(--action-primary)', fontSize: '0.9rem', fontWeight: 600, marginBottom: 12 }}>Configuration &amp; Location</h4>
            <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 16 }}>
              <div className="form-group mb-0">
                <label className="form-label">Location / Site Name</label>
                <input type="text" className="form-input" placeholder="e.g. Manung Dada / Kathmandu" value={newDevice.location} onChange={e => setNewDevice({ ...newDevice, location: e.target.value })} />
              </div>
              <div className="form-group mb-0">
                <label className="form-label">Status</label>
                <select className="form-input form-select" value={newDevice.status || 'Active'} onChange={e => setNewDevice({ ...newDevice, status: e.target.value })}>
                  <option value="Active">Active</option>
                  <option value="Inactive">Inactive</option>
                  <option value="Maintenance">Maintenance</option>
                </select>
              </div>
              <div className="form-group mb-0">
                <label className="form-label">IP Address (Optional)</label>
                <input type="text" className="form-input" placeholder="192.168.1.x" value={newDevice.ip_address || ''} onChange={e => setNewDevice({ ...newDevice, ip_address: e.target.value })} />
              </div>
              <div className="form-group mb-0">
                <label className="form-label">Minimum Usage Time</label>
                <input type="text" className="form-input" placeholder="e.g. 24 hours" value={newDevice.min_usage || ''} onChange={e => setNewDevice({ ...newDevice, min_usage: e.target.value })} />
              </div>
              <div className="form-group mb-0">
                <label className="form-label">GPS Latitude</label>
                <input type="number" step="any" min="-90" max="90" className="form-input" placeholder="e.g. 27.7172" value={newDevice.latitude ?? ''} onChange={e => setNewDevice({ ...newDevice, latitude: e.target.value })} />
              </div>
              <div className="form-group mb-0">
                <label className="form-label">GPS Longitude</label>
                <input type="number" step="any" min="-180" max="180" className="form-input" placeholder="e.g. 85.3240" value={newDevice.longitude ?? ''} onChange={e => setNewDevice({ ...newDevice, longitude: e.target.value })} />
              </div>
            </div>
          </form>
        )}
      </Modal>

      {/* ─────────────────────────────────────────────────────────────────────
          SCHEMA MODAL
      ───────────────────────────────────────────────────────────────────── */}
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
                <input type="text" className="form-input flex-1" placeholder="field_name" value={f.name} onChange={e => { const u = [...schemaFields]; u[idx].name = e.target.value; setSchemaFields(u); }} required />
                <select className="form-input form-select" style={{ width: 110 }} value={f.type} onChange={e => { const u = [...schemaFields]; u[idx].type = e.target.value; setSchemaFields(u); }}>
                  <option value="number">number</option>
                  <option value="boolean">boolean</option>
                  <option value="string">string</option>
                </select>
                <input type="text" className="form-input" style={{ width: 130 }} placeholder="unit (optional)" value={f.unit} onChange={e => { const u = [...schemaFields]; u[idx].unit = e.target.value; setSchemaFields(u); }} />
                {schemaFields.length > 1
                  ? <button type="button" onClick={() => setSchemaFields(schemaFields.filter((_, i) => i !== idx))} className="btn btn-danger btn-icon">✕</button>
                  : <div style={{ width: 28 }} />}
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
                <input type="text" className="form-input flex-1" placeholder="command_name (e.g. reset_actuator)" value={cmd} onChange={e => { const u = [...schemaCommands]; u[idx] = e.target.value; setSchemaCommands(u); }} />
                {schemaCommands.length > 1
                  ? <button type="button" onClick={() => setSchemaCommands(schemaCommands.filter((_, i) => i !== idx))} className="btn btn-danger btn-icon">✕</button>
                  : <div style={{ width: 28 }} />}
              </div>
            ))}
          </div>

          {!editingSchema && (
            <div className="pt-4 border-t border-subtle flex items-center gap-2">
              <input type="checkbox" id="quickProvision" checked={quickProvision} onChange={e => setQuickProvision(e.target.checked)} style={{ cursor: 'pointer' }} />
              <label htmlFor="quickProvision" className="text-sm font-medium" style={{ cursor: 'pointer' }}>
                Automatically provision the first physical device of this type
              </label>
            </div>
          )}
        </form>
      </Modal>

      {/* ─────────────────────────────────────────────────────────────────────
          CONFIRM MODAL
      ───────────────────────────────────────────────────────────────────── */}
      <ConfirmModal
        isOpen={confirmModal.isOpen}
        onClose={() => setConfirmModal({ isOpen: false, deviceId: null, action: null })}
        onConfirm={handleConfirmAction}
        title={confirmModal.action === 'activate' ? 'Activate Device' : 'Delete Device'}
        message={
          confirmModal.action === 'activate' ? (
            <><strong>Activate {confirmModal.deviceId}?</strong><br /><br />It will be authorized to communicate with the network.</>
          ) : (
            <><strong>Delete {confirmModal.deviceId}?</strong><br /><br />This device will be permanently removed from the network.</>
          )
        }
        confirmText={confirmModal.action === 'activate' ? 'Activate' : 'Delete'}
        type={confirmModal.action === 'activate' ? 'primary' : 'danger'}
      />
    </div>
  );
}

export default Devices;
