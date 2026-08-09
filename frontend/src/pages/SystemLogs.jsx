import React, { useState, useEffect, useRef } from 'react';
import { useNavigate } from 'react-router-dom';
import { Search, RefreshCw, Terminal, Download, Radio, ShieldAlert, Cpu, Filter, Layers, Copy, Check } from 'lucide-react';
import { API_BASE_URL } from '../config';

function SystemLogs() {
  const [logs, setLogs] = useState([]);
  const [devices, setDevices] = useState([]);
  const [loading, setLoading] = useState(true);
  const [autoRefresh, setAutoRefresh] = useState(true);
  const [viewMode, setViewMode] = useState('table'); // 'table' or 'terminal'
  const [searchTerm, setSearchTerm] = useState('');
  const [selectedEventType, setSelectedEventType] = useState('all');
  const [selectedDevice, setSelectedDevice] = useState('all');
  const [limit, setLimit] = useState(200);
  const [copied, setCopied] = useState(false);
  const [currentPage, setCurrentPage] = useState(1);
  const logsPerPage = 20;

  const navigate = useNavigate();
  const token = localStorage.getItem('token');
  const terminalEndRef = useRef(null);

  useEffect(() => {
    if (!token) {
      navigate('/login');
      return;
    }

    fetchInitialData();

    let intervalId;
    if (autoRefresh) {
      intervalId = setInterval(fetchLogs, 2500);
    }
    return () => {
      if (intervalId) clearInterval(intervalId);
    };
  }, [token, autoRefresh, selectedEventType, selectedDevice, limit, searchTerm]);

  useEffect(() => {
    if (viewMode === 'terminal' && terminalEndRef.current) {
      terminalEndRef.current.scrollIntoView({ behavior: 'smooth' });
    }
  }, [logs, viewMode]);

  const fetchInitialData = async () => {
    setLoading(true);
    try {
      // 1. Fetch devices list for filter dropdown
      const devRes = await fetch(`${API_BASE_URL}/v1/devices`, {
        headers: { Authorization: `Bearer ${token}` },
      });
      const devData = await devRes.json();
      setDevices(Array.isArray(devData) ? devData : []);

      // 2. Fetch system logs
      await fetchLogs();
    } catch (err) {
      console.error('Error fetching initial logs data:', err);
    } finally {
      setLoading(false);
    }
  };

  const fetchLogs = async () => {
    try {
      let url = `${API_BASE_URL}/device/logs/system?limit=${limit}`;
      if (selectedEventType !== 'all') url += `&event_type=${selectedEventType}`;
      if (selectedDevice !== 'all') url += `&device_id=${selectedDevice}`;
      if (searchTerm) url += `&search=${encodeURIComponent(searchTerm)}`;

      const res = await fetch(url);
      const data = await res.json();
      if (data.status === 'success') {
        setLogs(Array.isArray(data.logs) ? data.logs : []);
      }
    } catch (err) {
      console.error('Error fetching system logs:', err);
    }
  };

  const handleCopyLogs = () => {
    const logText = logs.map(l => `[${new Date(l.timestamp).toLocaleString()}] [${l.event_type.toUpperCase()}] [Device: ${l.device_id}] ${l.summary} | Payload: ${JSON.stringify(l.payload)}`).join('\n');
    navigator.clipboard.writeText(logText);
    setCopied(true);
    setTimeout(() => setCopied(false), 2000);
  };

  const exportLogs = (format) => {
    if (format === 'json') {
      const dataStr = 'data:text/json;charset=utf-8,' + encodeURIComponent(JSON.stringify(logs, null, 2));
      const downloadAnchor = document.createElement('a');
      downloadAnchor.setAttribute('href', dataStr);
      downloadAnchor.setAttribute('download', `system-activity-logs-${Date.now()}.json`);
      document.body.appendChild(downloadAnchor);
      downloadAnchor.click();
      downloadAnchor.remove();
    } else if (format === 'csv') {
      let csv = 'Timestamp,Event Type,Device Name,Device ID,Source,Summary,Payload\n';
      logs.forEach(l => {
        const row = `"${new Date(l.timestamp).toISOString()}","${l.event_type}","${l.device_name}","${l.device_id}","${l.source}","${l.summary.replace(/"/g, '""')}","${JSON.stringify(l.payload).replace(/"/g, '""')}"\n`;
        csv += row;
      });
      const dataStr = 'data:text/csv;charset=utf-8,' + encodeURIComponent(csv);
      const downloadAnchor = document.createElement('a');
      downloadAnchor.setAttribute('href', dataStr);
      downloadAnchor.setAttribute('download', `system-activity-logs-${Date.now()}.csv`);
      document.body.appendChild(downloadAnchor);
      downloadAnchor.click();
      downloadAnchor.remove();
    }
  };

  const totalPages = Math.ceil(logs.length / logsPerPage);
  const paginatedLogs = logs.slice((currentPage - 1) * logsPerPage, currentPage * logsPerPage);

  return (
    <div className="flex flex-col gap-6 flex-1 h-full">
      {/* Header & Controls */}
      <div className="flex justify-between items-center flex-wrap gap-4">
        <div>
          <h1 className="text-main flex items-center gap-2 m-0" style={{ fontSize: '1.5rem', fontWeight: 600, letterSpacing: '-0.02em' }}>
            <Terminal className="text-primary" size={24} />
            System Activity & Terminal Logs
          </h1>
          <p className="text-muted text-sm mt-1 m-0">
            Real-time event stream across all devices, RFID card taps, telemetry feeds & schemas
          </p>
        </div>

        <div className="flex gap-3 items-center flex-wrap">
          {/* Mode Switcher */}
          <div className="flex rounded p-1" style={{ background: '#f1f5f9', border: '1px solid #e2e8f0' }}>
            <button
              onClick={() => setViewMode('table')}
              className={`px-3 py-1.5 rounded text-sm font-medium ${viewMode === 'table' ? 'bg-white text-main' : 'text-muted hover:text-main'}`}
              style={{ border: 'none', cursor: 'pointer', transition: 'all 0.2s', boxShadow: viewMode === 'table' ? '0 1px 3px rgba(0,0,0,0.1), 0 1px 2px rgba(0,0,0,0.06)' : 'none' }}
            >
              Structured Table
            </button>
            <button
              onClick={() => setViewMode('terminal')}
              className={`px-3 py-1.5 rounded text-sm font-medium flex items-center gap-2 ${viewMode === 'terminal' ? 'bg-gray-900 text-white' : 'text-muted hover:text-main'}`}
              style={{ border: 'none', cursor: 'pointer', transition: 'all 0.2s', boxShadow: viewMode === 'terminal' ? '0 4px 6px rgba(0,0,0,0.1)' : 'none' }}
            >
              <Terminal size={14} className={viewMode === 'terminal' ? 'text-blue-400' : ''} style={{ color: viewMode === 'terminal' ? '#60a5fa' : '' }} /> Live Terminal
            </button>
          </div>

          {/* Auto Refresh Toggle */}
          <button
            onClick={() => setAutoRefresh(!autoRefresh)}
            className={`btn btn-sm ${autoRefresh ? 'btn-primary' : 'btn-secondary'}`}
          >
            <RefreshCw size={14} className={autoRefresh ? 'spin' : ''} />
            <span>{autoRefresh ? 'Live Stream ON' : 'Paused'}</span>
          </button>

          {/* Export Buttons */}
          <button onClick={() => exportLogs('json')} className="btn btn-secondary btn-sm">
            <Download size={14} /> JSON
          </button>
          <button onClick={() => exportLogs('csv')} className="btn btn-secondary btn-sm">
            <Download size={14} /> CSV
          </button>
        </div>
      </div>

      {/* Filter Panel */}
      <div className="card card-body flex flex-wrap gap-4 items-center justify-between">
        <div className="flex gap-4 flex-wrap flex-1" style={{ minWidth: '300px' }}>
          {/* Search bar */}
          <div className="flex-1" style={{ minWidth: '240px', position: 'relative' }}>
            <Search size={15} className="text-muted" style={{ position: 'absolute', left: '12px', top: '50%', transform: 'translateY(-50%)' }} />
            <input
              type="text"
              placeholder="Search UID (e.g. 04B6D368), device ID, or keywords..."
              value={searchTerm}
              onChange={(e) => setSearchTerm(e.target.value)}
              className="form-input"
              style={{ paddingLeft: '34px' }}
            />
          </div>

          {/* Event type filter */}
          <select
            className="form-select text-sm"
            style={{ width: '180px', padding: '8px 12px', background: '#ffffff', border: '1px solid var(--border-strong)', borderRadius: 'var(--radius-md)', boxShadow: 'inset 0 1px 2px rgba(0,0,0,0.02)', outline: 'none' }}
            value={selectedEventType}
            onChange={(e) => setSelectedEventType(e.target.value)}
          >
            <option value="all">All Event Types</option>
            <option value="tap">NFC/RFID Taps</option>
            <option value="telemetry">Sensor Telemetry</option>
          </select>

          {/* Device filter */}
          <select
            className="form-select text-sm"
            style={{ width: '220px', padding: '8px 12px', background: '#ffffff', border: '1px solid var(--border-strong)', borderRadius: 'var(--radius-md)', boxShadow: 'inset 0 1px 2px rgba(0,0,0,0.02)', outline: 'none' }}
            value={selectedDevice}
            onChange={(e) => setSelectedDevice(e.target.value)}
          >
            <option value="all">All Devices ({devices.length})</option>
            {devices.map(d => (
              <option key={d.device_id} value={d.device_id}>
                {d.name} ({d.device_type})
              </option>
            ))}
          </select>
        </div>

        <div className="text-sm text-muted flex items-center gap-2">
          <span>Showing <strong>{logs.length}</strong> system log events</span>
          <button onClick={handleCopyLogs} className="btn btn-secondary btn-sm">
            {copied ? <Check size={12} /> : <Copy size={12} />}
            <span>{copied ? 'Copied' : 'Copy All'}</span>
          </button>
        </div>
      </div>

      {/* Main View Area: Table vs Terminal Console */}
      {viewMode === 'terminal' ? (
        <div className="flex flex-col gap-2 p-4 text-mono text-sm shadow-inner" style={{ background: '#0f172a', borderRadius: 'var(--radius-md)', border: '1px solid #1e293b', color: '#38bdf8', minHeight: '500px', maxHeight: '650px', overflowY: 'auto' }}>
          <div className="border-b border-gray-800 pb-2 mb-2 flex justify-between text-xs" style={{ borderColor: '#1e293b', color: '#64748b' }}>
            <span>FLAPMAIN SYSTEM EVENT LOG TERMINAL STREAM v2.4</span>
            <span>LOGS COUNT: {logs.length}</span>
          </div>

          {logs.length === 0 ? (
            <div className="text-center p-8" style={{ color: '#64748b' }}>
              No system log events matched your query.
            </div>
          ) : (
            logs.map((log) => {
              const isTap = log.event_type === 'tap';
              const color = isTap ? '#4ade80' : '#38bdf8';
              return (
                <div key={log.id} className="flex gap-3 leading-relaxed break-all">
                  <span style={{ color: '#64748b' }}>[{new Date(log.timestamp).toLocaleTimeString()}]</span>
                  <span style={{ color: color, fontWeight: 600 }}>[{log.event_type.toUpperCase()}]</span>
                  <span style={{ color: '#e2e8f0' }}>[{log.device_name}]</span>
                  <span style={{ color: '#cbd5e1' }}>{log.summary}</span>
                  <span className="text-xs" style={{ color: '#94a3b8' }}>{JSON.stringify(log.payload)}</span>
                </div>
              );
            })
          )}
          <div ref={terminalEndRef} />
        </div>
      ) : (
        <div className="card" style={{ overflowX: 'auto', overflowY: 'auto', maxHeight: '650px' }}>
          {logs.length === 0 ? (
            <div className="text-center p-12 text-muted">
              No system log events available.
            </div>
          ) : (
            <table className="table">
              <thead>
                <tr>
                  <th>Timestamp</th>
                  <th>Event Type</th>
                  <th>Device</th>
                  <th>Event Summary</th>
                  <th>Payload Details</th>
                </tr>
              </thead>
              <tbody>
                {paginatedLogs.map((log) => {
                  const isTap = log.event_type === 'tap';
                  return (
                    <tr key={log.id}>
                      <td className="text-mono text-muted text-xs whitespace-nowrap">
                        {new Date(log.timestamp).toLocaleString()}
                      </td>
                      <td>
                        <span className={`badge ${isTap ? 'badge-success' : 'badge-primary'}`}>
                          {isTap ? '💳 CARD TAP' : '📡 TELEMETRY'}
                        </span>
                      </td>
                      <td>
                        <strong className="text-main text-sm">{log.device_name}</strong>
                        <div className="text-xs text-muted mt-1">{log.device_id} ({log.device_type})</div>
                      </td>
                      <td className="text-main text-sm">
                        {log.summary}
                      </td>
                      <td className="text-mono text-xs text-muted">
                        <code className="bg-gray-50 border border-subtle rounded px-2 py-1 inline-block max-w-[340px] truncate" style={{ background: '#f8fafc' }}>
                          {JSON.stringify(log.payload)}
                        </code>
                      </td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
          )}
          {logs.length > logsPerPage && (
            <div className="card-footer flex justify-between items-center" style={{ background: '#ffffff', borderTop: '1px solid var(--border-subtle)' }}>
              <span className="text-sm text-muted">
                Showing {((currentPage - 1) * logsPerPage) + 1} to {Math.min(currentPage * logsPerPage, logs.length)} of {logs.length} entries
              </span>
              <div className="flex gap-2">
                <button 
                  className="btn btn-secondary btn-sm" 
                  disabled={currentPage === 1}
                  onClick={() => setCurrentPage(prev => Math.max(prev - 1, 1))}
                >
                  Previous
                </button>
                <button 
                  className="btn btn-secondary btn-sm" 
                  disabled={currentPage >= totalPages}
                  onClick={() => setCurrentPage(prev => Math.min(prev + 1, totalPages))}
                >
                  Next
                </button>
              </div>
            </div>
          )}
        </div>
      )}
    </div>
  );
}

export default SystemLogs;
