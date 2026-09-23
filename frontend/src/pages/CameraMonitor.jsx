import React, { useState, useEffect, useRef } from 'react';
import { Camera, Video, Flashlight, RefreshCw, Radio, Maximize2, Download, Plus, CheckCircle, AlertCircle, Wifi, Monitor, Play, Pause, Upload, FileVideo, HardDrive } from 'lucide-react';
import { API_BASE_URL } from '../config';
import { io } from 'socket.io-client';

const CameraMonitor = () => {
  const [cameras, setCameras] = useState([
    {
      id: 'flap-esp32-cam-001',
      name: 'Gate 1 Surveillance ESP32-CAM',
      location: 'Clinic Front Gate',
      ip: '192.168.1.83',
      cloudStreamUrl: `${API_BASE_URL}/v1/devices/flap-esp32-cam-001/camera/stream`,
      localStreamUrl: 'http://192.168.1.83:81/stream',
      useCloudStream: true,
      status: 'online',
      flashOn: false,
      resolution: 'VGA (640x480)',
      isStreaming: true,
      lastSeen: new Date().toLocaleTimeString()
    }
  ]);

  const [liveFrameMap, setLiveFrameMap] = useState({});
  const [snapshots, setSnapshots] = useState([]);
  const [uploadedVideos, setUploadedVideos] = useState([]);
  const [showAddModal, setShowAddModal] = useState(false);
  const fileInputRef = useRef(null);

  // Form state for adding custom camera
  const [newCam, setNewCam] = useState({
    name: '',
    location: '',
    ip: '',
    streamUrl: ''
  });

  useEffect(() => {
    // Fetch registered camera devices from backend
    const token = localStorage.getItem('token');
    fetch(`${API_BASE_URL}/v1/devices`, {
      headers: { Authorization: `Bearer ${token}` }
    })
      .then(res => res.json())
      .then(data => {
        if (data.devices) {
          const camDevices = data.devices.filter(d => d.device_type === 'esp32_cam_v1');
          if (camDevices.length > 0) {
            setCameras(prev => {
              const updated = [...prev];
              camDevices.forEach(cd => {
                if (!updated.some(c => c.id === cd.device_id)) {
                  const ip = cd.last_telemetry?.ip_address || '192.168.1.120';
                  updated.push({
                    id: cd.device_id,
                    name: cd.name || `ESP32-CAM (${cd.device_id})`,
                    location: cd.location || 'Main Gate',
                    ip: ip,
                    cloudStreamUrl: `${API_BASE_URL}/v1/devices/${cd.device_id}/camera/stream`,
                    localStreamUrl: cd.last_telemetry?.stream_url || `http://${ip}:81/stream`,
                    useCloudStream: true,
                    status: cd.status || 'online',
                    flashOn: false,
                    resolution: 'VGA (640x480)',
                    isStreaming: true,
                    lastSeen: new Date(cd.last_seen || Date.now()).toLocaleTimeString()
                  });
                }
              });
              return updated;
            });
          }
        }
      })
      .catch(err => console.warn('Could not fetch registered cameras:', err.message));

    // Connect to Socket.io for live camera status & direct frame uploads
    const socket = io(API_BASE_URL.replace(/\/api$/, ''));

    socket.on('new_camera_frame', (frameData) => {
      const { device_id, image_base64 } = frameData;
      setLiveFrameMap(prev => ({
        ...prev,
        [device_id]: image_base64
      }));
    });

    socket.on('new_camera_reading', (reading) => {
      const payload = reading.payload || {};
      const devId = reading.device_id;
      setCameras(prev => prev.map(c => {
        if (c.id === devId) {
          return {
            ...c,
            ip: payload.ip_address || c.ip,
            status: payload.status || 'online',
            lastSeen: new Date().toLocaleTimeString()
          };
        }
        return c;
      }));
    });

    socket.on('camera_control_updated', (data) => {
      const { device_id, variable, val } = data;
      if (variable === 'flash' || variable === 'led' || variable === 'led_intensity') {
        setCameras(prev => prev.map(c => c.id === device_id ? { ...c, flashOn: val > 0 } : c));
      }
    });

    return () => socket.disconnect();
  }, []);

  const toggleStream = (camId) => {
    setCameras(prev => prev.map(c => c.id === camId ? { ...c, isStreaming: !c.isStreaming } : c));
  };

  const toggleStreamSource = (camId) => {
    setCameras(prev => prev.map(c => c.id === camId ? { ...c, useCloudStream: !c.useCloudStream } : c));
  };

  const toggleFlash = (cam) => {
    const nextState = !cam.flashOn;
    const val = nextState ? 1 : 0;
    setCameras(prev => prev.map(c => c.id === cam.id ? { ...c, flashOn: nextState } : c));

    // 1. Call Backend API Control Endpoint
    const token = localStorage.getItem('token');
    fetch(`${API_BASE_URL}/v1/devices/${cam.id}/control`, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        Authorization: `Bearer ${token}`
      },
      body: JSON.stringify({ variable: 'flash', val })
    }).catch(err => console.warn('Backend camera control error:', err.message));

    // 2. Direct local IP HTTP fetch fallback if available
    if (cam.ip) {
      fetch(`http://${cam.ip}/control?var=flash&val=${val}`, { mode: 'no-cors' }).catch(() => {});
      fetch(`http://${cam.ip}/control?var=led_intensity&val=${val ? 255 : 0}`, { mode: 'no-cors' }).catch(() => {});
    }
  };

  const takeSnapshot = (cam) => {
    const timestamp = new Date();
    const snapUrl = liveFrameMap[cam.id] || `${API_BASE_URL}/v1/devices/${cam.id}/camera/snapshot`;
    const snapObj = {
      id: Math.random().toString(),
      camName: cam.name,
      camId: cam.id,
      url: snapUrl,
      timestamp: timestamp.toLocaleString()
    };
    setSnapshots(prev => [snapObj, ...prev]);
  };

  // Direct Video & Image File Upload Handler
  const handleFileUpload = (e) => {
    const files = Array.from(e.target.files);
    files.forEach(file => {
      const fileUrl = URL.createObjectURL(file);
      const isVideo = file.type.startsWith('video/');
      const item = {
        id: Math.random().toString(),
        name: file.name,
        size: (file.size / (1024 * 1024)).toFixed(2) + ' MB',
        type: file.type,
        isVideo,
        url: fileUrl,
        uploadedAt: new Date().toLocaleString()
      };

      setUploadedVideos(prev => [item, ...prev]);

      // Post Base64 frame to backend if it's an image file
      if (!isVideo) {
        const reader = new FileReader();
        reader.onload = function (event) {
          fetch(`${API_BASE_URL}/v1/devices/camera/upload`, {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({
              device_id: 'flap-esp32-cam-001',
              image_base64: event.target.result
            })
          }).catch(err => console.warn('Direct image upload posted to server:', err.message));
        };
        reader.readAsDataURL(file);
      }
    });
  };

  const handleAddCameraSubmit = (e) => {
    e.preventDefault();
    if (!newCam.name || !newCam.streamUrl) return;

    const camObj = {
      id: `cam_${Date.now()}`,
      name: newCam.name,
      location: newCam.location || 'Custom View',
      ip: newCam.ip || 'Local Stream',
      cloudStreamUrl: newCam.streamUrl,
      localStreamUrl: newCam.streamUrl,
      useCloudStream: true,
      status: 'online',
      flashOn: false,
      resolution: 'Auto',
      isStreaming: true,
      lastSeen: new Date().toLocaleTimeString()
    };

    setCameras(prev => [...prev, camObj]);
    setNewCam({ name: '', location: '', ip: '', streamUrl: '' });
    setShowAddModal(false);
  };

  return (
    <div style={{ maxWidth: '1200px', margin: '0 auto', display: 'flex', flexDirection: 'column', gap: 'var(--space-6)' }}>

      {/* Page Header */}
      <div className="responsive-page-header">
        <div>
          <h1 style={{ fontSize: '1.75rem', fontWeight: 700, color: 'var(--text-main)', margin: '0 0 var(--space-2) 0', display: 'flex', alignItems: 'center', gap: 'var(--space-3)', flexWrap: 'wrap' }}>
            <Video size={30} style={{ color: '#38bdf8', flexShrink: 0 }} />
            <span>ESP32-CAM Live Surveillance</span>
          </h1>
          <p style={{ color: 'var(--text-dim)', margin: 0, fontSize: '0.95rem' }}>
            Direct Microcontroller Ingestion • Cloud Proxy Stream • Media Files
          </p>
        </div>

        <div style={{ display: 'flex', alignItems: 'center', gap: 10, flexWrap: 'wrap' }}>
          <input
            type="file"
            ref={fileInputRef}
            onChange={handleFileUpload}
            accept="image/*,video/*"
            multiple
            style={{ display: 'none' }}
          />

          <button
            onClick={() => fileInputRef.current?.click()}
            className="btn btn-secondary"
            style={{ display: 'flex', alignItems: 'center', gap: 8 }}
          >
            <Upload size={16} /> Upload Media
          </button>

          <button
            onClick={() => setShowAddModal(true)}
            className="btn btn-primary"
            style={{ display: 'flex', alignItems: 'center', gap: 8 }}
          >
            <Plus size={16} /> Add Feed
          </button>
        </div>
      </div>

      {/* Live Video Feeds Grid */}
      <div className="responsive-grid-cards">
        {cameras.map(cam => {
          const liveBase64 = liveFrameMap[cam.id];
          const activeStreamUrl = cam.useCloudStream ? cam.cloudStreamUrl : cam.localStreamUrl;

          return (
            <div key={cam.id} className="card" style={{
              padding: 0,
              overflow: 'hidden',
              background: 'var(--bg-surface)',
              border: '1px solid var(--border-strong)',
              borderRadius: 20,
              boxShadow: '0 15px 35px rgba(0,0,0,0.4)',
              display: 'flex',
              flexDirection: 'column'
            }}>

              {/* Card Header */}
              <div style={{
                padding: '14px 20px',
                background: 'rgba(15, 22, 38, 0.8)',
                borderBottom: '1px solid var(--border-subtle)',
                display: 'flex',
                alignItems: 'center',
                justifyContent: 'space-between'
              }}>
                <div>
                  <div style={{ fontSize: '1.05rem', fontWeight: 700, color: 'var(--text-main)' }}>
                    {cam.name}
                  </div>
                  <div style={{ fontSize: '0.8rem', color: 'var(--text-muted)', display: 'flex', alignItems: 'center', gap: 8, marginTop: 2 }}>
                    <span>Location: {cam.location}</span> • <code>{cam.ip}</code>
                  </div>
                </div>

                <div style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
                  <button
                    onClick={() => toggleStreamSource(cam.id)}
                    className="btn btn-secondary"
                    style={{ fontSize: '0.72rem', padding: '4px 8px' }}
                    title="Switch between FlapMain Cloud Proxy Stream and Local IP Stream"
                  >
                    {cam.useCloudStream ? '🌐 CLOUD STREAM' : '🏠 LOCAL IP STREAM'}
                  </button>

                  <div style={{
                    padding: '4px 10px',
                    borderRadius: 20,
                    fontSize: '0.75rem',
                    fontWeight: 700,
                    background: cam.status === 'online' ? 'rgba(16, 185, 129, 0.15)' : 'rgba(244, 63, 94, 0.15)',
                    color: cam.status === 'online' ? '#10b981' : '#f43f5e',
                    border: `1px solid ${cam.status === 'online' ? 'rgba(16, 185, 129, 0.3)' : 'rgba(244, 63, 94, 0.3)'}`,
                    display: 'flex',
                    alignItems: 'center',
                    gap: 6
                  }}>
                    <div style={{ width: 6, height: 6, borderRadius: '50%', background: cam.status === 'online' ? '#10b981' : '#f43f5e' }} />
                    {cam.status === 'online' ? 'LIVE' : 'OFFLINE'}
                  </div>
                </div>
              </div>

              {/* Video Stream Container */}
              <div style={{
                width: '100%',
                height: 320,
                background: '#090d16',
                position: 'relative',
                display: 'flex',
                alignItems: 'center',
                justifyContent: 'center',
                overflow: 'hidden'
              }}>
                {cam.isStreaming ? (
                  liveBase64 ? (
                    <img
                      src={liveBase64}
                      alt={cam.name}
                      style={{ width: '100%', height: '100%', objectFit: 'cover' }}
                    />
                  ) : (
                    <img
                      src={activeStreamUrl}
                      alt={cam.name}
                      style={{ width: '100%', height: '100%', objectFit: 'cover' }}
                      onError={(e) => {
                        e.target.onerror = null;
                        e.target.style.display = 'none';
                        const parent = e.target.parentNode;
                        if (parent && !parent.querySelector('.fallback-msg')) {
                          const msg = document.createElement('div');
                          msg.className = 'fallback-msg';
                          msg.style.color = 'var(--text-muted)';
                          msg.style.textAlign = 'center';
                          msg.style.padding = '20px';
                          msg.innerHTML = '<div style="font-size: 2.2rem; margin-bottom: 8px;">📷</div><div style="font-weight: 700; color: #fff;">Direct Cloud Stream Active</div><div style="font-size: 0.8rem; opacity: 0.7; margin-top: 4px;">ESP32-CAM POSTing frames to FlapMain Cloud...</div>';
                          parent.appendChild(msg);
                        }
                      }}
                    />
                  )
                ) : (
                  <div style={{ textAlign: 'center', color: 'var(--text-muted)' }}>
                    <Pause size={48} style={{ opacity: 0.4, marginBottom: 8 }} />
                    <div style={{ fontWeight: 700 }}>Stream Paused</div>
                    <div style={{ fontSize: '0.8rem', opacity: 0.7 }}>Click Play to Resume</div>
                  </div>
                )}

                {/* Overlaid REC Badge */}
                {cam.isStreaming && (
                  <div style={{
                    position: 'absolute',
                    top: 14,
                    left: 14,
                    background: 'rgba(0,0,0,0.65)',
                    backdropFilter: 'blur(4px)',
                    padding: '4px 10px',
                    borderRadius: 6,
                    color: '#ef4444',
                    fontSize: '0.75rem',
                    fontWeight: 800,
                    letterSpacing: '1px',
                    display: 'flex',
                    alignItems: 'center',
                    gap: 6
                  }}>
                    <div style={{ width: 8, height: 8, borderRadius: '50%', background: '#ef4444', animation: 'pulse 1.5s infinite' }} />
                    {cam.useCloudStream ? 'FLAPMAIN CLOUD STREAM' : 'LOCAL IP STREAM'}
                  </div>
                )}
              </div>

              {/* Bottom Controls Bar */}
              <div style={{
                padding: '14px 20px',
                background: 'var(--bg-surface-elevated)',
                borderTop: '1px solid var(--border-subtle)',
                display: 'flex',
                alignItems: 'center',
                justifyContent: 'space-between',
                flexWrap: 'wrap',
                gap: 10
              }}>
                <div style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
                  <button
                    onClick={() => toggleStream(cam.id)}
                    className="btn btn-secondary"
                    title={cam.isStreaming ? 'Pause Stream' : 'Play Stream'}
                    style={{ padding: '6px 12px', fontSize: '0.82rem' }}
                  >
                    {cam.isStreaming ? <><Pause size={14} /> Pause</> : <><Play size={14} /> Play</>}
                  </button>

                  <button
                    onClick={() => takeSnapshot(cam)}
                    className="btn btn-secondary"
                    title="Capture Snapshot"
                    style={{ padding: '6px 12px', fontSize: '0.82rem' }}
                  >
                    <Camera size={14} /> Snapshot
                  </button>

                  <button
                    onClick={() => toggleFlash(cam)}
                    className={`btn ${cam.flashOn ? 'btn-primary' : 'btn-secondary'}`}
                    title="Toggle Flash LED"
                    style={{ padding: '6px 12px', fontSize: '0.82rem' }}
                  >
                    <Flashlight size={14} /> {cam.flashOn ? 'Flash ON' : 'Flash OFF'}
                  </button>
                </div>

                <div style={{ fontSize: '0.8rem', color: 'var(--text-muted)' }}>
                  Resolution: <span style={{ color: 'var(--text-main)', fontWeight: 600 }}>{cam.resolution}</span>
                </div>
              </div>

            </div>
          );
        })}
      </div>

      {/* Uploaded Video Files Section */}
      {uploadedVideos.length > 0 && (
        <div className="card" style={{ padding: 'var(--space-6)', background: 'var(--bg-surface)', border: '1px solid var(--border-strong)', borderRadius: 20 }}>
          <h3 style={{ fontSize: '1.1rem', fontWeight: 700, color: 'var(--text-main)', margin: '0 0 var(--space-4) 0', display: 'flex', alignItems: 'center', gap: 8 }}>
            <FileVideo size={20} style={{ color: '#00ffaa' }} />
            Uploaded Video & Media Files ({uploadedVideos.length} Files Available)
          </h3>

          <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fill, minmax(320px, 1fr))', gap: 16 }}>
            {uploadedVideos.map(media => (
              <div key={media.id} style={{
                background: 'var(--bg-surface-elevated)',
                border: '1px solid var(--border-strong)',
                borderRadius: 14,
                overflow: 'hidden'
              }}>
                {media.isVideo ? (
                  <video
                    src={media.url}
                    controls
                    style={{ width: '100%', height: 180, objectFit: 'cover', background: '#000' }}
                  />
                ) : (
                  <img
                    src={media.url}
                    alt={media.name}
                    style={{ width: '100%', height: 180, objectFit: 'cover', background: '#000' }}
                  />
                )}
                <div style={{ padding: 12 }}>
                  <div style={{ fontSize: '0.88rem', fontWeight: 700, color: 'var(--text-main)', whiteSpace: 'nowrap', overflow: 'hidden', textOverflow: 'ellipsis' }}>
                    {media.name}
                  </div>
                  <div style={{ fontSize: '0.75rem', color: 'var(--text-muted)', display: 'flex', justifyContent: 'space-between', marginTop: 4 }}>
                    <span>Size: {media.size}</span>
                    <span>{media.uploadedAt}</span>
                  </div>
                </div>
              </div>
            ))}
          </div>
        </div>
      )}

      {/* Captured Snapshot Gallery Section */}
      <div className="card" style={{ padding: 'var(--space-6)', background: 'var(--bg-surface)', border: '1px solid var(--border-strong)', borderRadius: 20 }}>
        <h3 style={{ fontSize: '1.1rem', fontWeight: 700, color: 'var(--text-main)', margin: '0 0 var(--space-4) 0', display: 'flex', alignItems: 'center', gap: 8 }}>
          <Camera size={20} className="text-primary" />
          Operator Snapshot Capture Log ({snapshots.length} Images Saved)
        </h3>

        {snapshots.length === 0 ? (
          <div style={{ textAlign: 'center', padding: '30px 20px', color: 'var(--text-muted)', border: '1px dashed var(--border-strong)', borderRadius: 12 }}>
            <Camera size={36} style={{ opacity: 0.3, marginBottom: 8 }} />
            <div>No snapshots captured in this session.</div>
            <div style={{ fontSize: '0.8rem', opacity: 0.7, marginTop: 4 }}>Click "Snapshot" on any camera card above to grab high-res stills.</div>
          </div>
        ) : (
          <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fill, minmax(220px, 1fr))', gap: 16 }}>
            {snapshots.map(snap => (
              <div key={snap.id} style={{
                background: 'var(--bg-surface-elevated)',
                border: '1px solid var(--border-strong)',
                borderRadius: 12,
                overflow: 'hidden'
              }}>
                <div style={{ height: 130, background: '#000', overflow: 'hidden', position: 'relative' }}>
                  <img
                    src={snap.url}
                    alt={snap.camName}
                    style={{ width: '100%', height: '100%', objectFit: 'cover' }}
                    onError={(e) => {
                      e.target.style.display = 'none';
                      e.target.parentNode.innerHTML = '<div style="display:flex;height:100%;align-items:center;justify-content:center;color:#64748b;font-size:0.8rem;">Snapshot Captured</div>';
                    }}
                  />
                </div>
                <div style={{ padding: 10 }}>
                  <div style={{ fontSize: '0.82rem', fontWeight: 700, color: 'var(--text-main)', whiteSpace: 'nowrap', overflow: 'hidden', textOverflow: 'ellipsis' }}>
                    {snap.camName}
                  </div>
                  <div style={{ fontSize: '0.72rem', color: 'var(--text-muted)', marginTop: 2 }}>
                    {snap.timestamp}
                  </div>
                </div>
              </div>
            ))}
          </div>
        )}
      </div>

      {/* Add Camera Modal */}
      {showAddModal && (
        <div style={{
          position: 'fixed', top: 0, left: 0, right: 0, bottom: 0,
          background: 'rgba(0,0,0,0.75)', backdropFilter: 'blur(5px)',
          display: 'flex', alignItems: 'center', justifyContent: 'center', zIndex: 1000
        }}>
          <div className="card" style={{ width: 440, padding: 24, background: 'var(--bg-surface)', border: '1px solid var(--border-strong)', borderRadius: 20 }}>
            <h3 style={{ margin: '0 0 16px 0', fontSize: '1.2rem', color: 'var(--text-main)' }}>Register New Camera Feed</h3>
            <form onSubmit={handleAddCameraSubmit} style={{ display: 'flex', flexDirection: 'column', gap: 14 }}>
              <div>
                <label className="form-label">Camera Name</label>
                <input
                  type="text"
                  className="form-input"
                  placeholder="e.g. Back Entrance ESP32-CAM"
                  value={newCam.name}
                  onChange={e => setNewCam({ ...newCam, name: e.target.value })}
                  required
                />
              </div>
              <div>
                <label className="form-label">Location / Zone</label>
                <input
                  type="text"
                  className="form-input"
                  placeholder="e.g. Warehouse Bay 2"
                  value={newCam.location}
                  onChange={e => setNewCam({ ...newCam, location: e.target.value })}
                />
              </div>
              <div>
                <label className="form-label">ESP32-CAM IP Address</label>
                <input
                  type="text"
                  className="form-input"
                  placeholder="e.g. 192.168.1.145"
                  value={newCam.ip}
                  onChange={e => setNewCam({ ...newCam, ip: e.target.value })}
                />
              </div>
              <div>
                <label className="form-label">MJPEG Stream URL</label>
                <input
                  type="url"
                  className="form-input"
                  placeholder="e.g. http://192.168.1.145:81/stream or FlapMain cloud URL"
                  value={newCam.streamUrl}
                  onChange={e => setNewCam({ ...newCam, streamUrl: e.target.value })}
                  required
                />
              </div>
              <div style={{ display: 'flex', gap: 10, justifyContent: 'flex-end', marginTop: 10 }}>
                <button type="button" onClick={() => setShowAddModal(false)} className="btn btn-secondary">Cancel</button>
                <button type="submit" className="btn btn-primary">Add Camera</button>
              </div>
            </form>
          </div>
        </div>
      )}

    </div>
  );
};

export default CameraMonitor;
