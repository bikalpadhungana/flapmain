import React, { useState, useEffect } from 'react';
import { Server, Activity, CheckCircle2, XCircle, ArrowRight, Radio, RefreshCw } from 'lucide-react';
import { API_BASE_URL } from '../config';

import { io } from 'socket.io-client';

const SystemMonitor = () => {
  const [logs, setLogs] = useState([]);
  const [loading, setLoading] = useState(true);
  const [isPolling, setIsPolling] = useState(true); // Renamed to "Live Stream" in UI
  const [selectedLog, setSelectedLog] = useState(null);

  const fetchLogs = async () => {
    try {
      const response = await fetch(`${API_BASE_URL}/device/tap/logs`);
      const data = await response.json();
      if (data && data.logs) {
        setLogs(data.logs);
      }
    } catch (error) {
      console.error('Error fetching tap logs:', error);
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => {
    // Fetch initial state once
    fetchLogs();

    let socket;
    if (isPolling) {
      // Connect to the Socket.io server without the /api path
      socket = io(API_BASE_URL.replace(/\/api$/, ''));
      
      socket.on('connect', () => {
        console.log('Connected to real-time telemetry stream');
      });

      socket.on('new_tap', (newTap) => {
        // Prepend the new tap instantly to achieve Zero-Latency UI
        setLogs(prevLogs => {
          // Prevent duplicates if already in list
          if (prevLogs.some(log => log._id === newTap._id)) return prevLogs;
          return [newTap, ...prevLogs].slice(0, 100); // Keep max 100 items
        });
      });
    }

    return () => {
      if (socket) socket.disconnect();
    };
  }, [isPolling]);

  return (
    <div style={{ maxWidth: '1200px', margin: '0 auto', display: 'flex', flexDirection: 'column', gap: 'var(--space-6)' }}>
      {/* Header section */}
      <div className="flex justify-between items-end">
        <div>
          <h1 style={{ fontSize: '1.75rem', fontWeight: '700', color: 'var(--text-main)', margin: '0 0 var(--space-2) 0', display: 'flex', alignItems: 'center', gap: 'var(--space-3)' }}>
            <Server size={28} className="text-primary" />
            System Monitor
          </h1>
          <p style={{ color: 'var(--text-dim)', margin: 0, fontSize: '0.95rem' }}>
            Live hardware ingestion and VPS forwarding verification
          </p>
        </div>
        <button
          onClick={() => setIsPolling(!isPolling)}
          className={`btn ${isPolling ? 'btn-secondary' : 'btn-primary'}`}
          style={{ transition: 'all 0.3s ease' }}
        >
          {isPolling ? <><RefreshCw size={16} className="spin" /> Live Stream Active</> : <><Radio size={16} /> Live Stream Paused</>}
        </button>
      </div>

      {/* Visual Pipeline flow */}
      <div className="card" style={{ padding: 'var(--space-6)', background: 'linear-gradient(to right, #ffffff, #fafafa)', border: '1px solid var(--border-subtle)', boxShadow: '0 4px 24px -12px rgba(0,0,0,0.08)' }}>
        <h3 style={{ fontSize: '0.875rem', textTransform: 'uppercase', letterSpacing: '0.05em', color: 'var(--text-muted)', margin: '0 0 var(--space-5) 0', fontWeight: '600' }}>
          Data Pipeline Architecture
        </h3>

        <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', padding: 'var(--space-4) 0' }}>

          {/* Hardware Node */}
          <div style={{ display: 'flex', flexDirection: 'column', alignItems: 'center', flex: 1 }}>
            <div style={{ height: '64px', width: '64px', borderRadius: '50%', background: 'var(--bg-app)', border: '2px solid var(--border-default)', display: 'flex', alignItems: 'center', justifyContent: 'center', marginBottom: 'var(--space-3)', boxShadow: '0 2px 8px rgba(0,0,0,0.05)' }}>
              <Radio size={24} color="var(--text-dim)" />
            </div>
            <span style={{ fontWeight: '600', fontSize: '0.9rem', color: 'var(--text-main)' }}>Hardware</span>
            <span style={{ fontSize: '0.75rem', color: 'var(--text-muted)' }}>RFID / NFC Scanner</span>
          </div>

          <div style={{ flex: 1, display: 'flex', justifyContent: 'center' }}>
            <ArrowRight size={24} color="var(--text-muted)" className={isPolling && logs.length > 0 ? "pulse-arrow" : ""} />
          </div>

          {/* Local System Node */}
          <div style={{ display: 'flex', flexDirection: 'column', alignItems: 'center', flex: 1 }}>
            <div style={{ height: '72px', width: '72px', borderRadius: 'var(--radius-lg)', background: '#111', border: '2px solid #333', display: 'flex', alignItems: 'center', justifyContent: 'center', marginBottom: 'var(--space-3)', boxShadow: '0 8px 16px rgba(0,0,0,0.15)' }}>
              <Activity size={28} color="#fff" />
            </div>
            <span style={{ fontWeight: '700', fontSize: '1rem', color: 'var(--text-main)' }}>Local System</span>
            <span style={{ fontSize: '0.75rem', color: 'var(--text-muted)' }}>FlapMain Gateway</span>
          </div>

          <div style={{ flex: 1, display: 'flex', justifyContent: 'center' }}>
            <div style={{ display: 'flex', flexDirection: 'column', alignItems: 'center', gap: '4px' }}>
              <span style={{ fontSize: '0.65rem', fontWeight: '700', color: 'var(--action-primary)', textTransform: 'uppercase', letterSpacing: '0.05em' }}>HTTP POST</span>
              <ArrowRight size={24} color="var(--action-primary)" className={isPolling && logs.length > 0 ? "pulse-arrow" : ""} />
            </div>
          </div>

          {/* VPS Node */}
          <div style={{ display: 'flex', flexDirection: 'column', alignItems: 'center', flex: 1 }}>
            <div style={{ height: '64px', width: '64px', borderRadius: 'var(--radius-md)', background: 'var(--bg-app)', border: '2px dashed var(--action-primary)', display: 'flex', alignItems: 'center', justifyContent: 'center', marginBottom: 'var(--space-3)', boxShadow: '0 0 15px rgba(0, 112, 243, 0.15)' }}>
              <Server size={24} color="var(--action-primary)" />
            </div>
            <span style={{ fontWeight: '600', fontSize: '0.9rem', color: 'var(--text-main)' }}>VPS Endpoint</span>
            <span style={{ fontSize: '0.75rem', color: 'var(--text-muted)' }}>card.flap.com.np</span>
          </div>
        </div>
      </div>

      <div style={{ display: 'flex', gap: 'var(--space-6)', flex: 1, flexWrap: 'wrap' }}>

        {/* Left side: Live log stream */}
        <div style={{ flex: '1 1 500px', display: 'flex', flexDirection: 'column', gap: 'var(--space-4)' }}>
          <div className="flex justify-between items-center">
            <h2 style={{ fontSize: '1.25rem', fontWeight: '600', margin: 0, color: 'var(--text-main)' }}>Live Ingestion Stream</h2>
            <span style={{ fontSize: '0.85rem', color: 'var(--text-muted)', background: 'var(--bg-app)', padding: '2px 8px', borderRadius: '12px', border: '1px solid var(--border-subtle)' }}>
              {logs.length} Recent Taps
            </span>
          </div>

          <div className="card" style={{ overflow: 'hidden', padding: 0 }}>
            {loading ? (
              <div style={{ padding: 'var(--space-8)', textAlign: 'center', color: 'var(--text-muted)' }}>Loading Tap Logs...</div>
            ) : logs.length === 0 ? (
              <div style={{ padding: 'var(--space-8)', textAlign: 'center', color: 'var(--text-muted)' }}>No tap logs found. Tap a card to see data.</div>
            ) : (
              <table className="responsive-table">
                <thead>
                  <tr style={{ background: 'var(--bg-app)', borderBottom: '1px solid var(--border-subtle)' }}>
                    <th style={{ padding: 'var(--space-3) var(--space-4)', fontSize: '0.75rem', textTransform: 'uppercase', color: 'var(--text-muted)' }}>Time</th>
                    <th style={{ padding: 'var(--space-3) var(--space-4)', fontSize: '0.75rem', textTransform: 'uppercase', color: 'var(--text-muted)' }}>Tag UID</th>
                    <th style={{ padding: 'var(--space-3) var(--space-4)', fontSize: '0.75rem', textTransform: 'uppercase', color: 'var(--text-muted)' }}>Device</th>
                    <th style={{ padding: 'var(--space-3) var(--space-4)', fontSize: '0.75rem', textTransform: 'uppercase', color: 'var(--text-muted)' }}>VPS Forwarding</th>
                  </tr>
                </thead>
                <tbody>
                  {logs.map(log => {
                    const isSelected = selectedLog?._id === log._id;
                    // A tap is only a true success if the network request succeeded AND the VPS didn't return a logical error (including sync worker rejection wrappers)
                    const isErrorWrapper = log.targetResponse && log.targetResponse.error;
                    const vpsSuccess = log.forwardedMain && log.targetResponse && !isErrorWrapper && log.targetResponse.status !== 'error' && log.targetResponse.status !== 'fail';

                    return (
                      <tr
                        key={log._id}
                        onClick={() => setSelectedLog(log)}
                        style={{
                          borderBottom: '1px solid var(--border-subtle)',
                          background: isSelected ? 'var(--accent-light)' : 'transparent',
                          cursor: 'pointer',
                          transition: 'var(--transition)'
                        }}
                        onMouseEnter={(e) => { if (!isSelected) e.currentTarget.style.background = 'rgba(0,0,0,0.01)' }}
                        onMouseLeave={(e) => { if (!isSelected) e.currentTarget.style.background = 'transparent' }}
                      >
                        <td data-label="Time" style={{ padding: 'var(--space-4)', fontSize: '0.85rem', color: 'var(--text-dim)' }}>
                          {new Date(log.timestamp || log.createdAt).toLocaleTimeString()}
                        </td>
                        <td data-label="Tag UID" style={{ padding: 'var(--space-4)', fontSize: '0.9rem', fontWeight: '600', color: 'var(--text-main)', fontFamily: 'var(--font-mono)' }}>
                          {log.uid}
                        </td>
                        <td data-label="Device" style={{ padding: 'var(--space-4)', fontSize: '0.85rem', color: 'var(--text-dim)' }}>
                          {log.device_id ? `${log.device_id.substring(0, 8)}...` : 'N/A'}
                        </td>
                        <td data-label="VPS Forwarding" style={{ padding: 'var(--space-4)' }}>
                          {vpsSuccess ? (
                            <span style={{ display: 'inline-flex', alignItems: 'center', gap: '4px', fontSize: '0.75rem', fontWeight: '600', color: 'var(--status-success)', background: 'var(--status-success-bg)', padding: '4px 10px', borderRadius: '12px' }}>
                              <CheckCircle2 size={14} /> Success
                            </span>
                          ) : (
                            <span style={{ display: 'inline-flex', alignItems: 'center', gap: '4px', fontSize: '0.75rem', fontWeight: '600', color: 'var(--status-error)', background: 'var(--status-error-bg)', padding: '4px 10px', borderRadius: '12px' }}>
                              <XCircle size={14} /> Failed
                            </span>
                          )}
                        </td>
                      </tr>
                    );
                  })}
                </tbody>
              </table>
            )}
          </div>
        </div>

        {/* Right side: Detailed Inspector */}
        <div style={{ flex: '1 1 350px', display: 'flex', flexDirection: 'column', gap: 'var(--space-4)' }}>
          <h2 style={{ fontSize: '1.25rem', fontWeight: '600', margin: 0, color: 'var(--text-main)' }}>Payload Inspector</h2>

          <div className="card" style={{ padding: '0', overflow: 'hidden', display: 'flex', flexDirection: 'column', height: '100%', minHeight: '400px' }}>
            {!selectedLog ? (
              <div style={{ display: 'flex', flexDirection: 'column', alignItems: 'center', justifyContent: 'center', height: '100%', padding: 'var(--space-6)', color: 'var(--text-muted)' }}>
                <Activity size={32} style={{ marginBottom: 'var(--space-3)', opacity: 0.5 }} />
                <p style={{ margin: 0, fontSize: '0.9rem', textAlign: 'center' }}>Select a tap event from the stream to inspect the exact payload sent by this system to the VPS.</p>
              </div>
            ) : (
              <div style={{ display: 'flex', flexDirection: 'column', height: '100%' }}>
                <div style={{ padding: 'var(--space-4)', borderBottom: '1px solid var(--border-subtle)', background: '#fafafa' }}>
                  <div style={{ fontSize: '0.75rem', textTransform: 'uppercase', letterSpacing: '0.05em', color: 'var(--text-muted)', marginBottom: '4px' }}>Inspecting Tap ID</div>
                  <div style={{ fontSize: '0.9rem', fontFamily: 'monospace', fontWeight: '600' }}>{selectedLog._id}</div>
                </div>

                <div style={{ padding: 'var(--space-4)', flex: 1, overflowY: 'auto' }}>
                  <div style={{ marginBottom: 'var(--space-4)' }}>
                    <h4 style={{ fontSize: '0.8rem', color: 'var(--text-main)', margin: '0 0 var(--space-2) 0' }}>Ingested Data</h4>
                    <pre style={{ margin: 0, background: '#111', color: '#00ffcc', padding: 'var(--space-3)', borderRadius: 'var(--radius-md)', fontSize: '0.75rem', overflowX: 'auto', border: '1px solid #333' }}>
                      {JSON.stringify({
                        uid: selectedLog.uid,
                        device_id: selectedLog.device_id,
                        business_id: selectedLog.business_id,
                        flapid: selectedLog.flapid,
                        tag_type: selectedLog.tag_type,
                        type: selectedLog.type,
                        timestamp: selectedLog.timestamp || selectedLog.createdAt
                      }, null, 2)}
                    </pre>
                  </div>

                  <div>
                    <h4 style={{ fontSize: '0.8rem', color: 'var(--text-main)', margin: '0 0 var(--space-2) 0' }}>VPS Target Response</h4>
                    <pre style={{ margin: 0, background: '#111', color: selectedLog.forwardedMain ? '#10b981' : '#ef4444', padding: 'var(--space-3)', borderRadius: 'var(--radius-md)', fontSize: '0.75rem', overflowX: 'auto', border: '1px solid #333' }}>
                      {selectedLog.targetResponse ? JSON.stringify(selectedLog.targetResponse, null, 2) : '"No response received from VPS"'}
                    </pre>
                  </div>
                </div>
              </div>
            )}
          </div>
        </div>

      </div>

      <style dangerouslySetInnerHTML={{
        __html: `
        @keyframes pulse-arrow {
          0% { transform: translateX(0); opacity: 0.4; }
          50% { transform: translateX(5px); opacity: 1; }
          100% { transform: translateX(0); opacity: 0.4; }
        }
        .pulse-arrow {
          animation: pulse-arrow 1.5s infinite ease-in-out;
        }
        @keyframes spin {
          from { transform: rotate(0deg); }
          to { transform: rotate(360deg); }
        }
        .spin {
          animation: spin 2s linear infinite;
        }
      `}} />
    </div>
  );
};

export default SystemMonitor;
