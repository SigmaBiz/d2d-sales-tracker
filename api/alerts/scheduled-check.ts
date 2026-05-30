/**
 * Scheduled-reminder sweep.
 *
 * Polled by cron-job.org (~every 15 min). Finds scheduled_reminders that are due
 * (fire_at <= now, not sent, not canceled) and pushes the runner for each, then
 * marks them sent. Precomputed rows mean no date math here — just a sweep.
 *
 * GET ?secret=ACTIONS_SECRET
 */

import type { VercelRequest, VercelResponse } from '@vercel/node';
import axios from 'axios';
import { createClient, SupabaseClient } from '@supabase/supabase-js';

function getSupabaseClient(): SupabaseClient {
  const url = process.env.SUPABASE_URL;
  const key = process.env.SUPABASE_SERVICE_ROLE_KEY;
  if (!url || !key) throw new Error('Supabase env vars missing');
  return createClient(url, key);
}

const REMINDER_TITLE: Record<string, string> = {
  scheduled: '📅 Inspection scheduled — confirm it',
  '2d': '📅 Inspection in 2 days',
  '1d': '📅 Inspection tomorrow',
  '2h': '⏰ Inspection in 2 hours',
};

export default async function handler(req: VercelRequest, res: VercelResponse) {
  const secret = req.query.secret as string;
  if (!secret || secret !== process.env.ACTIONS_SECRET) {
    return res.status(401).json({ error: 'Unauthorized' });
  }

  const supabase = getSupabaseClient();
  const nowIso = new Date().toISOString();

  // 1. Due reminders (oldest first), capped per run.
  const { data: due, error: dueErr } = await supabase
    .from('scheduled_reminders')
    .select('id, knock_id, runner_user_id, kind, appointment_at')
    .is('sent_at', null)
    .is('canceled_at', null)
    .lte('fire_at', nowIso)
    .order('fire_at', { ascending: true })
    .limit(200);

  if (dueErr) {
    console.error('[ScheduledCheck] query error:', dueErr);
    return res.status(500).json({ error: dueErr.message });
  }
  if (!due || due.length === 0) {
    return res.status(200).json({ ok: true, fired: 0 });
  }

  // 2. Pull knock coords/address (for teleport) for the affected leads.
  const knockIds = [...new Set(due.map(r => r.knock_id))];
  const { data: knocks } = await supabase
    .from('knocks')
    .select('id, address, latitude, longitude')
    .in('id', knockIds);
  const knockById = new Map((knocks ?? []).map(k => [k.id, k]));

  let fired = 0;
  for (const rem of due) {
    try {
      // Active tokens for the runner (multi-device).
      const { data: tokenRows } = await supabase
        .from('push_tokens')
        .select('token')
        .eq('user_id', rem.runner_user_id)
        .eq('active', true);
      const tokens = (tokenRows ?? []).map(r => r.token).filter(Boolean);

      const k = knockById.get(rem.knock_id);
      const addr = k?.address ?? 'a scheduled inspection';

      if (tokens.length > 0) {
        await axios.post(
          'https://exp.host/--/api/v2/push/send',
          tokens.map(token => ({
            to: token,
            title: REMINDER_TITLE[rem.kind] ?? '📅 Inspection reminder',
            body: addr,
            data: {
              type: 'lead_reminder',
              knockId: rem.knock_id,
              kind: rem.kind,
              appointment_at: rem.appointment_at,
              lat: k?.latitude, lng: k?.longitude, address: k?.address,
            },
            sound: 'default',
            priority: 'high',
          })),
          { headers: { 'Content-Type': 'application/json', Accept: 'application/json' }, timeout: 10000 }
        );
      }

      // Mark sent regardless of token presence (a runner with no token shouldn't
      // keep the reminder pending forever).
      await supabase.from('scheduled_reminders')
        .update({ sent_at: new Date().toISOString() })
        .eq('id', rem.id);
      fired++;
    } catch (err: any) {
      console.warn('[ScheduledCheck] reminder', rem.id, 'failed:', err?.message);
      // Leave sent_at null so it retries next sweep.
    }
  }

  console.log(`[ScheduledCheck] fired ${fired}/${due.length} reminders`);
  return res.status(200).json({ ok: true, fired });
}
