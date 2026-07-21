// Centralized API Configuration for FlapMain
// Adapts dynamically to localhost or Local LAN IP (e.g. 192.168.1.80)
const HOST = typeof window !== 'undefined' ? window.location.hostname : 'localhost';
export const API_BASE_URL = import.meta.env.VITE_API_URL || `http://${HOST}:5055`;
