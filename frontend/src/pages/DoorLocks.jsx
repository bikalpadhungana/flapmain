import React, { useState, useEffect, useCallback } from 'react';
import { io } from 'socket.io-client';
import { Lock, Unlock, RefreshCw, Wifi, WifiOff, Clock, History } from 'lucide-react';
import { API_BASE_URL, authHeaders, socketOptions } from '../config';

const API = `${API_BASE_URL}/v1/locks`;
const DURATIONS = [3, 5, 10, 30];

const timeAgo = (d) => {
  if (!d) return 'never';
  const s = Math.floor((Date.now() - new Date(d).getTime()) / 1000);
  if (s < 5) return 'just now';
  if (s < 60) return `${s}s ago`;
  if (s < 3600) return `${Math.floor(s / 60)}m ago`;
  if (s < 86400) return `${Math.floor(s / 3600)}h ago`;
  return new Date(d).toLocaleString();
};

const EVENT_TEXT = {
  requested: (e) => `${e.by || 'Dashboard'} asked to ${e.action}${e.message ? ` (${e.message})` : ''}`,
  unlocked: (e) => `Unlocked${e.source ? ` by ${e.source}` : ''}`,
  locked: (e) => `Locked${e.source === 'timer' ? ' automatically' : e.source ? ` by ${e.source}` : ''}`,
  expired: (e) => `Command from ${e.by || 'dashboard'} expired: lock was offline`,
  boot: () => 'Lock restarted (locked)',
};

function StateBadge({ lock }) {
  const open = lock.state === 'unlocked';
  const color = lock.state === 'unknown' ? 'var(--text-muted)' : open ? '#b45309' : 'var(--status-success)';
  const bg = lock.state === 'unknown' ? 'var(--bg-app)' : open ? '#fef3c7' : 'var(--status-success-bg)';
  return (
    <div style={{ display: 'flex', alignItems: 'center', gap: 10, padding: '10px 14px', borderRadius: 10, background: bg, color }}>
      {open ? <Unlock size={26} /> : <Lock size={26} />}
      <div>
        <div style={{ fontWeight: 700, fontSize: '1.1rem' }}>{lock.state === 'unknown' ? 'Unknown' : open ? 'Unlocked' : 'Locked'}</div>
        <div className="text-xs" style={{ opacity: 0.8 }}>{lock.changed_at ? `since ${timeAgo(lock.changed_at)}` : 'no report yet'}</div>
      </div>
    </div>
  );
}

export default function DoorLocks() {
  const [locks, setLocks] = useState([]);
  const [loading, setLoading] = useState(true);
  const [selected, setSelected] = useState(null);
  const [events, setEvents] = useState([]);
  const [duration, setDuration] = useState(5);
  const [busy, setBusy] = useState('');
  const [msg, setMsg] = useState(null);
  const [, setTick] = useState(0);

  const loadLocks = useCallback(async () => {
    try {
      const r = await fetch(API, { headers: authHeaders() }).then((x) => x.json());
      setLocks(r.locks || []);
      setSelected((s) => s || r.locks?.[0]?.device_id || null);
    } finally {
      setLoading(false);
    }
  }, []);

  const loadEvents = useCallback(async (id) => {
    if (!id) return;
    const r = await fetch(`${API}/${encodeURIComponent(id)}/events?limit=50`, { headers: authHeaders() }).then((x) => x.json());
    setEvents(r.events || []);
  }, []);

  useEffect(() => {
    loadLocks();
    const socket = io(API_BASE_URL.replace(/\/api$/, ''), socketOptions());
    const upsert = (lock) => setLocks((list) => list.map((l) => (l.device_id === lock.device_id ? { ...l, ...lock } : l)));
    socket.on('lock_event', (ev) => {
      if (ev.lock) upsert(ev.lock);
      setSelected((sel) => {
        if (sel === ev.device_id) setEvents((list) => [ev, ...list].slice(0, 50));
        return sel;
      });
    });
    socket.on('lock_status', upsert);
    const poll = setInterval(loadLocks, 10000); // refresh online status
    const tick = setInterval(() => setTick((t) => t + 1), 5000); // refresh "x s ago"
    return () => { socket.disconnect(); clearInterval(poll); clearInterval(tick); };
  }, [loadLocks]);

  useEffect(() => { loadEvents(selected); }, [selected, loadEvents]);

  const send = async (lock, action) => {
    setBusy(`${lock.device_id}:${action}`);
    setMsg(null);
    try {
      const res = await fetch(`${API}/${encodeURIComponent(lock.device_id)}/${action}`, {
        method: 'POST',
        headers: authHeaders({ 'Content-Type': 'application/json' }),
        body: JSON.stringify(action === 'unlock' ? { duration_s: duration } : {}),
      });
      const body = await res.json().catch(() => ({}));
      setMsg({ ok: res.ok, text: body.message || (res.ok ? 'Sent' : `Failed (HTTP ${res.status})`) });
      if (body.lock) setLocks((list) => list.map((l) => (l.device_id === lock.device_id ? body.lock : l)));
    } finally {
      setBusy('');
    }
  };

  const current = locks.find((l) => l.device_id === selected);

  return (
    <div className="flex flex-col gap-6 flex-1 h-full relative animate-slide-up">
      <header className="responsive-page-header">
        <div>
          <h1 className="text-main" style={{ fontSize: '1.75rem', fontWeight: 600, letterSpacing: '-0.02em', margin: 0 }}>Door Locks</h1>
          <p className="text-muted text-sm mt-1">Unlock doors remotely and see who opened them. Locks re-lock on their own after the chosen time.</p>
        </div>
        <div className="flex items-center gap-2">
          <label className="text-sm text-muted">Unlock for</label>
          <select className="form-input form-select" style={{ width: 'auto' }} value={duration} onChange={(e) => setDuration(Number(e.target.value))}>
            {DURATIONS.map((d) => <option key={d} value={d}>{d} s</option>)}
          </select>
          <button onClick={loadLocks} className="btn btn-secondary"><RefreshCw size={16} /></button>
        </div>
      </header>

      {msg && <div className="text-sm" style={{ color: msg.ok ? 'var(--status-success)' : 'var(--status-error)' }}>{msg.text}</div>}

      {loading ? <div className="text-muted text-sm">Loading…</div> : locks.length === 0 ? (
        <div className="card card-body text-muted text-sm" style={{ borderStyle: 'dashed' }}>
          No door locks yet. Add one on <b>Hardware &amp; Devices</b> with device type <code>door_lock</code>, activate it,
          then flash <code>hardwarecode/esp8266_door_lock</code> with its device ID and key.
        </div>
      ) : (
        <div className="responsive-grid-cards">
          {locks.map((l) => (
            <div
              key={l.device_id}
              className="premium-card card-body flex flex-col gap-3"
              onClick={() => setSelected(l.device_id)}
              style={{ cursor: 'pointer', border: selected === l.device_id ? '1px solid var(--action-primary)' : undefined }}
            >
              <div className="flex justify-between items-start gap-2">
                <div style={{ minWidth: 0 }}>
                  <h4 className="font-semibold text-main m-0" style={{ fontSize: '1.05rem' }}>{l.name}</h4>
                  <div className="text-xs text-muted">{l.location || l.device_id}</div>
                </div>
                <span className="text-xs flex items-center gap-1" style={{ color: l.online ? 'var(--status-success)' : 'var(--status-error)', whiteSpace: 'nowrap' }}>
                  {l.online ? <Wifi size={13} /> : <WifiOff size={13} />} {l.online ? 'Online' : `Offline · ${timeAgo(l.last_poll)}`}
                </span>
              </div>
              <StateBadge lock={l} />
              {l.pending && (
                <div className="text-xs flex items-center gap-1" style={{ color: 'var(--action-primary)' }}>
                  <Clock size={12} /> Waiting for the lock to {l.pending.action}…
                </div>
              )}
              <div className="flex gap-2">
                <button
                  className="btn btn-primary"
                  style={{ flex: 1 }}
                  disabled={!!busy}
                  onClick={(e) => { e.stopPropagation(); send(l, 'unlock'); }}
                >
                  <Unlock size={15} /> {busy === `${l.device_id}:unlock` ? 'Sending…' : `Unlock ${duration}s`}
                </button>
                <button
                  className="btn btn-secondary"
                  disabled={!!busy || l.state === 'locked'}
                  onClick={(e) => { e.stopPropagation(); send(l, 'lock'); }}
                >
                  <Lock size={15} /> Lock
                </button>
              </div>
            </div>
          ))}
        </div>
      )}

      {current && (
        <div className="card card-body flex flex-col gap-3">
          <h3 className="font-semibold text-main m-0 flex items-center gap-2"><History size={18} /> Activity · {current.name}</h3>
          {events.length === 0 ? <div className="text-muted text-sm">No activity yet.</div> : (
            <div style={{ overflowX: 'auto' }}>
              <table className="responsive-table">
                <thead><tr><th>When</th><th>What</th></tr></thead>
                <tbody>
                  {events.map((e) => (
                    <tr key={e._id}>
                      <td title={new Date(e.timestamp).toLocaleString()} style={{ whiteSpace: 'nowrap' }}>{timeAgo(e.timestamp)}</td>
                      <td className="text-sm">{(EVENT_TEXT[e.event] || (() => e.event))(e)}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          )}
        </div>
      )}
    </div>
  );
}
