// Centralized API Configuration for FlapMain
// In production (Passenger/Nginx), API is on the SAME domain — no port needed
// In development, fallback to the local backend port
const HOST = typeof window !== 'undefined' ? window.location.hostname : 'localhost';
const isDev = import.meta.env.DEV;
export const API_BASE_URL = (import.meta.env.VITE_API_URL || (isDev ? `http://${HOST}:5051` : window.location.origin)) + '/api';
