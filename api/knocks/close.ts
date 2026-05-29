/**
 * Close Knock Session
 *
 * Called when a canvasser saves a label (or explicitly abandons a door).
 * Records closed_at, the resulting knock_id, and outcome label.
 * Session 2 will add reward-grant logic here.
 *
 * POST { sessionId, knockId, outcomeLabel }
 * Returns { success: true }
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

  const { sessionId, knockId, outcomeLabel } = req.body as {
    sessionId?: string;
    knockId?: string;
    outcomeLabel?: string;
  };

  if (!sessionId) {
    return res.status(400).json({ error: 'Missing required field: sessionId' });
  }

  const supabase = getSupabaseClient();

  const { error } = await supabase
    .from('knock_sessions')
    .update({
      closed_at: new Date().toISOString(),
      knock_id: knockId ?? null,
      outcome_label: outcomeLabel ?? null,
    })
    .eq('id', sessionId);

  if (error) {
    console.error('[KnockClose] Supabase error:', error);
    return res.status(500).json({ error: error.message });
  }

  console.log(`[KnockClose] Session ${sessionId} closed → label: ${outcomeLabel}`);
  return res.status(200).json({ success: true });
}
