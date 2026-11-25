// Where the backend (Express + Socket.IO) runs.
// Local development: http://localhost:3001 (default).
// Online: set NEXT_PUBLIC_BACKEND_URL in the hosting settings, e.g. https://unino-backend.up.railway.app
// (NEXT_PUBLIC_ variables are built into the page at build time, so redeploy after changing it.)
// Without that setting, the backend is on the same computer that served this page, port 3001:
// so an iPad or phone opening http://192.168.x.x:3000 talks to http://192.168.x.x:3001
// (on the iPad itself, "localhost" would mean the iPad).
const SAME_HOST = typeof window !== 'undefined' ? `${window.location.protocol}//${window.location.hostname}:3001` : 'http://localhost:3001';
export const BACKEND_URL = (process.env.NEXT_PUBLIC_BACKEND_URL || SAME_HOST).replace(/\/+$/, '');

// Build a full backend URL from a path such as '/room/123'.
export function backendUrl(path: string): string {
  return `${BACKEND_URL}${path.startsWith('/') ? path : `/${path}`}`;
}

// PDFs are stored as '/uploads/<file>.pdf' (no server name, so links survive a domain change).
// Older rooms may still hold a full URL; those are returned unchanged.
export function resolvePdfUrl(url: string | null | undefined): string | null {
  if (!url) return null;
  return url.startsWith('/') ? backendUrl(url) : url;
}
