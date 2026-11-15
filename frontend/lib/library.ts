// Score library helpers: the rooms this person hosts (My Scores), renaming / tagging and deleting them.
import { supabase } from './supabase';
import { backendUrl } from './config';

export interface LibraryRoom {
  roomId: string;
  scoreName: string;
  studentTag: string;
  createdAt: string | null;
  lastActive: string | null;
  annotationCount: number;
}

const HOST_PREFIX = 'unino_host_';

// Host tokens this browser holds (roomId → token).
export function getHostTokens(): Record<string, string> {
  const out: Record<string, string> = {};
  try {
    for (let i = 0; i < localStorage.length; i++) {
      const k = localStorage.key(i);
      if (k && k.startsWith(HOST_PREFIX)) {
        const v = localStorage.getItem(k);
        if (v) out[k.slice(HOST_PREFIX.length)] = v;
      }
    }
  } catch {}
  return out;
}

export function hasHostToken(roomId: string): boolean {
  try { return !!localStorage.getItem(HOST_PREFIX + roomId); } catch { return false; }
}

async function supabaseToken(): Promise<string | null> {
  try { const { data } = await supabase.auth.getSession(); return data.session?.access_token ?? null; } catch { return null; }
}

async function hostAuth(roomId: string) {
  let hostToken: string | null = null;
  try { hostToken = localStorage.getItem(HOST_PREFIX + roomId); } catch {}
  return { hostToken, supabaseToken: await supabaseToken() };
}

export async function fetchMyRooms(): Promise<LibraryRoom[]> {
  try {
    const res = await fetch(backendUrl('/my-rooms'), {
      method: 'POST', headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ tokens: getHostTokens(), supabaseToken: await supabaseToken() }),
    });
    if (!res.ok) return [];
    const body = await res.json();
    return Array.isArray(body.rooms) ? body.rooms : [];
  } catch { return []; }
}

export async function updateRoomMeta(roomId: string, changes: { scoreName?: string; studentTag?: string }): Promise<LibraryRoom | null> {
  const res = await fetch(backendUrl(`/room/${roomId}/meta`), {
    method: 'POST', headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ ...(await hostAuth(roomId)), ...changes }),
  });
  if (!res.ok) throw new Error((await res.json().catch(() => ({}))).error || 'Could not save.');
  return res.json();
}

// Deletes the room for everyone. Throws with a readable message if not allowed.
export async function deleteRoomForEveryone(roomId: string): Promise<void> {
  const res = await fetch(backendUrl(`/room/${roomId}/delete`), {
    method: 'POST', headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(await hostAuth(roomId)),
  });
  if (!res.ok && res.status !== 404) throw new Error((await res.json().catch(() => ({}))).error || 'Could not delete the room.');
  try { localStorage.removeItem(HOST_PREFIX + roomId); } catch {}
}
