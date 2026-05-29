/**
 * Open Knock Session
 *
 * Called when a canvasser taps a house on the map and engages a homeowner.
 * Creates a knock_session row that tracks the open→close lifecycle.
 * GPS is captured at this moment for geo-verification.
 *
 * POST { userId, teamId, lat, lng, address, opened }
 *   opened — the gate's Yes/No answer (door opened or not), stored for analytics.
 * Returns { sessionId }
 */

import type { VercelRequest, VercelResponse } from '@vercel/node';
import { createClient } from '@supabase/supabase-js';

function getSupabaseClient() {
  const url = process.env.SUPABASE_URL;
  const key = process.env.SUPABASE_SERVICE_ROLE_KEY;
  if (!url || !key) throw new Error('Supabase env vars missing');
  return createClient(url, key);
}

export default async function handler(req: VercelRequest, res: VercelResponse) {
  if (req.method !== 'POST') {
    return res.status(405).json({ error: 'Method not allowed' });
  }

  const { userId, teamId, lat, lng, address, opened } = req.body as {
    userId?: string;
    teamId?: string;
    lat?: number;
    lng?: number;
    address?: string;
    opened?: boolean;
  };

  if (!userId || lat == null || lng == null) {
    return res.status(400).json({ error: 'Missing required fields: userId, lat, lng' });
  }

  const supabase = getSupabaseClient();

  const { data, error } = await supabase
    .from('knock_sessions')
    .insert({
      user_id: userId,
      team_id: teamId ?? null,
      open_gps_lat: lat,
      open_gps_lng: lng,
      address: address ?? null,
      opened: opened ?? null,
    })
    .select('id')
    .single();

  if (error) {
    console.error('[KnockOpen] Supabase error:', error);
    return res.status(500).json({ error: error.message });
  }

  console.log(`[KnockOpen] Session ${data.id} opened by ${userId} at (${lat}, ${lng})`);
  return res.status(200).json({ sessionId: data.id });
}
