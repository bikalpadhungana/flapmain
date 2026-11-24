import React, { useState, useEffect, useMemo, useCallback } from 'react';
import { io } from 'socket.io-client';
import {
  UploadCloud, Cpu, Rocket, Trash2, RefreshCw, Radio, CheckCircle2, XCircle, Clock, Download, Ban, Package, Plus,
} from 'lucide-react';
import Modal from '../components/Modal';
import { API_BASE_URL, authHeaders, socketOptions } from '../config';

// Sketches that include flap_ota.h (value = FLAP_OTA_BOARD in the sketch).
const KNOWN_BOARDS = [
  { id: 'esp_gateway_node', label: 'LoRa gateway (ESP8266)', lora: false },
  { id: 'esp32_aws_node', label: 'ESP32 weather station (LoRa)', lora: true },
  { id: 'esp32_walkie_talkie_node', label: 'ESP32 walkie-talkie (LoRa)', lora: true },
  { id: 'flap_cardreader', label: 'Card reader (ESP8266)', lora: false },
  { id: 'esp_cam', label: 'ESP32-CAM', lora: false },
  { id: 'esp8266_weather_station', label: 'ESP8266 weather station', lora: false },
  { id: 'esp8266_weight_scale', label: 'Weight scale (ESP8266)', lora: false },
  { id: 'esp8266_ultrasonic_sensor', label: 'Ultrasonic sensor (ESP8266)', lora: false },
  { id: 'esp8266_water_tank', label: 'Water tank (ESP8266)', lora: false },
  { id: 'esp8266_flap_switch', label: 'Flap switch (ESP8266)', lora: false },
];
const boardLabel = (id) => KNOWN_BOARDS.find((b) => b.id === id)?.label || id;

const API = `${API_BASE_URL}/v1/firmware`;

const fmtSize = (n) => (n >= 1048576 ? `${(n / 1048576).toFixed(2)} MB` : `${Math.round(n / 1024)} KB`);
const timeAgo = (d) => {
  if (!d) return 'never';
  const s = Math.floor((Date.now() - new Date(d).getTime()) / 1000);
  if (s < 60) return `${s}s ago`;
  if (s < 3600) return `${Math.floor(s / 60)}m ago`;
  if (s < 86400) return `${Math.floor(s / 3600)}h ago`;
  return new Date(d).toLocaleDateString();
};

// "esp_gateway_node-2.2.0.bin" -> { board: "esp_gateway_node", version: "2.2.0" }
// "esp_gateway_node.ino.bin"   -> { board: "esp_gateway_node", version: "" }
const parseFilename = (name) => {
  const n = String(name || '');
  const m = n.match(/^([A-Za-z0-9_.]+?)-(\d[0-9A-Za-z_.+]*)\.bin$/);
  if (m) return { board: m[1], version: m[2] };
  const base = n.replace(/\.ino.*$|\.bin.*$/i, '');
  return { board: KNOWN_BOARDS.find((b) => base === b.id)?.id || '', version: '' };
};

const STATE_STYLE = {
  idle: { label: 'Up to date', color: 'var(--text-muted)', bg: 'var(--bg-app)', Icon: CheckCircle2 },
  pending: { label: 'Waiting for device', color: '#b45309', bg: '#fef3c7', Icon: Clock },
  downloading: { label: 'Updating', color: 'var(--action-primary)', bg: 'var(--accent-light)', Icon: Download },
  success: { label: 'Updated', color: 'var(--status-success)', bg: 'var(--status-success-bg)', Icon: CheckCircle2 },
  failed: { label: 'Failed', color: 'var(--status-error)', bg: 'var(--status-error-bg)', Icon: XCircle },
};

function StatePill({ state }) {
  const st = STATE_STYLE[state] || STATE_STYLE.idle;
  const { Icon } = st;
  return (
    <span style={{
      display: 'inline-flex', alignItems: 'center', gap: 4, fontSize: '0.72rem', fontWeight: 600,
      color: st.color, background: st.bg, padding: '3px 9px', borderRadius: 12, whiteSpace: 'nowrap',
    }}>
      <Icon size={13} /> {st.label}
    </span>
  );
}

export default function Firmware() {
  const [firmware, setFirmware] = useState([]);
  const [builds, setBuilds] = useState({ dir: '', builds: [] });
  const [importing, setImporting] = useState('');
  const [importMsg, setImportMsg] = useState(null);
  const [devices, setDevices] = useState([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState('');

  // upload form
  const [file, setFile] = useState(null);
  const [board, setBoard] = useState('');
  const [version, setVersion] = useState('');
  const [notes, setNotes] = useState('');
  const [progress, setProgress] = useState(null);
  const [uploadMsg, setUploadMsg] = useState(null);

  // deploy dialog
  const [deployFw, setDeployFw] = useState(null);
  const [selected, setSelected] = useState(new Set());
  const [loraWake, setLoraWake] = useState(true);
  const [showAll, setShowAll] = useState(false);
  const [deployResult, setDeployResult] = useState(null);

  const load = useCallback(async () => {
    try {
      const [f, d, b] = await Promise.all([
        fetch(API, { headers: authHeaders() }).then((r) => r.json()),
        fetch(`${API}/devices`, { headers: authHeaders() }).then((r) => r.json()),
        fetch(`${API}/builds`, { headers: authHeaders() }).then((r) => r.json()).catch(() => ({})),
      ]);
      setFirmware(f.firmware || []);
      setBuilds({ dir: b.dir || '', builds: b.builds || [] });
      setDevices(d.devices || []);
      setError('');
    } catch (e) {
      setError('Could not load firmware data. Is the backend running?');
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    load();
    const socket = io(API_BASE_URL.replace(/\/api$/, ''), socketOptions());
    socket.on('ota_status', (dev) => {
      setDevices((list) => list.map((d) => (d.device_id === dev.device_id ? { ...d, ...dev } : d)));
    });
    const t = setInterval(load, 30000); // reported versions change without socket events
    return () => { socket.disconnect(); clearInterval(t); };
  }, [load]);

  const onPickFile = (f) => {
    setFile(f);
    setUploadMsg(null);
    if (f) {
      const parsed = parseFilename(f.name);
      if (parsed.board) setBoard(parsed.board);
      if (parsed.version) setVersion(parsed.version);
    }
  };

  const importBuild = async (build) => {
    setImporting(build.file);
    setImportMsg(null);
    const res = await fetch(`${API}/builds/import`, {
      method: 'POST',
      headers: authHeaders({ 'Content-Type': 'application/json' }),
      body: JSON.stringify({ file: build.file }),
    });
    const body = await res.json().catch(() => ({}));
    setImporting('');
    setImportMsg(res.status === 201
      ? { ok: true, text: `Added ${build.board} ${build.version} to the library. Click Deploy to send it to devices.` }
      : { ok: false, text: body.message || `Import failed (HTTP ${res.status})` });
    load();
  };

  const upload = (e) => {
    e.preventDefault();
    if (!file || !board || !version) return;
    setUploadMsg(null);
    setProgress(0);
    const q = new URLSearchParams({ board, version, notes });
    const xhr = new XMLHttpRequest();
    xhr.open('POST', `${API}?${q.toString()}`);
    Object.entries(authHeaders({ 'Content-Type': 'application/octet-stream', 'X-Filename': file.name }))
      .forEach(([k, v]) => xhr.setRequestHeader(k, v));
    xhr.upload.onprogress = (ev) => ev.lengthComputable && setProgress(Math.round((ev.loaded / ev.total) * 100));
    xhr.onload = () => {
      setProgress(null);
      let body = {};
      try { body = JSON.parse(xhr.responseText); } catch (_) { /* not JSON */ }
      if (xhr.status === 201) {
        setUploadMsg({ ok: true, text: `Uploaded ${board} ${version} (${fmtSize(body.firmware.size)}, ${body.firmware.chip}).` });
        setFile(null); setVersion(''); setNotes('');
        e.target.reset();
        load();
      } else {
        setUploadMsg({ ok: false, text: body.message || `Upload failed (HTTP ${xhr.status})` });
      }
    };
    xhr.onerror = () => { setProgress(null); setUploadMsg({ ok: false, text: 'Upload failed: network error' }); };
    xhr.send(file);
  };

  const remove = async (fw) => {
    if (!window.confirm(`Delete ${fw.board} ${fw.version}? Devices still waiting for it will be cancelled.`)) return;
    await fetch(`${API}/${fw._id}`, { method: 'DELETE', headers: authHeaders() });
    load();
  };

  const openDeploy = (fw) => {
    setDeployFw(fw);
    setDeployResult(null);
    setShowAll(false);
    setSelected(new Set(devices.filter((d) => d.firmware?.board === fw.board && d.firmware?.version !== fw.version).map((d) => d.device_id)));
  };

  // Devices shown in the deploy dialog: those already reporting this board, plus (optionally) all the rest
  const deployCandidates = useMemo(() => {
    if (!deployFw) return [];
    return devices
      .filter((d) => showAll || d.firmware?.board === deployFw.board)
      .filter((d) => !d.firmware?.board || d.firmware.board === deployFw.board);
  }, [devices, deployFw, showAll]);

  const toggle = (id) => setSelected((s) => {
    const n = new Set(s);
    if (n.has(id)) n.delete(id); else n.add(id);
    return n;
  });

  const deploy = async () => {
    const res = await fetch(`${API}/${deployFw._id}/deploy`, {
      method: 'POST',
      headers: authHeaders({ 'Content-Type': 'application/json' }),
      body: JSON.stringify({ device_ids: [...selected], lora_wake: loraWake }),
    }).then((r) => r.json());
    setDeployResult(res.results || [{ ok: false, message: res.message }]);
    load();
  };

  const cancel = async (deviceId) => {
    await fetch(`${API}/cancel`, {
      method: 'POST',
      headers: authHeaders({ 'Content-Type': 'application/json' }),
      body: JSON.stringify({ device_ids: [deviceId] }),
    });
    load();
  };

  const selectedHaveRadio = [...selected].some((id) => devices.find((d) => d.device_id === id)?.radio_node);
  const reporting = devices.filter((d) => d.firmware?.board);
  const silent = devices.filter((d) => !d.firmware?.board);

  return (
    <div className="flex flex-col gap-6 flex-1 h-full relative animate-slide-up">
      <header className="responsive-page-header">
        <div>
          <h1 className="text-main" style={{ fontSize: '1.75rem', fontWeight: 600, letterSpacing: '-0.02em', margin: 0 }}>Firmware Updates</h1>
          <p className="text-muted text-sm mt-1">
            Upload a compiled .bin and send it to devices over the air. Wi-Fi boards check in every 10 minutes;
            LoRa boards can be woken over the radio and then download over Wi-Fi.
          </p>
        </div>
        <button onClick={load} className="btn btn-secondary"><RefreshCw size={16} /> Refresh</button>
      </header>

      {error && <div className="card card-body" style={{ color: 'var(--status-error)' }}>{error}</div>}

      {/* Upload */}
      <form onSubmit={upload} className="card card-body flex flex-col gap-4">
        <h3 className="font-semibold text-main m-0 flex items-center gap-2"><UploadCloud size={18} /> Upload firmware</h3>
        <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(200px, 1fr))', gap: 12 }}>
          <div className="form-group mb-0">
            <label className="form-label">Firmware file (.bin)</label>
            <input type="file" accept=".bin,.gz" className="form-input" onChange={(e) => onPickFile(e.target.files[0] || null)} required />
          </div>
          <div className="form-group mb-0">
            <label className="form-label">Board (FLAP_OTA_BOARD)</label>
            <input list="ota-boards" className="form-input" value={board} onChange={(e) => setBoard(e.target.value.trim())} placeholder="esp_gateway_node" required />
            <datalist id="ota-boards">
              {KNOWN_BOARDS.map((b) => <option key={b.id} value={b.id}>{b.label}</option>)}
            </datalist>
          </div>
          <div className="form-group mb-0">
            <label className="form-label">Version (FLAP_FW_VERSION)</label>
            <input className="form-input" value={version} onChange={(e) => setVersion(e.target.value.trim())} placeholder="2.2.1" required />
          </div>
          <div className="form-group mb-0">
            <label className="form-label">Notes</label>
            <input className="form-input" value={notes} onChange={(e) => setNotes(e.target.value)} placeholder="What changed" />
          </div>
        </div>
        <p className="text-muted text-xs m-0">
          Arduino IDE: <b>Sketch → Export Compiled Binary</b>, then upload <code>&lt;sketch&gt;.ino.bin</code>. A file named <code>&lt;board&gt;-&lt;version&gt;.bin</code> fills in both fields.
          The version must match <code>FLAP_FW_VERSION</code> in that build, or the device will download it again and again.
        </p>
        <div className="flex items-center gap-3">
          <button type="submit" className="btn btn-primary" disabled={progress !== null}>
            <UploadCloud size={16} /> {progress !== null ? `Uploading ${progress}%` : 'Upload'}
          </button>
          {uploadMsg && (
            <span className="text-sm" style={{ color: uploadMsg.ok ? 'var(--status-success)' : 'var(--status-error)' }}>{uploadMsg.text}</span>
          )}
        </div>
      </form>

      {/* Ready-made builds on the server */}
      <div className="card card-body flex flex-col gap-3">
        <h3 className="font-semibold text-main m-0 flex items-center gap-2"><Package size={18} /> Ready-made builds</h3>
        <p className="text-muted text-xs m-0">
          Files named <code>&lt;board&gt;-&lt;version&gt;.bin</code> in the server's build folder{builds.dir ? <> (<code>{builds.dir}</code>)</> : null}.
          Add one to the library, then deploy it.
        </p>
        {builds.builds.length === 0 ? (
          <div className="text-muted text-sm">No builds found on the server.</div>
        ) : (
          <div style={{ overflowX: 'auto' }}>
            <table className="responsive-table">
              <thead><tr><th>Board</th><th>Version</th><th>Size</th><th>Built</th><th /></tr></thead>
              <tbody>
                {builds.builds.map((b) => (
                  <tr key={b.file}>
                    <td><b>{boardLabel(b.board)}</b><div className="text-xs text-muted">{b.file}</div></td>
                    <td><code>{b.version}</code></td>
                    <td>{fmtSize(b.size)}</td>
                    <td title={new Date(b.modified).toLocaleString()}>{timeAgo(b.modified)}</td>
                    <td style={{ textAlign: 'right' }}>
                      {b.in_library ? (
                        <span className="text-xs" style={{ color: 'var(--status-success)' }}><CheckCircle2 size={13} style={{ verticalAlign: -2 }} /> In library</span>
                      ) : (
                        <button className="btn btn-primary btn-sm" disabled={importing === b.file} onClick={() => importBuild(b)}>
                          <Plus size={14} /> {importing === b.file ? 'Adding…' : 'Add to library'}
                        </button>
                      )}
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
        {importMsg && (
          <span className="text-sm" style={{ color: importMsg.ok ? 'var(--status-success)' : 'var(--status-error)' }}>{importMsg.text}</span>
        )}
      </div>

      {/* Firmware library */}
      <div className="card card-body flex flex-col gap-3">
        <h3 className="font-semibold text-main m-0 flex items-center gap-2"><Cpu size={18} /> Firmware library</h3>
        {loading ? <div className="text-muted text-sm">Loading…</div> : firmware.length === 0 ? (
          <div className="text-muted text-sm">No firmware uploaded yet.</div>
        ) : (
          <div style={{ overflowX: 'auto' }}>
            <table className="responsive-table">
              <thead><tr><th>Board</th><th>Version</th><th>Size</th><th>Uploaded</th><th>Notes</th><th /></tr></thead>
              <tbody>
                {firmware.map((fw) => (
                  <tr key={fw._id}>
                    <td><b>{boardLabel(fw.board)}</b><div className="text-xs text-muted">{fw.board} · {fw.chip}</div></td>
                    <td><code>{fw.version}</code></td>
                    <td>{fmtSize(fw.size)}</td>
                    <td title={new Date(fw.createdAt).toLocaleString()}>{timeAgo(fw.createdAt)}</td>
                    <td className="text-sm text-muted">{fw.notes || '—'}</td>
                    <td style={{ whiteSpace: 'nowrap', textAlign: 'right' }}>
                      <button className="btn btn-primary btn-sm" onClick={() => openDeploy(fw)}><Rocket size={14} /> Deploy</button>{' '}
                      <button className="btn btn-icon text-muted" title="Delete" onClick={() => remove(fw)}><Trash2 size={15} /></button>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
      </div>

      {/* Device status */}
      <div className="card card-body flex flex-col gap-3">
        <h3 className="font-semibold text-main m-0 flex items-center gap-2"><Radio size={18} /> Devices</h3>
        {reporting.length === 0 && !loading && (
          <div className="text-muted text-sm">
            No device has checked in yet. Flash each board once over USB with the OTA-enabled firmware; after that it shows up here.
          </div>
        )}
        {reporting.length > 0 && (
          <div style={{ overflowX: 'auto' }}>
            <table className="responsive-table">
              <thead><tr><th>Device</th><th>Board</th><th>Running</th><th>Update</th><th>Last check-in</th><th /></tr></thead>
              <tbody>
                {reporting.map((d) => (
                  <tr key={d.device_id}>
                    <td><b>{d.name}</b><div className="text-xs text-muted">{d.device_id}{d.radio_node ? ` · LoRa #${d.radio_node}` : ''}</div></td>
                    <td className="text-sm">{boardLabel(d.firmware.board)}</td>
                    <td><code>{d.firmware.version || '?'}</code></td>
                    <td>
                      <StatePill state={d.ota?.state} />
                      {d.ota?.target_version && ['pending', 'downloading'].includes(d.ota.state) && (
                        <span className="text-xs text-muted"> → {d.ota.target_version}</span>
                      )}
                      {d.ota?.message && <div className="text-xs text-muted" style={{ maxWidth: 320 }}>{d.ota.message}</div>}
                    </td>
                    <td className="text-sm">{timeAgo(d.firmware.reported_at)}</td>
                    <td style={{ textAlign: 'right' }}>
                      {['pending', 'downloading'].includes(d.ota?.state) && (
                        <button className="btn btn-secondary btn-sm" onClick={() => cancel(d.device_id)}><Ban size={14} /> Cancel</button>
                      )}
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
        {silent.length > 0 && (
          <details className="text-sm text-muted">
            <summary>{silent.length} device(s) have not checked in (older firmware, Arduino Nano, or offline)</summary>
            <div className="mt-2">{silent.map((d) => d.name).join(', ')}</div>
          </details>
        )}
      </div>

      <Modal
        open={!!deployFw}
        onClose={() => setDeployFw(null)}
        title={deployFw ? `Deploy ${deployFw.board} ${deployFw.version}` : ''}
        maxWidth="640px"
        actions={deployResult ? (
          <button className="btn btn-primary" onClick={() => setDeployFw(null)}>Done</button>
        ) : (
          <>
            <button className="btn btn-secondary" onClick={() => setDeployFw(null)}>Cancel</button>
            <button className="btn btn-primary" disabled={selected.size === 0} onClick={deploy}>
              <Rocket size={14} /> Deploy to {selected.size} device(s)
            </button>
          </>
        )}
      >
        {deployResult ? (
          <div className="flex flex-col gap-2">
            {deployResult.map((r, i) => (
              <div key={i} className="text-sm" style={{ color: r.ok ? 'var(--status-success)' : 'var(--status-error)' }}>
                {r.ok ? '✓' : '✗'} {r.device_id || ''} {r.ok ? (r.lora_wake ? '— queued, wake-up sent over LoRa' : '— queued, updates at its next check-in') : `— ${r.message}`}
              </div>
            ))}
          </div>
        ) : (
          <div className="flex flex-col gap-3">
            <label className="text-sm flex items-center gap-2">
              <input type="checkbox" checked={showAll} onChange={(e) => setShowAll(e.target.checked)} />
              Also show devices that have not reported a board yet
            </label>
            <div style={{ maxHeight: 320, overflowY: 'auto', border: '1px solid var(--border-subtle)', borderRadius: 8 }}>
              {deployCandidates.length === 0 ? (
                <div className="text-muted text-sm" style={{ padding: 12 }}>
                  No device reports board “{deployFw?.board}”. Flash one over USB first, or tick the box above.
                </div>
              ) : deployCandidates.map((d) => (
                <label key={d.device_id} className="flex items-center gap-3" style={{ padding: '8px 12px', borderBottom: '1px solid var(--border-subtle)', cursor: 'pointer' }}>
                  <input type="checkbox" checked={selected.has(d.device_id)} onChange={() => toggle(d.device_id)} />
                  <span style={{ flex: 1 }}>
                    <b className="text-sm">{d.name}</b>
                    <span className="text-xs text-muted"> · {d.device_id}{d.radio_node ? ` · LoRa #${d.radio_node}` : ''}</span>
                  </span>
                  <code className="text-xs">{d.firmware?.version || 'unknown'}</code>
                </label>
              ))}
            </div>
            <label className="text-sm flex items-center gap-2" style={{ opacity: selectedHaveRadio ? 1 : 0.5 }}>
              <input type="checkbox" checked={loraWake} disabled={!selectedHaveRadio} onChange={(e) => setLoraWake(e.target.checked)} />
              Wake LoRa radios now (sends “OTA:CHECK” through the gateway; the radio then downloads over Wi-Fi)
            </label>
          </div>
        )}
      </Modal>
    </div>
  );
}
