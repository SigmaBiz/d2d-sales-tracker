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

  const { token } = req.body as { token?: string };

  if (!token || typeof token !== 'string' || !token.startsWith('ExponentPushToken[')) {
    return res.status(400).json({ error: 'Invalid or missing push token' });
  }

  const supabase = getSupabaseClient();

  const { error } = await supabase
    .from('push_tokens')
    .upsert(
      { token, active: true, updated_at: new Date().toISOString() },
      { onConflict: 'token' }
    );

  if (error) {
    console.error('[RegisterToken] Supabase error:', error);
    return res.status(500).json({ error: error.message });
  }

  console.log('[RegisterToken] Registered:', token);
  return res.status(200).json({ success: true });
}
