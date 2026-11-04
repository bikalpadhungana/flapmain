import React, { useState, useEffect, useMemo } from 'react';
import { io } from 'socket.io-client';
import {
  CreditCard, Wifi, WifiOff, RefreshCw, Radio, User, CheckCircle2, XCircle, Clock,
} from 'lucide-react';
import { API_BASE_URL, authHeaders, socketOptions } from '../config';

// ─── Helpers ──────────────────────────────────────────────────────────────────

// Card readers register as device_type "nfc_reader" (see hardwarecode/flap_cardreader).
const isCardReader = (d) =>
  /nfc|rfid|card/i.test(d.device_type || '') || /^flap-card/i.test(d.device_id || '');

// Cardholder object as returned by flap.esainnovation.com (same precedence as the backend).
const getHolder = (tap) => {
  if (tap?.holder && typeof tap.holder === 'object') return tap.holder; // Flap Card API lookup
  const r = tap?.targetResponse;
  if (!r || typeof r !== 'object') return null;
  const h = r.holder || r.data || r.user;
  return h && typeof h === 'object' ? h : null;
};

const holderName = (h) => (h && (h.name || h.fullName || h.username || h.primaryFlapid || h.flapid)) || null;
const holderFlapId = (h, tap) => (h && (h.primaryFlapid || h.flapid)) || tap?.flapid || null;

const holderPhoto = (h) => {
  const url = h && (h.photo || h.avatar || h.profilePicture || h.image);
  return typeof url === 'string' && /^https?:\/\//i.test(url) ? url : null;
};

// Printable cardholder fields: primitives only, secret-like keys dropped.
const holderFields = (h) => {
  if (!h) return [];
  return Object.entries(h)
    .filter(([k, v]) => !/key|token|password|secret|hash|^_|^__v$/i.test(k) && v !== null && v !== undefined && typeof v !== 'object')
    .slice(0, 20);
};

const LOOKUP_LABELS = {
  ok: { ok: true, label: 'Recognised' },
  lost: { ok: false, label: 'Reported lost' },
  defective: { ok: false, label: 'Defective card' },
  unknown: { ok: false, label: 'Unknown card' },
};

const tapResult = (tap) => {
  if (LOOKUP_LABELS[tap?.lookupStatus]) {
    const res = LOOKUP_LABELS[tap.lookupStatus];
    return tap.lookupStatus === 'unknown' && /not linked/i.test(tap.lookupMessage || '') ? { ok: false, label: 'Not activated' } : res;
  }
  if (tap?.lookupStatus === 'unverified' && !getHolder(tap)) return { ok: false, label: 'Could not verify' };
  const r = tap?.targetResponse;
  if (!r) return { ok: false, label: tap?.forwardedMain === false ? 'Queued offline' : 'No response' };
  if (r.error || r.status === 'error' || r.status === 'fail') return { ok: false, label: r.message || r.error || 'Rejected' };
  if (!getHolder(tap)) return { ok: false, label: 'Unknown card' };
  return { ok: true, label: 'Recognised' };
};

const tapTime = (tap) => new Date(tap.timestamp || tap.createdAt);

const timeAgo = (date) => {
  if (!date || Number.isNaN(date.getTime())) return 'never';
  const s = Math.floor((Date.now() - date.getTime()) / 1000);
  if (s < 60) return `${s}s ago`;
  if (s < 3600) return `${Math.floor(s / 60)}m ago`;
  if (s < 86400) return `${Math.floor(s / 3600)}h ago`;
  return date.toLocaleDateString();
};

// ─── Small components ─────────────────────────────────────────────────────────

function ResultPill({ tap }) {
  const { ok, label } = tapResult(tap);
  return (
    <span style={{
      display: 'inline-flex', alignItems: 'center', gap: 4, fontSize: '0.72rem', fontWeight: 600,
      color: ok ? 'var(--status-success)' : 'var(--status-error)',
      background: ok ? 'var(--status-success-bg)' : 'var(--status-error-bg)',
      padding: '3px 9px', borderRadius: 12, whiteSpace: 'nowrap',
    }}>
      {ok ? <CheckCircle2 size={13} /> : <XCircle size={13} />} {String(label).slice(0, 40)}
    </span>
  );
}

function Avatar({ holder, size = 56 }) {
  const photo = holderPhoto(holder);
  const name = holderName(holder);
  const initials = name ? String(name).split(/\s+/).map((p) => p[0]).join('').slice(0, 2).toUpperCase() : null;
  const base = {
    width: size, height: size, borderRadius: '50%', flexShrink: 0,
    background: 'var(--bg-app)', border: '1px solid var(--border-subtle)',
    display: 'flex', alignItems: 'center', justifyContent: 'center', overflow: 'hidden',
  };
  if (photo) return <img src={photo} alt={name || 'Cardholder'} referrerPolicy="no-referrer" style={{ ...base, objectFit: 'cover' }} />;
  return (
    <div style={base}>
      {initials
        ? <span style={{ fontWeight: 700, fontSize: size * 0.34, color: 'var(--text-dim)' }}>{initials}</span>
        : <User size={size * 0.45} color="var(--text-muted)" />}
    </div>
  );
}

function ReaderCard({ reader, lastTap, tapsToday, active, onClick }) {
  const online = reader.status === 'online';
  return (
    <button
      onClick={onClick}
      className="card"
      style={{
        textAlign: 'left', cursor: 'pointer', padding: 14, display: 'flex', flexDirection: 'column', gap: 8,
        border: active ? '1px solid var(--action-primary)' : '1px solid var(--border-subtle)',
        background: active ? 'var(--accent-light)' : undefined, font: 'inherit', color: 'inherit',
      }}
    >
      <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', gap: 8 }}>
        <div style={{ display: 'flex', alignItems: 'center', gap: 8, minWidth: 0 }}>
          <CreditCard size={16} color="var(--action-primary)" style={{ flexShrink: 0 }} />
          <span style={{ fontWeight: 700, fontSize: '0.9rem', whiteSpace: 'nowrap', overflow: 'hidden', textOverflow: 'ellipsis' }}>
            {reader.name || reader.device_id}
          </span>
        </div>
        <span style={{
          display: 'inline-flex', alignItems: 'center', gap: 4, fontSize: '0.62rem', fontWeight: 700,
          padding: '2px 7px', borderRadius: 99, letterSpacing: '0.04em',
          background: online ? 'var(--status-success-bg)' : '#f1f5f9',
          color: online ? 'var(--status-success)' : 'var(--text-muted)',
        }}>
          {online ? <Wifi size={9} /> : <WifiOff size={9} />} {online ? 'ONLINE' : 'OFFLINE'}
        </span>
      </div>
      <div style={{ fontFamily: 'var(--font-mono)', fontSize: '0.7rem', color: 'var(--text-muted)' }}>{reader.device_id}</div>
      <div style={{ display: 'flex', justifyContent: 'space-between', fontSize: '0.75rem', color: 'var(--text-dim)' }}>
        <span><Clock size={11} style={{ verticalAlign: -1 }} /> Last tap: {lastTap ? timeAgo(tapTime(lastTap)) : 'none'}</span>
        <span>{tapsToday} today</span>
      </div>
    </button>
  );
}

// ═══════════════════════════════════════════════════════════════════════════════
// Card Reader page
// ═══════════════════════════════════════════════════════════════════════════════
const CardReader = () => {
  const [devices, setDevices] = useState([]);
  const [taps, setTaps] = useState([]);
  const [loading, setLoading] = useState(true);
  const [live, setLive] = useState(true);
  const [readerFilter, setReaderFilter] = useState('all');
  const [selected, setSelected] = useState(null);
  const [flashId, setFlashId] = useState(null);

  const fetchAll = async () => {
    try {
      const [devRes, tapRes] = await Promise.all([
        fetch(`${API_BASE_URL}/v1/devices`, { headers: authHeaders() }),
        fetch(`${API_BASE_URL}/device/tap/logs`, { headers: authHeaders() }),
      ]);
      const devData = await devRes.json().catch(() => []);
      const tapData = await tapRes.json().catch(() => ({}));
      setDevices(Array.isArray(devData) ? devData : []);
      setTaps(Array.isArray(tapData?.logs) ? tapData.logs : []);
    } catch (err) {
      console.error('Card reader fetch failed:', err);
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => { fetchAll(); }, []);

  useEffect(() => {
    if (!live) return undefined;
    const socket = io(API_BASE_URL.replace(/\/api$/, ''), socketOptions());
    socket.on('new_tap', (tap) => {
      setTaps((prev) => {
        if (tap._id && prev.some((t) => t._id === tap._id)) return prev;
        return [tap, ...prev].slice(0, 200);
      });
      setFlashId(tap._id || tap.timestamp);
      // Reader just tapped, so it is online; reflect that without a refetch.
      setDevices((prev) => prev.map((d) => (d.device_id === tap.device_id ? { ...d, status: 'online', last_seen: tap.timestamp } : d)));
    });
    return () => socket.disconnect();
  }, [live]);

  useEffect(() => {
    if (!flashId) return undefined;
    const t = setTimeout(() => setFlashId(null), 2500);
    return () => clearTimeout(t);
  }, [flashId]);

  // Readers = registered card-reader devices plus any device that has sent a tap.
  const readers = useMemo(() => {
    const map = new Map(devices.filter(isCardReader).map((d) => [d.device_id, d]));
    for (const t of taps) {
      if (t.device_id && !map.has(t.device_id)) {
        const dev = devices.find((d) => d.device_id === t.device_id);
        map.set(t.device_id, dev || { device_id: t.device_id, name: t.device_id, status: 'unknown' });
      }
    }
    return [...map.values()];
  }, [devices, taps]);

  const visibleTaps = useMemo(
    () => (readerFilter === 'all' ? taps : taps.filter((t) => t.device_id === readerFilter)),
    [taps, readerFilter],
  );

  const latest = visibleTaps[0] || null;
  const shown = selected || latest;
  const shownHolder = getHolder(shown);

  const startOfToday = new Date(); startOfToday.setHours(0, 0, 0, 0);
  const readerName = (id) => readers.find((r) => r.device_id === id)?.name || id || 'N/A';

  return (
    <div style={{ maxWidth: 1200, margin: '0 auto', display: 'flex', flexDirection: 'column', gap: 'var(--space-6)' }}>
      {/* Header */}
      <div className="responsive-page-header">
        <div>
          <h1 style={{ fontSize: '1.75rem', fontWeight: 700, color: 'var(--text-main)', margin: '0 0 var(--space-2) 0', display: 'flex', alignItems: 'center', gap: 'var(--space-3)' }}>
            <CreditCard size={28} className="text-primary" style={{ flexShrink: 0 }} />
            <span>Card Readers</span>
          </h1>
          <p style={{ color: 'var(--text-dim)', margin: 0, fontSize: '0.95rem' }}>
            NFC card taps and cardholder lookups from flap.esainnovation.com
          </p>
        </div>
        <button onClick={() => setLive(!live)} className={`btn ${live ? 'btn-secondary' : 'btn-primary'}`}>
          {live ? <><RefreshCw size={16} className="cr-spin" /> Live</> : <><Radio size={16} /> Paused</>}
        </button>
      </div>

      {/* Readers */}
      <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fill, minmax(240px, 1fr))', gap: 12 }}>
        {loading ? (
          <div style={{ color: 'var(--text-muted)' }}>Loading readers...</div>
        ) : readers.length === 0 ? (
          <div className="card" style={{ padding: 16, color: 'var(--text-muted)' }}>
            No card readers yet. Register a device of type <code>nfc_reader</code> or tap a card on a reader.
          </div>
        ) : (
          readers.map((r) => {
            const rTaps = taps.filter((t) => t.device_id === r.device_id);
            return (
              <ReaderCard
                key={r.device_id}
                reader={r}
                lastTap={rTaps[0]}
                tapsToday={rTaps.filter((t) => tapTime(t) >= startOfToday).length}
                active={readerFilter === r.device_id}
                onClick={() => { setReaderFilter(readerFilter === r.device_id ? 'all' : r.device_id); setSelected(null); }}
              />
            );
          })
        )}
      </div>

      <div className="responsive-grid-split">
        {/* Tap list */}
        <div style={{ display: 'flex', flexDirection: 'column', gap: 'var(--space-4)', minWidth: 0 }}>
          <div className="flex justify-between items-center" style={{ gap: 8, flexWrap: 'wrap' }}>
            <h2 style={{ fontSize: '1.25rem', fontWeight: 600, margin: 0 }}>Recent Taps</h2>
            <select
              value={readerFilter}
              onChange={(e) => { setReaderFilter(e.target.value); setSelected(null); }}
              className="input"
              style={{ maxWidth: 220, padding: '6px 10px' }}
            >
              <option value="all">All readers ({taps.length})</option>
              {readers.map((r) => <option key={r.device_id} value={r.device_id}>{r.name || r.device_id}</option>)}
            </select>
          </div>

          <div className="responsive-table-wrapper">
            {loading ? (
              <div style={{ padding: 'var(--space-8)', textAlign: 'center', color: 'var(--text-muted)' }}>Loading taps...</div>
            ) : visibleTaps.length === 0 ? (
              <div style={{ padding: 'var(--space-8)', textAlign: 'center', color: 'var(--text-muted)' }}>No taps yet. Tap a card on a reader.</div>
            ) : (
              <table className="responsive-table">
                <thead>
                  <tr style={{ background: 'var(--bg-app)', borderBottom: '1px solid var(--border-subtle)' }}>
                    {['Time', 'Cardholder', 'Card UID', 'Reader', 'Result'].map((h) => (
                      <th key={h} style={{ padding: 'var(--space-3) var(--space-4)', fontSize: '0.75rem', textTransform: 'uppercase', color: 'var(--text-muted)' }}>{h}</th>
                    ))}
                  </tr>
                </thead>
                <tbody>
                  {visibleTaps.map((tap, i) => {
                    const h = getHolder(tap);
                    const key = tap._id || `${tap.timestamp}-${i}`;
                    const isSel = shown && (shown._id ? shown._id === tap._id : shown === tap);
                    const isNew = flashId && (tap._id || tap.timestamp) === flashId;
                    return (
                      <tr
                        key={key}
                        onClick={() => setSelected(tap)}
                        className={isNew ? 'cr-flash' : ''}
                        style={{ borderBottom: '1px solid var(--border-subtle)', cursor: 'pointer', background: isSel ? 'var(--accent-light)' : 'transparent' }}
                      >
                        <td data-label="Time" style={{ padding: 'var(--space-4)', fontSize: '0.85rem', color: 'var(--text-dim)', whiteSpace: 'nowrap' }}>
                          {tapTime(tap).toLocaleTimeString()}
                        </td>
                        <td data-label="Cardholder" style={{ padding: 'var(--space-4)' }}>
                          <div style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
                            <Avatar holder={h} size={28} />
                            <div style={{ minWidth: 0 }}>
                              <div style={{ fontWeight: 600, fontSize: '0.88rem' }}>{holderName(h) || 'Unknown card'}</div>
                              {holderFlapId(h, tap) && <div style={{ fontSize: '0.7rem', color: 'var(--text-muted)', fontFamily: 'var(--font-mono)' }}>{holderFlapId(h, tap)}</div>}
                            </div>
                          </div>
                        </td>
                        <td data-label="Card UID" style={{ padding: 'var(--space-4)', fontFamily: 'var(--font-mono)', fontSize: '0.85rem' }}>{tap.uid}</td>
                        <td data-label="Reader" style={{ padding: 'var(--space-4)', fontSize: '0.85rem', color: 'var(--text-dim)' }}>{readerName(tap.device_id)}</td>
                        <td data-label="Result" style={{ padding: 'var(--space-4)' }}><ResultPill tap={tap} /></td>
                      </tr>
                    );
                  })}
                </tbody>
              </table>
            )}
          </div>
        </div>

        {/* Cardholder panel */}
        <div style={{ flex: '1 1 340px', display: 'flex', flexDirection: 'column', gap: 'var(--space-4)' }}>
          <h2 style={{ fontSize: '1.25rem', fontWeight: 600, margin: 0 }}>{selected ? 'Selected Tap' : 'Latest Tap'}</h2>
          <div className={`card ${shown && !selected && flashId ? 'cr-flash' : ''}`} style={{ padding: 'var(--space-5)', display: 'flex', flexDirection: 'column', gap: 'var(--space-4)', minHeight: 320 }}>
            {!shown ? (
              <div style={{ margin: 'auto', textAlign: 'center', color: 'var(--text-muted)' }}>
                <CreditCard size={32} style={{ opacity: 0.5, marginBottom: 8 }} />
                <p style={{ margin: 0 }}>Waiting for a card tap...</p>
              </div>
            ) : (
              <>
                <div style={{ display: 'flex', alignItems: 'center', gap: 14 }}>
                  <Avatar holder={shownHolder} size={64} />
                  <div style={{ minWidth: 0 }}>
                    <div style={{ fontSize: '1.2rem', fontWeight: 700 }}>{holderName(shownHolder) || 'Unknown card'}</div>
                    {holderFlapId(shownHolder, shown) && (
                      <div style={{ fontFamily: 'var(--font-mono)', fontSize: '0.8rem', color: 'var(--text-dim)' }}>{holderFlapId(shownHolder, shown)}</div>
                    )}
                    <div style={{ marginTop: 6 }}><ResultPill tap={shown} /></div>
                  </div>
                </div>

                <dl style={{ margin: 0, display: 'grid', gridTemplateColumns: 'auto 1fr', gap: '6px 14px', fontSize: '0.85rem' }}>
                  <dt style={{ color: 'var(--text-muted)' }}>Card UID</dt><dd style={{ margin: 0, fontFamily: 'var(--font-mono)' }}>{shown.uid}</dd>
                  <dt style={{ color: 'var(--text-muted)' }}>Reader</dt><dd style={{ margin: 0 }}>{readerName(shown.device_id)}</dd>
                  <dt style={{ color: 'var(--text-muted)' }}>Time</dt><dd style={{ margin: 0 }}>{tapTime(shown).toLocaleString()}</dd>
                  {shown.tag_type && <><dt style={{ color: 'var(--text-muted)' }}>Tag type</dt><dd style={{ margin: 0 }}>{shown.tag_type}</dd></>}
                </dl>

                {shownHolder && (
                  <div>
                    <h4 style={{ fontSize: '0.75rem', textTransform: 'uppercase', letterSpacing: '0.05em', color: 'var(--text-muted)', margin: '0 0 8px 0' }}>
                      Cardholder details
                    </h4>
                    <dl style={{ margin: 0, display: 'grid', gridTemplateColumns: 'auto 1fr', gap: '6px 14px', fontSize: '0.85rem' }}>
                      {holderFields(shownHolder).map(([k, v]) => (
                        <React.Fragment key={k}>
                          <dt style={{ color: 'var(--text-muted)' }}>{k}</dt>
                          <dd style={{ margin: 0, wordBreak: 'break-word' }}>{String(v)}</dd>
                        </React.Fragment>
                      ))}
                    </dl>
                  </div>
                )}
              </>
            )}
          </div>
        </div>
      </div>

      <style>{`
        @keyframes cr-spin { from { transform: rotate(0deg); } to { transform: rotate(360deg); } }
        .cr-spin { animation: cr-spin 2s linear infinite; }
        @keyframes cr-flash { from { box-shadow: inset 0 0 0 9999px rgba(16,185,129,0.18); } to { box-shadow: inset 0 0 0 9999px rgba(16,185,129,0); } }
        .cr-flash { animation: cr-flash 2.5s ease-out; }
      `}</style>
    </div>
  );
};

export default CardReader;
