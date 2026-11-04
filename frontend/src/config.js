// Centralized API Configuration for FlapMain
// In production (Passenger/Nginx), API is on the SAME domain — no port needed
// In development, fallback to the local backend port
const HOST = typeof window !== 'undefined' ? window.location.hostname : 'localhost';
const isDev = import.meta.env.DEV;

let rawUrl = import.meta.env.VITE_API_URL || (isDev ? `http://${HOST}:5003` : window.location.origin);
if (!rawUrl.endsWith('/api')) {
  rawUrl = rawUrl.replace(/\/+$/, '') + '/api';
}

export const API_BASE_URL = rawUrl;

// Auth helpers shared by pages. The backend requires a dashboard JWT on
// history/log endpoints and on the Socket.io handshake.
export const getToken = () => {
  try {
    return localStorage.getItem('token') || '';
  } catch {
    return '';
  }
};

export const authHeaders = (extra = {}) => {
  const token = getToken();
  return token ? { ...extra, Authorization: `Bearer ${token}` } : { ...extra };
};

// Pass as socket.io-client options: io(url, socketOptions()).
// `auth` as a callback re-reads the token on every reconnect.
export const socketOptions = (extra = {}) => ({
  ...extra,
  auth: (cb) => cb({ token: getToken() }),
});
