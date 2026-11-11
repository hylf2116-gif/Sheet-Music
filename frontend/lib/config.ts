// Where the backend (Express + Socket.IO) runs.
// Local development: http://localhost:3001 (default).
// Online: set NEXT_PUBLIC_BACKEND_URL in the hosting settings, e.g. https://unino-backend.up.railway.app
// (NEXT_PUBLIC_ variables are built into the page at build time, so redeploy after changing it.)
export const BACKEND_URL = (process.env.NEXT_PUBLIC_BACKEND_URL || 'http://localhost:3001').replace(/\/+$/, '');

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
