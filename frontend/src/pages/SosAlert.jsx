import React, { useState, useEffect, useRef } from 'react';
import { 
  AlertTriangle, MessageSquare, Send, Radio, Wifi, Clock, Cpu, Battery, 
  ShieldAlert, RefreshCw, Zap, CheckCircle2, Server
} from 'lucide-react';
import { API_BASE_URL } from '../config';
import { io } from 'socket.io-client';

const REGISTERED_NODES = [
  { id: 101, name: 'Walkie Alpha (Nano)', type: 'Hardware Walkie-Talkie', freq: '433 MHz', sf: 'SF10', status: 'Active' },
  { id: 102, name: 'Walkie Bravo (Nano)', type: 'Hardware Walkie-Talkie', freq: '433 MHz', sf: 'SF10', status: 'Active' },
  { id: 103, name: 'Walkie Charlie (ESP8266)', type: 'Hardware Walkie-Talkie', freq: '433 MHz', sf: 'SF10', status: 'Active' },
  { id: 0, name: 'Base Station (Gateway)', type: 'ESP LoRa Gateway', freq: '433 MHz / Wi-Fi', sf: 'SF10', status: 'Gateway Base' }
];

const SosAlert = () => {
  const [meshMessages, setMeshMessages] = useState([]);
  const [outgoingText, setOutgoingText] = useState('');
  const [targetNode, setTargetNode] = useState(0); // 0 = Broadcast
  const [isSending, setIsSending] = useState(false);
  const [activeSosAlert, setActiveSosAlert] = useState(null);
  const [isConnected, setIsConnected] = useState(true);

  const chatEndRef = useRef(null);

  // Load message history on mount
  useEffect(() => {
    fetch(`${API_BASE_URL}/devices/messages/history`)
      .then(res => res.json())
      .then(data => {
        if (data.messages && Array.isArray(data.messages)) {
          setMeshMessages(data.messages);

          // Check if latest message is an active SOS
          const latestSos = data.messages.find(m => m.alert_level > 0 || m.message_type === 'sos');
          if (latestSos) {
            setActiveSosAlert(latestSos);
          }
        }
      })
      .catch(err => console.warn('Failed to fetch mesh message history:', err));
  }, []);

  // Socket IO Live LoRa Mesh Stream
  useEffect(() => {
    const socket = io(API_BASE_URL.replace(/\/api$/, ''));

    socket.on('connect', () => {
      setIsConnected(true);
      console.log('[SosAlert] Connected to live LoRa Mesh messaging socket stream');
    });

    socket.on('disconnect', () => {
      setIsConnected(false);
    });

    const handleIncomingMeshMessage = (msg) => {
      setMeshMessages(prev => {
        if (prev.some(m => m._id === msg._id)) return prev;
        return [...prev, msg].slice(-80);
      });

      if (msg.alert_level > 0 || msg.message_type === 'sos') {
        setActiveSosAlert(msg);
      }
    };

    socket.on('new_mesh_message', handleIncomingMeshMessage);

    return () => {
      socket.disconnect();
    };
  }, []);

  useEffect(() => {
    if (chatEndRef.current) {
      chatEndRef.current.scrollIntoView({ behavior: 'smooth' });
    }
  }, [meshMessages]);

  const handleSendMessage = async (isSos = false) => {
    if (!outgoingText.trim() && !isSos) return;
    setIsSending(true);

    try {
      const res = await fetch(`${API_BASE_URL}/devices/send-message`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          target_node: targetNode,
          text: outgoingText.trim() || 'CRITICAL EMERGENCY SOS BROADCAST FROM BASE STATION!',
          alert_level: isSos ? 2 : 0,
          gateway_id: 'esp_gateway_node_01'
        })
      });
      const data = await res.json();
      if (data.status === 'success') {
        setOutgoingText('');
      }
    } catch (err) {
      console.error('Error sending message to LoRa Mesh outbox:', err);
    } finally {
      setIsSending(false);
    }
  };

  return (
    <div style={{ maxWidth: '1200px', margin: '0 auto', display: 'flex', flexDirection: 'column', gap: 'var(--space-6)' }}>
      
      {/* 1. Header */}
      <div className="responsive-page-header">
        <div>
          <h1 style={{ fontSize: '1.75rem', fontWeight: '700', color: 'var(--text-main)', margin: '0 0 var(--space-2) 0', display: 'flex', alignItems: 'center', gap: 'var(--space-3)', flexWrap: 'wrap' }}>
            <AlertTriangle size={30} style={{ color: 'var(--status-error)', flexShrink: 0 }} />
            <span>Emergency SOS & LoRa Mesh Base Station</span>
          </h1>
          <p style={{ color: 'var(--text-dim)', margin: 0, fontSize: '0.95rem' }}>
            Two-Way 433MHz LoRa Mesh Communicator & Hardware Walkie-Talkie OLED Relay • Gateway ID: <code style={{ color: 'var(--text-main)', background: 'var(--bg-app)', padding: '2px 8px', borderRadius: 6, border: '1px solid var(--border-subtle)' }}>esp_gateway_node_01</code>
          </p>
        </div>
        <div style={{ display: 'flex', alignItems: 'center', gap: 10 }}>
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

      {/* 2. Active Emergency SOS Alert Banner */}
      {activeSosAlert ? (
        <div className="card" style={{
          padding: '18px 24px',
          background: 'var(--status-error-bg)',
          border: '2px solid var(--status-error)',
          borderRadius: 18,
          boxShadow: '0 8px 25px rgba(225, 29, 72, 0.25)',
          display: 'flex',
          alignItems: 'center',
          justifyContent: 'space-between',
          flexWrap: 'wrap',
          gap: 16
        }}>
          <div style={{ display: 'flex', alignItems: 'center', gap: 16 }}>
            <div style={{
              width: 48, height: 48, borderRadius: '50%', background: 'var(--status-error)',
              color: '#ffffff', display: 'flex', alignItems: 'center', justifyContent: 'center',
              boxShadow: '0 0 15px rgba(225, 29, 72, 0.6)'
            }}>
              <ShieldAlert size={26} />
            </div>
            <div>
              <div style={{ fontSize: '1.1rem', fontWeight: 900, color: 'var(--status-error)', letterSpacing: '0.5px' }}>
                🚨 ACTIVE EMERGENCY SOS BROADCAST DETECTED ON MESH
              </div>
              <div style={{ fontSize: '0.95rem', fontWeight: 700, color: 'var(--text-main)', marginTop: 2 }}>
                "{activeSosAlert.text || activeSosAlert.text_msg}" — <span style={{ color: 'var(--status-error)' }}>From Node #{activeSosAlert.origin_node || activeSosAlert.mesh_origin_node || 'Unknown'}</span>
              </div>
              <div style={{ fontSize: '0.78rem', color: 'var(--text-muted)', marginTop: 4 }}>
                Received at: {new Date(activeSosAlert.timestamp || Date.now()).toLocaleString()} | RSSI: {activeSosAlert.rssi || '-'} dBm | SNR: {activeSosAlert.snr || '-'} dB
              </div>
            </div>
          </div>

          <button
            onClick={() => setActiveSosAlert(null)}
            className="btn btn-secondary"
            style={{ borderRadius: 10, fontSize: '0.82rem', padding: '6px 14px' }}
          >
            Dismiss Alert
          </button>
        </div>
      ) : (
        <div className="card" style={{
          padding: '14px 20px',
          background: 'var(--bg-surface)',
          border: '1px solid var(--border-strong)',
          borderRadius: 14,
          display: 'flex',
          alignItems: 'center',
          justifyContent: 'space-between',
          flexWrap: 'wrap',
          gap: 12
        }}>
          <div style={{ display: 'flex', alignItems: 'center', gap: 10 }}>
            <CheckCircle2 size={18} style={{ color: '#10b981' }} />
            <span style={{ fontWeight: 700, fontSize: '0.9rem', color: 'var(--text-main)' }}>
              LORA MESH SYSTEM ALL CLEAR — NO ACTIVE EMERGENCY ALERTS
            </span>
          </div>
          <span style={{ fontSize: '0.8rem', color: 'var(--text-muted)' }}>
            Radio Freq: 433 MHz SF10 • Max TTL Hops: 8 • SyncWord: 0x12
          </span>
        </div>
      )}

      {/* 3. TWO-WAY LORA MESH WALKIE-TALKIE CHAT CONSOLE */}
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
            <MessageSquare size={22} style={{ color: 'var(--action-primary)' }} /> Two-Way LoRa Mesh Text & SOS Communicator
          </div>
          <span style={{ fontSize: '0.8rem', color: 'var(--text-muted)', background: 'var(--bg-app)', padding: '4px 12px', borderRadius: 12, border: '1px solid var(--border-subtle)', fontWeight: 500 }}>
            Active Hardware Walkies: Node #101 (Alpha), #102 (Bravo), #103 (Charlie)
          </span>
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
                    <span style={{ color: 'var(--text-muted)' }}>{new Date(msg.timestamp || Date.now()).toLocaleTimeString([], { hour: '2-digit', minute: '2-digit', second: '2-digit' })}</span>
                  </div>
                  
                  <div style={{ fontSize: '1rem', fontWeight: 600, wordBreak: 'break-word', color: isSos ? 'var(--status-error)' : 'var(--text-main)' }}>
                    {isSos && <span style={{ fontWeight: 900, marginRight: 6 }}>🚨 EMERGENCY SOS:</span>}
                    {msg.text || msg.text_msg}
                  </div>

                  {!isDownlink && (
                    <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'flex-end', gap: 12, fontSize: '0.72rem', color: 'var(--text-muted)', marginTop: 6 }}>
                      {msg.rssi && <span>RSSI: {msg.rssi} dBm</span>}
                      {msg.snr && <span>SNR: {msg.snr} dB</span>}
                      {msg.hops_left && <span>Hops Left: {msg.hops_left}</span>}
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
              outline: 'none'
            }}
          >
            <option value={0}>📢 Broadcast (All Walkie Nodes)</option>
            <option value={101}>📻 Node #101 (Walkie Alpha)</option>
            <option value={102}>📻 Node #102 (Walkie Bravo)</option>
            <option value={103}>📻 Node #103 (ESP Walkie Charlie)</option>
          </select>

          <input
            type="text"
            placeholder="Type message to send to hardware Walkie-Talkie OLED displays..."
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

      {/* 4. LoRa Mesh Hardware Nodes Status Grid */}
      <div className="card" style={{ padding: 'var(--space-6)', background: 'var(--bg-surface)', border: '1px solid var(--border-strong)', borderRadius: 20 }}>
        <h3 style={{ fontSize: '1.1rem', fontWeight: 700, color: 'var(--text-main)', margin: '0 0 var(--space-4) 0', display: 'flex', alignItems: 'center', gap: 8 }}>
          <Cpu size={20} style={{ color: 'var(--action-primary)' }} />
          Hardware LoRa Mesh Network Nodes Status
        </h3>

        <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(250px, 1fr))', gap: 14 }}>
          {REGISTERED_NODES.map(node => (
            <div key={node.id} style={{
              padding: 16,
              background: 'var(--bg-app)',
              border: '1px solid var(--border-subtle)',
              borderRadius: 14,
              display: 'flex',
              flexDirection: 'column',
              gap: 6
            }}>
              <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between' }}>
                <span style={{ fontWeight: 800, fontSize: '0.95rem', color: 'var(--text-main)' }}>
                  {node.name}
                </span>
                <span style={{
                  fontSize: '0.7rem', fontWeight: 700, padding: '2px 8px', borderRadius: 8,
                  background: node.id === 0 ? 'var(--accent-light)' : 'rgba(16, 185, 129, 0.12)',
                  color: node.id === 0 ? 'var(--action-primary)' : '#10b981',
                  border: `1px solid ${node.id === 0 ? 'var(--border-focus)' : '#10b981'}`
                }}>
                  {node.status}
                </span>
              </div>
              <div style={{ fontSize: '0.8rem', color: 'var(--text-muted)' }}>
                {node.type} • {node.freq} ({node.sf})
              </div>
            </div>
          ))}
        </div>
      </div>

    </div>
  );
};

export default SosAlert;
