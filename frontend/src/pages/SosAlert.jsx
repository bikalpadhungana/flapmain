import React, { useState, useEffect, useRef } from 'react';
import { 
  AlertTriangle, MessageSquare, Send, Radio, Wifi, Clock, Cpu, Battery, 
  ShieldAlert, RefreshCw, Zap, CheckCircle2, Server, Volume2, VolumeX,
  Filter, ArrowRight, CornerDownLeft, Bell, Shield, Activity, Check, Copy,
  Compass, Thermometer, Wind, Flame, Download, Eye, ExternalLink, X
} from 'lucide-react';
import { API_BASE_URL } from '../config';
import { io } from 'socket.io-client';

const INITIAL_REGISTERED_NODES = [
  { id: 101, name: 'Walkie Alpha (Nano)', type: 'Hardware Walkie-Talkie', freq: '433 MHz', sf: 'SF10', role: 'walkie' },
  { id: 102, name: 'Walkie Bravo (Nano)', type: 'Hardware Walkie-Talkie', freq: '433 MHz', sf: 'SF10', role: 'walkie' },
  { id: 103, name: 'Walkie Charlie (ESP8266)', type: 'Hardware Walkie-Talkie', freq: '433 MHz', sf: 'SF10', role: 'walkie' },
  { id: 0, name: 'Base Station (Gateway)', type: 'ESP LoRa Gateway', freq: '433 MHz / Wi-Fi', sf: 'SF10', role: 'gateway' },
  { id: 1, name: 'AWS Weather Node #1', type: 'Automatic Weather Station', freq: '433 MHz', sf: 'SF10', role: 'weather' },
  { id: 2, name: 'AWS Weather Node #2', type: 'Automatic Weather Station', freq: '433 MHz', sf: 'SF10', role: 'weather' },
  { id: 3, name: 'AWS Weather Node #3', type: 'Automatic Weather Station', freq: '433 MHz', sf: 'SF10', role: 'weather' }
];

const EMERGENCY_PRESETS = [
  { label: '🚨 EVACUATE NOW', text: 'CRITICAL EMERGENCY: EVACUATE AREA IMMEDIATELY!' },
  { label: '🦺 SAR DISPATCHED', text: 'SEARCH & RESCUE DISPATCHED - REMAIN AT POSITION' },
  { label: '🚑 MEDICAL EN ROUTE', text: 'MEDICAL ASSISTANCE EN ROUTE - REPORT INJURIES' },
  { label: '✅ ALL CLEAR', text: 'ALL CLEAR: EMERGENCY STAND DOWN. RESUME NORMAL OPS' }
];

// Browser-native Audio Siren Chime using Web Audio API
const playSirenBeep = () => {
  try {
    const AudioCtx = window.AudioContext || window.webkitAudioContext;
    if (!AudioCtx) return;
    const ctx = new AudioCtx();
    const osc = ctx.createOscillator();
    const gain = ctx.createGain();
    
    osc.type = 'sawtooth';
    osc.frequency.setValueAtTime(880, ctx.currentTime);
    osc.frequency.exponentialRampToValueAtTime(440, ctx.currentTime + 0.35);
    osc.frequency.exponentialRampToValueAtTime(880, ctx.currentTime + 0.7);
    
    gain.gain.setValueAtTime(0.3, ctx.currentTime);
    gain.gain.exponentialRampToValueAtTime(0.01, ctx.currentTime + 0.75);
    
    osc.connect(gain);
    gain.connect(ctx.destination);
    
    osc.start();
    osc.stop(ctx.currentTime + 0.75);
  } catch (e) {
    console.warn('Audio siren notification could not play:', e);
  }
};

const SosAlert = () => {
  const [meshMessages, setMeshMessages] = useState([]);
  const [sosHistory, setSosHistory] = useState([]);
  const [activeSosAlert, setActiveSosAlert] = useState(null);
  const [outgoingText, setOutgoingText] = useState('');
  const [targetNode, setTargetNode] = useState(0); // 0 = Broadcast
  const [isSending, setIsSending] = useState(false);
  const [isConnected, setIsConnected] = useState(true);
  const [isMuted, setIsMuted] = useState(false);
  const [sosFilter, setSosFilter] = useState('all'); // 'all', 'critical', 'walkie', 'weather'
  const [dismissedAlertIds, setDismissedAlertIds] = useState(new Set());
  const [nodeLiveStatus, setNodeLiveStatus] = useState({}); // { [nodeId]: { online, lastSeen, alertLevel } }

  const chatEndRef = useRef(null);

  // Normalize API URL
  const baseApiUrl = API_BASE_URL.replace(/\/+$/, '');

  // 1. Fetch unified SOS history and Walkie chat messages on mount
  useEffect(() => {
    // A. Fetch unified SOS alerts history
    fetch(`${baseApiUrl}/v1/devices/sos/history`)
      .then(res => {
        if (!res.ok) throw new Error(`HTTP ${res.status}`);
        return res.json();
      })
      .then(data => {
        if (data.alerts && Array.isArray(data.alerts)) {
          setSosHistory(data.alerts);

          // Find most recent unacknowledged SOS alert
          const latest = data.alerts[0];
          if (latest && (latest.alert_level > 0 || String(latest.alert_level_name).includes('SOS') || latest.message_type === 'sos')) {
            setActiveSosAlert(latest);
          }
        }
      })
      .catch(() => {
        // Fallback: Query telemetry history directly if /sos/history endpoint is pending
        fetch(`${baseApiUrl}/v1/devices/telemetry/history?range=30d&limit=250`)
          .then(res => res.json())
          .then(tData => {
            if (tData.readings && Array.isArray(tData.readings)) {
              const detected = tData.readings
                .filter(r => (r.alertLevel && r.alertLevel > 0) || (r.text_msg && /sos|emergency/i.test(r.text_msg)))
                .map(r => ({
                  _id: r._id,
                  source: 'telemetry',
                  source_type: 'Weather Station AWS',
                  device_id: r.deviceId || 'flap-flap-aws-001-7zhj',
                  origin_node: r.originNode || 1,
                  target_node: 0,
                  alert_level: r.alertLevel || 2,
                  alert_level_name: r.alertLevelName || 'EMERGENCY SOS',
                  message: r.text_msg || `Emergency SOS Alert on Station Node #${r.originNode || 1}`,
                  timestamp: r.timestamp,
                  temperature: r.temp,
                  humidity: r.humidity,
                  wind_speed: r.windSpeed,
                  mq9_gas: r.mq9Gas,
                  battery_mv: r.batteryMv,
                  battery_pct: r.batteryPct,
                  rssi: r.rssi,
                  snr: r.snr
                }));

              if (detected.length > 0) {
                setSosHistory(prev => {
                  const combined = [...prev, ...detected];
                  combined.sort((a, b) => new Date(b.timestamp).getTime() - new Date(a.timestamp).getTime());
                  return combined;
                });
                setActiveSosAlert(detected[0]);
              }
            }
          })
          .catch(e => console.warn('Fallback telemetry SOS fetch failed:', e));
      });

    // B. Fetch Walkie-Talkie Mesh message history
    fetch(`${baseApiUrl}/v1/devices/messages/history`)
      .then(res => res.json())
      .then(data => {
        if (data.messages && Array.isArray(data.messages)) {
          setMeshMessages(data.messages);

          // Check if any message is an active SOS
          const latestSosMsg = data.messages.find(m => m.alert_level > 0 || m.message_type === 'sos');
          if (latestSosMsg) {
            setActiveSosAlert(prev => prev || latestSosMsg);
            setSosHistory(prev => {
              if (prev.some(a => String(a._id) === String(latestSosMsg._id))) return prev;
              return [latestSosMsg, ...prev];
            });
          }
        }
      })
      .catch(err => console.warn('Failed to fetch mesh message history:', err));
  }, [baseApiUrl]);

  // 2. Real-time Socket.io Live Stream Listeners
  useEffect(() => {
    const socket = io(baseApiUrl.replace(/\/api$/, ''));

    socket.on('connect', () => {
      setIsConnected(true);
      console.log('[SosAlert] Connected to live LoRa Mesh emergency & SOS socket stream');
    });

    socket.on('disconnect', () => {
      setIsConnected(false);
    });

    // A. Dedicated SOS Alert Event
    const handleIncomingSosAlert = (alert) => {
      console.log('🚨 [LIVE SOS ALERT RECEIVED VIA SOCKET]:', alert);
      setActiveSosAlert(alert);
      setSosHistory(prev => [alert, ...prev.filter(a => String(a._id) !== String(alert._id))]);

      if (!isMuted) {
        playSirenBeep();
      }

      // Mark originating node as actively alerting
      if (alert.origin_node !== undefined) {
        setNodeLiveStatus(prev => ({
          ...prev,
          [alert.origin_node]: { online: true, lastSeen: new Date(), alertLevel: alert.alert_level || 2 }
        }));
      }
    };

    // B. Walkie-Talkie Mesh Message Event
    const handleIncomingMeshMessage = (msg) => {
      setMeshMessages(prev => {
        if (prev.some(m => String(m._id) === String(msg._id))) return prev;
        return [...prev, msg].slice(-100);
      });

      const isSos = msg.alert_level > 0 || msg.message_type === 'sos';
      if (isSos) {
        const sosRecord = {
          _id: msg._id,
          source: 'mesh_message',
          source_type: 'LoRa Walkie-Talkie',
          device_id: msg.device_id,
          origin_node: msg.origin_node,
          target_node: msg.target_node,
          alert_level: msg.alert_level || 2,
          alert_level_name: msg.alert_level === 1 ? 'WARNING' : 'EMERGENCY SOS',
          message: msg.text,
          timestamp: msg.timestamp || new Date().toISOString(),
          battery_mv: msg.battery_mv,
          rssi: msg.rssi,
          snr: msg.snr,
          hops_left: msg.hops_left
        };

        handleIncomingSosAlert(sosRecord);
      }

      if (msg.origin_node !== undefined) {
        setNodeLiveStatus(prev => ({
          ...prev,
          [msg.origin_node]: { online: true, lastSeen: new Date(), alertLevel: msg.alert_level || 0 }
        }));
      }
    };

    // C. Weather Station & Telemetry Packets
    const handleIncomingTelemetry = (reading) => {
      const payload = reading.payload || {};
      const originNode = payload.mesh_origin_node !== undefined ? Number(payload.mesh_origin_node) : 1;
      const alertLevel = payload.alert_level !== undefined ? Number(payload.alert_level) : 0;
      const textMsg = payload.text_msg || '';

      if (alertLevel > 0 || /sos|emergency/i.test(textMsg)) {
        const sosRecord = {
          _id: reading._id,
          source: 'telemetry',
          source_type: reading.device_type === 'weather_station_v1' ? 'Weather Station AWS' : 'Hardware Node',
          device_id: reading.device_id,
          origin_node: originNode,
          target_node: 0,
          alert_level: alertLevel || 2,
          alert_level_name: payload.alert_level_name || 'EMERGENCY SOS',
          message: textMsg || `Emergency SOS Alert triggered on Station Node #${originNode}`,
          timestamp: reading.timestamp || new Date().toISOString(),
          temperature: payload.temperature,
          humidity: payload.humidity,
          wind_speed: payload.wind_speed,
          mq9_gas: payload.mq9_gas,
          battery_mv: payload.battery_mv,
          battery_pct: payload.battery_pct,
          rssi: payload.rssi,
          snr: payload.snr
        };

        handleIncomingSosAlert(sosRecord);
      }

      setNodeLiveStatus(prev => ({
        ...prev,
        [originNode]: { online: true, lastSeen: new Date(), alertLevel }
      }));
    };

    socket.on('new_sos_alert', handleIncomingSosAlert);
    socket.on('new_mesh_message', handleIncomingMeshMessage);
    socket.on('new_weather_reading', handleIncomingTelemetry);
    socket.on('new_telemetry', handleIncomingTelemetry);

    return () => {
      socket.disconnect();
    };
  }, [baseApiUrl, isMuted]);

  // Scroll chat window to bottom on new messages
  useEffect(() => {
    if (chatEndRef.current) {
      chatEndRef.current.scrollIntoView({ behavior: 'smooth' });
    }
  }, [meshMessages]);

  // Send message or Emergency SOS Downlink to LoRa Mesh
  const handleSendMessage = async (isSos = false, customText = '') => {
    const textToSend = customText || outgoingText.trim();
    if (!textToSend && !isSos) return;
    setIsSending(true);

    try {
      const res = await fetch(`${baseApiUrl}/v1/devices/send-message`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          target_node: targetNode,
          text: textToSend || 'CRITICAL EMERGENCY SOS BROADCAST FROM BASE STATION!',
          alert_level: isSos ? 2 : 0,
          gateway_id: 'esp_gateway_node_01'
        })
      });

      const data = await res.json();
      if (data.status === 'success') {
        if (!customText) setOutgoingText('');
      }
    } catch (err) {
      console.error('Error sending message to LoRa Mesh outbox:', err);
    } finally {
      setIsSending(false);
    }
  };

  // Quick Acknowledge Active SOS
  const handleAcknowledgeActiveSos = () => {
    if (!activeSosAlert) return;
    const origin = activeSosAlert.origin_node || activeSosAlert.mesh_origin_node || 0;
    const ackMsg = `BASE STATION ACK: SOS RECEIVED FROM NODE #${origin}. HELP EN ROUTE!`;
    handleSendMessage(false, ackMsg);
    
    // Dismiss active banner
    if (activeSosAlert._id) {
      setDismissedAlertIds(prev => new Set([...prev, activeSosAlert._id]));
    }
    setActiveSosAlert(null);
  };

  // Dismiss Active Banner
  const handleDismissBanner = () => {
    if (activeSosAlert && activeSosAlert._id) {
      setDismissedAlertIds(prev => new Set([...prev, activeSosAlert._id]));
    }
    setActiveSosAlert(null);
  };

  // Filtered SOS History List
  const filteredSosHistory = sosHistory.filter(item => {
    if (sosFilter === 'critical') return (item.alert_level || 0) >= 2 || String(item.alert_level_name).includes('SOS');
    if (sosFilter === 'walkie') return item.source === 'mesh_message' || String(item.source_type).includes('Walkie');
    if (sosFilter === 'weather') return item.source === 'telemetry' || String(item.source_type).includes('Weather');
    return true;
  });

  return (
    <div style={{ maxWidth: '1200px', margin: '0 auto', display: 'flex', flexDirection: 'column', gap: 'var(--space-6)' }}>
      
      {/* 1. Header */}
      <div className="responsive-page-header">
        <div>
          <div style={{ display: 'flex', alignItems: 'center', gap: 10, flexWrap: 'wrap' }}>
            <h1 style={{ fontSize: '1.75rem', fontWeight: '700', color: 'var(--text-main)', margin: '0 0 var(--space-2) 0', display: 'flex', alignItems: 'center', gap: 'var(--space-3)' }}>
              <ShieldAlert size={32} style={{ color: 'var(--status-error)', flexShrink: 0 }} />
              <span>Emergency SOS Console & LoRa Mesh Base</span>
            </h1>
            {activeSosAlert && (
              <span style={{
                background: 'var(--status-error)',
                color: '#ffffff',
                fontSize: '0.75rem',
                fontWeight: 900,
                padding: '4px 10px',
                borderRadius: 20,
                letterSpacing: '0.5px',
                animation: 'pulse 1.2s infinite'
              }}>
                🚨 ACTIVE SOS INCIDENT
              </span>
            )}
          </div>
          <p style={{ color: 'var(--text-dim)', margin: 0, fontSize: '0.95rem' }}>
            Central Emergency Command, Hardware Walkie-Talkie OLED Relay & Station Distress Monitoring • Gateway ID: <code style={{ color: 'var(--text-main)', background: 'var(--bg-app)', padding: '2px 8px', borderRadius: 6, border: '1px solid var(--border-subtle)' }}>esp_gateway_node_01</code>
          </p>
        </div>

        <div style={{ display: 'flex', alignItems: 'center', gap: 10, flexWrap: 'wrap' }}>
          {/* Siren Audio Toggle */}
          <button
            onClick={() => {
              setIsMuted(!isMuted);
              if (isMuted) playSirenBeep();
            }}
            className="btn btn-secondary"
            style={{
              display: 'flex',
              alignItems: 'center',
              gap: 6,
              borderRadius: 10,
              fontSize: '0.82rem',
              fontWeight: 600,
              color: isMuted ? 'var(--text-muted)' : 'var(--action-primary)'
            }}
            title={isMuted ? 'Enable Audio Siren for SOS Alerts' : 'Mute Audio Siren'}
          >
            {isMuted ? <VolumeX size={16} /> : <Volume2 size={16} />}
            <span>{isMuted ? 'Siren Muted' : 'Siren Active'}</span>
          </button>

          {/* Connection Status Pill */}
          <span style={{
            fontSize: '0.82rem', fontWeight: 600, padding: '6px 14px', borderRadius: 20,
            background: isConnected ? 'rgba(16, 185, 129, 0.12)' : 'rgba(239, 68, 68, 0.12)',
            color: isConnected ? '#10b981' : '#ef4444', border: `1px solid ${isConnected ? '#10b981' : '#ef4444'}`,
            display: 'flex', alignItems: 'center', gap: 6
          }}>
            <Radio size={15} /> {isConnected ? 'Mesh Gateway Connected' : 'Gateway Disconnected'}
          </span>
        </div>
      </div>

      {/* 2. ACTIVE EMERGENCY SOS ALERT BANNER */}
      {activeSosAlert ? (
        <div className="card" style={{
          padding: '20px 24px',
          background: 'var(--status-error-bg)',
          border: '2px solid var(--status-error)',
          borderRadius: 20,
          boxShadow: '0 8px 30px rgba(225, 29, 72, 0.3)',
          display: 'flex',
          flexDirection: 'column',
          gap: 16,
          animation: 'pulse 1.8s infinite'
        }}>
          <div style={{ display: 'flex', alignItems: 'flex-start', justifyContent: 'space-between', flexWrap: 'wrap', gap: 16 }}>
            <div style={{ display: 'flex', alignItems: 'flex-start', gap: 16 }}>
              <div style={{
                width: 52, height: 52, borderRadius: '50%', background: 'var(--status-error)',
                color: '#ffffff', display: 'flex', alignItems: 'center', justifyContent: 'center',
                boxShadow: '0 0 20px rgba(225, 29, 72, 0.8)', flexShrink: 0
              }}>
                <AlertTriangle size={28} />
              </div>
              <div>
                <div style={{ display: 'flex', alignItems: 'center', gap: 10, flexWrap: 'wrap' }}>
                  <span style={{ fontSize: '1.15rem', fontWeight: 900, color: 'var(--status-error)', letterSpacing: '0.5px' }}>
                    🚨 ACTIVE EMERGENCY SOS BROADCAST DETECTED ON LORA MESH
                  </span>
                  <span style={{
                    fontSize: '0.75rem', fontWeight: 800, padding: '2px 8px', borderRadius: 6,
                    background: 'var(--status-error)', color: '#ffffff'
                  }}>
                    {activeSosAlert.source_type || 'LoRa Node'}
                  </span>
                </div>

                <div style={{ fontSize: '1.1rem', fontWeight: 800, color: 'var(--text-main)', marginTop: 4 }}>
                  "{activeSosAlert.message || activeSosAlert.text || activeSosAlert.text_msg || 'EMERGENCY DISTRESS SIGNAL'}"
                </div>

                <div style={{ display: 'flex', alignItems: 'center', gap: 16, flexWrap: 'wrap', marginTop: 8, fontSize: '0.82rem', color: 'var(--text-dim)' }}>
                  <span>
                    <strong>Origin Node:</strong> #{activeSosAlert.origin_node || activeSosAlert.mesh_origin_node || 1} ({activeSosAlert.device_id || 'Hardware Node'})
                  </span>
                  <span>
                    <strong>Time:</strong> {new Date(activeSosAlert.timestamp || Date.now()).toLocaleTimeString()}
                  </span>
                  {activeSosAlert.battery_mv && (
                    <span><strong>Battery:</strong> {activeSosAlert.battery_mv} mV</span>
                  )}
                  {activeSosAlert.rssi && (
                    <span><strong>Signal:</strong> {activeSosAlert.rssi} dBm (SNR: {activeSosAlert.snr || '-'} dB)</span>
                  )}
                  {activeSosAlert.temperature !== undefined && activeSosAlert.temperature !== null && (
                    <span><strong>Temp:</strong> {activeSosAlert.temperature}°C</span>
                  )}
                  {activeSosAlert.wind_speed !== undefined && activeSosAlert.wind_speed !== null && (
                    <span><strong>Wind:</strong> {activeSosAlert.wind_speed} km/h</span>
                  )}
                </div>
              </div>
            </div>

            {/* Banner Actions */}
            <div style={{ display: 'flex', alignItems: 'center', gap: 10, flexWrap: 'wrap' }}>
              <button
                onClick={handleAcknowledgeActiveSos}
                className="btn btn-primary"
                style={{
                  background: 'var(--status-error)',
                  borderColor: 'var(--status-error)',
                  borderRadius: 10,
                  fontSize: '0.85rem',
                  fontWeight: 700,
                  display: 'flex',
                  alignItems: 'center',
                  gap: 6
                }}
              >
                <Zap size={16} /> Quick Acknowledge to Mesh
              </button>

              <button
                onClick={handleDismissBanner}
                className="btn btn-secondary"
                style={{ borderRadius: 10, fontSize: '0.85rem', padding: '7px 14px' }}
              >
                Dismiss Banner
              </button>
            </div>
          </div>
        </div>
      ) : (
        <div className="card" style={{
          padding: '16px 22px',
          background: 'var(--bg-surface)',
          border: '1px solid var(--border-strong)',
          borderRadius: 16,
          display: 'flex',
          alignItems: 'center',
          justifyContent: 'space-between',
          flexWrap: 'wrap',
          gap: 12
        }}>
          <div style={{ display: 'flex', alignItems: 'center', gap: 10 }}>
            <CheckCircle2 size={20} style={{ color: '#10b981' }} />
            <div>
              <span style={{ fontWeight: 800, fontSize: '0.95rem', color: 'var(--text-main)' }}>
                LORA MESH SYSTEM ALL CLEAR — NO ACTIVE EMERGENCY ALERTS
              </span>
              <p style={{ margin: 0, fontSize: '0.8rem', color: 'var(--text-muted)' }}>
                Radio: 433 MHz SF10 • Gateway: esp_gateway_node_01 • Listening on LoRa mesh for incoming emergency distress packets
              </p>
            </div>
          </div>

          <button
            onClick={() => handleSendMessage(true, 'MANUAL SOS TEST BROADCAST FROM CLOUD DASHBOARD')}
            className="btn btn-secondary"
            style={{ fontSize: '0.8rem', color: 'var(--status-error)', borderColor: 'rgba(239, 68, 68, 0.3)', borderRadius: 8 }}
          >
            <AlertTriangle size={14} style={{ marginRight: 6 }} /> Broadcast Test SOS
          </button>
        </div>
      )}

      {/* 3. DEDICATED EMERGENCY SOS INCIDENTS & ALERT HISTORY LOG */}
      <div className="card" style={{
        padding: 'var(--space-6)',
        background: 'var(--bg-surface)',
        border: '1px solid var(--border-strong)',
        borderRadius: 20,
        boxShadow: 'var(--shadow-md)',
        display: 'flex',
        flexDirection: 'column',
        gap: 16
      }}>
        <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', flexWrap: 'wrap', gap: 12 }}>
          <div>
            <h3 style={{ fontSize: '1.15rem', fontWeight: 700, color: 'var(--text-main)', margin: 0, display: 'flex', alignItems: 'center', gap: 8 }}>
              <ShieldAlert size={20} style={{ color: 'var(--status-error)' }} />
              Emergency SOS Incidents & Alert History Log ({filteredSosHistory.length} Recorded)
            </h3>
            <p style={{ margin: '4px 0 0 0', fontSize: '0.82rem', color: 'var(--text-muted)' }}>
              Permanent record of all emergency distress calls, hardware button presses, and station warning telemetry.
            </p>
          </div>

          {/* Filter Pills */}
          <div style={{ display: 'flex', alignItems: 'center', gap: 6, flexWrap: 'wrap' }}>
            {[
              { id: 'all', label: `All Alerts (${sosHistory.length})` },
              { id: 'critical', label: '🚨 Level 2 Critical SOS' },
              { id: 'walkie', label: '📻 Walkie-Talkies' },
              { id: 'weather', label: '📡 Weather Stations' }
            ].map(f => (
              <button
                key={f.id}
                onClick={() => setSosFilter(f.id)}
                style={{
                  padding: '5px 12px',
                  borderRadius: 8,
                  fontSize: '0.78rem',
                  fontWeight: sosFilter === f.id ? 700 : 500,
                  border: sosFilter === f.id ? '1px solid var(--status-error)' : '1px solid var(--border-subtle)',
                  background: sosFilter === f.id ? 'var(--status-error-bg)' : 'var(--bg-app)',
                  color: sosFilter === f.id ? 'var(--status-error)' : 'var(--text-muted)',
                  cursor: 'pointer',
                  transition: 'all 0.15s ease'
                }}
              >
                {f.label}
              </button>
            ))}
          </div>
        </div>

        {/* SOS Incidents Table / Feed */}
        <div style={{
          maxHeight: 320,
          overflowY: 'auto',
          border: '1px solid var(--border-subtle)',
          borderRadius: 14,
          background: 'var(--bg-app)'
        }}>
          {filteredSosHistory.length === 0 ? (
            <div style={{ padding: '36px 20px', textAlign: 'center', color: 'var(--text-muted)' }}>
              <Shield size={36} style={{ opacity: 0.3, marginBottom: 8 }} />
              <p style={{ margin: 0, fontWeight: 600 }}>No emergency SOS alerts logged in this filter view</p>
              <span style={{ fontSize: '0.8rem' }}>When a hardware node transmits an SOS packet, it will appear here in real time.</span>
            </div>
          ) : (
            <table style={{ width: '100%', borderCollapse: 'collapse', textAlign: 'left', fontSize: '0.82rem' }}>
              <thead>
                <tr style={{ background: 'var(--bg-surface)', borderBottom: '1px solid var(--border-strong)', color: 'var(--text-muted)' }}>
                  <th style={{ padding: '10px 14px', fontWeight: 700 }}>Time & Date</th>
                  <th style={{ padding: '10px 14px', fontWeight: 700 }}>Source Node</th>
                  <th style={{ padding: '10px 14px', fontWeight: 700 }}>Severity Level</th>
                  <th style={{ padding: '10px 14px', fontWeight: 700 }}>Emergency Message / Reason</th>
                  <th style={{ padding: '10px 14px', fontWeight: 700 }}>Telemetry / RF Link</th>
                  <th style={{ padding: '10px 14px', fontWeight: 700, textAlign: 'center' }}>Response</th>
                </tr>
              </thead>
              <tbody>
                {filteredSosHistory.map((item, idx) => {
                  const itemDate = item.timestamp ? new Date(item.timestamp) : null;
                  const timeStr = itemDate ? itemDate.toLocaleTimeString([], { hour: '2-digit', minute: '2-digit', second: '2-digit' }) : '--';
                  const dateStr = itemDate ? itemDate.toLocaleDateString([], { month: 'short', day: 'numeric' }) : '';
                  const originNode = item.origin_node || item.mesh_origin_node || 1;
                  const isCritical = (item.alert_level || 0) >= 2 || String(item.alert_level_name).includes('SOS');

                  return (
                    <tr
                      key={item._id || idx}
                      style={{
                        borderBottom: '1px solid var(--border-subtle)',
                        background: isCritical ? 'rgba(239, 68, 68, 0.06)' : 'transparent',
                        transition: 'background 0.15s ease'
                      }}
                    >
                      {/* Timestamp */}
                      <td style={{ padding: '10px 14px', whiteSpace: 'nowrap' }}>
                        <div style={{ fontWeight: 600, color: 'var(--text-main)' }}>{timeStr}</div>
                        <div style={{ fontSize: '0.72rem', color: 'var(--text-muted)' }}>{dateStr}</div>
                      </td>

                      {/* Origin Node */}
                      <td style={{ padding: '10px 14px', whiteSpace: 'nowrap' }}>
                        <span style={{
                          fontWeight: 700,
                          fontSize: '0.76rem',
                          padding: '3px 8px',
                          borderRadius: 6,
                          background: 'var(--bg-surface)',
                          border: '1px solid var(--border-strong)',
                          color: 'var(--text-main)'
                        }}>
                          {String(item.source_type || '').includes('Weather') ? '📡' : '📻'} Node #{originNode}
                        </span>
                        <div style={{ fontSize: '0.72rem', color: 'var(--text-muted)', marginTop: 2 }}>
                          {item.source_type || 'LoRa Node'}
                        </div>
                      </td>

                      {/* Severity */}
                      <td style={{ padding: '10px 14px', whiteSpace: 'nowrap' }}>
                        <span style={{
                          fontSize: '0.72rem',
                          fontWeight: 800,
                          padding: '3px 8px',
                          borderRadius: 6,
                          background: isCritical ? 'var(--status-error)' : 'rgba(245, 158, 11, 0.2)',
                          color: isCritical ? '#ffffff' : '#f59e0b'
                        }}>
                          {isCritical ? '🚨 CRITICAL SOS' : '⚠️ WARNING (LVL 1)'}
                        </span>
                      </td>

                      {/* Message Content */}
                      <td style={{ padding: '10px 14px', fontWeight: 600, color: isCritical ? 'var(--status-error)' : 'var(--text-main)' }}>
                        {item.message || item.text || item.text_msg || 'Emergency distress signal'}
                      </td>

                      {/* Telemetry / RF link */}
                      <td style={{ padding: '10px 14px', whiteSpace: 'nowrap', fontSize: '0.75rem', color: 'var(--text-muted)' }}>
                        <div>{item.battery_mv ? `Batt: ${item.battery_mv} mV` : ''} {item.battery_pct ? `(${item.battery_pct}%)` : ''}</div>
                        <div>{item.rssi ? `RSSI: ${item.rssi} dBm` : ''} {item.snr ? `• SNR: ${item.snr} dB` : ''}</div>
                        {item.temperature !== undefined && item.temperature !== null && (
                          <div>Temp: {item.temperature}°C • Wind: {item.wind_speed || 0} km/h</div>
                        )}
                      </td>

                      {/* Quick Action Button */}
                      <td style={{ padding: '10px 14px', whiteSpace: 'nowrap', textAlign: 'center' }}>
                        <button
                          onClick={() => {
                            setTargetNode(originNode);
                            setOutgoingText(`BASE STATION ACK TO NODE #${originNode}: WE RECEIVE YOUR SOS. DISPATCHING ASSISTANCE!`);
                          }}
                          className="btn btn-secondary"
                          style={{
                            padding: '4px 10px',
                            fontSize: '0.75rem',
                            borderRadius: 6,
                            fontWeight: 600,
                            display: 'inline-flex',
                            alignItems: 'center',
                            gap: 4
                          }}
                          title={`Target Node #${originNode} in the communicator`}
                        >
                          <CornerDownLeft size={12} /> Target Node
                        </button>
                      </td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
          )}
        </div>
      </div>

      {/* 4. TWO-WAY LORA MESH WALKIE-TALKIE CHAT CONSOLE */}
      <div className="card" style={{
        padding: 'var(--space-6)',
        background: 'var(--bg-surface)',
        border: '1px solid var(--border-strong)',
        borderRadius: 20,
        boxShadow: 'var(--shadow-md)',
        display: 'flex',
        flexDirection: 'column',
        gap: 16
      }}>
        <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', flexWrap: 'wrap', gap: 10 }}>
          <div style={{ display: 'flex', alignItems: 'center', gap: 10, color: 'var(--text-main)', fontWeight: 700, fontSize: '1.1rem' }}>
            <MessageSquare size={22} style={{ color: 'var(--action-primary)' }} />
            Two-Way LoRa Mesh Text & Emergency Dispatcher
          </div>
          <span style={{ fontSize: '0.8rem', color: 'var(--text-muted)', background: 'var(--bg-app)', padding: '4px 12px', borderRadius: 12, border: '1px solid var(--border-subtle)', fontWeight: 500 }}>
            Broadcasts over 433MHz LoRa Mesh to Hardware Walkie OLEDs & AWS Station Displays
          </span>
        </div>

        {/* Quick Emergency Broadcast Presets Bar */}
        <div style={{
          padding: '10px 14px',
          background: 'var(--bg-app)',
          borderRadius: 12,
          border: '1px solid var(--border-subtle)',
          display: 'flex',
          alignItems: 'center',
          gap: 8,
          flexWrap: 'wrap'
        }}>
          <span style={{ fontSize: '0.78rem', fontWeight: 700, color: 'var(--text-muted)' }}>
            ⚡ 1-Click Emergency Broadcast Presets:
          </span>
          {EMERGENCY_PRESETS.map(p => (
            <button
              key={p.label}
              onClick={() => handleSendMessage(p.label.includes('EVACUATE'), p.text)}
              disabled={isSending}
              style={{
                padding: '4px 10px',
                fontSize: '0.75rem',
                fontWeight: 700,
                borderRadius: 8,
                background: 'var(--bg-surface)',
                border: '1px solid var(--border-strong)',
                color: p.label.includes('EVACUATE') ? 'var(--status-error)' : 'var(--text-main)',
                cursor: 'pointer',
                transition: 'all 0.15s ease'
              }}
            >
              {p.label}
            </button>
          ))}
        </div>

        {/* Chat History Container */}
        <div style={{
          height: 380,
          overflowY: 'auto',
          background: 'var(--bg-app)',
          border: '1px solid var(--border-subtle)',
          borderRadius: 16,
          padding: 16,
          display: 'flex',
          flexDirection: 'column',
          gap: 12
        }}>
          {meshMessages.length === 0 ? (
            <div style={{ margin: 'auto', textAlign: 'center', color: 'var(--text-muted)', fontSize: '0.9rem' }}>
              No mesh messages transmitted yet. Type a message below to broadcast to hardware walkie-talkie OLED displays over 433MHz LoRa Mesh.
            </div>
          ) : (
            meshMessages.map((msg, idx) => {
              const isSos = msg.alert_level > 0 || msg.message_type === 'sos';
              const isDownlink = msg.is_downlink || msg.origin_node === 0;

              return (
                <div key={msg._id || idx} style={{
                  alignSelf: isDownlink ? 'flex-end' : 'flex-start',
                  maxWidth: '80%',
                  padding: '12px 16px',
                  borderRadius: isDownlink ? '16px 16px 4px 16px' : '16px 16px 16px 4px',
                  background: isSos ? 'var(--status-error-bg)' : (isDownlink ? 'var(--accent-light)' : 'var(--bg-surface)'),
                  border: `1px solid ${isSos ? 'var(--status-error)' : (isDownlink ? 'var(--border-focus)' : 'var(--border-strong)')}`,
                  color: 'var(--text-main)',
                  boxShadow: 'var(--shadow-sm)'
                }}>
                  <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', gap: 14, fontSize: '0.78rem', marginBottom: 6, opacity: 0.9 }}>
                    <span style={{ fontWeight: 800, color: isSos ? 'var(--status-error)' : (isDownlink ? 'var(--action-primary)' : 'var(--text-dim)') }}>
                      {isDownlink ? '☁️ Base Station (Cloud Web App)' : `📻 Walkie Node #${msg.origin_node || msg.mesh_origin_node || 'Unknown'}`}
                      {msg.target_node !== undefined && (
                        <span style={{ marginLeft: 8, opacity: 0.8, fontSize: '0.74rem', color: msg.target_node === 0 ? 'var(--text-muted)' : 'var(--action-primary)' }}>
                          {msg.target_node === 0 ? '📢 Broadcast' : `🎯 To Node #${msg.target_node}`}
                        </span>
                      )}
                    </span>
                    <span style={{ color: 'var(--text-muted)' }}>
                      {new Date(msg.timestamp || Date.now()).toLocaleTimeString([], { hour: '2-digit', minute: '2-digit', second: '2-digit' })}
                    </span>
                  </div>
                  
                  <div style={{ fontSize: '1rem', fontWeight: 600, wordBreak: 'break-word', color: isSos ? 'var(--status-error)' : 'var(--text-main)' }}>
                    {isSos && <span style={{ fontWeight: 900, marginRight: 6 }}>🚨 EMERGENCY SOS:</span>}
                    {msg.text || msg.text_msg}
                  </div>

                  {!isDownlink && (
                    <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'flex-end', gap: 12, fontSize: '0.72rem', color: 'var(--text-muted)', marginTop: 6 }}>
                      {msg.battery_mv && <span>Batt: {msg.battery_mv} mV</span>}
                      {msg.rssi && <span>RSSI: {msg.rssi} dBm</span>}
                      {msg.snr && <span>SNR: {msg.snr} dB</span>}
                      {msg.hops_left && <span>Hops: {msg.hops_left}</span>}
                    </div>
                  )}
                </div>
              );
            })
          )}
          <div ref={chatEndRef} />
        </div>

        {/* Form & Controls */}
        <div style={{ display: 'flex', gap: 10, flexWrap: 'wrap' }}>
          <select
            value={targetNode}
            onChange={(e) => setTargetNode(Number(e.target.value))}
            style={{
              background: 'var(--bg-surface)',
              color: 'var(--text-main)',
              border: '1px solid var(--border-strong)',
              borderRadius: 12,
              padding: '11px 16px',
              fontSize: '0.9rem',
              fontWeight: 600,
              outline: 'none',
              cursor: 'pointer'
            }}
          >
            <option value={0}>📢 Broadcast (All Mesh Nodes)</option>
            <optgroup label="Walkie-Talkie Nodes">
              <option value={101}>📻 Node #101 (Walkie Alpha)</option>
              <option value={102}>📻 Node #102 (Walkie Bravo)</option>
              <option value={103}>📻 Node #103 (ESP Walkie Charlie)</option>
            </optgroup>
            <optgroup label="Automatic Weather Station Nodes">
              <option value={1}>📡 Node #1 (Primary AWS Station)</option>
              <option value={2}>📡 Node #2 (AWS Station 2)</option>
              <option value={3}>📡 Node #3 (AWS Station 3)</option>
            </optgroup>
          </select>

          <input
            type="text"
            placeholder="Type message to broadcast to hardware LoRa Mesh OLED displays..."
            value={outgoingText}
            onChange={(e) => setOutgoingText(e.target.value)}
            onKeyDown={(e) => e.key === 'Enter' && handleSendMessage(false)}
            maxLength={31}
            style={{
              flex: 1,
              minWidth: 260,
              background: 'var(--bg-surface)',
              color: 'var(--text-main)',
              border: '1px solid var(--border-strong)',
              borderRadius: 12,
              padding: '11px 16px',
              fontSize: '0.94rem',
              outline: 'none'
            }}
          />

          <button
            onClick={() => handleSendMessage(false)}
            disabled={isSending || !outgoingText.trim()}
            className="btn btn-primary"
            style={{ borderRadius: 12, padding: '11px 22px', display: 'flex', alignItems: 'center', gap: 8, fontWeight: 600 }}
          >
            <Send size={17} /> Send to Mesh
          </button>

          <button
            onClick={() => handleSendMessage(true)}
            disabled={isSending}
            style={{
              background: 'var(--status-error)',
              color: '#fff',
              border: 'none',
              borderRadius: 12,
              padding: '11px 22px',
              fontWeight: 800,
              fontSize: '0.9rem',
              cursor: 'pointer',
              display: 'flex',
              alignItems: 'center',
              gap: 8,
              boxShadow: '0 4px 15px rgba(239, 68, 68, 0.3)'
            }}
          >
            <AlertTriangle size={17} /> Send SOS
          </button>
        </div>
      </div>

      {/* 5. LoRa Mesh Hardware Nodes Status Grid */}
      <div className="card" style={{ padding: 'var(--space-6)', background: 'var(--bg-surface)', border: '1px solid var(--border-strong)', borderRadius: 20 }}>
        <h3 style={{ fontSize: '1.1rem', fontWeight: 700, color: 'var(--text-main)', margin: '0 0 var(--space-4) 0', display: 'flex', alignItems: 'center', gap: 8 }}>
          <Cpu size={20} style={{ color: 'var(--action-primary)' }} />
          Hardware LoRa Mesh Network Nodes Status Matrix
        </h3>

        <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(240px, 1fr))', gap: 14 }}>
          {INITIAL_REGISTERED_NODES.map(node => {
            const live = nodeLiveStatus[node.id] || {};
            const isAlerting = live.alertLevel && live.alertLevel > 0;
            const isOnline = live.online || node.id === 0;

            return (
              <div
                key={node.id}
                onClick={() => setTargetNode(node.id)}
                style={{
                  padding: 16,
                  background: isAlerting ? 'var(--status-error-bg)' : 'var(--bg-app)',
                  border: isAlerting ? '2px solid var(--status-error)' : '1px solid var(--border-subtle)',
                  borderRadius: 14,
                  display: 'flex',
                  flexDirection: 'column',
                  gap: 6,
                  cursor: 'pointer',
                  transition: 'all 0.2s ease',
                  boxShadow: isAlerting ? '0 0 15px rgba(225, 29, 72, 0.2)' : 'none'
                }}
                title={`Click to set Node #${node.id} as communicator target`}
              >
                <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between' }}>
                  <span style={{ fontWeight: 800, fontSize: '0.95rem', color: isAlerting ? 'var(--status-error)' : 'var(--text-main)' }}>
                    {node.role === 'weather' ? '📡' : (node.role === 'gateway' ? '🌐' : '📻')} {node.name}
                  </span>
                  <span style={{
                    fontSize: '0.7rem', fontWeight: 700, padding: '2px 8px', borderRadius: 8,
                    background: isAlerting ? 'var(--status-error)' : (isOnline ? 'rgba(16, 185, 129, 0.12)' : 'rgba(0,0,0,0.05)'),
                    color: isAlerting ? '#ffffff' : (isOnline ? '#10b981' : 'var(--text-muted)'),
                    border: isAlerting ? 'none' : `1px solid ${isOnline ? '#10b981' : 'var(--border-subtle)'}`
                  }}>
                    {isAlerting ? '🚨 SOS ALERT' : (isOnline ? 'ONLINE' : 'STANDBY')}
                  </span>
                </div>
                <div style={{ fontSize: '0.78rem', color: 'var(--text-muted)' }}>
                  {node.type} • {node.freq} ({node.sf})
                </div>
              </div>
            );
          })}
        </div>
      </div>

    </div>
  );
};

export default SosAlert;
