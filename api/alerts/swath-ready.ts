/**
 * Tier 2 — Swath Ready Notification
 *
 * Called by GitHub Actions after MESH data is uploaded to R2.
 * Sends a second push notification: "Hail map ready — open to target streets."
 *
 * Protected by a shared secret (x-actions-secret header) so only the
 * Actions workflow can trigger it.
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

function formatDate(dateStr: string): string {
  // "2026-05-27" → "May 27, 2026"
  const [year, month, day] = dateStr.split('-').map(Number);
  const d = new Date(year, month - 1, day);
  return d.toLocaleDateString('en-US', { month: 'long', day: 'numeric', year: 'numeric' });
}

export default async function handler(req: VercelRequest, res: VercelResponse) {
  if (req.method !== 'POST') {
    return res.status(405).json({ error: 'Method not allowed' });
  }

  // Verify shared secret
  const secret = req.headers['x-actions-secret'];
  if (!secret || secret !== process.env.ACTIONS_SECRET) {
    return res.status(401).json({ error: 'Unauthorized' });
  }

  const { date } = req.body as { date?: string };
  if (!date || !/^\d{4}-\d{2}-\d{2}$/.test(date)) {
    return res.status(400).json({ error: 'date required (YYYY-MM-DD)' });
  }

  const supabase = getSupabaseClient();

  // Fetch all active push tokens
  const { data: tokenRows, error } = await supabase
    .from('push_tokens')
    .select('token')
    .eq('active', true);

  if (error) {
    console.error('[SwathReady] Error fetching tokens:', error);
    return res.status(500).json({ error: 'Failed to fetch push tokens' });
  }

  const tokens: string[] = (tokenRows || []).map((r: { token: string }) => r.token);

  if (tokens.length === 0) {
    console.log('[SwathReady] No active push tokens — skipping notification');
    return res.status(200).json({ sent: 0, date });
  }

  const formattedDate = formatDate(date);
  const title = `🗺️ Hail Map Ready — ${formattedDate}`;
  const body = 'Open app to see the targeting map and start canvassing.';

  const messages = tokens.map(token => ({
    to: token,
    title,
    body,
    data: { type: 'swath_ready', date },
    sound: 'default',
    priority: 'high',
    channelId: 'hail-alerts',
  }));

  // Send in chunks of 100 (Expo limit)
  let sent = 0;
  for (let i = 0; i < messages.length; i += 100) {
    const chunk = messages.slice(i, i + 100);
    await axios.post('https://exp.host/--/api/v2/push/send', chunk, {
      headers: { 'Content-Type': 'application/json', 'Accept': 'application/json' },
      timeout: 10000,
    });
    sent += chunk.length;
  }

  console.log(`[SwathReady] Sent swath-ready notification for ${date} to ${sent} devices`);
  return res.status(200).json({ sent, date, title });
}
