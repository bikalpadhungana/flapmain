import React, { useState, useEffect, useRef } from 'react';
import {
  Cpu, Plus, Trash2, Edit3, Save, X, Wifi, WifiOff, Link2, Link2Off,
  CreditCard, Weight, Thermometer, Wind, Camera, Radio, Zap, Activity,
  ChevronDown, ChevronRight, Users, CheckCircle, RefreshCw
} from 'lucide-react';
import { API_BASE_URL } from '../config';
import io from 'socket.io-client';

// ─── Device type metadata ────────────────────────────────────────────────────
const DEVICE_TYPE_META = {
  card_reader:       { label: 'NFC / Card Reader',       icon: CreditCard,  color: '#6366f1', role: 'identity' },
  nfc_reader:        { label: 'NFC / Card Reader',       icon: CreditCard,  color: '#6366f1', role: 'identity' },
  weight_scale_v1:   { label: 'Weight & Height Scale',   icon: Weight,      color: '#10b981', role: 'measurement' },
  weight_scale:      { label: 'Weight Scale',            icon: Weight,      color: '#10b981', role: 'measurement' },
  weather_station:   { label: 'Weather Station',         icon: Thermometer, color: '#f59e0b', role: 'environment' },
  temperature:       { label: 'Temperature Sensor',      icon: Thermometer, color: '#f59e0b', role: 'environment' },
  wind:              { label: 'Wind Sensor',             icon: Wind,        color: '#06b6d4', role: 'environment' },
  camera:            { label: 'Camera',                  icon: Camera,      color: '#8b5cf6', role: 'visual' },
  relay:             { label: 'Relay / Actuator',        icon: Zap,         color: '#ef4444', role: 'actuator' },
  rfid:              { label: 'RFID Reader',             icon: Radio,       color: '#6366f1', role: 'identity' },
  default:           { label: 'Generic Sensor',          icon: Cpu,         color: '#64748b', role: 'sensor' },
};

function getDeviceMeta(device_type) {
  const key = (device_type || '').toLowerCase().replace(/[\s-]/g, '_');
  for (const [k, v] of Object.entries(DEVICE_TYPE_META)) {
    if (key.includes(k)) return v;
  }
  return DEVICE_TYPE_META.default;
}

// ─── Sub-components ──────────────────────────────────────────────────────────
function DeviceTypeBadge({ device_type, small }) {
  const meta = getDeviceMeta(device_type);
  const Icon = meta.icon;
  return (
    <span style={{
      display: 'inline-flex', alignItems: 'center', gap: '4px',
      padding: small ? '2px 6px' : '3px 9px',
      borderRadius: '999px',
      background: meta.color + '22',
      color: meta.color,
      fontSize: small ? '0.68rem' : '0.75rem',
      fontWeight: 600,
      border: `1px solid ${meta.color}44`,
    }}>
      <Icon size={small ? 10 : 12} />
      {meta.label}
    </span>
  );
}

function DeviceStatusDot({ status }) {
  const online = status === 'online';
  return (
    <span style={{
      display: 'inline-block', width: 8, height: 8, borderRadius: '50%',
      background: online ? '#10b981' : '#475569',
      boxShadow: online ? '0 0 6px #10b98180' : 'none',
      flexShrink: 0,
    }} />
  );
}

function LiveEventCard({ event }) {
  if (!event) return null;
  const isIdentity = event.type === 'tap';
  const ts = event.timestamp ? new Date(event.timestamp).toLocaleTimeString() : '';
  return (
    <div style={{
      padding: '10px 14px', borderRadius: 10,
      background: isIdentity ? '#6366f115' : '#10b98115',
      border: `1px solid ${isIdentity ? '#6366f130' : '#10b98130'}`,
      display: 'flex', alignItems: 'center', gap: 10,
    }}>
      {isIdentity ? <CreditCard size={16} color="#6366f1" /> : <Activity size={16} color="#10b981" />}
      <div style={{ flex: 1, minWidth: 0 }}>
        <div style={{ fontWeight: 600, fontSize: '0.8rem', color: 'var(--text-main)', whiteSpace: 'nowrap', overflow: 'hidden', textOverflow: 'ellipsis' }}>
          {isIdentity ? `Card Tap — ${event.uid || event.data?.uid || ''}` : `Reading — ${event.device_id || ''}`}
        </div>
        {event.user?.name && (
          <div style={{ fontSize: '0.72rem', color: 'var(--text-muted)' }}>👤 {event.user.name}</div>
        )}
      </div>
      <span style={{ fontSize: '0.68rem', color: 'var(--text-muted)', whiteSpace: 'nowrap' }}>{ts}</span>
    </div>
  );
}

// ─── Fusion Group Panel (live monitor card) ──────────────────────────────────
function FusionGroupPanel({ group, liveEvents }) {
  const identityDevices = (group.devices || []).filter(d =>
    getDeviceMeta(d.device_type).role === 'identity'
  );
  const measureDevices = (group.devices || []).filter(d =>
    getDeviceMeta(d.device_type).role !== 'identity'
  );

  // Latest tap for this group
  const latestTap = liveEvents.find(e =>
    e.type === 'tap' && group.device_ids?.some(id => id === e.device_id)
  );

  return (
    <div style={{
      background: 'var(--surface)',
      border: `2px solid ${latestTap ? group.color || '#6366f1' : 'var(--border)'}`,
      borderRadius: 16,
      padding: '18px 20px',
      display: 'flex',
      flexDirection: 'column',
      gap: 14,
      boxShadow: latestTap ? `0 0 24px ${(group.color || '#6366f1')}30` : '0 2px 8px #0002',
      transition: 'all 0.4s ease',
    }}>
      {/* Header */}
      <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between' }}>
        <div style={{ display: 'flex', alignItems: 'center', gap: 10 }}>
          <span style={{
            width: 32, height: 32, borderRadius: 8,
            background: (group.color || '#6366f1') + '22',
            color: group.color || '#6366f1',
            display: 'flex', alignItems: 'center', justifyContent: 'center',
          }}>
            <Link2 size={16} />
          </span>
          <div>
            <div style={{ fontWeight: 700, fontSize: '0.95rem', color: 'var(--text-main)' }}>{group.name}</div>
            <div style={{ fontSize: '0.72rem', color: 'var(--text-muted)' }}>{group.description || `${(group.devices || []).length} devices`}</div>
          </div>
        </div>
        <span style={{
          padding: '3px 10px', borderRadius: '999px',
          background: latestTap ? '#6366f122' : '#64748b18',
          color: latestTap ? '#6366f1' : '#64748b',
          fontSize: '0.7rem', fontWeight: 700,
        }}>
          {latestTap ? '● ACTIVE' : '○ IDLE'}
        </span>
      </div>

      {/* Identity section (from card reader) */}
      {latestTap ? (
        <div style={{
          borderRadius: 10, padding: '12px 14px',
          background: '#6366f112', border: '1px solid #6366f130',
          display: 'flex', alignItems: 'center', gap: 12,
        }}>
          <div style={{
            width: 40, height: 40, borderRadius: '50%',
            background: '#6366f1', color: '#fff',
            display: 'flex', alignItems: 'center', justifyContent: 'center',
            fontWeight: 700, fontSize: '1rem',
          }}>
            {(latestTap.user?.name || latestTap.uid || '?')[0]?.toUpperCase()}
          </div>
          <div>
            <div style={{ fontWeight: 700, color: '#6366f1', fontSize: '0.9rem' }}>
              {latestTap.user?.name || 'Unknown User'}
            </div>
            <div style={{ fontSize: '0.72rem', color: 'var(--text-muted)' }}>
              UID: {latestTap.uid || latestTap.data?.uid} &nbsp;·&nbsp; {new Date(latestTap.timestamp).toLocaleTimeString()}
            </div>
          </div>
          <CheckCircle size={18} color="#10b981" style={{ marginLeft: 'auto' }} />
        </div>
      ) : identityDevices.length > 0 ? (
        <div style={{
          borderRadius: 10, padding: '10px 14px',
          background: '#64748b0a', border: '1px dashed #64748b30',
          color: 'var(--text-muted)', fontSize: '0.78rem', textAlign: 'center',
        }}>
          <CreditCard size={14} style={{ display: 'inline', marginRight: 6 }} />
          Waiting for card tap…
        </div>
      ) : null}

      {/* Measurement / Sensor devices */}
      {measureDevices.length > 0 && (
        <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fill, minmax(140px, 1fr))', gap: 8 }}>
          {measureDevices.map(device => {
            const meta = getDeviceMeta(device.device_type);
            const Icon = meta.icon;
            const reading = device.latest_data;
            return (
              <div key={device.device_id} style={{
                borderRadius: 10, padding: '10px 12px',
                background: `${meta.color}0d`,
                border: `1px solid ${meta.color}30`,
              }}>
                <div style={{ display: 'flex', alignItems: 'center', gap: 6, marginBottom: 6 }}>
                  <DeviceStatusDot status={device.status} />
                  <Icon size={13} color={meta.color} />
                  <span style={{ fontSize: '0.7rem', color: meta.color, fontWeight: 600 }}>{device.name}</span>
                </div>
                {reading ? (
                  <div style={{ fontSize: '0.8rem', color: 'var(--text-main)', fontWeight: 700 }}>
                    {reading.weight_kg !== undefined && <div>⚖️ {reading.weight_kg} kg</div>}
                    {reading.height_cm !== undefined && <div>📏 {reading.height_cm} cm</div>}
                    {reading.temperature !== undefined && <div>🌡️ {reading.temperature}°C</div>}
                    {reading.humidity !== undefined && <div>💧 {reading.humidity}%</div>}
                    {reading.wind_speed !== undefined && <div>💨 {reading.wind_speed} m/s</div>}
                    {reading.value !== undefined && <div>📊 {reading.value}</div>}
                    {(reading.tapped_user_name || reading.tapped_user_flapid) && (
                      <div style={{ fontSize: '0.68rem', color: '#6366f1', fontWeight: 600, marginTop: 4 }}>
                        👤 {reading.tapped_user_name || reading.tapped_user_flapid}
                      </div>
                    )}
                    <div style={{ fontSize: '0.65rem', color: 'var(--text-muted)', marginTop: 2, fontWeight: 400 }}>
                      {reading.timestamp ? new Date(reading.timestamp).toLocaleTimeString() : ''}
                    </div>
                  </div>
                ) : (
                  <div style={{ fontSize: '0.72rem', color: 'var(--text-muted)' }}>Awaiting data…</div>
                )}
              </div>
            );
          })}
        </div>
      )}
    </div>
  );
}

// ─── Main Page Component ─────────────────────────────────────────────────────
function SensorFusion() {
  const token = localStorage.getItem('token');
  const [groups, setGroups] = useState([]);
  const [allDevices, setAllDevices] = useState([]);
  const [loading, setLoading] = useState(true);
  const [liveEvents, setLiveEvents] = useState([]);
  const [activeSection, setActiveSection] = useState('monitor'); // 'monitor' | 'configure'

  // Form state
  const [showForm, setShowForm] = useState(false);
  const [editingGroup, setEditingGroup] = useState(null);
  const [formData, setFormData] = useState({ name: '', description: '', device_ids: [], color: '#6366f1' });
  const [saving, setSaving] = useState(false);

  const socketRef = useRef(null);

  // ── Fetch initial data ──────────────────────────────────────────────────────
  useEffect(() => {
    fetchAll();
    connectSocket();
    return () => socketRef.current?.disconnect();
  }, []);

  const fetchAll = async () => {
    setLoading(true);
    try {
      const [groupsRes, devicesRes] = await Promise.all([
        fetch(`${API_BASE_URL}/v1/fusion-groups/all/live`, { headers: { Authorization: `Bearer ${token}` } }),
        fetch(`${API_BASE_URL}/v1/devices`, { headers: { Authorization: `Bearer ${token}` } }),
      ]);
      if (groupsRes.ok) setGroups(await groupsRes.json());
      if (devicesRes.ok) setAllDevices(await devicesRes.json());
    } catch (e) {
      console.error('SensorFusion fetch error:', e);
    } finally {
      setLoading(false);
    }
  };

  const connectSocket = () => {
    const host = import.meta.env.DEV
      ? `http://${window.location.hostname}:5051`
      : window.location.origin;
    socketRef.current = io(host, { transports: ['websocket', 'polling'] });

    socketRef.current.on('new_tap', (data) => {
      setLiveEvents(prev => [{ ...data, type: 'tap', timestamp: data.timestamp || new Date().toISOString() }, ...prev].slice(0, 20));
    });

    socketRef.current.on('sensor_fusion_tap', (data) => {
      setLiveEvents(prev => [{ ...data, type: 'tap', timestamp: data.timestamp || new Date().toISOString() }, ...prev].slice(0, 20));
    });

    socketRef.current.on('new_reading', (data) => {
      setLiveEvents(prev => [{ ...data, type: 'reading', timestamp: data.timestamp || new Date().toISOString() }, ...prev].slice(0, 20));
      setGroups(prev => prev.map(g => ({
        ...g,
        devices: (g.devices || []).map(d =>
          d.device_id === (data.device_id || data.deviceId) ? { ...d, latest_data: data } : d
        ),
      })));
    });

    socketRef.current.on('new_scale_reading', (data) => {
      const readingPayload = data.payload || data;
      setLiveEvents(prev => [{ ...readingPayload, device_id: data.device_id, type: 'reading', timestamp: data.timestamp || new Date().toISOString() }, ...prev].slice(0, 20));
      setGroups(prev => prev.map(g => ({
        ...g,
        devices: (g.devices || []).map(d =>
          d.device_id === data.device_id ? { ...d, latest_data: readingPayload } : d
        ),
      })));
    });
  };

  // ── CRUD ────────────────────────────────────────────────────────────────────
  const openCreate = () => {
    setEditingGroup(null);
    setFormData({ name: '', description: '', device_ids: [], color: '#6366f1' });
    setShowForm(true);
  };

  const openEdit = (group) => {
    setEditingGroup(group);
    setFormData({ name: group.name, description: group.description || '', device_ids: group.device_ids || [], color: group.color || '#6366f1' });
    setShowForm(true);
  };

  const toggleDevice = (device_id) => {
    setFormData(prev => ({
      ...prev,
      device_ids: prev.device_ids.includes(device_id)
        ? prev.device_ids.filter(id => id !== device_id)
        : [...prev.device_ids, device_id],
    }));
  };

  const handleSave = async () => {
    if (!formData.name.trim()) return;
    setSaving(true);
    try {
      const url = editingGroup
        ? `${API_BASE_URL}/v1/fusion-groups/${editingGroup._id}`
        : `${API_BASE_URL}/v1/fusion-groups`;
      const method = editingGroup ? 'PUT' : 'POST';
      const res = await fetch(url, {
        method,
        headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${token}` },
        body: JSON.stringify(formData),
      });
      if (res.ok) {
        setShowForm(false);
        fetchAll();
      }
    } finally {
      setSaving(false);
    }
  };

  const handleDelete = async (id) => {
    if (!window.confirm('Delete this fusion group?')) return;
    await fetch(`${API_BASE_URL}/v1/fusion-groups/${id}`, {
      method: 'DELETE',
      headers: { Authorization: `Bearer ${token}` },
    });
    fetchAll();
  };

  const GROUP_COLORS = ['#6366f1', '#10b981', '#f59e0b', '#06b6d4', '#8b5cf6', '#ef4444', '#ec4899', '#14b8a6'];

  return (
    <div style={{ padding: '28px 32px', maxWidth: 1400, margin: '0 auto' }}>

      {/* ── Page header ── */}
      <div style={{ display: 'flex', alignItems: 'flex-start', justifyContent: 'space-between', marginBottom: 28, gap: 16, flexWrap: 'wrap' }}>
        <div>
          <h1 style={{ fontSize: '1.6rem', fontWeight: 800, color: 'var(--text-main)', margin: 0, display: 'flex', alignItems: 'center', gap: 10 }}>
            <Link2 size={24} color="#6366f1" /> Sensor Fusion
          </h1>
          <p style={{ color: 'var(--text-muted)', margin: '4px 0 0', fontSize: '0.88rem' }}>
            Group devices together to create intelligent, correlated IoT workstations — from clinic entry stations to automated weather arrays.
          </p>
        </div>
        <div style={{ display: 'flex', gap: 10 }}>
          <button
            onClick={fetchAll}
            className="btn btn-secondary"
            style={{ gap: 6 }}
          >
            <RefreshCw size={15} />
            Refresh
          </button>
          <button onClick={openCreate} className="btn btn-primary" style={{ gap: 6 }}>
            <Plus size={15} /> New Group
          </button>
        </div>
      </div>

      {/* ── Tab switcher ── */}
      <div style={{ display: 'flex', gap: 4, marginBottom: 24, background: 'var(--surface)', borderRadius: 10, padding: 4, border: '1px solid var(--border)', width: 'fit-content' }}>
        {[['monitor', 'Live Monitor', Activity], ['configure', 'Configure Groups', Link2]].map(([id, label, Icon]) => (
          <button
            key={id}
            onClick={() => setActiveSection(id)}
            style={{
              display: 'flex', alignItems: 'center', gap: 6,
              padding: '7px 16px', borderRadius: 8, border: 'none', cursor: 'pointer',
              background: activeSection === id ? 'var(--accent)' : 'transparent',
              color: activeSection === id ? '#fff' : 'var(--text-muted)',
              fontWeight: 600, fontSize: '0.82rem', transition: 'all 0.15s',
            }}
          >
            <Icon size={14} /> {label}
          </button>
        ))}
      </div>

      {/* ── Modal Form ── */}
      {showForm && (
        <div style={{
          position: 'fixed', inset: 0, background: 'rgba(15, 23, 42, 0.55)', backdropFilter: 'blur(4px)', zIndex: 1000,
          display: 'flex', alignItems: 'center', justifyContent: 'center', padding: 24,
        }} onClick={() => setShowForm(false)}>
          <div style={{
            background: 'var(--bg-surface, #ffffff)', borderRadius: 18, padding: 28, width: '100%', maxWidth: 560,
            border: '1px solid var(--border-strong, #cbd5e1)', boxShadow: '0 20px 60px rgba(0, 0, 0, 0.18)',
            maxHeight: '90vh', overflowY: 'auto',
          }} onClick={e => e.stopPropagation()}>
            <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', marginBottom: 20 }}>
              <h2 style={{ margin: 0, fontWeight: 800, fontSize: '1.15rem', color: 'var(--text-main)' }}>
                {editingGroup ? 'Edit Group' : 'New Fusion Group'}
              </h2>
              <button onClick={() => setShowForm(false)} className="btn btn-secondary btn-icon" style={{ borderRadius: '50%', width: 32, height: 32, padding: 0 }}>
                <X size={18} />
              </button>
            </div>

            <div style={{ display: 'flex', flexDirection: 'column', gap: 16 }}>
              <div className="form-group" style={{ marginBottom: 0 }}>
                <label className="form-label" style={{ display: 'block', marginBottom: 6 }}>Group Name *</label>
                <input className="form-control" placeholder="e.g. Clinic Entry Station 1"
                  value={formData.name} onChange={e => setFormData(p => ({ ...p, name: e.target.value }))} />
              </div>
              <div className="form-group" style={{ marginBottom: 0 }}>
                <label className="form-label" style={{ display: 'block', marginBottom: 6 }}>Description</label>
                <input className="form-control" placeholder="Optional description (e.g. Reception Desk & Scale)"
                  value={formData.description} onChange={e => setFormData(p => ({ ...p, description: e.target.value }))} />
              </div>

              {/* Color picker */}
              <div className="form-group" style={{ marginBottom: 0 }}>
                <label className="form-label" style={{ display: 'block', marginBottom: 6 }}>Group Color</label>
                <div style={{ display: 'flex', gap: 10, flexWrap: 'wrap' }}>
                  {GROUP_COLORS.map(c => (
                    <button key={c} type="button" onClick={() => setFormData(p => ({ ...p, color: c }))} style={{
                      width: 30, height: 30, borderRadius: '50%', background: c, border: formData.color === c ? '3px solid #0f172a' : '2px solid transparent',
                      boxShadow: formData.color === c ? `0 0 10px ${c}80` : 'none',
                      cursor: 'pointer', transition: 'all 0.15s',
                    }} />
                  ))}
                </div>
              </div>

              {/* Device picker */}
              <div className="form-group" style={{ marginBottom: 0 }}>
                <label className="form-label" style={{ display: 'block', marginBottom: 6 }}>Select Devices ({formData.device_ids.length} selected)</label>
                <div style={{ display: 'flex', flexDirection: 'column', gap: 8, maxHeight: 260, overflowY: 'auto', padding: '4px 0' }}>
                  {allDevices.map(device => {
                    const meta = getDeviceMeta(device.device_type);
                    const Icon = meta.icon;
                    const selected = formData.device_ids.includes(device.device_id);
                    return (
                      <div key={device.device_id}
                        onClick={() => toggleDevice(device.device_id)}
                        style={{
                          display: 'flex', alignItems: 'center', gap: 12, padding: '10px 14px',
                          borderRadius: 12, cursor: 'pointer', transition: 'all 0.15s ease',
                          background: selected ? `${meta.color}15` : '#f8fafc',
                          border: `1.5px solid ${selected ? meta.color : '#e2e8f0'}`,
                        }}>
                        <div style={{
                          width: 22, height: 22, borderRadius: 6, border: `2px solid ${selected ? meta.color : '#cbd5e1'}`,
                          background: selected ? meta.color : '#ffffff', flexShrink: 0,
                          display: 'flex', alignItems: 'center', justifyContent: 'center',
                          transition: 'all 0.15s ease',
                        }}>
                          {selected && <CheckCircle size={14} color="#fff" />}
                        </div>
                        <Icon size={16} color={meta.color} />
                        <div style={{ flex: 1, minWidth: 0 }}>
                          <div style={{ fontWeight: 600, fontSize: '0.85rem', color: 'var(--text-main)' }}>{device.name}</div>
                          <div style={{ fontSize: '0.72rem', color: 'var(--text-muted)' }}>{device.device_id} · {meta.label}</div>
                        </div>
                        <DeviceStatusDot status={device.status} />
                      </div>
                    );
                  })}
                  {allDevices.length === 0 && (
                    <div style={{ color: 'var(--text-muted)', fontSize: '0.85rem', textAlign: 'center', padding: '20px 16px', background: '#f8fafc', borderRadius: 12, border: '1px dashed #cbd5e1' }}>
                      No registered devices found. Add devices in Hardware & Devices first.
                    </div>
                  )}
                </div>
              </div>

              <div style={{ display: 'flex', gap: 10, justifyContent: 'flex-end', marginTop: 8 }}>
                <button className="btn btn-secondary" onClick={() => setShowForm(false)}>Cancel</button>
                <button className="btn btn-primary" onClick={handleSave} disabled={saving || !formData.name.trim()}>
                  <Save size={15} /> {saving ? 'Saving…' : 'Save Group'}
                </button>
              </div>
            </div>
          </div>
        </div>
      )}

      {/* ── LIVE MONITOR TAB ── */}
      {activeSection === 'monitor' && (
        <div>
          {loading ? (
            <div style={{ textAlign: 'center', padding: 64, color: 'var(--text-muted)' }}>
              <RefreshCw size={28} style={{ animation: 'spin 1s linear infinite', marginBottom: 12 }} />
              <div>Loading fusion groups…</div>
            </div>
          ) : groups.length === 0 ? (
            <div style={{
              textAlign: 'center', padding: '64px 32px',
              background: 'var(--surface)', borderRadius: 16, border: '2px dashed var(--border)',
            }}>
              <Link2Off size={36} color="var(--text-muted)" style={{ marginBottom: 14 }} />
              <div style={{ fontWeight: 700, fontSize: '1.1rem', color: 'var(--text-main)', marginBottom: 6 }}>No Fusion Groups Yet</div>
              <div style={{ color: 'var(--text-muted)', fontSize: '0.85rem', marginBottom: 18 }}>
                Create a group in "Configure Groups" to pair your devices together and monitor them in real-time.
              </div>
              <button className="btn btn-primary" onClick={() => { setActiveSection('configure'); openCreate(); }}>
                <Plus size={14} /> Create First Group
              </button>
            </div>
          ) : (
            <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fill, minmax(380px, 1fr))', gap: 18 }}>
              {groups.map(group => (
                <FusionGroupPanel key={group._id} group={group} liveEvents={liveEvents} />
              ))}
            </div>
          )}

          {/* Live event stream */}
          {liveEvents.length > 0 && (
            <div style={{ marginTop: 28 }}>
              <div style={{ fontWeight: 700, fontSize: '0.85rem', color: 'var(--text-muted)', marginBottom: 10, textTransform: 'uppercase', letterSpacing: '0.05em' }}>
                ● Live Events
              </div>
              <div style={{ display: 'flex', flexDirection: 'column', gap: 6 }}>
                {liveEvents.slice(0, 8).map((ev, i) => <LiveEventCard key={i} event={ev} />)}
              </div>
            </div>
          )}
        </div>
      )}

      {/* ── CONFIGURE GROUPS TAB ── */}
      {activeSection === 'configure' && (
        <div style={{ display: 'flex', flexDirection: 'column', gap: 12 }}>
          {loading ? (
            <div style={{ textAlign: 'center', padding: 40, color: 'var(--text-muted)' }}>Loading…</div>
          ) : groups.length === 0 ? (
            <div style={{
              textAlign: 'center', padding: '48px 32px',
              background: 'var(--surface)', borderRadius: 16, border: '2px dashed var(--border)',
            }}>
              <Cpu size={32} color="var(--text-muted)" style={{ marginBottom: 12 }} />
              <div style={{ fontWeight: 700, fontSize: '1rem', color: 'var(--text-main)', marginBottom: 6 }}>No groups configured</div>
              <div style={{ color: 'var(--text-muted)', fontSize: '0.82rem', marginBottom: 16 }}>
                Create a fusion group to pair devices like NFC readers, scales, and weather stations together.
              </div>
              <button className="btn btn-primary" onClick={openCreate}><Plus size={14} /> Create Group</button>
            </div>
          ) : (
            groups.map(group => (
              <div key={group._id} style={{
                background: 'var(--surface)', borderRadius: 14, padding: '16px 20px',
                border: '1px solid var(--border)',
                borderLeft: `4px solid ${group.color || '#6366f1'}`,
              }}>
                <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', gap: 12 }}>
                  <div>
                    <div style={{ fontWeight: 700, fontSize: '1rem', color: 'var(--text-main)', marginBottom: 4 }}>
                      {group.name}
                    </div>
                    {group.description && (
                      <div style={{ fontSize: '0.78rem', color: 'var(--text-muted)', marginBottom: 8 }}>{group.description}</div>
                    )}
                    <div style={{ display: 'flex', flexWrap: 'wrap', gap: 6 }}>
                      {(group.device_ids || []).length === 0 ? (
                        <span style={{ fontSize: '0.72rem', color: 'var(--text-muted)' }}>No devices linked</span>
                      ) : (group.devices || []).map(d => (
                        <DeviceTypeBadge key={d.device_id} device_type={d.device_type} small />
                      ))}
                    </div>
                  </div>
                  <div style={{ display: 'flex', gap: 8, flexShrink: 0 }}>
                    <button className="btn btn-secondary" style={{ padding: '6px 10px' }} onClick={() => openEdit(group)}>
                      <Edit3 size={14} />
                    </button>
                    <button className="btn btn-secondary" style={{ padding: '6px 10px', color: '#ef4444', borderColor: '#ef444430' }} onClick={() => handleDelete(group._id)}>
                      <Trash2 size={14} />
                    </button>
                  </div>
                </div>
              </div>
            ))
          )}
        </div>
      )}
    </div>
  );
}

export default SensorFusion;
