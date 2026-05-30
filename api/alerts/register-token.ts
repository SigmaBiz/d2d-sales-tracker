/**
 * Push Token Registration
 *
 * Called by the mobile app on launch to register its Expo push token.
 * Uses service role key server-side so the app never needs direct Supabase
 * write access to push_tokens.
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

  const { token, userId, deactivate } = req.body as {
    token?: string; userId?: string; deactivate?: boolean;
  };

  if (!token || typeof token !== 'string' || !token.startsWith('ExponentPushToken[')) {
    return res.status(400).json({ error: 'Invalid or missing push token' });
  }

  const supabase = getSupabaseClient();

  // Sign-out path: mark this device's token inactive so it stops receiving pushes.
  if (deactivate) {
    const { error: deErr } = await supabase
      .from('push_tokens')
      .update({ active: false, updated_at: new Date().toISOString() })
      .eq('token', token);
    if (deErr) {
      console.error('[RegisterToken] deactivate error:', deErr);
      return res.status(500).json({ error: deErr.message });
    }
    return res.status(200).json({ success: true, deactivated: true });
  }

  // Register: bind this token to the current user. One device = one current user —
  // a token must never stay mapped to a previously-signed-in account, or pushes
  // route to the wrong phone. The upsert (onConflict: token) reassigns user_id,
  // so any prior owner of this exact token is overwritten here.
  const upsertPayload: Record<string, unknown> = {
    token,
    active: true,
    updated_at: new Date().toISOString(),
  };
  if (userId) upsertPayload.user_id = userId;

  const { error } = await supabase
    .from('push_tokens')
    .upsert(upsertPayload, { onConflict: 'token' });

  if (error) {
    console.error('[RegisterToken] Supabase error:', error);
    return res.status(500).json({ error: error.message });
  }

  console.log('[RegisterToken] Registered token for user:', userId ?? '(none)');
  return res.status(200).json({ success: true });
}
