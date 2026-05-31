/**
 * Ping Owner — Live Inspection Alert
 *
 * Called by a canvasser when they've engaged a homeowner and want to alert
 * the owner to drive out for a live inspection.
 *
 * POST { userId, canvasserName, address, lat, lng }
 * → Looks up the canvasser's team, finds owner_id, fetches owner's push token,
 *   sends a targeted push notification with address + GPS coordinates.
 *
 * Requires push_tokens.user_id column (see Supabase migration notes).
 */

import type { VercelRequest, VercelResponse } from '@vercel/node';
import axios from 'axios';
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

  const { userId, canvasserName, address, lat, lng } = req.body as {
    userId?: string;
    canvasserName?: string;
    address?: string;
    lat?: number;
    lng?: number;
  };

  if (!userId || !address || lat == null || lng == null) {
    return res.status(400).json({ error: 'Missing required fields: userId, address, lat, lng' });
  }

  const name = canvasserName?.trim() || 'A canvasser';
  const supabase = getSupabaseClient();

  // 1. Find the canvasser's team membership
  const { data: membership, error: memberErr } = await supabase
    .from('team_members')
    .select('team_id')
    .eq('user_id', userId)
    .maybeSingle();

  if (memberErr) {
    console.error('[PingOwner] Error looking up team membership:', memberErr);
    return res.status(500).json({ error: 'Failed to look up team' });
  }

  if (!membership) {
    return res.status(404).json({ error: 'Canvasser is not on a team' });
  }

  // 2. Find the team's owner
  const { data: team, error: teamErr } = await supabase
    .from('teams')
    .select('owner_id')
    .eq('id', membership.team_id)
    .maybeSingle();

  if (teamErr || !team) {
    console.error('[PingOwner] Error looking up team:', teamErr);
    return res.status(500).json({ error: 'Failed to look up team owner' });
  }

  // If the canvasser IS the owner (solo or owner testing), still send to themselves
  const ownerId = team.owner_id;

  // 3. Get owner's push token
  const { data: tokenRow, error: tokenErr } = await supabase
    .from('push_tokens')
    .select('token')
    .eq('user_id', ownerId)
    .eq('active', true)
    .maybeSingle();

  if (tokenErr) {
    console.error('[PingOwner] Error fetching owner token:', tokenErr);
    return res.status(500).json({ error: 'Failed to fetch owner push token' });
  }

  if (!tokenRow) {
    return res.status(404).json({ error: 'Owner has no registered push token' });
  }

  // 4. Send push notification to owner
  const message = {
    to: tokenRow.token,
    title: '🔔 Live Inspection',
    body: `${name} at ${address}`,
    data: {
      type: 'live_inspection',
      lat,
      lng,
      address,
      canvasserName: name,
    },
    sound: 'default',
    priority: 'high',
  };

  try {
    await axios.post('https://exp.host/--/api/v2/push/send', [message], {
      headers: { 'Content-Type': 'application/json', 'Accept': 'application/json' },
      timeout: 10000,
    });
  } catch (pushErr: any) {
    console.error('[PingOwner] Push send failed:', pushErr?.message);
    return res.status(502).json({ error: 'Push notification failed' });
  }

  // 5. Log ping to ping_log (non-blocking — best effort)
  supabase.from('ping_log').insert({
    from_user_id: userId,
    to_user_id: ownerId,
    team_id: membership.team_id,
    address,
    lat,
    lng,
  }).then(({ error }) => {
    if (error) console.warn('[PingOwner] ping_log insert failed:', error.message);
  });

  console.log(`[PingOwner] Sent live inspection alert to owner for ${address}`);
  return res.status(200).json({ success: true });
}
