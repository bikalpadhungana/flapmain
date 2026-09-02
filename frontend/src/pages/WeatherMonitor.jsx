import React, { useState, useEffect, useRef } from 'react';
import { CloudSun, Wind, Thermometer, Droplets, Gauge, Compass, Sun, Radio, RefreshCw, Wifi, Activity, Clock } from 'lucide-react';
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

const WeatherMonitor = () => {
  const [isPolling, setIsPolling] = useState(true);
  const [chartData, setChartData] = useState([]);
  
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
    time: null,
    apBssid: null,
    rssi: null,
    lastSeen: null,
    online: false
  });

  const timeoutRef = useRef(null);
  const DEVICE_TIMEOUT_MS = 65000;

  useEffect(() => {
    let socket;
    if (isPolling) {
      socket = io(API_BASE_URL.replace(/\/api$/, ''));

      socket.on('connect', () => {
        console.log('[WeatherMonitor] Connected to live telemetry stream');
      });

      const handleIncomingReading = (reading) => {
        const payload = reading.payload || {};
        const deviceId = reading.device_id;

        // Check if reading belongs to a weather station or contains weather payload
        const hasWeather = payload.wind_speed !== undefined || payload.wind_direction !== undefined || payload.temperature !== undefined;
        if (!hasWeather) return;

        const ts = new Date(reading.timestamp || Date.now());
        const timeLabel = ts.toLocaleTimeString([], { hour: '2-digit', minute: '2-digit', second: '2-digit' });

        setWeatherData({
          deviceId: deviceId || 'flap-flap-aws-001-7zhj',
          windSpeed: payload.wind_speed !== undefined ? Number(payload.wind_speed) : 0.0,
          windDirection: payload.wind_direction || 'None',
          temperature: payload.temperature !== undefined ? Number(payload.temperature) : null,
          humidity: payload.humidity !== undefined ? Number(payload.humidity) : null,
          pressure: payload.pressure !== undefined ? Number(payload.pressure) : null,
          altitude: payload.altitude !== undefined ? Number(payload.altitude) : null,
          light: payload.light !== undefined ? Number(payload.light) : null,
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

        // Update chart history
        setChartData(prev => {
          if (prev.some(r => r._id === reading._id)) return prev;
          const entry = {
            _id: reading._id || Math.random().toString(),
            timeLabel,
            temp: payload.temperature !== undefined ? Number(payload.temperature) : null,
            humidity: payload.humidity !== undefined ? Number(payload.humidity) : null,
            windSpeed: payload.wind_speed !== undefined ? Number(payload.wind_speed) : null,
          };
          return [...prev, entry].slice(-30);
        });
      };

      socket.on('new_weather_reading', handleIncomingReading);
      socket.on('new_telemetry', handleIncomingReading);
    }

    return () => {
      if (socket) socket.disconnect();
      if (timeoutRef.current) clearTimeout(timeoutRef.current);
    };
  }, [isPolling]);

  const dirAngle = DIRECTION_ANGLES[weatherData.windDirection] !== undefined ? DIRECTION_ANGLES[weatherData.windDirection] : 0;

  return (
    <div style={{ maxWidth: '1200px', margin: '0 auto', display: 'flex', flexDirection: 'column', gap: 'var(--space-6)' }}>
      {/* Header */}
      <div className="flex justify-between items-end" style={{ flexWrap: 'wrap', gap: 12 }}>
        <div>
          <h1 style={{ fontSize: '1.75rem', fontWeight: '700', color: 'var(--text-main)', margin: '0 0 var(--space-2) 0', display: 'flex', alignItems: 'center', gap: 'var(--space-3)' }}>
            <CloudSun size={30} style={{ color: '#00ffaa' }} />
            Weather Station Pro Monitor
          </h1>
          <p style={{ color: 'var(--text-dim)', margin: 0, fontSize: '0.95rem' }}>
            Unified Real-Time Meteorological & Atmospheric Telemetry • Device: <code style={{ color: 'var(--text-main)', background: 'var(--bg-surface-elevated)', padding: '2px 8px', borderRadius: 6 }}>{weatherData.deviceId}</code>
          </p>
        </div>
        <div style={{ display: 'flex', alignItems: 'center', gap: 10 }}>
          <button
            onClick={() => setIsPolling(!isPolling)}
            className={`btn ${isPolling ? 'btn-secondary' : 'btn-primary'}`}
            style={{ transition: 'all 0.3s ease' }}
          >
            {isPolling ? <><RefreshCw size={16} className="spin" /> Live Stream Active</> : <><Radio size={16} /> Live Stream Paused</>}
          </button>
        </div>
      </div>

      {/* Device Status Bar */}
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
        <div style={{ display: 'flex', alignItems: 'center', gap: 12 }}>
          <div style={{
            width: 10, height: 10, borderRadius: '50%',
            background: weatherData.online ? '#10b981' : '#f43f5e',
            boxShadow: weatherData.online ? '0 0 10px #10b981' : 'none'
          }} />
          <span style={{ fontWeight: 700, fontSize: '0.9rem', color: 'var(--text-main)' }}>
            {weatherData.online ? 'ONLINE & TRANSMITTING' : 'STANDBY / OFFLINE'}
          </span>
          <span style={{ fontSize: '0.8rem', color: 'var(--text-muted)' }}>
            Device ID: {weatherData.deviceId}
          </span>
        </div>

        <div style={{ display: 'flex', alignItems: 'center', gap: 16, fontSize: '0.82rem', color: 'var(--text-muted)' }}>
          {weatherData.rssi !== null && (
            <span style={{ display: 'flex', alignItems: 'center', gap: 6 }}>
              <Wifi size={14} style={{ color: '#38bdf8' }} /> {weatherData.rssi} dBm
            </span>
          )}
          {weatherData.lastSeen && (
            <span style={{ display: 'flex', alignItems: 'center', gap: 6 }}>
              <Clock size={14} /> Last Seen: {weatherData.lastSeen.toLocaleTimeString()}
            </span>
          )}
        </div>
      </div>

      {/* Main Grid: Cinematic Compass & Primary Meteorological KPI Cards */}
      <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(320px, 1fr))', gap: 'var(--space-5)' }}>
        
        {/* Cinematic Wind Compass Card */}
        <div className="card" style={{
          padding: 'var(--space-6)',
          background: 'linear-gradient(145deg, rgba(15,22,38,0.95), rgba(26,35,56,0.95))',
          border: '1px solid rgba(0, 255, 170, 0.2)',
          borderRadius: 24,
          boxShadow: '0 20px 40px rgba(0,0,0,0.5)',
          display: 'flex',
          flexDirection: 'column',
          alignItems: 'center',
          textAlign: 'center',
          position: 'relative'
        }}>
          <div style={{ display: 'flex', alignItems: 'center', gap: 8, color: '#00ffaa', fontWeight: 800, fontSize: '0.85rem', letterSpacing: '1px', textTransform: 'uppercase', marginBottom: 12 }}>
            <Compass size={18} /> Wind Direction & Anemometer
          </div>

          {/* Compass Graphic */}
          <div style={{
            width: 200, height: 200, borderRadius: '50%',
            border: '3px solid #00ffaa',
            margin: '10px 0',
            position: 'relative',
            background: 'radial-gradient(circle, #1a2338 0%, #0f1626 100%)',
            boxShadow: '0 0 30px rgba(0, 255, 170, 0.15)',
            display: 'flex',
            alignItems: 'center',
            justifyContent: 'center'
          }}>
            {/* Cardinal Labels */}
            <span style={{ position: 'absolute', top: 8, fontWeight: 900, color: '#00ffaa', fontSize: '0.9rem' }}>N</span>
            <span style={{ position: 'absolute', bottom: 8, fontWeight: 900, color: '#00ffaa', fontSize: '0.9rem' }}>S</span>
            <span style={{ position: 'absolute', right: 12, fontWeight: 900, color: '#00ffaa', fontSize: '0.9rem' }}>E</span>
            <span style={{ position: 'absolute', left: 12, fontWeight: 900, color: '#00ffaa', fontSize: '0.9rem' }}>W</span>

            {/* Rotating Needle */}
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
              background: '#0f1626', border: '3px solid #ff3366',
              zIndex: 3
            }} />
          </div>

          <div style={{
            fontSize: '1.4rem', fontWeight: 800, color: '#ff3366',
            textShadow: '0 0 15px rgba(255, 51, 102, 0.4)',
            letterSpacing: '1px', marginTop: 4
          }}>
            {weatherData.windDirection === 'None' ? 'CALM' : weatherData.windDirection.toUpperCase()}
          </div>

          <div style={{ fontSize: '2.4rem', fontWeight: 900, color: '#ffffff', margin: '4px 0 0 0' }}>
            {weatherData.windSpeed.toFixed(1)} <span style={{ fontSize: '0.9rem', color: '#00ffaa', fontWeight: 700 }}>KM/H</span>
          </div>
        </div>

        {/* Environmental Sensors Grid */}
        <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 12 }}>
          
          {/* Temperature */}
          <div className="card" style={{ padding: 18, background: 'var(--bg-surface)', border: '1px solid var(--border-strong)', borderRadius: 16 }}>
            <div style={{ display: 'flex', alignItems: 'center', gap: 8, color: '#f97316', fontSize: '0.8rem', fontWeight: 700, textTransform: 'uppercase' }}>
              <Thermometer size={16} /> Temperature
            </div>
            <div style={{ fontSize: '2rem', fontWeight: 900, color: 'var(--text-main)', marginTop: 8 }}>
              {weatherData.temperature !== null ? `${weatherData.temperature.toFixed(1)} °C` : '--'}
            </div>
            <div style={{ fontSize: '0.75rem', color: 'var(--text-muted)', marginTop: 4 }}>
              DHT22 High-Precision Sensor
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

          {/* Barometric Pressure */}
          <div className="card" style={{ padding: 18, background: 'var(--bg-surface)', border: '1px solid var(--border-strong)', borderRadius: 16 }}>
            <div style={{ display: 'flex', alignItems: 'center', gap: 8, color: '#a855f7', fontSize: '0.8rem', fontWeight: 700, textTransform: 'uppercase' }}>
              <Gauge size={16} /> Barometric Pressure
            </div>
            <div style={{ fontSize: '1.8rem', fontWeight: 900, color: 'var(--text-main)', marginTop: 8 }}>
              {weatherData.pressure !== null ? `${weatherData.pressure.toLocaleString()} Pa` : '--'}
            </div>
            <div style={{ fontSize: '0.75rem', color: 'var(--text-muted)', marginTop: 4 }}>
              BMP085 Precision Sensor
            </div>
          </div>

          {/* Ambient Light & Altitude */}
          <div className="card" style={{ padding: 18, background: 'var(--bg-surface)', border: '1px solid var(--border-strong)', borderRadius: 16 }}>
            <div style={{ display: 'flex', alignItems: 'center', gap: 8, color: '#eab308', fontSize: '0.8rem', fontWeight: 700, textTransform: 'uppercase' }}>
              <Sun size={16} /> Ambient Light & Altitude
            </div>
            <div style={{ fontSize: '1.4rem', fontWeight: 900, color: 'var(--text-main)', marginTop: 8 }}>
              {weatherData.light !== null ? `${weatherData.light} Lux` : '--'}
            </div>
            <div style={{ fontSize: '0.8rem', color: 'var(--text-muted)', marginTop: 4 }}>
              Alt: {weatherData.altitude !== null ? `${weatherData.altitude.toFixed(1)} m` : '--'}
            </div>
          </div>

        </div>

      </div>

      {/* Atmospheric Real-Time Telemetry History Graph */}
      <div className="card" style={{ padding: 'var(--space-6)', background: 'var(--bg-surface)', border: '1px solid var(--border-strong)', borderRadius: 20 }}>
        <h3 style={{ fontSize: '1.1rem', fontWeight: 700, color: 'var(--text-main)', margin: '0 0 var(--space-4) 0', display: 'flex', alignItems: 'center', gap: 8 }}>
          <Activity size={20} className="text-primary" />
          Real-Time Weather & Atmospheric History (Last 30 Packet Samples)
        </h3>

        <div style={{ width: '100%', height: 320 }}>
          <ResponsiveContainer width="100%" height="100%">
            <LineChart data={chartData}>
              <CartesianGrid strokeDasharray="3 3" stroke="rgba(255,255,255,0.08)" />
              <XAxis dataKey="timeLabel" stroke="var(--text-muted)" fontSize={12} />
              <YAxis yAxisId="left" stroke="#f97316" fontSize={12} domain={['auto', 'auto']} />
              <YAxis yAxisId="right" orientation="right" stroke="#00ffaa" fontSize={12} domain={[0, 'auto']} />
              <Tooltip contentStyle={{ background: 'var(--bg-surface-elevated)', border: '1px solid var(--border-strong)', borderRadius: 8, color: '#fff' }} />
              <Legend />
              <Line yAxisId="left" type="monotone" dataKey="temp" name="Temperature (°C)" stroke="#f97316" strokeWidth={2} dot={false} />
              <Line yAxisId="left" type="monotone" dataKey="humidity" name="Humidity (%)" stroke="#38bdf8" strokeWidth={2} dot={false} />
              <Line yAxisId="right" type="monotone" dataKey="windSpeed" name="Wind Speed (km/h)" stroke="#00ffaa" strokeWidth={2.5} dot={false} />
            </LineChart>
          </ResponsiveContainer>
        </div>
      </div>

    </div>
  );
};

export default WeatherMonitor;
