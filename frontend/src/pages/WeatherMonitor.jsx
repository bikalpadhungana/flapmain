import React, { useState, useEffect, useRef } from 'react';
import { 
  CloudSun, Wind, Thermometer, Droplets, Gauge, Compass, Sun, Radio, RefreshCw, 
  Wifi, Activity, Clock, Flame, Battery, ShieldAlert, Cpu, BarChart2, AlertTriangle, ArrowRight
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

const WeatherMonitor = () => {
  const [isPolling, setIsPolling] = useState(true);
  const [chartData, setChartData] = useState([]);
  const [timeRange, setTimeRange] = useState('3h');
  const [chartMetricView, setChartMetricView] = useState('all');
  const [isLoadingHistory, setIsLoadingHistory] = useState(false);
  
  // Weather Telemetry State
  const [weatherData, setWeatherData] = useState({
    deviceId: 'flap-flap-aws-001-7zhj',
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
    meshOriginNode: null,
    meshHopsLeft: null,
    alertLevel: 0,
    snr: null,
    time: null,
    apBssid: null,
    rssi: null,
    lastSeen: null,
    online: false
  });

  const timeoutRef = useRef(null);
  const DEVICE_TIMEOUT_MS = 65000;

  // Fetch Historical Telemetry for Selected Time Range
  useEffect(() => {
    if (timeRange === 'live') return;

    setIsLoadingHistory(true);
    fetch(`${API_BASE_URL}/devices/telemetry/history?range=${timeRange}&device_id=${weatherData.deviceId}`)
      .then(res => res.json())
      .then(data => {
        if (data.readings && Array.isArray(data.readings)) {
          setChartData(data.readings);
        }
      })
      .catch(err => console.error('Failed to fetch telemetry history:', err))
      .finally(() => setIsLoadingHistory(false));
  }, [timeRange, weatherData.deviceId]);

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

        const ts = new Date(reading.timestamp || Date.now());
        const timeLabel = ts.toLocaleTimeString([], { hour: '2-digit', minute: '2-digit', second: '2-digit' });
        const gasVal = payload.mq9_gas !== undefined ? Number(payload.mq9_gas) : (payload.mq3_gas !== undefined ? Number(payload.mq3_gas) : null);

        setWeatherData({
          deviceId: deviceId || 'flap-flap-aws-001-7zhj',
          windSpeed: payload.wind_speed !== undefined ? Number(payload.wind_speed) : 0.0,
          windDirection: payload.wind_direction || 'None',
          temperature: payload.temperature !== undefined ? Number(payload.temperature) : null,
          humidity: payload.humidity !== undefined ? Number(payload.humidity) : null,
          pressure: payload.pressure !== undefined ? Number(payload.pressure) : null,
          altitude: payload.altitude !== undefined ? Number(payload.altitude) : (payload.pressure ? Number((44330 * (1 - Math.pow(payload.pressure / 101325, 0.1903))).toFixed(1)) : null),
          light: payload.light !== undefined ? Number(payload.light) : null,
          mq9Gas: gasVal,
          mq3Gas: gasVal,
          batteryMv: payload.battery_mv !== undefined ? Number(payload.battery_mv) : null,
          meshOriginNode: payload.mesh_origin_node !== undefined ? Number(payload.mesh_origin_node) : null,
          meshHopsLeft: payload.mesh_hops_left !== undefined ? Number(payload.mesh_hops_left) : null,
          alertLevel: payload.alert_level !== undefined ? Number(payload.alert_level) : 0,
          snr: payload.snr !== undefined ? Number(payload.snr) : null,
          time: payload.time || timeLabel,
          apBssid: payload.ap_bssid || null,
          rssi: payload.rssi !== undefined ? Number(payload.rssi) : null,
          lastSeen: ts,
          online: true
        });

        if (timeoutRef.current) clearTimeout(timeoutRef.current);
        timeoutRef.current = setTimeout(() => {
          setWeatherData(prev => ({ ...prev, online: false }));
        }, DEVICE_TIMEOUT_MS);

        if (timeRange === 'live') {
          setChartData(prev => {
            if (prev.some(r => r._id === reading._id)) return prev;
            const entry = {
              _id: reading._id || Math.random().toString(),
              timeLabel,
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
      };

      socket.on('new_weather_reading', handleIncomingReading);
      socket.on('new_telemetry', handleIncomingReading);
    }

    return () => {
      if (socket) socket.disconnect();
      if (timeoutRef.current) clearTimeout(timeoutRef.current);
    };
  }, [isPolling, timeRange]);

  const dirAngle = DIRECTION_ANGLES[weatherData.windDirection] !== undefined ? DIRECTION_ANGLES[weatherData.windDirection] : 0;

  const getGasStatus = (val) => {
    if (val === null || val === undefined) return { label: 'Sensor Offline', color: 'var(--text-muted)', bg: 'rgba(255,255,255,0.05)' };
    if (val < 300) return { label: 'Clean Air / Normal', color: '#10b981', bg: 'rgba(16, 185, 129, 0.15)' };
    if (val < 600) return { label: 'Moderate Gas', color: '#f59e0b', bg: 'rgba(245, 158, 11, 0.15)' };
    return { label: 'HIGH GAS ALERT', color: '#ef4444', bg: 'rgba(239, 68, 68, 0.2)' };
  };

  const gasStatus = getGasStatus(weatherData.mq9Gas ?? weatherData.mq3Gas);

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
            Real-Time Meteorological Sensor Telemetry & Anemometer Monitoring • Station Gateway: <code style={{ color: 'var(--text-main)', background: 'var(--bg-app)', padding: '2px 8px', borderRadius: 6, border: '1px solid var(--border-subtle)' }}>esp_gateway_node_01</code>
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

      {/* 2. Device Status Bar */}
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
            {weatherData.alertLevel > 0 ? '🚨 EMERGENCY SOS ALERT ACTIVE ON LORA MESH' : (weatherData.online ? 'STATION ONLINE & TRANSMITTING' : 'STANDBY / OFFLINE')}
          </span>
          {weatherData.alertLevel > 0 && (
            <Link to="/sos-alert" style={{ fontSize: '0.8rem', fontWeight: 800, color: 'var(--status-error)', display: 'flex', alignItems: 'center', gap: 4, textDecoration: 'underline' }}>
              View SOS Base Console <ArrowRight size={14} />
            </Link>
          )}
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

      {/* 3. Primary Meteorological KPI Cards Grid */}
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
            <Compass size={18} style={{ color: 'var(--action-primary)' }} /> Wind Direction & Anemometer
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

      {/* 4. HISTORICAL MULTI-SENSOR TELEMETRY & TIMEFRAME GRAPH ANALYTICS */}
      <div className="card" style={{ padding: 'var(--space-6)', background: 'var(--bg-surface)', border: '1px solid var(--border-strong)', borderRadius: 20, display: 'flex', flexDirection: 'column', gap: 16 }}>
        
        {/* Graph Header & Controls Bar */}
        <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', flexWrap: 'wrap', gap: 16 }}>
          <div>
            <h3 style={{ fontSize: '1.15rem', fontWeight: 700, color: 'var(--text-main)', margin: 0, display: 'flex', alignItems: 'center', gap: 8 }}>
              <Activity size={22} style={{ color: 'var(--action-primary)' }} />
              Meteorological Telemetry Analytics & Timeframe Graph
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
