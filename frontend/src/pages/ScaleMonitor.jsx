import React, { useState, useEffect, useRef } from 'react';
import { Activity, Radio, RefreshCw, Ruler, Weight, Wifi, WifiOff, Clock, Zap } from 'lucide-react';
import { API_BASE_URL } from '../config';
import { io } from 'socket.io-client';
import { LineChart, Line, XAxis, YAxis, CartesianGrid, Tooltip, ResponsiveContainer, Legend } from 'recharts';

const ScaleMonitor = () => {
  const [chartData, setChartData] = useState([]);
  const [isPolling, setIsPolling] = useState(true);

  // Latest values from sensors (may come from one combined device or two separate)
  const [heightData, setHeightData] = useState({ value: null, deviceId: null, lastSeen: null, online: false });
  const [weightData, setWeightData] = useState({ value: null, deviceId: null, lastSeen: null, online: false });

  const heightTimeoutRef = useRef(null);
  const weightTimeoutRef = useRef(null);
  const DEVICE_TIMEOUT_MS = 15000;

  useEffect(() => {
    let socket;
    if (isPolling) {
      socket = io(API_BASE_URL.replace(/\/api$/, ''));

      socket.on('connect', () => {
        console.log('[ScaleMonitor] Connected to real-time telemetry stream');
      });

      socket.on('new_scale_reading', (reading) => {
        const ts = new Date(reading.timestamp);
        const timeLabel = ts.toLocaleTimeString([], { hour: '2-digit', minute: '2-digit', second: '2-digit' });
        const payload = reading.payload || {};
        const deviceId = reading.device_id;

        const hasHeight = payload.height_cm !== undefined && payload.height_cm !== null;
        const hasWeight = payload.weight_kg !== undefined && payload.weight_kg !== null;

        // Update height state if this reading contains height data
        if (hasHeight) {
          const h = Number(payload.height_cm);
          setHeightData({ value: h, deviceId, lastSeen: ts, online: true });
          if (heightTimeoutRef.current) clearTimeout(heightTimeoutRef.current);
          heightTimeoutRef.current = setTimeout(() => {
            setHeightData(prev => ({ ...prev, online: false }));
          }, DEVICE_TIMEOUT_MS);
        }

        // Update weight state if this reading contains weight data
        if (hasWeight) {
          const w = Number(payload.weight_kg);
          setWeightData({ value: w, deviceId, lastSeen: ts, online: true });
          if (weightTimeoutRef.current) clearTimeout(weightTimeoutRef.current);
          weightTimeoutRef.current = setTimeout(() => {
            setWeightData(prev => ({ ...prev, online: false }));
          }, DEVICE_TIMEOUT_MS);
        }

        // Add chart point
        setChartData(prev => {
          if (prev.some(r => r._id === reading._id)) return prev;
          const entry = {
            _id: reading._id,
            timeLabel,
            height: hasHeight && Number(payload.height_cm) > 0 ? Number(payload.height_cm) : null,
            weight: hasWeight && Number(payload.weight_kg) > 0 ? Number(payload.weight_kg) : null,
          };
          return [...prev, entry].slice(-30);
        });
      });
    }

    return () => {
      if (socket) socket.disconnect();
      if (heightTimeoutRef.current) clearTimeout(heightTimeoutRef.current);
      if (weightTimeoutRef.current) clearTimeout(weightTimeoutRef.current);
    };
  }, [isPolling]);

  const currentHeight = heightData.value || 0;
  const currentWeight = weightData.value || 0;
  const bmi = (currentHeight > 0 && currentWeight > 0)
    ? parseFloat((currentWeight / Math.pow(currentHeight / 100, 2)).toFixed(1))
    : null;

  const getBmiCategory = (bmi) => {
    if (!bmi) return { label: '', color: 'var(--text-muted)' };
    if (bmi < 18.5) return { label: 'Underweight', color: '#f59e0b' };
    if (bmi < 25)   return { label: 'Healthy', color: '#10b981' };
    if (bmi < 30)   return { label: 'Overweight', color: '#f97316' };
    return { label: 'Obese', color: '#ef4444' };
  };
  const bmiInfo = getBmiCategory(bmi);

  const formatLastSeen = (date) => {
    if (!date) return 'Never';
    return new Date(date).toLocaleTimeString([], { hour: '2-digit', minute: '2-digit', second: '2-digit' });
  };

  // Determine if both sensors are on the same device
  const isCombinedDevice = heightData.deviceId && weightData.deviceId && heightData.deviceId === weightData.deviceId;

  return (
    <div style={{ maxWidth: '1200px', margin: '0 auto', display: 'flex', flexDirection: 'column', gap: 'var(--space-6)' }}>

      {/* Header */}
      <div className="flex justify-between items-end">
        <div>
          <h1 style={{ fontSize: '1.75rem', fontWeight: '700', color: 'var(--text-main)', margin: '0 0 var(--space-2) 0', display: 'flex', alignItems: 'center', gap: 'var(--space-3)' }}>
            <Activity size={28} className="text-primary" />
            Medical Scale Monitor
          </h1>
          <p style={{ color: 'var(--text-dim)', margin: 0, fontSize: '0.95rem' }}>
            {isCombinedDevice
              ? `Combined sensor on device ${heightData.deviceId}`
              : 'Real-time height & weight telemetry'
            }
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

      {/* Device Status Bar */}
      <div style={{ display: 'grid', gridTemplateColumns: isCombinedDevice ? '1fr' : '1fr 1fr', gap: 'var(--space-4)' }}>
        {isCombinedDevice ? (
          <DeviceStatusPill
            label="Combined Height + Weight Scale"
            deviceId={heightData.deviceId}
            online={heightData.online || weightData.online}
            lastSeen={heightData.lastSeen > weightData.lastSeen ? heightData.lastSeen : weightData.lastSeen}
            color="#635bff"
            icon={<Activity size={14} />}
          />
        ) : (
          <>
            <DeviceStatusPill
              label="Height Sensor"
              deviceId={heightData.deviceId}
              online={heightData.online}
              lastSeen={heightData.lastSeen}
              color="#3b82f6"
              icon={<Ruler size={14} />}
            />
            <DeviceStatusPill
              label="Weight Scale"
              deviceId={weightData.deviceId}
              online={weightData.online}
              lastSeen={weightData.lastSeen}
              color="#10b981"
              icon={<Weight size={14} />}
            />
          </>
        )}
      </div>

      {/* Main KPI Cards */}
      <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(280px, 1fr))', gap: 'var(--space-5)' }}>

        {/* Height Card */}
        <div className="card" style={{ padding: 'var(--space-6)', borderLeft: '4px solid #3b82f6', position: 'relative', overflow: 'hidden' }}>
          <div style={{
            position: 'absolute', top: '-20px', right: '-20px', width: '100px', height: '100px',
            borderRadius: '50%', background: 'rgba(59, 130, 246, 0.06)',
          }} />
          <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: 'var(--space-4)' }}>
            <span style={{ color: 'var(--text-dim)', fontWeight: '600', fontSize: '0.8rem', textTransform: 'uppercase', letterSpacing: '0.06em' }}>Height</span>
            <Ruler size={20} color="#3b82f6" />
          </div>
          <div style={{ fontSize: '3rem', fontWeight: '800', color: 'var(--text-main)', lineHeight: '1', marginBottom: 'var(--space-2)', transition: 'all 0.3s ease' }}>
            {currentHeight > 0 ? currentHeight.toFixed(1) : '--'}
            <span style={{ fontSize: '1.25rem', color: 'var(--text-muted)', marginLeft: '4px' }}>cm</span>
          </div>
          <div style={{ fontSize: '0.8rem', color: 'var(--text-muted)', display: 'flex', alignItems: 'center', gap: '6px' }}>
            <Clock size={12} />
            {heightData.lastSeen ? `Updated ${formatLastSeen(heightData.lastSeen)}` : 'Waiting for sensor...'}
          </div>
        </div>

        {/* Weight Card */}
        <div className="card" style={{ padding: 'var(--space-6)', borderLeft: '4px solid #10b981', position: 'relative', overflow: 'hidden' }}>
          <div style={{
            position: 'absolute', top: '-20px', right: '-20px', width: '100px', height: '100px',
            borderRadius: '50%', background: 'rgba(16, 185, 129, 0.06)',
          }} />
          <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: 'var(--space-4)' }}>
            <span style={{ color: 'var(--text-dim)', fontWeight: '600', fontSize: '0.8rem', textTransform: 'uppercase', letterSpacing: '0.06em' }}>Weight</span>
            <Weight size={20} color="#10b981" />
          </div>
          <div style={{ fontSize: '3rem', fontWeight: '800', color: 'var(--text-main)', lineHeight: '1', marginBottom: 'var(--space-2)', transition: 'all 0.3s ease' }}>
            {currentWeight > 0 ? currentWeight.toFixed(1) : '--'}
            <span style={{ fontSize: '1.25rem', color: 'var(--text-muted)', marginLeft: '4px' }}>kg</span>
          </div>
          <div style={{ fontSize: '0.8rem', color: 'var(--text-muted)', display: 'flex', alignItems: 'center', gap: '6px' }}>
            <Clock size={12} />
            {weightData.lastSeen ? `Updated ${formatLastSeen(weightData.lastSeen)}` : 'Waiting for sensor...'}
          </div>
        </div>

        {/* BMI Card */}
        <div className="card" style={{
          padding: 'var(--space-6)', borderLeft: `4px solid ${bmi ? bmiInfo.color : '#8b5cf6'}`,
          position: 'relative', overflow: 'hidden',
          background: bmi ? `linear-gradient(135deg, #ffffff 0%, ${bmiInfo.color}08 100%)` : 'var(--bg-surface)',
        }}>
          <div style={{
            position: 'absolute', top: '-20px', right: '-20px', width: '100px', height: '100px',
            borderRadius: '50%', background: 'rgba(139, 92, 246, 0.06)',
          }} />
          <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: 'var(--space-4)' }}>
            <span style={{ color: 'var(--text-dim)', fontWeight: '600', fontSize: '0.8rem', textTransform: 'uppercase', letterSpacing: '0.06em' }}>Body Mass Index</span>
            <Zap size={20} color={bmi ? bmiInfo.color : '#8b5cf6'} />
          </div>
          <div style={{ fontSize: '3rem', fontWeight: '800', color: bmi ? bmiInfo.color : 'var(--text-main)', lineHeight: '1', marginBottom: 'var(--space-2)', transition: 'all 0.3s ease' }}>
            {bmi || '--'}
          </div>
          <div style={{ fontSize: '0.85rem', color: bmi ? bmiInfo.color : 'var(--text-muted)', fontWeight: bmi ? '600' : '400' }}>
            {bmi ? bmiInfo.label : 'Needs both height & weight'}
          </div>
        </div>
      </div>

      {/* Live Chart */}
      <div className="card" style={{ padding: 'var(--space-6)', height: '420px' }}>
        <div className="flex justify-between items-center" style={{ marginBottom: 'var(--space-4)' }}>
          <h3 style={{ margin: 0, fontSize: '1.1rem', color: 'var(--text-main)' }}>Live Telemetry Graph</h3>
          <span className="badge badge-neutral" style={{ fontSize: '0.7rem' }}>
            {chartData.length} readings
          </span>
        </div>
        {chartData.length === 0 ? (
          <div style={{
            height: '85%', display: 'flex', flexDirection: 'column', alignItems: 'center', justifyContent: 'center',
            color: 'var(--text-muted)', gap: 'var(--space-3)',
          }}>
            <Activity size={40} style={{ opacity: 0.3 }} />
            <span>No readings received yet in this session.</span>
            <span style={{ fontSize: '0.8rem' }}>Readings will appear here as sensors transmit data.</span>
          </div>
        ) : (
          <ResponsiveContainer width="100%" height="85%">
            <LineChart data={chartData} margin={{ top: 5, right: 30, left: 20, bottom: 5 }}>
              <CartesianGrid strokeDasharray="3 3" vertical={false} stroke="#e5e7eb" />
              <XAxis dataKey="timeLabel" stroke="#9ca3af" fontSize={11} tickLine={false} axisLine={false} />
              <YAxis yAxisId="left" stroke="#3b82f6" fontSize={11} tickLine={false} axisLine={false} domain={['auto', 'auto']} label={{ value: 'cm', angle: -90, position: 'insideLeft', style: { fontSize: 11, fill: '#3b82f6' } }} />
              <YAxis yAxisId="right" orientation="right" stroke="#10b981" fontSize={11} tickLine={false} axisLine={false} domain={['auto', 'auto']} label={{ value: 'kg', angle: 90, position: 'insideRight', style: { fontSize: 11, fill: '#10b981' } }} />
              <Tooltip
                contentStyle={{ borderRadius: '10px', border: 'none', boxShadow: '0 4px 16px rgba(0,0,0,0.12)', fontSize: '0.85rem' }}
                labelStyle={{ fontWeight: 600, marginBottom: '4px' }}
              />
              <Legend wrapperStyle={{ fontSize: '0.8rem' }} />
              <Line yAxisId="left" type="monotone" dataKey="height" name="Height (cm)" stroke="#3b82f6" strokeWidth={2.5} dot={{ r: 3, strokeWidth: 2 }} activeDot={{ r: 5 }} connectNulls />
              <Line yAxisId="right" type="monotone" dataKey="weight" name="Weight (kg)" stroke="#10b981" strokeWidth={2.5} dot={{ r: 3, strokeWidth: 2 }} activeDot={{ r: 5 }} connectNulls />
            </LineChart>
          </ResponsiveContainer>
        )}
      </div>
    </div>
  );
};

// =====================================================================
// Device Status Pill — adapts for combined or split devices
// =====================================================================
const DeviceStatusPill = ({ label, deviceId, online, lastSeen, color, icon }) => {
  const formatTime = (date) => {
    if (!date) return 'Never connected';
    return new Date(date).toLocaleTimeString([], { hour: '2-digit', minute: '2-digit', second: '2-digit' });
  };

  return (
    <div className="card" style={{
      padding: 'var(--space-3) var(--space-4)',
      display: 'flex', alignItems: 'center', justifyContent: 'space-between',
      borderLeft: `3px solid ${online ? color : '#94a3b8'}`,
      transition: 'all 0.3s ease',
      opacity: online ? 1 : 0.7,
    }}>
      <div className="flex items-center gap-3">
        <div style={{
          width: '32px', height: '32px', borderRadius: '8px',
          background: online ? `${color}15` : '#f1f5f9',
          display: 'flex', alignItems: 'center', justifyContent: 'center',
          color: online ? color : '#94a3b8',
        }}>
          {icon}
        </div>
        <div>
          <div style={{ fontWeight: '600', fontSize: '0.85rem', color: 'var(--text-main)' }}>{label}</div>
          <div style={{ fontSize: '0.75rem', color: 'var(--text-muted)', fontFamily: 'var(--font-mono)' }}>
            {deviceId || 'Not connected'}
          </div>
        </div>
      </div>

      <div className="flex items-center gap-3">
        <div style={{ textAlign: 'right' }}>
          <div style={{ fontSize: '0.7rem', color: 'var(--text-muted)' }}>Last seen</div>
          <div style={{ fontSize: '0.75rem', color: 'var(--text-dim)', fontWeight: '500' }}>{formatTime(lastSeen)}</div>
        </div>
        {online ? (
          <span className="badge badge-success" style={{ fontSize: '0.7rem', padding: '2px 8px' }}>
            <Wifi size={10} /> Online
          </span>
        ) : (
          <span className="badge badge-neutral" style={{ fontSize: '0.7rem', padding: '2px 8px' }}>
            <WifiOff size={10} /> Offline
          </span>
        )}
      </div>
    </div>
  );
};

export default ScaleMonitor;
