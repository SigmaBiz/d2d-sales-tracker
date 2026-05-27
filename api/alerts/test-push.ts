/**
 * Daily Pipeline Test Notification
 *
 * Sends a "pipeline alive" push to all registered devices once per day.
 * Called by cron-job.org at 6pm CDT (23:00 UTC) daily.
 *
 * Protected by ?secret=ACTIONS_SECRET query param.
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
  const secret = req.query.secret as string;
  if (!secret || secret !== process.env.ACTIONS_SECRET) {
    return res.status(401).json({ error: 'Unauthorized' });
  }

  const supabase = getSupabaseClient();

  const { data: tokenRows, error } = await supabase
    .from('push_tokens')
    .select('token')
    .eq('active', true);

  if (error) {
    console.error('[TestPush] Error fetching tokens:', error);
    return res.status(500).json({ error: 'Failed to fetch push tokens' });
  }

  const tokens: string[] = (tokenRows || []).map((r: { token: string }) => r.token);

  if (tokens.length === 0) {
    return res.status(200).json({ sent: 0, message: 'No active tokens' });
  }

  const now = new Date().toLocaleString('en-US', {
    timeZone: 'America/Chicago',
    month: 'short',
    day: 'numeric',
    hour: 'numeric',
    minute: '2-digit',
  });

  const messages = tokens.map(token => ({
    to: token,
    title: '🔔 Pipeline alive',
    body: `Notification pipeline confirmed working — ${now} CDT`,
    data: { type: 'pipeline_test' },
    sound: 'default',
    priority: 'normal',
  }));

  let sent = 0;
  for (let i = 0; i < messages.length; i += 100) {
    const chunk = messages.slice(i, i + 100);
    await axios.post('https://exp.host/--/api/v2/push/send', chunk, {
      headers: { 'Content-Type': 'application/json', 'Accept': 'application/json' },
      timeout: 10000,
    });
    sent += chunk.length;
  }

  console.log(`[TestPush] Sent pipeline test to ${sent} devices`);
  return res.status(200).json({ sent, tokens_found: tokens.length });
}
