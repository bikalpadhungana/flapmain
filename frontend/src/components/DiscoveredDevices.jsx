import React, { useEffect, useState, useCallback } from 'react';
import { Radar, Plus, EyeOff, Radio, MapPin, Crosshair } from 'lucide-react';
import { API_BASE_URL } from '../config';
import Modal from './Modal';

const timeAgo = (d) => {
  const t = d ? new Date(d).getTime() : NaN;
  if (Number.isNaN(t)) return 'never';
  const s = Math.max(0, Math.floor((Date.now() - t) / 1000));
  if (s < 60) return `${s}s ago`;
  if (s < 3600) return `${Math.floor(s / 60)}m ago`;
  if (s < 86400) return `${Math.floor(s / 3600)}h ago`;
  return new Date(t).toLocaleDateString();
};

const PREVIEW_FIELDS = ['temperature', 'humidity', 'battery_mv', 'rain_mm', 'text_msg'];

/**
 * Devices that sent data but are not registered yet. An admin adds each one,
 * either as a new device or by attaching it to an existing device, and enters
 * its GPS position.
 */
export default function DiscoveredDevices({ token, devices, schemas, onChanged }) {
  const [nodes, setNodes] = useState([]);
  const [claiming, setClaiming] = useState(null);
  const [form, setForm] = useState({});
  const [error, setError] = useState('');
  const [result, setResult] = useState(null);
  const [locating, setLocating] = useState(false);

  const load = useCallback(async () => {
    try {
      const res = await fetch(`${API_BASE_URL}/v1/devices/discovered`, { headers: { Authorization: `Bearer ${token}` } });
      const data = await res.json();
      setNodes(Array.isArray(data) ? data : []);
    } catch (err) {
      console.error('Discovered devices fetch failed:', err);
    }
  }, [token]);

  useEffect(() => {
    load();
    const t = setInterval(load, 30000);
    return () => clearInterval(t);
  }, [load]);

  const openClaim = (node) => {
    setError('');
    setResult(null);
    setClaiming(node);
    setForm({
      mode: 'new',
      name: '',
      device_type: node.device_type_guess || schemas[0]?.device_type || '',
      device_id: node.reported_device_id,
      location: '',
      target_device_id: '',
      latitude: '',
      longitude: '',
    });
  };

  const useMyLocation = () => {
    if (!navigator.geolocation) { setError('This browser cannot read GPS position'); return; }
    setLocating(true);
    navigator.geolocation.getCurrentPosition(
      (pos) => {
        setForm((f) => ({ ...f, latitude: pos.coords.latitude.toFixed(6), longitude: pos.coords.longitude.toFixed(6) }));
        setLocating(false);
      },
      (err) => { setError(`Could not get location: ${err.message}`); setLocating(false); },
      { enableHighAccuracy: true, timeout: 15000 },
    );
  };

  const submitClaim = async (e) => {
    e.preventDefault();
    setError('');
    const body = form.mode === 'attach'
      ? { mode: 'attach', target_device_id: form.target_device_id, latitude: form.latitude, longitude: form.longitude }
      : { mode: 'new', name: form.name, device_type: form.device_type, device_id: form.device_id, location: form.location, latitude: form.latitude, longitude: form.longitude };
    if (form.mode === 'attach' && !form.target_device_id) { setError('Choose the device to attach to'); return; }
    // Leave GPS untouched on attach when both fields are empty.
    if (form.mode === 'attach' && form.latitude === '' && form.longitude === '') { delete body.latitude; delete body.longitude; }
    try {
      const res = await fetch(`${API_BASE_URL}/v1/devices/discovered/${claiming._id}/claim`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${token}` },
        body: JSON.stringify(body),
      });
      const data = await res.json();
      if (!res.ok) throw new Error(data.message || 'Could not add device');
      setResult(data);
      load();
      onChanged?.();
    } catch (err) {
      setError(err.message);
    }
  };

  const ignore = async (node) => {
    await fetch(`${API_BASE_URL}/v1/devices/discovered/${node._id}`, {
      method: 'PATCH',
      headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${token}` },
      body: JSON.stringify({ status: 'ignored' }),
    });
    load();
  };

  if (nodes.length === 0) return null;

  const set = (k) => (e) => setForm((f) => ({ ...f, [k]: e.target.value }));

  return (
    <section className="card" style={{ padding: 16, border: '1px solid rgba(217,119,6,0.35)', background: 'var(--status-warn-bg)' }}>
      <div style={{ display: 'flex', alignItems: 'center', gap: 8, marginBottom: 4 }}>
        <Radar size={18} color="var(--status-warn)" />
        <h2 style={{ margin: 0, fontSize: '1rem', fontWeight: 700 }}>Discovered devices ({nodes.length})</h2>
      </div>
      <p style={{ margin: '0 0 12px 0', fontSize: '0.82rem', color: 'var(--text-dim)' }}>
        These devices are sending data but are not registered. Their readings are held for 7 days. Add each one to start showing its data.
      </p>

      <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fill, minmax(280px, 1fr))', gap: 10 }}>
        {nodes.map((n) => {
          const p = n.last_payload || {};
          const preview = PREVIEW_FIELDS.filter((k) => p[k] !== undefined && p[k] !== '').map((k) => `${k}: ${p[k]}`).join(' · ');
          return (
            <div key={n._id} className="card" style={{ padding: 12, display: 'flex', flexDirection: 'column', gap: 6, background: 'var(--bg-surface, #fff)' }}>
              <div style={{ display: 'flex', justifyContent: 'space-between', gap: 8, alignItems: 'baseline' }}>
                <strong style={{ fontSize: '0.92rem' }}>{n.origin_node ? `LoRa node #${n.origin_node}` : 'Unknown device'}</strong>
                <span style={{ fontSize: '0.72rem', color: 'var(--text-muted)' }}>{timeAgo(n.last_seen)}</span>
              </div>
              <div style={{ fontFamily: 'var(--font-mono)', fontSize: '0.72rem', color: 'var(--text-muted)', wordBreak: 'break-all' }}>{n.reported_device_id}</div>
              <div style={{ fontSize: '0.75rem', color: 'var(--text-dim)' }}>
                {n.packet_count} packets · {n.device_type_guess || 'unknown type'}
              </div>
              {n.heard_by?.length > 0 && (
                <div style={{ fontSize: '0.72rem', color: 'var(--text-dim)', display: 'flex', alignItems: 'center', gap: 4, flexWrap: 'wrap' }}>
                  <Radio size={11} /> {n.heard_by.map((h) => `${h.gateway_id}${h.rssi != null ? ` (${h.rssi} dBm)` : ''}`).join(', ')}
                </div>
              )}
              {preview && <div style={{ fontSize: '0.72rem', color: 'var(--text-muted)' }}>{preview}</div>}
              <div style={{ display: 'flex', gap: 6, marginTop: 4 }}>
                <button className="btn btn-primary" style={{ padding: '4px 10px', fontSize: '0.8rem' }} onClick={() => openClaim(n)}>
                  <Plus size={13} /> Add
                </button>
                <button className="btn btn-secondary" style={{ padding: '4px 10px', fontSize: '0.8rem' }} onClick={() => ignore(n)}>
                  <EyeOff size={13} /> Ignore
                </button>
              </div>
            </div>
          );
        })}
      </div>

      <Modal
        open={!!claiming}
        onClose={() => setClaiming(null)}
        title={claiming ? `Add ${claiming.origin_node ? `LoRa node #${claiming.origin_node}` : claiming.reported_device_id}` : ''}
        maxWidth="640px"
        actions={result ? (
          <button type="button" className="btn btn-primary" onClick={() => setClaiming(null)}>Done</button>
        ) : (
          <>
            <button type="button" className="btn btn-secondary" onClick={() => setClaiming(null)}>Cancel</button>
            <button type="submit" form="claimForm" className="btn btn-primary">Add device</button>
          </>
        )}
      >
        {error && <div className="text-error text-sm mb-3 p-2 rounded" style={{ background: 'var(--status-error-bg)' }}>{error}</div>}
        {result ? (
          <div style={{ display: 'flex', flexDirection: 'column', gap: 8, fontSize: '0.9rem' }}>
            <p style={{ margin: 0 }}>
              <strong>{result.device.name}</strong> ({result.device.device_id}) now receives this node's data.
              {result.moved_readings > 0 && ` ${result.moved_readings} held readings were moved to it.`}
            </p>
            {result.apiKey && (
              <p style={{ margin: 0, fontSize: '0.8rem', color: 'var(--text-dim)' }}>
                Device key (shown once, only needed if this device ever talks to the server directly):{' '}
                <code style={{ wordBreak: 'break-all' }}>{result.apiKey}</code>
              </p>
            )}
          </div>
        ) : claiming && (
          <form id="claimForm" onSubmit={submitClaim}>
            <div style={{ display: 'flex', gap: 16, marginBottom: 16, fontSize: '0.88rem' }}>
              <label style={{ display: 'flex', gap: 6, alignItems: 'center', cursor: 'pointer' }}>
                <input type="radio" checked={form.mode === 'new'} onChange={() => setForm((f) => ({ ...f, mode: 'new' }))} /> New device
              </label>
              <label style={{ display: 'flex', gap: 6, alignItems: 'center', cursor: 'pointer' }}>
                <input type="radio" checked={form.mode === 'attach'} onChange={() => setForm((f) => ({ ...f, mode: 'attach' }))} /> Same as an existing device
              </label>
            </div>

            {form.mode === 'attach' ? (
              <div className="form-group">
                <label className="form-label">Existing device</label>
                <select className="form-input form-select" value={form.target_device_id} onChange={set('target_device_id')} required>
                  <option value="">Choose…</option>
                  {devices.map((d) => (
                    <option key={d.device_id} value={d.device_id}>{d.name} ({d.device_id}{d.node_id ? `, node ${d.node_id}` : ''})</option>
                  ))}
                </select>
                <p style={{ margin: '6px 0 0', fontSize: '0.78rem', color: 'var(--text-dim)' }}>
                  Use this when the station is already registered but its board sends a different node number
                  (for example a station registered as 1003 arrives over LoRa as 235).
                </p>
              </div>
            ) : (
              <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 12 }}>
                <div className="form-group mb-0">
                  <label className="form-label">Name</label>
                  <input className="form-input" required value={form.name} onChange={set('name')} placeholder="e.g. Banyatar Weather Station" />
                </div>
                <div className="form-group mb-0">
                  <label className="form-label">Device type</label>
                  <select className="form-input form-select" value={form.device_type} onChange={set('device_type')} required>
                    {!schemas.some((s) => s.device_type === form.device_type) && form.device_type && <option value={form.device_type}>{form.device_type}</option>}
                    {schemas.map((s) => <option key={s.device_type} value={s.device_type}>{s.display_name || s.device_type}</option>)}
                  </select>
                </div>
                <div className="form-group mb-0">
                  <label className="form-label">Device ID</label>
                  <input className="form-input" required value={form.device_id} onChange={set('device_id')} />
                </div>
                <div className="form-group mb-0">
                  <label className="form-label">Site name</label>
                  <input className="form-input" value={form.location} onChange={set('location')} placeholder="e.g. Banyatar, Kathmandu" />
                </div>
              </div>
            )}

            <div style={{ marginTop: 16 }}>
              <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: 6 }}>
                <label className="form-label" style={{ margin: 0, display: 'flex', alignItems: 'center', gap: 4 }}><MapPin size={13} /> GPS position</label>
                <button type="button" className="btn btn-secondary" style={{ padding: '3px 8px', fontSize: '0.75rem' }} onClick={useMyLocation} disabled={locating}>
                  <Crosshair size={12} /> {locating ? 'Locating…' : 'Use my location'}
                </button>
              </div>
              <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 12 }}>
                <input className="form-input" type="number" step="any" min="-90" max="90" placeholder="Latitude, e.g. 27.7172" value={form.latitude} onChange={set('latitude')} />
                <input className="form-input" type="number" step="any" min="-180" max="180" placeholder="Longitude, e.g. 85.3240" value={form.longitude} onChange={set('longitude')} />
              </div>
            </div>
          </form>
        )}
      </Modal>
    </section>
  );
}
