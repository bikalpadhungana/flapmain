import React, { useState, useEffect, useRef } from 'react';
import { 
  CloudSun, Wind, Thermometer, Droplets, Gauge, Compass, Sun, Radio, RefreshCw, 
  Wifi, Activity, Clock, Flame, Battery, ShieldAlert, Cpu, BarChart2, AlertTriangle, ArrowRight,
  Layers, CheckCircle2, AlertCircle, Signal
} from 'lucide-react';
import { Link } from 'react-router-dom';
import { API_BASE_URL } from '../config';
import { io } from 'socket.io-client';
import { LineChart, Line, XAxis, YAxis, CartesianGrid, Tooltip, ResponsiveContainer, Legend } from 'recharts';

const DIRECTION_ANGLES = {
  'North': 0, 'N': 0,
  'NE': 45, 'NorthEast': 45,
  'East': 90, 'E': 90,
  'SE': 135, 'SouthEast': 135,
  'South': 180, 'S': 180,
  'SW': 225, 'SouthWest': 225,
  'West': 270, 'W': 270,
  'NW': 315, 'NorthWest': 315,
  'None': 0, 'CALM': 0
};

const TIME_RANGES = [
  { id: 'live', label: '⚡ Live' },
  { id: '3h', label: '⏱️ 3 Hours' },
  { id: '6h', label: '⏱️ 6 Hours' },
  { id: '12h', label: '⏱️ 12 Hours' },
  { id: '24h', label: '📅 1 Day' },
  { id: '7d', label: '📅 7 Days' },
  { id: '30d', label: '🗓️ 1 Month' }
];

const METRIC_VIEWS = [
  { id: 'all', label: '📊 All Sensors' },
  { id: 'temp_hum', label: '🌡️ Temp & Humidity' },
  { id: 'wind_press', label: '💨 Wind & Pressure' },
  { id: 'mq9', label: '🔥 MQ-9 Gas' },
  { id: 'batt_light', label: '🔋 Battery & Light' }
];

const createInitialNode = (nodeId = 1) => ({
  nodeId: Number(nodeId),
  deviceId: Number(nodeId) === 1 ? 'flap-flap-aws-001-7zhj' : `flap-flap-aws-${String(nodeId).padStart(3, '0')}-node`,
  displayName: Number(nodeId) === 1 ? 'AWS Node #1 (Primary)' : `AWS Node #${nodeId} (Station ${nodeId})`,
  windSpeed: 0.0,
  windDirection: 'None',
  temperature: null,
  humidity: null,
  pressure: null,
  altitude: null,
  light: null,
  mq9Gas: null,
  mq3Gas: null,
  batteryMv: null,
  meshOriginNode: Number(nodeId),
  meshHopsLeft: null,
  alertLevel: 0,
  snr: null,
  time: null,
  apBssid: null,
  rssi: null,
  lastSeen: null,
  online: false
});

const WeatherMonitor = () => {
  const [isPolling, setIsPolling] = useState(true);
  const [chartData, setChartData] = useState([]);
  const [timeRange, setTimeRange] = useState('3h');
  const [chartMetricView, setChartMetricView] = useState('all');
  const [isLoadingHistory, setIsLoadingHistory] = useState(false);
  
  // Multi-Node Weather Telemetry State: { [nodeId]: nodeTelemetry }
  const [nodesMap, setNodesMap] = useState({ 1: createInitialNode(1) });
  // Selected Station: '1', '2', '3', etc., or 'all' for multi-station mesh matrix
  const [selectedStation, setSelectedStation] = useState('1');

  const timeoutRefs = useRef({});
  const DEVICE_TIMEOUT_MS = 65000;

  // Active Station Object to display in main gauges / compass
  const activeNodeId = selectedStation === 'all' ? 1 : Number(selectedStation);
  const weatherData = nodesMap[activeNodeId] || nodesMap[1] || createInitialNode(activeNodeId);

  // Check if any station on the mesh has an active SOS emergency alert
  const activeSosNode = Object.values(nodesMap).find(n => n.alertLevel > 0);

  // Fetch Historical Telemetry for Selected Station and Time Range
  useEffect(() => {
    if (timeRange === 'live') return;

    setIsLoadingHistory(true);
    let url = `${API_BASE_URL}/devices/telemetry/history?range=${timeRange}`;
    if (selectedStation !== 'all') {
      url += `&origin_node=${selectedStation}`;
    }

    fetch(url)
      .then(res => res.json())
      .then(data => {
        if (data.readings && Array.isArray(data.readings)) {
          setChartData(data.readings);

          // Auto-discover nodes found in the historical readings or activeNodes list
          setNodesMap(prev => {
            const updated = { ...prev };
            const discovered = data.activeNodes || [];

            discovered.forEach(id => {
              const numId = Number(id);
              if (!updated[numId]) {
                updated[numId] = createInitialNode(numId);
              }
            });

            // Populate the latest historical readings into nodes that haven't received live packets yet
            data.readings.forEach(r => {
              const rNode = r.originNode || 1;
              if (updated[rNode] && !updated[rNode].lastSeen) {
                updated[rNode] = {
                  ...updated[rNode],
                  deviceId: r.deviceId || updated[rNode].deviceId,
                  temperature: r.temp !== null ? r.temp : updated[rNode].temperature,
                  humidity: r.humidity !== null ? r.humidity : updated[rNode].humidity,
                  windSpeed: r.windSpeed !== null ? r.windSpeed : updated[rNode].windSpeed,
                  mq9Gas: r.mq9Gas !== null ? r.mq9Gas : updated[rNode].mq9Gas,
                  mq3Gas: r.mq3Gas !== null ? r.mq3Gas : updated[rNode].mq3Gas,
                  pressure: r.pressure !== null ? r.pressure : updated[rNode].pressure,
                  altitude: r.altitude !== null ? r.altitude : updated[rNode].altitude,
                  light: r.light !== null ? r.light : updated[rNode].light,
                  batteryMv: r.batteryMv !== null ? r.batteryMv : updated[rNode].batteryMv,
                  lastSeen: new Date(r.timestamp),
                  online: (Date.now() - new Date(r.timestamp).getTime()) < DEVICE_TIMEOUT_MS
                };
              }
            });

            return updated;
          });
        }
      })
      .catch(err => console.error('Failed to fetch telemetry history:', err))
      .finally(() => setIsLoadingHistory(false));
  }, [timeRange, selectedStation]);

  // Socket IO Live Telemetry Stream
  useEffect(() => {
    let socket;
    if (isPolling) {
      socket = io(API_BASE_URL.replace(/\/api$/, ''));

      socket.on('connect', () => {
        console.log('[WeatherMonitor] Connected to live weather telemetry stream');
      });

      const handleIncomingReading = (reading) => {
        const payload = reading.payload || {};
        const deviceId = reading.device_id;

        const hasWeather = payload.wind_speed !== undefined || payload.wind_direction !== undefined || payload.temperature !== undefined || payload.mq9_gas !== undefined || payload.mq3_gas !== undefined;
        if (!hasWeather) return;

        const originNode = payload.mesh_origin_node !== undefined ? Number(payload.mesh_origin_node) : 1;
        const ts = new Date(reading.timestamp || Date.now());
        const timeLabel = ts.toLocaleTimeString([], { hour: '2-digit', minute: '2-digit', second: '2-digit' });
        const gasVal = payload.mq9_gas !== undefined ? Number(payload.mq9_gas) : (payload.mq3_gas !== undefined ? Number(payload.mq3_gas) : null);

        // Update Multi-Station Map
        setNodesMap(prev => {
          const existing = prev[originNode] || createInitialNode(originNode);
          return {
            ...prev,
            [originNode]: {
              ...existing,
              deviceId: deviceId || existing.deviceId,
              windSpeed: payload.wind_speed !== undefined ? Number(payload.wind_speed) : 0.0,
              windDirection: payload.wind_direction || 'None',
              temperature: payload.temperature !== undefined ? Number(payload.temperature) : existing.temperature,
              humidity: payload.humidity !== undefined ? Number(payload.humidity) : existing.humidity,
              pressure: payload.pressure !== undefined ? Number(payload.pressure) : existing.pressure,
              altitude: payload.altitude !== undefined ? Number(payload.altitude) : (payload.pressure ? Number((44330 * (1 - Math.pow(payload.pressure / 101325, 0.1903))).toFixed(1)) : existing.altitude),
              light: payload.light !== undefined ? Number(payload.light) : existing.light,
              mq9Gas: gasVal,
              mq3Gas: gasVal,
              batteryMv: payload.battery_mv !== undefined ? Number(payload.battery_mv) : existing.batteryMv,
              meshOriginNode: originNode,
              meshHopsLeft: payload.mesh_hops_left !== undefined ? Number(payload.mesh_hops_left) : existing.meshHopsLeft,
              alertLevel: payload.alert_level !== undefined ? Number(payload.alert_level) : 0,
              snr: payload.snr !== undefined ? Number(payload.snr) : existing.snr,
              time: payload.time || timeLabel,
              apBssid: payload.ap_bssid || existing.apBssid,
              rssi: payload.rssi !== undefined ? Number(payload.rssi) : existing.rssi,
              lastSeen: ts,
              online: true
            }
          };
        });

        // Set per-node offline watchdog timer
        if (timeoutRefs.current[originNode]) clearTimeout(timeoutRefs.current[originNode]);
        timeoutRefs.current[originNode] = setTimeout(() => {
          setNodesMap(prev => {
            if (!prev[originNode]) return prev;
            return {
              ...prev,
              [originNode]: { ...prev[originNode], online: false }
            };
          });
        }, DEVICE_TIMEOUT_MS);

        // Update live chart stream if viewing this station or viewing 'all'
        if (timeRange === 'live') {
          if (selectedStation === 'all' || Number(selectedStation) === originNode) {
            setChartData(prev => {
              if (prev.some(r => r._id === reading._id)) return prev;
              const entry = {
                _id: reading._id || Math.random().toString(),
                timeLabel,
                originNode,
                temp: payload.temperature !== undefined ? Number(payload.temperature) : null,
                humidity: payload.humidity !== undefined ? Number(payload.humidity) : null,
                windSpeed: payload.wind_speed !== undefined ? Number(payload.wind_speed) : null,
                mq9Gas: gasVal,
                mq3Gas: gasVal,
                pressure: payload.pressure !== undefined ? Number(payload.pressure) : null,
                light: payload.light !== undefined ? Number(payload.light) : null,
                batteryMv: payload.battery_mv !== undefined ? Number(payload.battery_mv) : null,
              };
              return [...prev, entry].slice(-35);
            });
          }
        }
      };

      socket.on('new_weather_reading', handleIncomingReading);
      socket.on('new_telemetry', handleIncomingReading);
    }

    return () => {
      if (socket) socket.disconnect();
      Object.values(timeoutRefs.current).forEach(t => clearTimeout(t));
    };
  }, [isPolling, timeRange, selectedStation]);

  const dirAngle = DIRECTION_ANGLES[weatherData.windDirection] !== undefined ? DIRECTION_ANGLES[weatherData.windDirection] : 0;

  const getGasStatus = (val) => {
    if (val === null || val === undefined) return { label: 'Sensor Offline', color: 'var(--text-muted)', bg: 'rgba(255,255,255,0.05)' };
    if (val < 300) return { label: 'Clean Air / Normal', color: '#10b981', bg: 'rgba(16, 185, 129, 0.15)' };
    if (val < 600) return { label: 'Moderate Gas', color: '#f59e0b', bg: 'rgba(245, 158, 11, 0.15)' };
    return { label: 'HIGH GAS ALERT', color: '#ef4444', bg: 'rgba(239, 68, 68, 0.2)' };
  };

  const gasStatus = getGasStatus(weatherData.mq9Gas ?? weatherData.mq3Gas);

  const discoveredNodesList = Object.values(nodesMap).sort((a, b) => a.nodeId - b.nodeId);

  return (
    <div style={{ maxWidth: '1200px', margin: '0 auto', display: 'flex', flexDirection: 'column', gap: 'var(--space-6)' }}>
      
      {/* 1. Header */}
      <div className="responsive-page-header">
        <div>
          <h1 style={{ fontSize: '1.75rem', fontWeight: '700', color: 'var(--text-main)', margin: '0 0 var(--space-2) 0', display: 'flex', alignItems: 'center', gap: 'var(--space-3)', flexWrap: 'wrap' }}>
            <CloudSun size={30} style={{ color: 'var(--action-primary)', flexShrink: 0 }} />
            <span>Automatic Weather Station Pro</span>
          </h1>
          <p style={{ color: 'var(--text-dim)', margin: 0, fontSize: '0.95rem' }}>
            Multi-Node Meteorological Sensor Telemetry & Anemometer Mesh • Gateway: <code style={{ color: 'var(--text-main)', background: 'var(--bg-app)', padding: '2px 8px', borderRadius: 6, border: '1px solid var(--border-subtle)' }}>esp_gateway_node_01</code>
          </p>
        </div>
        <div style={{ display: 'flex', alignItems: 'center', gap: 10 }}>
          <Link to="/sos-alert" className="btn btn-secondary" style={{ display: 'flex', alignItems: 'center', gap: 6, borderRadius: 10, fontWeight: 600 }}>
            <AlertTriangle size={16} style={{ color: 'var(--status-error)' }} /> LoRa SOS Console
          </Link>
          <button
            onClick={() => setIsPolling(!isPolling)}
            className={`btn ${isPolling ? 'btn-secondary' : 'btn-primary'}`}
            style={{ transition: 'all 0.3s ease' }}
          >
            {isPolling ? <><RefreshCw size={16} className="spin" /> Stream Active</> : <><Radio size={16} /> Stream Paused</>}
          </button>
        </div>
      </div>

      {/* 2. Global Emergency SOS Banner if triggered on ANY station */}
      {activeSosNode && (
        <div style={{
          padding: '14px 20px',
          background: 'var(--status-error-bg)',
          border: '2px solid var(--status-error)',
          borderRadius: 14,
          display: 'flex',
          alignItems: 'center',
          justifyContent: 'space-between',
          flexWrap: 'wrap',
          gap: 12,
          animation: 'pulse 1.5s infinite'
        }}>
          <div style={{ display: 'flex', alignItems: 'center', gap: 10, color: 'var(--status-error)', fontWeight: 800 }}>
            <AlertTriangle size={22} />
            <span>🚨 EMERGENCY SOS ALERT TRANSMITTED FROM STATION NODE #{activeSosNode.nodeId} ({activeSosNode.deviceId})!</span>
          </div>
          <Link to="/sos-alert" className="btn btn-primary" style={{ background: 'var(--status-error)', borderColor: 'var(--status-error)', fontSize: '0.85rem' }}>
            Open Emergency SOS Console <ArrowRight size={14} style={{ marginLeft: 6 }} />
          </Link>
        </div>
      )}

      {/* 3. MULTI-STATION SWITCHER BAR */}
      <div className="card" style={{
        padding: '12px 18px',
        background: 'var(--bg-surface)',
        border: '1px solid var(--border-strong)',
        borderRadius: 16,
        display: 'flex',
        alignItems: 'center',
        justifyContent: 'space-between',
        flexWrap: 'wrap',
        gap: 12
      }}>
        <div style={{ display: 'flex', alignItems: 'center', gap: 8, fontSize: '0.85rem', fontWeight: 700, color: 'var(--text-main)', textTransform: 'uppercase', letterSpacing: '0.5px' }}>
          <Radio size={16} style={{ color: 'var(--action-primary)' }} />
          <span>LoRa Mesh Stations ({discoveredNodesList.length} Active):</span>
        </div>

        <div style={{ display: 'flex', alignItems: 'center', gap: 8, flexWrap: 'wrap' }}>
          {/* All Stations Button */}
          <button
            onClick={() => setSelectedStation('all')}
            style={{
              display: 'flex',
              alignItems: 'center',
              gap: 8,
              padding: '6px 14px',
              borderRadius: 10,
              fontSize: '0.85rem',
              fontWeight: selectedStation === 'all' ? 700 : 500,
              border: selectedStation === 'all' ? '1px solid var(--action-primary)' : '1px solid var(--border-subtle)',
              background: selectedStation === 'all' ? 'var(--action-primary)' : 'var(--bg-app)',
              color: selectedStation === 'all' ? '#ffffff' : 'var(--text-dim)',
              cursor: 'pointer',
              transition: 'all 0.2s ease',
              boxShadow: selectedStation === 'all' ? '0 2px 8px rgba(99, 91, 255, 0.3)' : 'none'
            }}
          >
            <Layers size={14} />
            <span>🌐 All Stations Overview</span>
          </button>

          {/* Individual Station Pills */}
          {discoveredNodesList.map(node => {
            const isSelected = selectedStation === String(node.nodeId);
            return (
              <button
                key={node.nodeId}
                onClick={() => setSelectedStation(String(node.nodeId))}
                style={{
                  display: 'flex',
                  alignItems: 'center',
                  gap: 8,
                  padding: '6px 14px',
                  borderRadius: 10,
                  fontSize: '0.85rem',
                  fontWeight: isSelected ? 700 : 500,
                  border: isSelected ? '1px solid var(--action-primary)' : '1px solid var(--border-subtle)',
                  background: isSelected ? 'var(--accent-light)' : 'var(--bg-app)',
                  color: isSelected ? 'var(--action-primary)' : 'var(--text-main)',
                  cursor: 'pointer',
                  transition: 'all 0.2s ease'
                }}
              >
                {/* Online pulse dot */}
                <div style={{
                  width: 8, height: 8, borderRadius: '50%',
                  background: node.online ? '#10b981' : '#f43f5e',
                  boxShadow: node.online ? '0 0 6px #10b981' : 'none'
                }} />
                <span>📡 Station Node #{node.nodeId}</span>
                {node.temperature !== null && (
                  <span style={{ fontSize: '0.75rem', opacity: 0.8, marginLeft: 2, background: 'rgba(0,0,0,0.06)', padding: '1px 6px', borderRadius: 4 }}>
                    {node.temperature.toFixed(1)}°C
                  </span>
                )}
                {node.windSpeed > 0 && (
                  <span style={{ fontSize: '0.75rem', opacity: 0.8, background: 'rgba(0,0,0,0.06)', padding: '1px 6px', borderRadius: 4 }}>
                    {node.windSpeed.toFixed(1)} km/h
                  </span>
                )}
              </button>
            );
          })}
        </div>
      </div>

      {/* 4. MULTI-STATION COMPARISON MATRIX (When 'All Stations' is Selected) */}
      {selectedStation === 'all' && (
        <div style={{ display: 'flex', flexDirection: 'column', gap: 12 }}>
          <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', padding: '0 4px' }}>
            <h3 style={{ fontSize: '1.05rem', fontWeight: 700, color: 'var(--text-main)', margin: 0, display: 'flex', alignItems: 'center', gap: 8 }}>
              <Layers size={18} style={{ color: 'var(--action-primary)' }} />
              Active Mesh Stations Comparison Matrix
            </h3>
            <span style={{ fontSize: '0.8rem', color: 'var(--text-muted)' }}>
              Click "Inspect Station" to view dedicated gauges, compass & diagnostics
            </span>
          </div>

          <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(320px, 1fr))', gap: 16 }}>
            {discoveredNodesList.map(node => (
              <div
                key={node.nodeId}
                className="card"
                style={{
                  padding: 18,
                  background: 'var(--bg-surface)',
                  border: '1px solid var(--border-strong)',
                  borderRadius: 16,
                  display: 'flex',
                  flexDirection: 'column',
                  gap: 14,
                  boxShadow: 'var(--shadow-sm)'
                }}
              >
                <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between' }}>
                  <div style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
                    <div style={{
                      width: 10, height: 10, borderRadius: '50%',
                      background: node.online ? '#10b981' : '#f43f5e',
                      boxShadow: node.online ? '0 0 8px #10b981' : 'none'
                    }} />
                    <span style={{ fontWeight: 800, fontSize: '0.95rem', color: 'var(--text-main)' }}>
                      {node.displayName}
                    </span>
                  </div>
                  <span style={{
                    fontSize: '0.72rem',
                    fontWeight: 700,
                    padding: '2px 8px',
                    borderRadius: 6,
                    background: node.online ? 'rgba(16, 185, 129, 0.15)' : 'rgba(244, 63, 94, 0.15)',
                    color: node.online ? '#10b981' : '#f43f5e'
                  }}>
                    {node.online ? 'ONLINE' : 'STANDBY'}
                  </span>
                </div>

                {/* Metrics Grid */}
                <div style={{ display: 'grid', gridTemplateColumns: 'repeat(2, 1fr)', gap: 10 }}>
                  <div style={{ background: 'var(--bg-app)', padding: '10px 12px', borderRadius: 10, border: '1px solid var(--border-subtle)' }}>
                    <div style={{ fontSize: '0.75rem', color: '#f97316', fontWeight: 700, display: 'flex', alignItems: 'center', gap: 6 }}>
                      <Thermometer size={14} /> Temp & Hum
                    </div>
                    <div style={{ fontSize: '1.2rem', fontWeight: 800, color: 'var(--text-main)', marginTop: 4 }}>
                      {node.temperature !== null ? `${node.temperature.toFixed(1)}°C` : '--'}
                    </div>
                    <div style={{ fontSize: '0.75rem', color: 'var(--text-muted)' }}>
                      {node.humidity !== null ? `${node.humidity.toFixed(1)}% Hum` : '--'}
                    </div>
                  </div>

                  <div style={{ background: 'var(--bg-app)', padding: '10px 12px', borderRadius: 10, border: '1px solid var(--border-subtle)' }}>
                    <div style={{ fontSize: '0.75rem', color: '#10b981', fontWeight: 700, display: 'flex', alignItems: 'center', gap: 6 }}>
                      <Wind size={14} /> Wind Speed
                    </div>
                    <div style={{ fontSize: '1.2rem', fontWeight: 800, color: 'var(--text-main)', marginTop: 4 }}>
                      {node.windSpeed.toFixed(1)} <span style={{ fontSize: '0.75rem' }}>km/h</span>
                    </div>
                    <div style={{ fontSize: '0.75rem', color: 'var(--text-muted)' }}>
                      Dir: {node.windDirection === 'None' ? 'CALM' : node.windDirection}
                    </div>
                  </div>

                  <div style={{ background: 'var(--bg-app)', padding: '10px 12px', borderRadius: 10, border: '1px solid var(--border-subtle)' }}>
                    <div style={{ fontSize: '0.75rem', color: '#ef4444', fontWeight: 700, display: 'flex', alignItems: 'center', gap: 6 }}>
                      <Flame size={14} /> MQ-9 Gas
                    </div>
                    <div style={{ fontSize: '1.2rem', fontWeight: 800, color: 'var(--text-main)', marginTop: 4 }}>
                      {node.mq9Gas !== null && node.mq9Gas !== undefined ? node.mq9Gas : (node.mq3Gas !== null && node.mq3Gas !== undefined ? node.mq3Gas : '--')}
                    </div>
                    <div style={{ fontSize: '0.72rem', color: 'var(--text-muted)' }}>
                      {getGasStatus(node.mq9Gas ?? node.mq3Gas).label}
                    </div>
                  </div>

                  <div style={{ background: 'var(--bg-app)', padding: '10px 12px', borderRadius: 10, border: '1px solid var(--border-subtle)' }}>
                    <div style={{ fontSize: '0.75rem', color: '#38bdf8', fontWeight: 700, display: 'flex', alignItems: 'center', gap: 6 }}>
                      <Signal size={14} /> RF Signal / Batt
                    </div>
                    <div style={{ fontSize: '1.2rem', fontWeight: 800, color: 'var(--text-main)', marginTop: 4 }}>
                      {node.rssi !== null ? `${node.rssi} dBm` : '--'}
                    </div>
                    <div style={{ fontSize: '0.75rem', color: 'var(--text-muted)' }}>
                      {node.batteryMv !== null ? `${node.batteryMv} mV` : '--'}
                    </div>
                  </div>
                </div>

                {/* Footer and Inspect Button */}
                <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', paddingTop: 6, borderTop: '1px solid var(--border-subtle)' }}>
                  <span style={{ fontSize: '0.75rem', color: 'var(--text-muted)', display: 'flex', alignItems: 'center', gap: 4 }}>
                    <Clock size={12} /> {node.lastSeen ? node.lastSeen.toLocaleTimeString() : 'No recent packet'}
                  </span>
                  <button
                    onClick={() => setSelectedStation(String(node.nodeId))}
                    className="btn btn-secondary"
                    style={{ fontSize: '0.78rem', padding: '4px 10px', borderRadius: 8, display: 'flex', alignItems: 'center', gap: 4 }}
                  >
                    Inspect Station <ArrowRight size={12} />
                  </button>
                </div>
              </div>
            ))}
          </div>
        </div>
      )}

      {/* 5. Device Status Bar for Current Active Station */}
      <div className="card" style={{
        padding: '14px 20px',
        background: weatherData.alertLevel > 0 ? 'var(--status-error-bg)' : 'var(--bg-surface)',
        border: weatherData.alertLevel > 0 ? '1px solid var(--status-error)' : '1px solid var(--border-strong)',
        borderRadius: 14,
        display: 'flex',
        alignItems: 'center',
        justifyContent: 'space-between',
        flexWrap: 'wrap',
        gap: 12
      }}>
        <div style={{ display: 'flex', alignItems: 'center', gap: 12 }}>
          <div style={{
            width: 10, height: 10, borderRadius: '50%',
            background: weatherData.alertLevel > 0 ? 'var(--status-error)' : (weatherData.online ? '#10b981' : '#f43f5e'),
            boxShadow: weatherData.online ? (weatherData.alertLevel > 0 ? '0 0 12px var(--status-error)' : '0 0 10px #10b981') : 'none'
          }} />
          <span style={{ fontWeight: 700, fontSize: '0.9rem', color: weatherData.alertLevel > 0 ? 'var(--status-error)' : 'var(--text-main)' }}>
            {weatherData.displayName}: {weatherData.alertLevel > 0 ? '🚨 EMERGENCY SOS ACTIVE' : (weatherData.online ? 'ONLINE & TRANSMITTING' : 'STANDBY / OFFLINE')}
          </span>
          <span style={{ fontSize: '0.8rem', color: 'var(--text-muted)' }}>
            Device ID: {weatherData.deviceId}
          </span>
        </div>

        <div style={{ display: 'flex', alignItems: 'center', gap: 16, fontSize: '0.82rem', color: 'var(--text-muted)' }}>
          {weatherData.meshOriginNode !== null && (
            <span style={{ display: 'flex', alignItems: 'center', gap: 6 }}>
              <Cpu size={14} style={{ color: 'var(--action-primary)' }} /> Mesh Node #{weatherData.meshOriginNode}
            </span>
          )}
          {weatherData.rssi !== null && (
            <span style={{ display: 'flex', alignItems: 'center', gap: 6 }}>
              <Wifi size={14} style={{ color: '#38bdf8' }} /> {weatherData.rssi} dBm
            </span>
          )}
          {weatherData.lastSeen && (
            <span style={{ display: 'flex', alignItems: 'center', gap: 6 }}>
              <Clock size={14} /> {weatherData.lastSeen.toLocaleTimeString()}
            </span>
          )}
        </div>
      </div>

      {/* 6. Primary Meteorological KPI Cards Grid */}
      <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(320px, 1fr))', gap: 'var(--space-5)' }}>
        
        {/* Cinematic Wind Compass Card */}
        <div className="card" style={{
          padding: 'var(--space-6)',
          background: 'var(--bg-surface)',
          border: '1px solid var(--border-strong)',
          borderRadius: 20,
          boxShadow: 'var(--shadow-md)',
          display: 'flex',
          flexDirection: 'column',
          alignItems: 'center',
          textAlign: 'center',
          position: 'relative'
        }}>
          <div style={{ display: 'flex', alignItems: 'center', gap: 8, color: 'var(--text-main)', fontWeight: 700, fontSize: '0.85rem', letterSpacing: '1px', textTransform: 'uppercase', marginBottom: 12 }}>
            <Compass size={18} style={{ color: 'var(--action-primary)' }} /> Wind Direction & Anemometer (Node #{weatherData.meshOriginNode || 1})
          </div>

          {/* Compass Graphic */}
          <div style={{
            width: 200, height: 200, borderRadius: '50%',
            border: '3px solid var(--action-primary)',
            margin: '10px 0',
            position: 'relative',
            background: 'var(--bg-app)',
            boxShadow: 'var(--shadow-sm)',
            display: 'flex',
            alignItems: 'center',
            justifyContent: 'center'
          }}>
            <span style={{ position: 'absolute', top: 8, fontWeight: 900, color: 'var(--action-primary)', fontSize: '0.9rem' }}>N</span>
            <span style={{ position: 'absolute', bottom: 8, fontWeight: 900, color: 'var(--action-primary)', fontSize: '0.9rem' }}>S</span>
            <span style={{ position: 'absolute', right: 12, fontWeight: 900, color: 'var(--action-primary)', fontSize: '0.9rem' }}>E</span>
            <span style={{ position: 'absolute', left: 12, fontWeight: 900, color: 'var(--action-primary)', fontSize: '0.9rem' }}>W</span>

            <div style={{
              position: 'absolute',
              width: 6,
              height: 85,
              background: 'linear-gradient(to top, #ff3366, #ff6699)',
              top: 15,
              left: 'calc(50% - 3px)',
              transformOrigin: 'center 85px',
              transform: `rotate(${dirAngle}deg)`,
              transition: 'transform 1.2s cubic-bezier(0.34, 1.56, 0.64, 1)',
              borderRadius: 6,
              zIndex: 2
            }} />
            <div style={{
              width: 14, height: 14, borderRadius: '50%',
              background: 'var(--bg-surface)', border: '3px solid #ff3366',
              zIndex: 3
            }} />
          </div>

          <div style={{
            fontSize: '1.4rem', fontWeight: 800, color: '#ff3366',
            letterSpacing: '1px', marginTop: 4
          }}>
            {weatherData.windDirection === 'None' ? 'CALM' : weatherData.windDirection.toUpperCase()}
          </div>

          <div style={{ fontSize: '2.4rem', fontWeight: 900, color: 'var(--text-main)', margin: '4px 0 0 0' }}>
            {weatherData.windSpeed.toFixed(1)} <span style={{ fontSize: '0.9rem', color: 'var(--action-primary)', fontWeight: 700 }}>KM/H</span>
          </div>
        </div>

        {/* Multi-Sensor Grid */}
        <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(200px, 1fr))', gap: 12 }}>
          
          {/* Temperature */}
          <div className="card" style={{ padding: 18, background: 'var(--bg-surface)', border: '1px solid var(--border-strong)', borderRadius: 16 }}>
            <div style={{ display: 'flex', alignItems: 'center', gap: 8, color: '#f97316', fontSize: '0.8rem', fontWeight: 700, textTransform: 'uppercase' }}>
              <Thermometer size={16} /> Temperature
            </div>
            <div style={{ fontSize: '2rem', fontWeight: 900, color: 'var(--text-main)', marginTop: 8 }}>
              {weatherData.temperature !== null ? `${weatherData.temperature.toFixed(1)} °C` : '--'}
            </div>
            <div style={{ fontSize: '0.75rem', color: 'var(--text-muted)', marginTop: 4 }}>
              DHT22 Precision Sensor (A0)
            </div>
          </div>

          {/* Humidity */}
          <div className="card" style={{ padding: 18, background: 'var(--bg-surface)', border: '1px solid var(--border-strong)', borderRadius: 16 }}>
            <div style={{ display: 'flex', alignItems: 'center', gap: 8, color: '#38bdf8', fontSize: '0.8rem', fontWeight: 700, textTransform: 'uppercase' }}>
              <Droplets size={16} /> Relative Humidity
            </div>
            <div style={{ fontSize: '2rem', fontWeight: 900, color: 'var(--text-main)', marginTop: 8 }}>
              {weatherData.humidity !== null ? `${weatherData.humidity.toFixed(1)} %` : '--'}
            </div>
            <div style={{ fontSize: '0.75rem', color: 'var(--text-muted)', marginTop: 4 }}>
              Atmospheric Moisture
            </div>
          </div>

          {/* MQ-9 Gas Sensor */}
          <div className="card" style={{ padding: 18, background: 'var(--bg-surface)', border: '1px solid var(--border-strong)', borderRadius: 16, position: 'relative' }}>
            <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between' }}>
              <div style={{ display: 'flex', alignItems: 'center', gap: 8, color: '#ef4444', fontSize: '0.8rem', fontWeight: 700, textTransform: 'uppercase' }}>
                <Flame size={16} /> MQ-9 Gas Sensor
              </div>
              <span style={{
                fontSize: '0.68rem', fontWeight: 800, padding: '2px 8px', borderRadius: 8,
                color: gasStatus.color, background: gasStatus.bg, border: `1px solid ${gasStatus.color}`
              }}>
                {gasStatus.label}
              </span>
            </div>
            <div style={{ fontSize: '2rem', fontWeight: 900, color: 'var(--text-main)', marginTop: 8 }}>
              {weatherData.mq9Gas !== null && weatherData.mq9Gas !== undefined ? `${weatherData.mq9Gas}` : (weatherData.mq3Gas !== null && weatherData.mq3Gas !== undefined ? `${weatherData.mq3Gas}` : '--')} <span style={{ fontSize: '0.85rem', color: 'var(--text-muted)', fontWeight: 600 }}>ADC</span>
            </div>
            <div style={{ fontSize: '0.75rem', color: 'var(--text-muted)', marginTop: 4 }}>
              MQ-9 Gas Sensor — CO & Flammable Gas (Pin A2)
            </div>
          </div>

          {/* Barometric Pressure */}
          <div className="card" style={{ padding: 18, background: 'var(--bg-surface)', border: '1px solid var(--border-strong)', borderRadius: 16 }}>
            <div style={{ display: 'flex', alignItems: 'center', gap: 8, color: '#a855f7', fontSize: '0.8rem', fontWeight: 700, textTransform: 'uppercase' }}>
              <Gauge size={16} /> Barometric Pressure
            </div>
            <div style={{ fontSize: '1.8rem', fontWeight: 900, color: 'var(--text-main)', marginTop: 8 }}>
              {weatherData.pressure !== null ? `${weatherData.pressure.toLocaleString()} Pa` : '--'}
            </div>
            <div style={{ fontSize: '0.75rem', color: 'var(--text-muted)', marginTop: 4 }}>
              BMP180 I2C Sensor (A4/A5)
            </div>
          </div>

          {/* Ambient Light & Altitude */}
          <div className="card" style={{ padding: 18, background: 'var(--bg-surface)', border: '1px solid var(--border-strong)', borderRadius: 16 }}>
            <div style={{ display: 'flex', alignItems: 'center', gap: 8, color: '#eab308', fontSize: '0.8rem', fontWeight: 700, textTransform: 'uppercase' }}>
              <Sun size={16} /> Ambient Light & Altitude
            </div>
            <div style={{ fontSize: '1.4rem', fontWeight: 900, color: 'var(--text-main)', marginTop: 8 }}>
              {weatherData.light !== null ? `${weatherData.light} ADC` : '--'}
            </div>
            <div style={{ fontSize: '0.8rem', color: 'var(--text-muted)', marginTop: 4 }}>
              Alt: {weatherData.altitude !== null ? `${weatherData.altitude.toFixed(1)} m` : '--'}
            </div>
          </div>

          {/* AWS Battery Voltage */}
          <div className="card" style={{ padding: 18, background: 'var(--bg-surface)', border: '1px solid var(--border-strong)', borderRadius: 16 }}>
            <div style={{ display: 'flex', alignItems: 'center', gap: 8, color: '#10b981', fontSize: '0.8rem', fontWeight: 700, textTransform: 'uppercase' }}>
              <Battery size={16} /> AWS Battery System
            </div>
            <div style={{ fontSize: '1.8rem', fontWeight: 900, color: 'var(--text-main)', marginTop: 8 }}>
              {weatherData.batteryMv !== null ? `${weatherData.batteryMv} mV` : '--'}
            </div>
            <div style={{ fontSize: '0.75rem', color: 'var(--text-muted)', marginTop: 4 }}>
              Voltage Divider ADC (Pin A3)
            </div>
          </div>

        </div>

      </div>

      {/* 7. HISTORICAL MULTI-SENSOR TELEMETRY & TIMEFRAME GRAPH ANALYTICS */}
      <div className="card" style={{ padding: 'var(--space-6)', background: 'var(--bg-surface)', border: '1px solid var(--border-strong)', borderRadius: 20, display: 'flex', flexDirection: 'column', gap: 16 }}>
        
        {/* Graph Header & Controls Bar */}
        <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', flexWrap: 'wrap', gap: 16 }}>
          <div>
            <h3 style={{ fontSize: '1.15rem', fontWeight: 700, color: 'var(--text-main)', margin: 0, display: 'flex', alignItems: 'center', gap: 8 }}>
              <Activity size={22} style={{ color: 'var(--action-primary)' }} />
              Meteorological Telemetry Analytics & Timeframe Graph {selectedStation !== 'all' && `(Station Node #${selectedStation})`}
            </h3>
            <p style={{ margin: '4px 0 0 0', fontSize: '0.85rem', color: 'var(--text-muted)' }}>
              Query historical trends or watch real-time sensor streams across custom time intervals.
            </p>
          </div>

          {/* Time Range Selector Pills */}
          <div style={{ display: 'flex', alignItems: 'center', gap: 6, flexWrap: 'wrap', background: 'var(--bg-app)', padding: 4, borderRadius: 12, border: '1px solid var(--border-subtle)' }}>
            {TIME_RANGES.map(tr => {
              const active = timeRange === tr.id;
              return (
                <button
                  key={tr.id}
                  onClick={() => setTimeRange(tr.id)}
                  style={{
                    padding: '6px 12px',
                    fontSize: '0.8rem',
                    fontWeight: active ? 700 : 500,
                    borderRadius: 8,
                    border: 'none',
                    background: active ? 'var(--action-primary)' : 'transparent',
                    color: active ? '#ffffff' : 'var(--text-dim)',
                    cursor: 'pointer',
                    transition: 'all 0.2s ease',
                    boxShadow: active ? '0 2px 8px rgba(99, 91, 255, 0.3)' : 'none'
                  }}
                >
                  {tr.label}
                </button>
              );
            })}
          </div>
        </div>

        {/* Metric Sensor Selector Tabs & Point Count Counter */}
        <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', flexWrap: 'wrap', gap: 12, borderBottom: '1px solid var(--border-subtle)', paddingBottom: 12 }}>
          <div style={{ display: 'flex', gap: 8, flexWrap: 'wrap' }}>
            {METRIC_VIEWS.map(mv => {
              const active = chartMetricView === mv.id;
              return (
                <button
                  key={mv.id}
                  onClick={() => setChartMetricView(mv.id)}
                  style={{
                    padding: '5px 12px',
                    fontSize: '0.8rem',
                    fontWeight: active ? 700 : 500,
                    borderRadius: 8,
                    border: `1px solid ${active ? 'var(--action-primary)' : 'var(--border-subtle)'}`,
                    background: active ? 'var(--accent-light)' : 'var(--bg-surface)',
                    color: active ? 'var(--action-primary)' : 'var(--text-muted)',
                    cursor: 'pointer',
                    transition: 'all 0.2s ease'
                  }}
                >
                  {mv.label}
                </button>
              );
            })}
          </div>

          <div style={{ fontSize: '0.8rem', color: 'var(--text-muted)', display: 'flex', alignItems: 'center', gap: 6 }}>
            <BarChart2 size={14} /> {isLoadingHistory ? 'Fetching readings...' : `${chartData.length} Readings in View`}
          </div>
        </div>

        {/* Interactive Chart View Area */}
        <div style={{ width: '100%', height: 360, position: 'relative' }}>
          {isLoadingHistory && (
            <div style={{
              position: 'absolute', inset: 0, background: 'rgba(255,255,255,0.6)',
              backdropFilter: 'blur(2px)', display: 'flex', alignItems: 'center', justifyContent: 'center',
              zIndex: 10, borderRadius: 12, fontWeight: 700, color: 'var(--action-primary)'
            }}>
              <RefreshCw size={22} className="spin" style={{ marginRight: 8 }} /> Loading Timeframe Data...
            </div>
          )}

          {chartData.length === 0 ? (
            <div style={{ height: '100%', display: 'flex', flexDirection: 'column', alignItems: 'center', justifyContent: 'center', color: 'var(--text-muted)' }}>
              <Activity size={40} style={{ opacity: 0.3, marginBottom: 8 }} />
              <p style={{ margin: 0, fontWeight: 600 }}>No telemetry records found for timeframe ({timeRange.toUpperCase()})</p>
              <span style={{ fontSize: '0.8rem' }}>Data will automatically render when AWS hardware transmits packets.</span>
            </div>
          ) : (
            <ResponsiveContainer width="100%" height="100%">
              <LineChart data={chartData} margin={{ top: 10, right: 20, left: 0, bottom: 0 }}>
                <CartesianGrid strokeDasharray="3 3" stroke="var(--border-subtle)" opacity={0.6} />
                <XAxis dataKey="timeLabel" stroke="var(--text-muted)" fontSize={11} tickMargin={8} />
                <YAxis yAxisId="left" stroke="#f97316" fontSize={11} domain={['auto', 'auto']} />
                <YAxis yAxisId="right" orientation="right" stroke="#10b981" fontSize={11} domain={[0, 'auto']} />
                <Tooltip contentStyle={{ background: 'var(--bg-surface)', border: '1px solid var(--border-strong)', borderRadius: 10, color: 'var(--text-main)', boxShadow: 'var(--shadow-md)' }} />
                <Legend wrapperStyle={{ paddingTop: 10 }} />

                {(chartMetricView === 'all' || chartMetricView === 'temp_hum') && (
                  <Line yAxisId="left" type="monotone" dataKey="temp" name="Temperature (°C)" stroke="#f97316" strokeWidth={2.5} dot={false} />
                )}
                {(chartMetricView === 'all' || chartMetricView === 'temp_hum') && (
                  <Line yAxisId="left" type="monotone" dataKey="humidity" name="Humidity (%)" stroke="#38bdf8" strokeWidth={2} dot={false} />
                )}
                {(chartMetricView === 'all' || chartMetricView === 'wind_press') && (
                  <Line yAxisId="right" type="monotone" dataKey="windSpeed" name="Wind Speed (km/h)" stroke="#10b981" strokeWidth={2.5} dot={false} />
                )}
                {(chartMetricView === 'all' || chartMetricView === 'mq9' || chartMetricView === 'mq3') && (
                  <Line yAxisId="right" type="monotone" dataKey="mq9Gas" name="MQ-9 Gas (ADC)" stroke="#ef4444" strokeWidth={2} dot={false} />
                )}
                {chartMetricView === 'wind_press' && (
                  <Line yAxisId="right" type="monotone" dataKey="pressure" name="Pressure (Pa)" stroke="#a855f7" strokeWidth={2} dot={false} />
                )}
                {chartMetricView === 'batt_light' && (
                  <Line yAxisId="right" type="monotone" dataKey="batteryMv" name="Battery (mV)" stroke="#059669" strokeWidth={2.5} dot={false} />
                )}
                {chartMetricView === 'batt_light' && (
                  <Line yAxisId="right" type="monotone" dataKey="light" name="Light (ADC)" stroke="#eab308" strokeWidth={2} dot={false} />
                )}
              </LineChart>
            </ResponsiveContainer>
          )}
        </div>

      </div>

    </div>
  );
};

export default WeatherMonitor;
