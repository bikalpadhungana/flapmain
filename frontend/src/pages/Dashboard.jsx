import React, { useState, useEffect, useRef } from 'react';
import { useNavigate } from 'react-router-dom';
import {
  Search, Trash2, Cpu, RefreshCw, Link2,
  CreditCard, Activity, Wifi, ArrowRight
} from 'lucide-react';
import { API_BASE_URL } from '../config';
import ConfirmModal from '../components/ConfirmModal';
import io from 'socket.io-client';

const DEVICE_COLORS = {
  card_reader: '#6366f1', nfc_reader: '#6366f1', rfid: '#6366f1',
  weight_scale_v1: '#10b981', weight_scale: '#10b981',
  weather_station: '#f59e0b', temperature: '#f59e0b',
  relay: '#ef4444', actuator: '#ef4444',
};
function getDeviceColor(device_type) {
  const key = (device_type || '').toLowerCase();
  for (const [k, v] of Object.entries(DEVICE_COLORS)) {
    if (key.includes(k)) return v;
  }
  return '#64748b';
}

function StatCard({ icon: Icon, label, value, sub, color, loading }) {
  return (
    <div style={{
      background: 'var(--surface)', borderRadius: 14, padding: '18px 22px',
      border: '1px solid var(--border)',
      display: 'flex', alignItems: 'center', gap: 16,
      boxShadow: '0 2px 8px #0001',
    }}>
      <div style={{
        width: 44, height: 44, borderRadius: 12,
        background: color + '20', color,
        display: 'flex', alignItems: 'center', justifyContent: 'center',
        flexShrink: 0,
      }}>
        <Icon size={20} />
      </div>
      <div>
        <div style={{ fontSize: '1.6rem', fontWeight: 800, color: 'var(--text-main)', lineHeight: 1 }}>
          {loading ? '—' : value}
        </div>
        <div style={{ fontSize: '0.75rem', color: 'var(--text-muted)', marginTop: 2 }}>{label}</div>
        {sub && <div style={{ fontSize: '0.68rem', color, marginTop: 1 }}>{sub}</div>}
      </div>
    </div>
  );
}

function LiveEventRow({ event }) {
  const isTap = event.type === 'tap';
  const color = isTap ? '#6366f1' : '#10b981';
  const time = event.ts ? new Date(event.ts).toLocaleTimeString() : '';
  return (
    <div style={{
      display: 'flex', alignItems: 'center', gap: 10, padding: '8px 12px',
      borderRadius: 8, background: color + '0d', border: `1px solid ${color}20`,
    }}>
      {isTap ? <CreditCard size={14} color={color} /> : <Activity size={14} color={color} />}
      <span style={{ flex: 1, fontSize: '0.78rem', color: 'var(--text-main)', overflow: 'hidden', whiteSpace: 'nowrap', textOverflow: 'ellipsis' }}>
        {isTap
          ? `Card tap · ${event.uid || ''} ${event.user ? `· ${event.user}` : ''}`
          : `${event.device_id || 'Sensor'} reading`}
      </span>
      <span style={{ fontSize: '0.68rem', color: 'var(--text-muted)', flexShrink: 0 }}>{time}</span>
    </div>
  );
}

function Dashboard() {
  const [devices, setDevices] = useState([]);
  const [groups, setGroups] = useState([]);
  const [searchTerm, setSearchTerm] = useState('');
  const [loading, setLoading] = useState(true);
  const [confirmModal, setConfirmModal] = useState({ isOpen: false, deviceId: null });
  const [liveEvents, setLiveEvents] = useState([]);
  const [isConnected, setIsConnected] = useState(false);

  const navigate = useNavigate();
  const token = localStorage.getItem('token');
  const socketRef = useRef(null);

  useEffect(() => {
    if (!token) { navigate('/login'); return; }
    fetchData();
    connectSocket();
    return () => socketRef.current?.disconnect();
  }, [token]);

  const fetchData = async () => {
    setLoading(true);
    try {
      const [devRes, groupsRes] = await Promise.all([
        fetch(`${API_BASE_URL}/v1/devices`, { headers: { Authorization: `Bearer ${token}` } }),
        fetch(`${API_BASE_URL}/v1/fusion-groups`, { headers: { Authorization: `Bearer ${token}` } }),
      ]);
      if (devRes.status === 401) { navigate('/login'); return; }
      const devData = await devRes.json();
      setDevices(Array.isArray(devData) ? devData : []);
      if (groupsRes.ok) setGroups(await groupsRes.json());
    } catch (err) {
      console.error('Error fetching dashboard data:', err);
    } finally {
      setLoading(false);
    }
  };

  const connectSocket = () => {
    const host = import.meta.env.DEV
      ? `http://${window.location.hostname}:5051`
      : window.location.origin;
    socketRef.current = io(host, { transports: ['websocket', 'polling'] });
    socketRef.current.on('connect', () => setIsConnected(true));
    socketRef.current.on('disconnect', () => setIsConnected(false));
    socketRef.current.on('new_tap', (data) => {
      setLiveEvents(p => [{
        type: 'tap', uid: data.uid || data.tag_uid,
        user: data.targetResponse?.user?.name || data.tapped_user_name || '',
        device_id: data.device_id, ts: new Date().toISOString(),
      }, ...p].slice(0, 12));
    });
    socketRef.current.on('new_reading', (data) => {
      setLiveEvents(p => [{
        type: 'reading', device_id: data.device_id || data.deviceId,
        ts: new Date().toISOString(),
      }, ...p].slice(0, 12));
    });
  };

  const handleDeleteClick = (deviceId) => setConfirmModal({ isOpen: true, deviceId });

  const handleDeleteConfirm = async () => {
    const deviceId = confirmModal.deviceId;
    if (!deviceId) return;
    try {
      await fetch(`${API_BASE_URL}/v1/devices/${deviceId}`, {
        method: 'DELETE',
        headers: { Authorization: `Bearer ${token}` },
      });
      setDevices(prev => prev.filter(d => d.device_id !== deviceId));
    } catch (err) {
      console.error('Error deleting device:', err);
    } finally {
      setConfirmModal({ isOpen: false, deviceId: null });
    }
  };

  const onlineDevices = devices.filter(d => d.status === 'online');
  const filteredDevices = devices.filter(d =>
    d.name.toLowerCase().includes(searchTerm.toLowerCase()) ||
    d.device_id.toLowerCase().includes(searchTerm.toLowerCase()) ||
    d.device_type.toLowerCase().includes(searchTerm.toLowerCase())
  );

  return (
    <div style={{ display: 'flex', flexDirection: 'column', gap: 24, flex: 1 }}>

      {/* Page header */}
      <div style={{ display: 'flex', alignItems: 'flex-end', justifyContent: 'space-between', flexWrap: 'wrap', gap: 12 }}>
        <div>
          <h1 style={{ fontSize: '1.6rem', fontWeight: 800, color: 'var(--text-main)', margin: 0, letterSpacing: '-0.02em' }}>
            Fleet Overview
          </h1>
          <p style={{ color: 'var(--text-muted)', margin: '4px 0 0', fontSize: '0.85rem' }}>
            Real-time status of all registered IoT devices.
            {isConnected
              ? <span style={{ color: '#10b981', marginLeft: 8 }}>● Live</span>
              : <span style={{ color: '#94a3b8', marginLeft: 8 }}>○ Connecting…</span>}
          </p>
        </div>
        <button onClick={fetchData} className="btn btn-secondary" style={{ gap: 6 }} disabled={loading}>
          <RefreshCw size={14} className={loading ? 'spin' : ''} />
          Refresh
        </button>
      </div>

      {/* Hero stat cards */}
      <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fill, minmax(200px, 1fr))', gap: 14 }}>
        <StatCard icon={Cpu} label="Total Devices" value={devices.length} color="#6366f1" loading={loading} />
        <StatCard icon={Wifi} label="Online Now" value={onlineDevices.length}
          sub={devices.length > 0 ? `${Math.round(onlineDevices.length / devices.length * 100)}% uptime` : ''}
          color="#10b981" loading={loading} />
        <StatCard icon={Link2} label="Fusion Groups" value={groups.length}
          sub={groups.length > 0 ? 'Active device groups' : 'None configured'}
          color="#f59e0b" loading={loading} />
        <StatCard icon={Activity} label="Live Events" value={liveEvents.length}
          sub="Since page load" color="#8b5cf6" />
      </div>

      {/* Live event feed + quick links */}
      <div style={{ display: 'grid', gridTemplateColumns: '1fr 300px', gap: 16 }}>
        <div style={{ background: 'var(--surface)', borderRadius: 14, border: '1px solid var(--border)', padding: '16px 18px' }}>
          <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', marginBottom: 12 }}>
            <div style={{ fontWeight: 700, fontSize: '0.85rem', color: 'var(--text-main)' }}>Live Event Stream</div>
            <span style={{
              fontSize: '0.68rem', fontWeight: 700, padding: '2px 8px', borderRadius: '999px',
              background: isConnected ? '#10b98120' : '#64748b20',
              color: isConnected ? '#10b981' : '#64748b',
            }}>
              {isConnected ? '● LIVE' : '○ OFFLINE'}
            </span>
          </div>
          {liveEvents.length === 0 ? (
            <div style={{ color: 'var(--text-muted)', fontSize: '0.8rem', textAlign: 'center', padding: '28px 0' }}>
              Waiting for device events…<br />
              <span style={{ fontSize: '0.72rem' }}>Tap an NFC card or trigger a sensor.</span>
            </div>
          ) : (
            <div style={{ display: 'flex', flexDirection: 'column', gap: 6 }}>
              {liveEvents.map((ev, i) => <LiveEventRow key={i} event={ev} />)}
            </div>
          )}
        </div>

        <div style={{ display: 'flex', flexDirection: 'column', gap: 10 }}>
          {[
            { icon: Link2, label: 'Sensor Fusion', sub: 'Pair & monitor device groups', path: '/fusion', color: '#6366f1' },
            { icon: Activity, label: 'Scale Monitor', sub: 'Weight & height live feed', path: '/scale-monitor', color: '#10b981' },
            { icon: Cpu, label: 'System Monitor', sub: 'Server health & queue', path: '/system-monitor', color: '#f59e0b' },
          ].map(({ icon: Icon, label, sub, path, color }) => (
            <button key={path} onClick={() => navigate(path)} style={{
              background: 'var(--surface)', border: '1px solid var(--border)', borderRadius: 12,
              padding: '12px 14px', display: 'flex', alignItems: 'center', gap: 12,
              cursor: 'pointer', textAlign: 'left', transition: 'all 0.15s',
            }}
              onMouseEnter={e => { e.currentTarget.style.borderColor = color; e.currentTarget.style.background = color + '0a'; }}
              onMouseLeave={e => { e.currentTarget.style.borderColor = 'var(--border)'; e.currentTarget.style.background = 'var(--surface)'; }}
            >
              <div style={{ width: 36, height: 36, borderRadius: 9, background: color + '20', color, display: 'flex', alignItems: 'center', justifyContent: 'center' }}>
                <Icon size={16} />
              </div>
              <div style={{ flex: 1 }}>
                <div style={{ fontWeight: 700, fontSize: '0.85rem', color: 'var(--text-main)' }}>{label}</div>
                <div style={{ fontSize: '0.7rem', color: 'var(--text-muted)' }}>{sub}</div>
              </div>
              <ArrowRight size={14} color="var(--text-muted)" />
            </button>
          ))}
        </div>
      </div>

      {/* Device fleet grid */}
      <div style={{ display: 'flex', flexDirection: 'column', gap: 14 }}>
        <div style={{ fontWeight: 700, fontSize: '1rem', color: 'var(--text-main)' }}>
          Device Fleet
          <span style={{ marginLeft: 8, fontSize: '0.75rem', color: 'var(--text-muted)', fontWeight: 400 }}>
            {filteredDevices.length} device{filteredDevices.length !== 1 ? 's' : ''}
          </span>
        </div>

        <div style={{
          display: 'flex', alignItems: 'center', gap: 10,
          background: 'var(--surface)', borderRadius: 10, padding: '10px 14px',
          border: '1px solid var(--border)',
        }}>
          <Search size={16} color="var(--text-muted)" />
          <input
            type="text"
            placeholder="Search by name, ID or type…"
            value={searchTerm}
            onChange={e => setSearchTerm(e.target.value)}
            style={{ flex: 1, background: 'transparent', border: 'none', outline: 'none', color: 'var(--text-main)', fontSize: '0.85rem' }}
          />
        </div>

        {loading ? (
          <div style={{ textAlign: 'center', padding: 48, color: 'var(--text-muted)', fontSize: '0.85rem' }}>
            <RefreshCw size={24} style={{ animation: 'spin 1s linear infinite', marginBottom: 8 }} /><br />Loading devices…
          </div>
        ) : filteredDevices.length === 0 ? (
          <div style={{ textAlign: 'center', padding: 40, color: 'var(--text-muted)', fontSize: '0.85rem', background: 'var(--surface)', borderRadius: 14, border: '1px solid var(--border)' }}>
            No devices matched your query.
          </div>
        ) : (
          <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fill, minmax(300px, 1fr))', gap: 14 }}>
            {filteredDevices.map((device) => {
              const online = device.status === 'online';
              const color = getDeviceColor(device.device_type);
              return (
                <div
                  key={device.device_id}
                  onClick={() => navigate(`/device/${device.device_id}`)}
                  style={{
                    background: 'var(--surface)', borderRadius: 14, border: '1px solid var(--border)',
                    cursor: 'pointer', overflow: 'hidden', transition: 'all 0.15s',
                    borderLeft: `4px solid ${online ? color : '#475569'}`,
                  }}
                  onMouseEnter={e => { e.currentTarget.style.transform = 'translateY(-2px)'; e.currentTarget.style.boxShadow = '0 6px 20px #0002'; }}
                  onMouseLeave={e => { e.currentTarget.style.transform = 'none'; e.currentTarget.style.boxShadow = 'none'; }}
                >
                  <div style={{ padding: '14px 16px' }}>
                    <div style={{ display: 'flex', alignItems: 'flex-start', justifyContent: 'space-between', marginBottom: 10 }}>
                      <div style={{ display: 'flex', alignItems: 'center', gap: 10 }}>
                        <div style={{ width: 36, height: 36, borderRadius: 9, background: color + '20', color, display: 'flex', alignItems: 'center', justifyContent: 'center' }}>
                          <Cpu size={16} />
                        </div>
                        <div>
                          <div style={{ fontWeight: 700, fontSize: '0.9rem', color: 'var(--text-main)' }}>{device.name}</div>
                          <div style={{ fontFamily: 'monospace', fontSize: '0.68rem', color: 'var(--text-muted)' }}>{device.device_id}</div>
                        </div>
                      </div>
                      <button
                        onClick={e => { e.stopPropagation(); handleDeleteClick(device.device_id); }}
                        style={{ background: 'none', border: 'none', cursor: 'pointer', color: 'var(--text-muted)', padding: 4 }}
                        onMouseEnter={e => e.currentTarget.style.color = '#ef4444'}
                        onMouseLeave={e => e.currentTarget.style.color = 'var(--text-muted)'}
                      >
                        <Trash2 size={14} />
                      </button>
                    </div>

                    <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: '4px 12px', fontSize: '0.76rem' }}>
                      {[
                        ['Type', device.device_type],
                        ['Location', device.location || 'Unspecified'],
                        ['Status', device.status],
                        ['Last seen', device.last_seen ? new Date(device.last_seen).toLocaleTimeString() : 'Never'],
                      ].map(([k, v]) => (
                        <div key={k} style={{ display: 'flex', justifyContent: 'space-between', padding: '3px 0', borderBottom: '1px solid var(--border)' }}>
                          <span style={{ color: 'var(--text-muted)' }}>{k}</span>
                          <span style={{ fontWeight: 600, color: k === 'Status' ? (online ? '#10b981' : '#94a3b8') : 'var(--text-main)', maxWidth: 120, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>{v}</span>
                        </div>
                      ))}
                    </div>
                  </div>
                  <div style={{ padding: '8px 16px', background: color + '08', borderTop: '1px solid var(--border)', display: 'flex', justifyContent: 'flex-end' }}>
                    <span style={{ fontSize: '0.72rem', color, fontWeight: 600 }}>View Details →</span>
                  </div>
                </div>
              );
            })}
          </div>
        )}
      </div>

      <ConfirmModal
        isOpen={confirmModal.isOpen}
        onClose={() => setConfirmModal({ isOpen: false, deviceId: null })}
        onConfirm={handleDeleteConfirm}
        title="Deactivate Device"
        message={<><strong>Deactivate {confirmModal.deviceId}?</strong><br /><br />This device will be removed from the network.</>}
        confirmText="Deactivate"
        type="danger"
      />
    </div>
  );
}

export default Dashboard;
