import { supabase } from './supabase';

export interface RecentSession {
  id: string;
  room_id: string;
  score_name: string;
  last_accessed: string;
}

/** Upsert a session record, then trim the user's list to 10. */
export async function upsertSession(
  userId: string,
  roomId: string,
  scoreName: string,
): Promise<void> {
  const { error } = await supabase.from('recent_sessions').upsert(
    { user_id: userId, room_id: roomId, score_name: scoreName, last_accessed: new Date().toISOString() },
    { onConflict: 'user_id,room_id' },
  );
  if (error) { console.error('Failed to save session:', error); return; }

  // Keep only 10 most-recent rows per user.
  const { data: all } = await supabase
    .from('recent_sessions')
    .select('id')
    .eq('user_id', userId)
    .order('last_accessed', { ascending: false });
  if (all && all.length > 10) {
    const excess = all.slice(10).map(r => r.id);
    await supabase.from('recent_sessions').delete().in('id', excess);
  }
}

/** Delete a single session record by id. */
export async function deleteSession(id: string): Promise<void> {
  const { error } = await supabase.from('recent_sessions').delete().eq('id', id);
  if (error) console.error('Failed to delete session:', error);
}

/** Fetch up to `limit` sessions for the user, newest first. */
export async function fetchRecentSessions(
  userId: string,
  limit = 10,
): Promise<RecentSession[]> {
  const { data, error } = await supabase
    .from('recent_sessions')
    .select('id, room_id, score_name, last_accessed')
    .eq('user_id', userId)
    .order('last_accessed', { ascending: false })
    .limit(limit);
  if (error) {
    // Table doesn't exist yet — ignore gracefully until migration is run
    if (!error.message?.includes('does not exist')) {
      console.error('Failed to fetch sessions:', error);
    }
    return [];
  }
  return data ?? [];
}
