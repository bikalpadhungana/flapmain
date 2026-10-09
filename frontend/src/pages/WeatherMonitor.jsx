import React, { useState, useEffect, useRef, useMemo } from 'react';
import { 
  CloudSun, Wind, Thermometer, Droplets, Gauge, Compass, Sun, Radio, RefreshCw, 
  Wifi, Activity, Clock, Flame, Battery, ShieldAlert, Cpu, BarChart2, AlertTriangle, ArrowRight,
  Layers, CheckCircle2, AlertCircle, Signal, Download, Table as TableIcon, Calendar, Search, 
  ChevronLeft, ChevronRight, FileText, Database, Filter, Eye, SlidersHorizontal, Sparkles, X, Copy, Check
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
  { id: '1h', label: '⏱️ 1h' },
  { id: '3h', label: '⏱️ 3h' },
  { id: '6h', label: '⏱️ 6h' },
  { id: '12h', label: '⏱️ 12h' },
  { id: '24h', label: '📅 24h' },
  { id: '7d', label: '📅 7d' },
  { id: '30d', label: '🗓️ 30d' },
  { id: 'custom', label: '🗓️ Custom' }
];

const METRIC_VIEWS = [
  { id: 'all', label: '📊 All Sensors' },
  { id: 'temp_hum', label: '🌡️ Temp & Humidity' },
  { id: 'wind_press', label: '💨 Wind & Pressure' },
  { id: 'mq9', label: '🔥 MQ-9 Gas' },
  { id: 'batt_light', label: '🔋 Battery & Light' }
];

const getDefaultStartDate = () => {
  const d = new Date(Date.now() - 24 * 60 * 60 * 1000);
  const pad = (n) => String(n).padStart(2, '0');
  return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}T${pad(d.getHours())}:${pad(d.getMinutes())}`;
};

const getDefaultEndDate = () => {
  const d = new Date();
  const pad = (n) => String(n).padStart(2, '0');
  return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}T${pad(d.getHours())}:${pad(d.getMinutes())}`;
};

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
  const [nodesMap, setNodesMap] = useState({ 1: createInitialNode(1), 2: createInitialNode(2) });
  // Selected Station: '1', '2', '3', etc., or 'all' for multi-station mesh matrix
  const [selectedStation, setSelectedStation] = useState('1');

  // History Data View Modes: 'split' (Charts + Table), 'chart' (Charts only), 'table' (Table only)
  const [historyViewMode, setHistoryViewMode] = useState('split');

  // Custom Date & Time Query State
  const [customStartDate, setCustomStartDate] = useState(getDefaultStartDate);
  const [customEndDate, setCustomEndDate] = useState(getDefaultEndDate);
  const [customLimit, setCustomLimit] = useState(1000);
  const [customQueryTrigger, setCustomQueryTrigger] = useState(0);

  // Table Log Filtering, Sorting & Pagination State
  const [tableSearch, setTableSearch] = useState('');
  const [tableNodeFilter, setTableNodeFilter] = useState('all');
  const [tableAlertFilter, setTableAlertFilter] = useState('all');
  const [tableSortAsc, setTableSortAsc] = useState(false); // false = newest first
  const [tablePage, setTablePage] = useState(1);
  const [tablePageSize, setTablePageSize] = useState(25);
  const [selectedInspectionRecord, setSelectedInspectionRecord] = useState(null);
  const [copiedRecord, setCopiedRecord] = useState(false);

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
    const apiUrl = API_BASE_URL.replace(/\/+$/, '');
    let url = `${apiUrl}/v1/devices/telemetry/history?range=${timeRange}`;

    if (timeRange === 'custom') {
      const startIso = customStartDate ? new Date(customStartDate).toISOString() : '';
      const endIso = customEndDate ? new Date(customEndDate).toISOString() : '';
      url = `${apiUrl}/v1/devices/telemetry/history?start_date=${encodeURIComponent(startIso)}&end_date=${encodeURIComponent(endIso)}&limit=${customLimit}`;
    }

    if (selectedStation !== 'all') {
      url += `&origin_node=${selectedStation}`;
    }

    fetch(url)
      .then(res => {
        if (!res.ok) throw new Error(`HTTP error! status: ${res.status}`);
        return res.json();
      })
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
  }, [timeRange, selectedStation, customQueryTrigger]);

  // Reset pagination to first page when query parameters change
  useEffect(() => {
    setTablePage(1);
  }, [tableSearch, tableNodeFilter, tableAlertFilter, tablePageSize, timeRange, selectedStation]);

  // Statistical Extrema & Aggregates calculation across currently loaded history readings
  const computedStats = useMemo(() => {
    if (!chartData || chartData.length === 0) return null;

    const validTemps = chartData.map(r => r.temp).filter(v => v !== null && v !== undefined && !isNaN(v));
    const validHums = chartData.map(r => r.humidity).filter(v => v !== null && v !== undefined && !isNaN(v));
    const validWinds = chartData.map(r => r.windSpeed).filter(v => v !== null && v !== undefined && !isNaN(v));
    const validPress = chartData.map(r => r.pressure).filter(v => v !== null && v !== undefined && !isNaN(v));
    const validBatts = chartData.map(r => r.batteryMv).filter(v => v !== null && v !== undefined && !isNaN(v));
    const validGas = chartData.map(r => r.mq9Gas ?? r.mq3Gas).filter(v => v !== null && v !== undefined && !isNaN(v));

    const timestamps = chartData.map(r => new Date(r.timestamp || 0).getTime()).filter(t => t > 0);
    const minTs = timestamps.length ? new Date(Math.min(...timestamps)) : null;
    const maxTs = timestamps.length ? new Date(Math.max(...timestamps)) : null;

    return {
      count: chartData.length,
      minTs,
      maxTs,
      temp: validTemps.length ? {
        min: Math.min(...validTemps),
        max: Math.max(...validTemps),
        avg: Number((validTemps.reduce((a, b) => a + b, 0) / validTemps.length).toFixed(1))
      } : null,
      humidity: validHums.length ? {
        min: Math.min(...validHums),
        max: Math.max(...validHums),
        avg: Number((validHums.reduce((a, b) => a + b, 0) / validHums.length).toFixed(1))
      } : null,
      windSpeed: validWinds.length ? {
        min: Math.min(...validWinds),
        max: Math.max(...validWinds),
        avg: Number((validWinds.reduce((a, b) => a + b, 0) / validWinds.length).toFixed(1))
      } : null,
      pressure: validPress.length ? {
        min: Math.min(...validPress),
        max: Math.max(...validPress),
        avg: Math.round(validPress.reduce((a, b) => a + b, 0) / validPress.length)
      } : null,
      batteryMv: validBatts.length ? {
        min: Math.min(...validBatts),
        max: Math.max(...validBatts),
        avg: Math.round(validBatts.reduce((a, b) => a + b, 0) / validBatts.length)
      } : null,
      gas: validGas.length ? {
        min: Math.min(...validGas),
        max: Math.max(...validGas),
        avg: Math.round(validGas.reduce((a, b) => a + b, 0) / validGas.length)
      } : null
    };
  }, [chartData]);

  // Filtered & Sorted Table Records
  const filteredTableData = useMemo(() => {
    let list = [...chartData];

    if (tableNodeFilter !== 'all') {
      list = list.filter(r => String(r.originNode) === String(tableNodeFilter));
    }

    if (tableAlertFilter === 'sos') {
      list = list.filter(r => (r.alertLevel || 0) > 0);
    } else if (tableAlertFilter === 'normal') {
      list = list.filter(r => !r.alertLevel || r.alertLevel === 0);
    }

    if (tableSearch.trim()) {
      const q = tableSearch.toLowerCase().trim();
      list = list.filter(r => {
        const tsStr = r.timestamp ? new Date(r.timestamp).toLocaleString().toLowerCase() : '';
        const nodeStr = `node ${r.originNode || 1}`;
        const devStr = (r.deviceId || '').toLowerCase();
        const dirStr = (r.windDirection || '').toLowerCase();
        const tempStr = r.temp !== null && r.temp !== undefined ? `${r.temp}` : '';
        const alertStr = r.alertLevel > 0 ? 'sos emergency alert' : 'normal';
        return tsStr.includes(q) || nodeStr.includes(q) || devStr.includes(q) || dirStr.includes(q) || tempStr.includes(q) || alertStr.includes(q);
      });
    }

    list.sort((a, b) => {
      const ta = new Date(a.timestamp || 0).getTime();
      const tb = new Date(b.timestamp || 0).getTime();
      return tableSortAsc ? ta - tb : tb - ta;
    });

    return list;
  }, [chartData, tableNodeFilter, tableAlertFilter, tableSearch, tableSortAsc]);

  const totalTablePages = Math.max(1, Math.ceil(filteredTableData.length / tablePageSize));
  const currentPageData = useMemo(() => {
    const start = (tablePage - 1) * tablePageSize;
    return filteredTableData.slice(start, start + tablePageSize);
  }, [filteredTableData, tablePage, tablePageSize]);

  // CSV Telemetry Export Handler
  const handleExportCSV = () => {
    if (!chartData || chartData.length === 0) return;

    const headers = [
      'Timestamp_ISO',
      'Date_Local',
      'Time_Local',
      'Station_Node',
      'Device_ID',
      'Temperature_C',
      'Humidity_Pct',
      'Wind_Speed_kmh',
      'Wind_Direction',
      'Barometric_Pressure_Pa',
      'Altitude_m',
      'MQ9_Gas_ADC',
      'Battery_mV',
      'Battery_Pct',
      'LoRa_RSSI_dBm',
      'LoRa_SNR',
      'Alert_Level',
      'Alert_Level_Name'
    ];

    const rows = chartData.map(r => {
      const d = r.timestamp ? new Date(r.timestamp) : new Date();
      return [
        `"${r.timestamp || ''}"`,
        `"${d.toLocaleDateString()}"`,
        `"${d.toLocaleTimeString()}"`,
        r.originNode ?? 1,
        `"${r.deviceId || ''}"`,
        r.temp !== null && r.temp !== undefined ? r.temp : '',
        r.humidity !== null && r.humidity !== undefined ? r.humidity : '',
        r.windSpeed !== null && r.windSpeed !== undefined ? r.windSpeed : '',
        `"${r.windDirection || 'None'}"`,
        r.pressure !== null && r.pressure !== undefined ? r.pressure : '',
        r.altitude !== null && r.altitude !== undefined ? r.altitude : '',
        r.mq9Gas ?? r.mq3Gas ?? '',
        r.batteryMv !== null && r.batteryMv !== undefined ? r.batteryMv : '',
        r.batteryPct !== null && r.batteryPct !== undefined ? r.batteryPct : '',
        r.rssi !== null && r.rssi !== undefined ? r.rssi : '',
        r.snr !== null && r.snr !== undefined ? r.snr : '',
        r.alertLevel ?? 0,
        `"${r.alertLevel > 0 ? 'EMERGENCY_SOS' : 'NORMAL'}"`
      ].join(',');
    });

    const csvContent = [headers.join(','), ...rows].join('\r\n');
    const blob = new Blob([csvContent], { type: 'text/csv;charset=utf-8;' });
    const url = URL.createObjectURL(blob);
    const link = document.createElement('a');
    const filename = `weather_history_node_${selectedStation}_${timeRange}_${new Date().toISOString().slice(0, 10)}.csv`;
    link.setAttribute('href', url);
    link.setAttribute('download', filename);
    document.body.appendChild(link);
    link.click();
    document.body.removeChild(link);
    URL.revokeObjectURL(url);
  };

  // JSON Telemetry Export Handler
  const handleExportJSON = () => {
    if (!chartData || chartData.length === 0) return;

    const exportPayload = {
      exportedAt: new Date().toISOString(),
      stationFilter: selectedStation,
      timeRange,
      totalReadings: chartData.length,
      statistics: computedStats,
      readings: chartData
    };

    const blob = new Blob([JSON.stringify(exportPayload, null, 2)], { type: 'application/json' });
    const url = URL.createObjectURL(blob);
    const link = document.createElement('a');
    const filename = `weather_history_node_${selectedStation}_${timeRange}_${new Date().toISOString().slice(0, 10)}.json`;
    link.setAttribute('href', url);
    link.setAttribute('download', filename);
    document.body.appendChild(link);
    link.click();
    document.body.removeChild(link);
    URL.revokeObjectURL(url);
  };

  // Quick Range Presets for Custom Date Picker
  const setQuickRange = (hoursAgo) => {
    const end = new Date();
    const start = new Date(end.getTime() - hoursAgo * 60 * 60 * 1000);
    const pad = (n) => String(n).padStart(2, '0');
    const formatDT = (d) => `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}T${pad(d.getHours())}:${pad(d.getMinutes())}`;
    setCustomStartDate(formatDT(start));
    setCustomEndDate(formatDT(end));
    setCustomQueryTrigger(prev => prev + 1);
  };

  const handleCopyRecord = (rec) => {
    navigator.clipboard.writeText(JSON.stringify(rec, null, 2));
    setCopiedRecord(true);
    setTimeout(() => setCopiedRecord(false), 2000);
  };

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

  const getBatteryStatus = (mv, pct) => {
    if (mv === null || mv === undefined) return { pct: null, label: 'Unknown', color: 'var(--text-muted)' };
    const p = pct !== null && pct !== undefined ? pct : Math.max(0, Math.min(100, Math.round(((mv - 3300) / 900) * 100)));
    if (p >= 75) return { pct: p, label: 'Good (Full)', color: '#10b981' };
    if (p >= 30) return { pct: p, label: 'Normal', color: '#38bdf8' };
    if (p >= 15) return { pct: p, label: 'Low Battery', color: '#f59e0b' };
    return { pct: p, label: 'Critical Low', color: '#ef4444' };
  };

  const getSignalStatus = (rssi) => {
    if (rssi === null || rssi === undefined) return { label: 'No Link', color: 'var(--text-muted)' };
    if (rssi >= -75) return { label: 'Excellent', color: '#10b981' };
    if (rssi >= -90) return { label: 'Good', color: '#38bdf8' };
    if (rssi >= -105) return { label: 'Fair (Relay)', color: '#f59e0b' };
    return { label: 'Weak Link', color: '#ef4444' };
  };

  const gasStatus = getGasStatus(weatherData.mq9Gas ?? weatherData.mq3Gas);
  const battStatus = getBatteryStatus(weatherData.batteryMv, weatherData.batteryPct);
  const signalStatus = getSignalStatus(weatherData.rssi);

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
            <span style={{ display: 'flex', alignItems: 'center', gap: 6, color: signalStatus.color, fontWeight: 600 }}>
              <Signal size={14} /> {weatherData.rssi} dBm ({signalStatus.label})
            </span>
          )}
          {battStatus.pct !== null && (
            <span style={{ display: 'flex', alignItems: 'center', gap: 6, color: battStatus.color, fontWeight: 600 }}>
              <Battery size={14} /> {battStatus.pct}% ({battStatus.label})
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

          {/* AWS Battery Voltage & Level */}
          <div className="card" style={{ padding: 18, background: 'var(--bg-surface)', border: '1px solid var(--border-strong)', borderRadius: 16 }}>
            <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between' }}>
              <div style={{ display: 'flex', alignItems: 'center', gap: 8, color: '#10b981', fontSize: '0.8rem', fontWeight: 700, textTransform: 'uppercase' }}>
                <Battery size={16} /> AWS Battery System
              </div>
              {battStatus.pct !== null && (
                <span style={{ fontSize: '0.72rem', fontWeight: 700, padding: '2px 8px', borderRadius: 6, color: battStatus.color, background: 'var(--bg-app)', border: `1px solid ${battStatus.color}` }}>
                  {battStatus.pct}% • {battStatus.label}
                </span>
              )}
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

      {/* 7. HISTORICAL WEATHER TELEMETRY, ADVANCED ANALYTICS & RECORDS LOG */}
      <div className="card" style={{ padding: 'var(--space-6)', background: 'var(--bg-surface)', border: '1px solid var(--border-strong)', borderRadius: 20, display: 'flex', flexDirection: 'column', gap: 20 }}>
        
        {/* Graph & History Header with View Mode Switcher and Export Suite */}
        <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', flexWrap: 'wrap', gap: 16 }}>
          <div>
            <div style={{ display: 'flex', alignItems: 'center', gap: 10 }}>
              <h3 style={{ fontSize: '1.25rem', fontWeight: 700, color: 'var(--text-main)', margin: 0, display: 'flex', alignItems: 'center', gap: 8 }}>
                <Activity size={22} style={{ color: 'var(--action-primary)' }} />
                Weather History Analytics & Data Records {selectedStation !== 'all' && `(Station Node #${selectedStation})`}
              </h3>
              <span style={{ fontSize: '0.75rem', fontWeight: 700, padding: '2px 8px', borderRadius: 6, background: 'var(--accent-light)', color: 'var(--action-primary)' }}>
                {timeRange === 'live' ? '⚡ LIVE STREAM' : `HISTORICAL (${timeRange.toUpperCase()})`}
              </span>
            </div>
            <p style={{ margin: '4px 0 0 0', fontSize: '0.85rem', color: 'var(--text-muted)' }}>
              Inspect meteorological trends, analyze statistical extrema, filter raw station packets, and export records.
            </p>
          </div>

          {/* Action Toolbar: View Mode Switcher + Export Buttons */}
          <div style={{ display: 'flex', alignItems: 'center', gap: 10, flexWrap: 'wrap' }}>
            {/* View Mode Switcher */}
            <div style={{ display: 'flex', alignItems: 'center', background: 'var(--bg-app)', padding: 3, borderRadius: 10, border: '1px solid var(--border-subtle)' }}>
              <button
                onClick={() => setHistoryViewMode('chart')}
                style={{
                  padding: '6px 12px',
                  fontSize: '0.8rem',
                  fontWeight: historyViewMode === 'chart' ? 700 : 500,
                  borderRadius: 8,
                  border: 'none',
                  background: historyViewMode === 'chart' ? 'var(--bg-surface)' : 'transparent',
                  color: historyViewMode === 'chart' ? 'var(--action-primary)' : 'var(--text-muted)',
                  boxShadow: historyViewMode === 'chart' ? 'var(--shadow-sm)' : 'none',
                  cursor: 'pointer',
                  display: 'flex',
                  alignItems: 'center',
                  gap: 6,
                  transition: 'all 0.2s ease'
                }}
                title="View interactive graphical trend charts"
              >
                <BarChart2 size={15} /> Charts
              </button>

              <button
                onClick={() => setHistoryViewMode('table')}
                style={{
                  padding: '6px 12px',
                  fontSize: '0.8rem',
                  fontWeight: historyViewMode === 'table' ? 700 : 500,
                  borderRadius: 8,
                  border: 'none',
                  background: historyViewMode === 'table' ? 'var(--bg-surface)' : 'transparent',
                  color: historyViewMode === 'table' ? 'var(--action-primary)' : 'var(--text-muted)',
                  boxShadow: historyViewMode === 'table' ? 'var(--shadow-sm)' : 'none',
                  cursor: 'pointer',
                  display: 'flex',
                  alignItems: 'center',
                  gap: 6,
                  transition: 'all 0.2s ease'
                }}
                title="View tabular data records and logs"
              >
                <TableIcon size={15} /> Table Log
              </button>

              <button
                onClick={() => setHistoryViewMode('split')}
                style={{
                  padding: '6px 12px',
                  fontSize: '0.8rem',
                  fontWeight: historyViewMode === 'split' ? 700 : 500,
                  borderRadius: 8,
                  border: 'none',
                  background: historyViewMode === 'split' ? 'var(--bg-surface)' : 'transparent',
                  color: historyViewMode === 'split' ? 'var(--action-primary)' : 'var(--text-muted)',
                  boxShadow: historyViewMode === 'split' ? 'var(--shadow-sm)' : 'none',
                  cursor: 'pointer',
                  display: 'flex',
                  alignItems: 'center',
                  gap: 6,
                  transition: 'all 0.2s ease'
                }}
                title="View both charts and table log together"
              >
                <Layers size={15} /> Split View
              </button>
            </div>

            {/* Export Suite Buttons */}
            <div style={{ display: 'flex', alignItems: 'center', gap: 6 }}>
              <button
                onClick={handleExportCSV}
                disabled={chartData.length === 0}
                className="btn btn-secondary"
                style={{
                  fontSize: '0.8rem',
                  padding: '6px 12px',
                  borderRadius: 10,
                  display: 'flex',
                  alignItems: 'center',
                  gap: 6,
                  fontWeight: 600,
                  opacity: chartData.length === 0 ? 0.5 : 1,
                  cursor: chartData.length === 0 ? 'not-allowed' : 'pointer'
                }}
                title="Download current historical dataset as CSV file"
              >
                <FileText size={14} style={{ color: 'var(--action-primary)' }} />
                <span>Export CSV</span>
              </button>

              <button
                onClick={handleExportJSON}
                disabled={chartData.length === 0}
                className="btn btn-secondary"
                style={{
                  fontSize: '0.8rem',
                  padding: '6px 12px',
                  borderRadius: 10,
                  display: 'flex',
                  alignItems: 'center',
                  gap: 6,
                  fontWeight: 600,
                  opacity: chartData.length === 0 ? 0.5 : 1,
                  cursor: chartData.length === 0 ? 'not-allowed' : 'pointer'
                }}
                title="Download current historical dataset and metadata as JSON"
              >
                <Database size={14} style={{ color: '#10b981' }} />
                <span>JSON</span>
              </button>
            </div>
          </div>
        </div>

        {/* Timeframe Selector Pills Bar */}
        <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', flexWrap: 'wrap', gap: 12, paddingBottom: 6 }}>
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

          <div style={{ fontSize: '0.82rem', color: 'var(--text-muted)', display: 'flex', alignItems: 'center', gap: 6 }}>
            <BarChart2 size={15} />
            <span>
              {isLoadingHistory ? 'Fetching historical readings...' : `${chartData.length} Readings in View`}
            </span>
          </div>
        </div>

        {/* Custom Date Range Toolbar (Visible when 'custom' is active) */}
        {timeRange === 'custom' && (
          <div style={{
            padding: '14px 16px',
            background: 'var(--bg-app)',
            border: '1px solid var(--border-strong)',
            borderRadius: 14,
            display: 'flex',
            flexDirection: 'column',
            gap: 12,
            animation: 'fadeIn 0.2s ease'
          }}>
            <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', flexWrap: 'wrap', gap: 10 }}>
              <div style={{ display: 'flex', alignItems: 'center', gap: 8, fontSize: '0.85rem', fontWeight: 700, color: 'var(--text-main)' }}>
                <Calendar size={16} style={{ color: 'var(--action-primary)' }} />
                <span>Specify Custom Historical Date & Time Range:</span>
              </div>

              {/* Quick Preset Buttons */}
              <div style={{ display: 'flex', alignItems: 'center', gap: 6, flexWrap: 'wrap' }}>
                <span style={{ fontSize: '0.75rem', color: 'var(--text-muted)' }}>Quick Presets:</span>
                {[
                  { label: 'Past 6h', hours: 6 },
                  { label: 'Past 24h', hours: 24 },
                  { label: 'Past 3 Days', hours: 72 },
                  { label: 'Past 7 Days', hours: 168 },
                  { label: 'Past 30 Days', hours: 720 }
                ].map(p => (
                  <button
                    key={p.label}
                    onClick={() => setQuickRange(p.hours)}
                    style={{
                      padding: '3px 8px',
                      fontSize: '0.75rem',
                      fontWeight: 600,
                      borderRadius: 6,
                      background: 'var(--bg-surface)',
                      border: '1px solid var(--border-subtle)',
                      color: 'var(--text-dim)',
                      cursor: 'pointer',
                      transition: 'all 0.15s ease'
                    }}
                  >
                    {p.label}
                  </button>
                ))}
              </div>
            </div>

            <div style={{ display: 'flex', alignItems: 'center', flexWrap: 'wrap', gap: 12 }}>
              <div style={{ display: 'flex', alignItems: 'center', gap: 6 }}>
                <label style={{ fontSize: '0.8rem', color: 'var(--text-muted)', fontWeight: 600 }}>Start (From):</label>
                <input
                  type="datetime-local"
                  value={customStartDate}
                  onChange={e => setCustomStartDate(e.target.value)}
                  style={{
                    padding: '6px 10px',
                    borderRadius: 8,
                    border: '1px solid var(--border-strong)',
                    background: 'var(--bg-surface)',
                    color: 'var(--text-main)',
                    fontSize: '0.82rem',
                    outline: 'none'
                  }}
                />
              </div>

              <div style={{ display: 'flex', alignItems: 'center', gap: 6 }}>
                <label style={{ fontSize: '0.8rem', color: 'var(--text-muted)', fontWeight: 600 }}>End (To):</label>
                <input
                  type="datetime-local"
                  value={customEndDate}
                  onChange={e => setCustomEndDate(e.target.value)}
                  style={{
                    padding: '6px 10px',
                    borderRadius: 8,
                    border: '1px solid var(--border-strong)',
                    background: 'var(--bg-surface)',
                    color: 'var(--text-main)',
                    fontSize: '0.82rem',
                    outline: 'none'
                  }}
                />
              </div>

              <div style={{ display: 'flex', alignItems: 'center', gap: 6 }}>
                <label style={{ fontSize: '0.8rem', color: 'var(--text-muted)', fontWeight: 600 }}>Limit:</label>
                <select
                  value={customLimit}
                  onChange={e => setCustomLimit(Number(e.target.value))}
                  style={{
                    padding: '6px 10px',
                    borderRadius: 8,
                    border: '1px solid var(--border-strong)',
                    background: 'var(--bg-surface)',
                    color: 'var(--text-main)',
                    fontSize: '0.82rem',
                    outline: 'none',
                    cursor: 'pointer'
                  }}
                >
                  <option value={250}>250 records</option>
                  <option value={500}>500 records</option>
                  <option value={1000}>1,000 records</option>
                  <option value={2000}>2,000 records</option>
                  <option value={3000}>3,000 records (Max)</option>
                </select>
              </div>

              <button
                onClick={() => setCustomQueryTrigger(prev => prev + 1)}
                disabled={isLoadingHistory}
                className="btn btn-primary"
                style={{
                  padding: '7px 16px',
                  borderRadius: 8,
                  fontSize: '0.82rem',
                  fontWeight: 700,
                  display: 'flex',
                  alignItems: 'center',
                  gap: 6,
                  cursor: isLoadingHistory ? 'wait' : 'pointer'
                }}
              >
                {isLoadingHistory ? <RefreshCw size={14} className="spin" /> : <Search size={14} />}
                <span>Fetch Historical Records</span>
              </button>
            </div>
          </div>
        )}

        {/* Statistical Summary Extrema Bar (Calculated Aggregates) */}
        {computedStats && (
          <div style={{
            display: 'grid',
            gridTemplateColumns: 'repeat(auto-fit, minmax(180px, 1fr))',
            gap: 12,
            padding: '14px 16px',
            background: 'var(--bg-app)',
            borderRadius: 14,
            border: '1px solid var(--border-subtle)'
          }}>
            {/* Temperature Stats */}
            <div style={{ display: 'flex', flexDirection: 'column', gap: 4 }}>
              <div style={{ display: 'flex', alignItems: 'center', gap: 6, color: '#f97316', fontSize: '0.75rem', fontWeight: 700, textTransform: 'uppercase' }}>
                <Thermometer size={14} /> Temperature Extrema
              </div>
              <div style={{ fontSize: '1.15rem', fontWeight: 800, color: 'var(--text-main)' }}>
                {computedStats.temp ? `${computedStats.temp.avg}°C` : '--'}
                <span style={{ fontSize: '0.75rem', color: 'var(--text-muted)', fontWeight: 500, marginLeft: 4 }}>avg</span>
              </div>
              <div style={{ fontSize: '0.75rem', color: 'var(--text-muted)' }}>
                Min: <strong style={{ color: 'var(--text-main)' }}>{computedStats.temp ? `${computedStats.temp.min}°C` : '--'}</strong> • Max: <strong style={{ color: 'var(--text-main)' }}>{computedStats.temp ? `${computedStats.temp.max}°C` : '--'}</strong>
              </div>
            </div>

            {/* Humidity Stats */}
            <div style={{ display: 'flex', flexDirection: 'column', gap: 4 }}>
              <div style={{ display: 'flex', alignItems: 'center', gap: 6, color: '#0284c7', fontSize: '0.75rem', fontWeight: 700, textTransform: 'uppercase' }}>
                <Droplets size={14} /> Relative Humidity
              </div>
              <div style={{ fontSize: '1.15rem', fontWeight: 800, color: 'var(--text-main)' }}>
                {computedStats.humidity ? `${computedStats.humidity.avg}%` : '--'}
                <span style={{ fontSize: '0.75rem', color: 'var(--text-muted)', fontWeight: 500, marginLeft: 4 }}>avg</span>
              </div>
              <div style={{ fontSize: '0.75rem', color: 'var(--text-muted)' }}>
                Min: <strong style={{ color: 'var(--text-main)' }}>{computedStats.humidity ? `${computedStats.humidity.min}%` : '--'}</strong> • Max: <strong style={{ color: 'var(--text-main)' }}>{computedStats.humidity ? `${computedStats.humidity.max}%` : '--'}</strong>
              </div>
            </div>

            {/* Wind Stats */}
            <div style={{ display: 'flex', flexDirection: 'column', gap: 4 }}>
              <div style={{ display: 'flex', alignItems: 'center', gap: 6, color: '#10b981', fontSize: '0.75rem', fontWeight: 700, textTransform: 'uppercase' }}>
                <Wind size={14} /> Wind Speed
              </div>
              <div style={{ fontSize: '1.15rem', fontWeight: 800, color: 'var(--text-main)' }}>
                {computedStats.windSpeed ? `${computedStats.windSpeed.max} km/h` : '--'}
                <span style={{ fontSize: '0.75rem', color: '#10b981', fontWeight: 700, marginLeft: 4 }}>gust</span>
              </div>
              <div style={{ fontSize: '0.75rem', color: 'var(--text-muted)' }}>
                Avg Speed: <strong style={{ color: 'var(--text-main)' }}>{computedStats.windSpeed ? `${computedStats.windSpeed.avg} km/h` : '--'}</strong>
              </div>
            </div>

            {/* Pressure Stats */}
            <div style={{ display: 'flex', flexDirection: 'column', gap: 4 }}>
              <div style={{ display: 'flex', alignItems: 'center', gap: 6, color: '#8b5cf6', fontSize: '0.75rem', fontWeight: 700, textTransform: 'uppercase' }}>
                <Gauge size={14} /> Barometric Pressure
              </div>
              <div style={{ fontSize: '1.15rem', fontWeight: 800, color: 'var(--text-main)' }}>
                {computedStats.pressure ? `${(computedStats.pressure.avg / 100).toFixed(1)} hPa` : '--'}
              </div>
              <div style={{ fontSize: '0.75rem', color: 'var(--text-muted)' }}>
                {computedStats.pressure ? `${computedStats.pressure.avg.toLocaleString()} Pa avg` : '--'}
              </div>
            </div>

            {/* AWS Battery Stats */}
            <div style={{ display: 'flex', flexDirection: 'column', gap: 4 }}>
              <div style={{ display: 'flex', alignItems: 'center', gap: 6, color: '#059669', fontSize: '0.75rem', fontWeight: 700, textTransform: 'uppercase' }}>
                <Battery size={14} /> Battery Extrema
              </div>
              <div style={{ fontSize: '1.15rem', fontWeight: 800, color: 'var(--text-main)' }}>
                {computedStats.batteryMv ? `${computedStats.batteryMv.avg} mV` : '--'}
              </div>
              <div style={{ fontSize: '0.75rem', color: 'var(--text-muted)' }}>
                Min: <strong style={{ color: 'var(--text-main)' }}>{computedStats.batteryMv ? `${computedStats.batteryMv.min} mV` : '--'}</strong> • Max: <strong style={{ color: 'var(--text-main)' }}>{computedStats.batteryMv ? `${computedStats.batteryMv.max} mV` : '--'}</strong>
              </div>
            </div>

            {/* Telemetry Packets Count & Interval */}
            <div style={{ display: 'flex', flexDirection: 'column', gap: 4 }}>
              <div style={{ display: 'flex', alignItems: 'center', gap: 6, color: 'var(--text-muted)', fontSize: '0.75rem', fontWeight: 700, textTransform: 'uppercase' }}>
                <Clock size={14} /> Dataset Span
              </div>
              <div style={{ fontSize: '1.15rem', fontWeight: 800, color: 'var(--text-main)' }}>
                {computedStats.count} Packets
              </div>
              <div style={{ fontSize: '0.72rem', color: 'var(--text-muted)', overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>
                {computedStats.minTs && computedStats.maxTs ? `${computedStats.minTs.toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' })} → ${computedStats.maxTs.toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' })}` : 'Live Telemetry'}
              </div>
            </div>
          </div>
        )}

        {/* 7A. VISUAL CHARTS SECTION (Shown when mode is 'chart' or 'split') */}
        {(historyViewMode === 'chart' || historyViewMode === 'split') && (
          <div style={{ display: 'flex', flexDirection: 'column', gap: 14 }}>
            {/* Metric Sensor Selector Tabs */}
            <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', flexWrap: 'wrap', gap: 12, borderBottom: '1px solid var(--border-subtle)', paddingBottom: 10 }}>
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

              <div style={{ fontSize: '0.8rem', color: 'var(--text-muted)' }}>
                {chartData.length} Data Points Rendered
              </div>
            </div>

            {/* Interactive Chart View Area */}
            <div style={{ width: '100%', height: 360, position: 'relative' }}>
              {isLoadingHistory && (
                <div style={{
                  position: 'absolute', inset: 0, background: 'rgba(255,255,255,0.7)',
                  backdropFilter: 'blur(3px)', display: 'flex', alignItems: 'center', justifyContent: 'center',
                  zIndex: 10, borderRadius: 12, fontWeight: 700, color: 'var(--action-primary)'
                }}>
                  <RefreshCw size={22} className="spin" style={{ marginRight: 8 }} /> Loading Timeframe Telemetry...
                </div>
              )}

              {chartData.length === 0 ? (
                <div style={{ height: '100%', display: 'flex', flexDirection: 'column', alignItems: 'center', justifyContent: 'center', color: 'var(--text-muted)' }}>
                  <Activity size={40} style={{ opacity: 0.3, marginBottom: 8 }} />
                  <p style={{ margin: 0, fontWeight: 600 }}>No telemetry records found for timeframe ({timeRange.toUpperCase()})</p>
                  <span style={{ fontSize: '0.8rem', marginTop: 4 }}>Select a broader date range or verify station node power.</span>
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
        )}

        {/* 7B. TABULAR HISTORICAL DATA RECORDS & LOG VIEWER (Shown when mode is 'table' or 'split') */}
        {(historyViewMode === 'table' || historyViewMode === 'split') && (
          <div style={{
            display: 'flex',
            flexDirection: 'column',
            gap: 14,
            paddingTop: historyViewMode === 'split' ? 16 : 0,
            borderTop: historyViewMode === 'split' ? '1px solid var(--border-subtle)' : 'none'
          }}>
            {/* Table Header & Search/Filter Controls Bar */}
            <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', flexWrap: 'wrap', gap: 12 }}>
              <div>
                <h4 style={{ fontSize: '1.05rem', fontWeight: 700, color: 'var(--text-main)', margin: 0, display: 'flex', alignItems: 'center', gap: 8 }}>
                  <TableIcon size={18} style={{ color: 'var(--action-primary)' }} />
                  Historical Meteorological Data Log ({filteredTableData.length} records)
                </h4>
                <span style={{ fontSize: '0.8rem', color: 'var(--text-muted)' }}>
                  Search and inspect individual packet readings from all reporting AWS stations.
                </span>
              </div>

              {/* Table Filters & Search Controls */}
              <div style={{ display: 'flex', alignItems: 'center', gap: 8, flexWrap: 'wrap' }}>
                {/* Search Bar */}
                <div style={{ position: 'relative', display: 'flex', alignItems: 'center' }}>
                  <Search size={14} style={{ position: 'absolute', left: 10, color: 'var(--text-muted)' }} />
                  <input
                    type="text"
                    placeholder="Search logs (time, temp, status)..."
                    value={tableSearch}
                    onChange={e => setTableSearch(e.target.value)}
                    style={{
                      padding: '6px 12px 6px 30px',
                      borderRadius: 8,
                      border: '1px solid var(--border-strong)',
                      background: 'var(--bg-app)',
                      color: 'var(--text-main)',
                      fontSize: '0.82rem',
                      width: 220,
                      outline: 'none'
                    }}
                  />
                  {tableSearch && (
                    <button
                      onClick={() => setTableSearch('')}
                      style={{ position: 'absolute', right: 8, background: 'none', border: 'none', color: 'var(--text-muted)', cursor: 'pointer', padding: 0 }}
                    >
                      <X size={14} />
                    </button>
                  )}
                </div>

                {/* Node Filter */}
                <select
                  value={tableNodeFilter}
                  onChange={e => setTableNodeFilter(e.target.value)}
                  style={{
                    padding: '6px 10px',
                    borderRadius: 8,
                    border: '1px solid var(--border-strong)',
                    background: 'var(--bg-app)',
                    color: 'var(--text-main)',
                    fontSize: '0.82rem',
                    outline: 'none',
                    cursor: 'pointer'
                  }}
                >
                  <option value="all">All Stations</option>
                  {discoveredNodesList.map(n => (
                    <option key={n.nodeId} value={String(n.nodeId)}>Station Node #{n.nodeId}</option>
                  ))}
                </select>

                {/* Alert Filter */}
                <select
                  value={tableAlertFilter}
                  onChange={e => setTableAlertFilter(e.target.value)}
                  style={{
                    padding: '6px 10px',
                    borderRadius: 8,
                    border: '1px solid var(--border-strong)',
                    background: 'var(--bg-app)',
                    color: 'var(--text-main)',
                    fontSize: '0.82rem',
                    outline: 'none',
                    cursor: 'pointer'
                  }}
                >
                  <option value="all">All Statuses</option>
                  <option value="normal">Normal Only</option>
                  <option value="sos">🚨 SOS Alert Only</option>
                </select>

                {/* Sort Order Toggle */}
                <button
                  onClick={() => setTableSortAsc(!tableSortAsc)}
                  className="btn btn-secondary"
                  style={{ padding: '6px 10px', fontSize: '0.8rem', borderRadius: 8, display: 'flex', alignItems: 'center', gap: 4 }}
                  title="Toggle chronological sorting"
                >
                  <SlidersHorizontal size={14} />
                  <span>{tableSortAsc ? 'Oldest First ⬆️' : 'Newest First ⬇️'}</span>
                </button>

                {/* Page Size Dropdown */}
                <select
                  value={tablePageSize}
                  onChange={e => setTablePageSize(Number(e.target.value))}
                  style={{
                    padding: '6px 8px',
                    borderRadius: 8,
                    border: '1px solid var(--border-strong)',
                    background: 'var(--bg-app)',
                    color: 'var(--text-main)',
                    fontSize: '0.82rem',
                    outline: 'none',
                    cursor: 'pointer'
                  }}
                >
                  <option value={15}>15 / page</option>
                  <option value={25}>25 / page</option>
                  <option value={50}>50 / page</option>
                  <option value={100}>100 / page</option>
                </select>
              </div>
            </div>

            {/* Scrollable Data Table Container */}
            <div style={{
              width: '100%',
              overflowX: 'auto',
              border: '1px solid var(--border-subtle)',
              borderRadius: 12,
              background: 'var(--bg-surface)'
            }}>
              <table style={{ width: '100%', borderCollapse: 'collapse', textAlign: 'left', fontSize: '0.82rem' }}>
                <thead>
                  <tr style={{ background: 'var(--bg-app)', borderBottom: '1px solid var(--border-strong)', color: 'var(--text-muted)' }}>
                    <th style={{ padding: '10px 14px', fontWeight: 700, whiteSpace: 'nowrap' }}>Timestamp</th>
                    <th style={{ padding: '10px 14px', fontWeight: 700, whiteSpace: 'nowrap' }}>Station Node</th>
                    <th style={{ padding: '10px 14px', fontWeight: 700, whiteSpace: 'nowrap' }}>Temp (°C)</th>
                    <th style={{ padding: '10px 14px', fontWeight: 700, whiteSpace: 'nowrap' }}>Humidity (%)</th>
                    <th style={{ padding: '10px 14px', fontWeight: 700, whiteSpace: 'nowrap' }}>Wind Speed</th>
                    <th style={{ padding: '10px 14px', fontWeight: 700, whiteSpace: 'nowrap' }}>Direction</th>
                    <th style={{ padding: '10px 14px', fontWeight: 700, whiteSpace: 'nowrap' }}>Pressure (Pa)</th>
                    <th style={{ padding: '10px 14px', fontWeight: 700, whiteSpace: 'nowrap' }}>Altitude</th>
                    <th style={{ padding: '10px 14px', fontWeight: 700, whiteSpace: 'nowrap' }}>Air Quality (MQ-9)</th>
                    <th style={{ padding: '10px 14px', fontWeight: 700, whiteSpace: 'nowrap' }}>Battery</th>
                    <th style={{ padding: '10px 14px', fontWeight: 700, whiteSpace: 'nowrap' }}>Signal / RF</th>
                    <th style={{ padding: '10px 14px', fontWeight: 700, whiteSpace: 'nowrap' }}>Status</th>
                    <th style={{ padding: '10px 14px', fontWeight: 700, whiteSpace: 'nowrap', textAlign: 'center' }}>Inspect</th>
                  </tr>
                </thead>
                <tbody>
                  {currentPageData.length === 0 ? (
                    <tr>
                      <td colSpan={13} style={{ padding: '30px 14px', textAlign: 'center', color: 'var(--text-muted)' }}>
                        No records match the current filter or search criteria.
                      </td>
                    </tr>
                  ) : (
                    currentPageData.map((row, idx) => {
                      const rowDate = row.timestamp ? new Date(row.timestamp) : null;
                      const timeStr = rowDate ? rowDate.toLocaleTimeString([], { hour: '2-digit', minute: '2-digit', second: '2-digit' }) : '--';
                      const dateStr = rowDate ? rowDate.toLocaleDateString([], { month: 'short', day: 'numeric' }) : '';
                      const gasInfo = getGasStatus(row.mq9Gas ?? row.mq3Gas);
                      const battInfo = getBatteryStatus(row.batteryMv, row.batteryPct);
                      const isSos = (row.alertLevel || 0) > 0;

                      return (
                        <tr
                          key={row._id || idx}
                          style={{
                            borderBottom: '1px solid var(--border-subtle)',
                            background: isSos ? 'rgba(239, 68, 68, 0.08)' : (idx % 2 === 0 ? 'transparent' : 'rgba(0,0,0,0.01)'),
                            transition: 'background 0.15s ease'
                          }}
                        >
                          {/* Timestamp */}
                          <td style={{ padding: '10px 14px', whiteSpace: 'nowrap' }}>
                            <div style={{ fontWeight: 600, color: 'var(--text-main)' }}>{timeStr}</div>
                            <div style={{ fontSize: '0.72rem', color: 'var(--text-muted)' }}>{dateStr}</div>
                          </td>

                          {/* Station Node */}
                          <td style={{ padding: '10px 14px', whiteSpace: 'nowrap' }}>
                            <span style={{
                              fontWeight: 700,
                              fontSize: '0.75rem',
                              padding: '2px 8px',
                              borderRadius: 6,
                              background: 'var(--bg-app)',
                              border: '1px solid var(--border-subtle)',
                              color: 'var(--action-primary)'
                            }}>
                              📡 Node #{row.originNode || 1}
                            </span>
                          </td>

                          {/* Temperature */}
                          <td style={{ padding: '10px 14px', whiteSpace: 'nowrap', fontWeight: 700, color: row.temp !== null ? '#ea580c' : 'var(--text-muted)' }}>
                            {row.temp !== null && row.temp !== undefined ? `${row.temp.toFixed(1)} °C` : '--'}
                          </td>

                          {/* Humidity */}
                          <td style={{ padding: '10px 14px', whiteSpace: 'nowrap', fontWeight: 600, color: row.humidity !== null ? '#0284c7' : 'var(--text-muted)' }}>
                            {row.humidity !== null && row.humidity !== undefined ? `${row.humidity.toFixed(1)} %` : '--'}
                          </td>

                          {/* Wind Speed */}
                          <td style={{ padding: '10px 14px', whiteSpace: 'nowrap', fontWeight: 600, color: row.windSpeed > 0 ? '#10b981' : 'var(--text-main)' }}>
                            {row.windSpeed !== null && row.windSpeed !== undefined ? `${row.windSpeed.toFixed(1)} km/h` : '0.0 km/h'}
                          </td>

                          {/* Direction */}
                          <td style={{ padding: '10px 14px', whiteSpace: 'nowrap', color: 'var(--text-dim)' }}>
                            {row.windDirection && row.windDirection !== 'None' ? row.windDirection : 'CALM'}
                          </td>

                          {/* Pressure */}
                          <td style={{ padding: '10px 14px', whiteSpace: 'nowrap', color: 'var(--text-dim)' }}>
                            {row.pressure !== null && row.pressure !== undefined ? `${row.pressure.toLocaleString()} Pa` : '--'}
                          </td>

                          {/* Altitude */}
                          <td style={{ padding: '10px 14px', whiteSpace: 'nowrap', color: 'var(--text-muted)' }}>
                            {row.altitude !== null && row.altitude !== undefined ? `${row.altitude.toFixed(1)} m` : '--'}
                          </td>

                          {/* Air Quality (MQ-9) */}
                          <td style={{ padding: '10px 14px', whiteSpace: 'nowrap' }}>
                            <span style={{
                              fontSize: '0.72rem',
                              fontWeight: 700,
                              padding: '2px 8px',
                              borderRadius: 6,
                              background: gasInfo.bg,
                              color: gasInfo.color
                            }}>
                              {row.mq9Gas ?? row.mq3Gas ?? '--'} ADC • {gasInfo.label}
                            </span>
                          </td>

                          {/* Battery */}
                          <td style={{ padding: '10px 14px', whiteSpace: 'nowrap' }}>
                            <span style={{ color: battInfo.color, fontWeight: 600 }}>
                              {row.batteryMv !== null && row.batteryMv !== undefined ? `${row.batteryMv} mV` : '--'}
                            </span>
                            {battInfo.pct !== null && (
                              <span style={{ fontSize: '0.72rem', color: 'var(--text-muted)', marginLeft: 4 }}>
                                ({battInfo.pct}%)
                              </span>
                            )}
                          </td>

                          {/* Signal */}
                          <td style={{ padding: '10px 14px', whiteSpace: 'nowrap', fontSize: '0.78rem', color: 'var(--text-muted)' }}>
                            {row.rssi !== null && row.rssi !== undefined ? `${row.rssi} dBm` : '--'}
                            {row.snr !== null && row.snr !== undefined ? ` (SNR: ${row.snr})` : ''}
                          </td>

                          {/* Status */}
                          <td style={{ padding: '10px 14px', whiteSpace: 'nowrap' }}>
                            <span style={{
                              fontSize: '0.72rem',
                              fontWeight: 700,
                              padding: '2px 8px',
                              borderRadius: 6,
                              background: isSos ? 'rgba(239, 68, 68, 0.2)' : 'rgba(16, 185, 129, 0.15)',
                              color: isSos ? '#ef4444' : '#10b981'
                            }}>
                              {isSos ? '🚨 SOS ALERT' : 'NORMAL'}
                            </span>
                          </td>

                          {/* Inspect Action */}
                          <td style={{ padding: '10px 14px', whiteSpace: 'nowrap', textAlign: 'center' }}>
                            <button
                              onClick={() => setSelectedInspectionRecord(row)}
                              className="btn btn-secondary"
                              style={{
                                padding: '4px 8px',
                                fontSize: '0.75rem',
                                borderRadius: 6,
                                display: 'inline-flex',
                                alignItems: 'center',
                                gap: 4
                              }}
                              title="Inspect full JSON telemetry packet"
                            >
                              <Eye size={12} /> Inspect
                            </button>
                          </td>
                        </tr>
                      );
                    })
                  )}
                </tbody>
              </table>
            </div>

            {/* Pagination Controls Footer Bar */}
            <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', flexWrap: 'wrap', gap: 12, paddingTop: 4 }}>
              <span style={{ fontSize: '0.82rem', color: 'var(--text-muted)' }}>
                Showing {filteredTableData.length === 0 ? 0 : (tablePage - 1) * tablePageSize + 1} to {Math.min(filteredTableData.length, tablePage * tablePageSize)} of {filteredTableData.length} records
              </span>

              <div style={{ display: 'flex', alignItems: 'center', gap: 6 }}>
                <button
                  onClick={() => setTablePage(1)}
                  disabled={tablePage === 1}
                  className="btn btn-secondary"
                  style={{ padding: '5px 10px', fontSize: '0.78rem', borderRadius: 8, opacity: tablePage === 1 ? 0.4 : 1, cursor: tablePage === 1 ? 'not-allowed' : 'pointer' }}
                  title="First Page"
                >
                  « First
                </button>
                <button
                  onClick={() => setTablePage(prev => Math.max(1, prev - 1))}
                  disabled={tablePage === 1}
                  className="btn btn-secondary"
                  style={{ padding: '5px 10px', fontSize: '0.78rem', borderRadius: 8, opacity: tablePage === 1 ? 0.4 : 1, cursor: tablePage === 1 ? 'not-allowed' : 'pointer' }}
                >
                  <ChevronLeft size={14} /> Prev
                </button>

                <span style={{ fontSize: '0.82rem', fontWeight: 600, color: 'var(--text-main)', padding: '0 8px' }}>
                  Page {tablePage} of {totalTablePages}
                </span>

                <button
                  onClick={() => setTablePage(prev => Math.min(totalTablePages, prev + 1))}
                  disabled={tablePage === totalTablePages}
                  className="btn btn-secondary"
                  style={{ padding: '5px 10px', fontSize: '0.78rem', borderRadius: 8, opacity: tablePage === totalTablePages ? 0.4 : 1, cursor: tablePage === totalTablePages ? 'not-allowed' : 'pointer' }}
                >
                  Next <ChevronRight size={14} />
                </button>
                <button
                  onClick={() => setTablePage(totalTablePages)}
                  disabled={tablePage === totalTablePages}
                  className="btn btn-secondary"
                  style={{ padding: '5px 10px', fontSize: '0.78rem', borderRadius: 8, opacity: tablePage === totalTablePages ? 0.4 : 1, cursor: tablePage === totalTablePages ? 'not-allowed' : 'pointer' }}
                  title="Last Page"
                >
                  Last »
                </button>
              </div>
            </div>
          </div>
        )}

      </div>

      {/* 8. TELEMETRY PACKET INSPECTION MODAL */}
      {selectedInspectionRecord && (
        <div style={{
          position: 'fixed',
          inset: 0,
          background: 'rgba(0,0,0,0.5)',
          backdropFilter: 'blur(4px)',
          display: 'flex',
          alignItems: 'center',
          justifyContent: 'center',
          zIndex: 9999,
          padding: 20
        }}>
          <div style={{
            background: 'var(--bg-surface)',
            border: '1px solid var(--border-strong)',
            borderRadius: 20,
            width: '100%',
            maxWidth: 680,
            maxHeight: '90vh',
            display: 'flex',
            flexDirection: 'column',
            boxShadow: 'var(--shadow-lg)',
            overflow: 'hidden',
            animation: 'fadeIn 0.2s ease'
          }}>
            {/* Modal Header */}
            <div style={{ padding: '16px 20px', borderBottom: '1px solid var(--border-subtle)', display: 'flex', alignItems: 'center', justifyContent: 'space-between' }}>
              <div style={{ display: 'flex', alignItems: 'center', gap: 10 }}>
                <Activity size={20} style={{ color: 'var(--action-primary)' }} />
                <div>
                  <h4 style={{ margin: 0, fontSize: '1.05rem', fontWeight: 700, color: 'var(--text-main)' }}>
                    Station Node #{selectedInspectionRecord.originNode || 1} Packet Detail
                  </h4>
                  <span style={{ fontSize: '0.78rem', color: 'var(--text-muted)' }}>
                    Device ID: <code>{selectedInspectionRecord.deviceId}</code>
                  </span>
                </div>
              </div>
              <button
                onClick={() => setSelectedInspectionRecord(null)}
                style={{ background: 'none', border: 'none', color: 'var(--text-muted)', cursor: 'pointer', padding: 4 }}
              >
                <X size={20} />
              </button>
            </div>

            {/* Modal Content */}
            <div style={{ padding: 20, overflowY: 'auto', display: 'flex', flexDirection: 'column', gap: 16 }}>
              {/* Metrics Grid */}
              <div style={{ display: 'grid', gridTemplateColumns: 'repeat(3, 1fr)', gap: 10 }}>
                <div style={{ background: 'var(--bg-app)', padding: '10px 12px', borderRadius: 10 }}>
                  <div style={{ fontSize: '0.72rem', color: 'var(--text-muted)' }}>Temperature</div>
                  <div style={{ fontSize: '1.1rem', fontWeight: 800, color: '#f97316' }}>
                    {selectedInspectionRecord.temp !== null ? `${selectedInspectionRecord.temp.toFixed(1)} °C` : '--'}
                  </div>
                </div>

                <div style={{ background: 'var(--bg-app)', padding: '10px 12px', borderRadius: 10 }}>
                  <div style={{ fontSize: '0.72rem', color: 'var(--text-muted)' }}>Humidity</div>
                  <div style={{ fontSize: '1.1rem', fontWeight: 800, color: '#0284c7' }}>
                    {selectedInspectionRecord.humidity !== null ? `${selectedInspectionRecord.humidity.toFixed(1)} %` : '--'}
                  </div>
                </div>

                <div style={{ background: 'var(--bg-app)', padding: '10px 12px', borderRadius: 10 }}>
                  <div style={{ fontSize: '0.72rem', color: 'var(--text-muted)' }}>Wind Speed & Dir</div>
                  <div style={{ fontSize: '1.1rem', fontWeight: 800, color: '#10b981' }}>
                    {selectedInspectionRecord.windSpeed !== null ? `${selectedInspectionRecord.windSpeed.toFixed(1)} km/h` : '0 km/h'}
                  </div>
                  <div style={{ fontSize: '0.72rem', color: 'var(--text-muted)' }}>{selectedInspectionRecord.windDirection || 'None'}</div>
                </div>

                <div style={{ background: 'var(--bg-app)', padding: '10px 12px', borderRadius: 10 }}>
                  <div style={{ fontSize: '0.72rem', color: 'var(--text-muted)' }}>Pressure</div>
                  <div style={{ fontSize: '1.1rem', fontWeight: 800, color: '#8b5cf6' }}>
                    {selectedInspectionRecord.pressure !== null ? `${selectedInspectionRecord.pressure.toLocaleString()} Pa` : '--'}
                  </div>
                </div>

                <div style={{ background: 'var(--bg-app)', padding: '10px 12px', borderRadius: 10 }}>
                  <div style={{ fontSize: '0.72rem', color: 'var(--text-muted)' }}>Altitude</div>
                  <div style={{ fontSize: '1.1rem', fontWeight: 800, color: 'var(--text-main)' }}>
                    {selectedInspectionRecord.altitude !== null ? `${selectedInspectionRecord.altitude.toFixed(1)} m` : '--'}
                  </div>
                </div>

                <div style={{ background: 'var(--bg-app)', padding: '10px 12px', borderRadius: 10 }}>
                  <div style={{ fontSize: '0.72rem', color: 'var(--text-muted)' }}>MQ-9 Gas (CO)</div>
                  <div style={{ fontSize: '1.1rem', fontWeight: 800, color: '#ef4444' }}>
                    {selectedInspectionRecord.mq9Gas ?? selectedInspectionRecord.mq3Gas ?? '--'} ADC
                  </div>
                </div>

                <div style={{ background: 'var(--bg-app)', padding: '10px 12px', borderRadius: 10 }}>
                  <div style={{ fontSize: '0.72rem', color: 'var(--text-muted)' }}>Battery Voltage</div>
                  <div style={{ fontSize: '1.1rem', fontWeight: 800, color: '#059669' }}>
                    {selectedInspectionRecord.batteryMv !== null ? `${selectedInspectionRecord.batteryMv} mV` : '--'}
                  </div>
                </div>

                <div style={{ background: 'var(--bg-app)', padding: '10px 12px', borderRadius: 10 }}>
                  <div style={{ fontSize: '0.72rem', color: 'var(--text-muted)' }}>LoRa Signal (RSSI)</div>
                  <div style={{ fontSize: '1.1rem', fontWeight: 800, color: 'var(--text-main)' }}>
                    {selectedInspectionRecord.rssi !== null ? `${selectedInspectionRecord.rssi} dBm` : '--'}
                  </div>
                </div>

                <div style={{ background: 'var(--bg-app)', padding: '10px 12px', borderRadius: 10 }}>
                  <div style={{ fontSize: '0.72rem', color: 'var(--text-muted)' }}>Status</div>
                  <div style={{ fontSize: '1.1rem', fontWeight: 800, color: selectedInspectionRecord.alertLevel > 0 ? '#ef4444' : '#10b981' }}>
                    {selectedInspectionRecord.alertLevel > 0 ? '🚨 EMERGENCY' : 'NORMAL'}
                  </div>
                </div>
              </div>

              {/* Raw JSON Code Block */}
              <div>
                <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', marginBottom: 6 }}>
                  <span style={{ fontSize: '0.78rem', fontWeight: 700, color: 'var(--text-dim)' }}>
                    Raw Telemetry Payload JSON:
                  </span>
                  <button
                    onClick={() => handleCopyRecord(selectedInspectionRecord)}
                    style={{
                      display: 'flex',
                      alignItems: 'center',
                      gap: 4,
                      fontSize: '0.75rem',
                      background: 'none',
                      border: 'none',
                      color: copiedRecord ? '#10b981' : 'var(--action-primary)',
                      cursor: 'pointer'
                    }}
                  >
                    {copiedRecord ? <Check size={14} /> : <Copy size={14} />}
                    <span>{copiedRecord ? 'Copied to Clipboard!' : 'Copy JSON'}</span>
                  </button>
                </div>
                <pre style={{
                  margin: 0,
                  padding: 12,
                  borderRadius: 10,
                  background: 'var(--bg-app)',
                  border: '1px solid var(--border-subtle)',
                  fontFamily: 'monospace',
                  fontSize: '0.78rem',
                  color: 'var(--text-main)',
                  maxHeight: 200,
                  overflowY: 'auto'
                }}>
                  {JSON.stringify(selectedInspectionRecord, null, 2)}
                </pre>
              </div>
            </div>

            {/* Modal Footer */}
            <div style={{ padding: '12px 20px', borderTop: '1px solid var(--border-subtle)', display: 'flex', justifyContent: 'flex-end', background: 'var(--bg-app)' }}>
              <button
                onClick={() => setSelectedInspectionRecord(null)}
                className="btn btn-primary"
                style={{ fontSize: '0.82rem', padding: '6px 16px', borderRadius: 8 }}
              >
                Close Inspector
              </button>
            </div>
          </div>
        </div>
      )}

    </div>
  );
};

export default WeatherMonitor;
