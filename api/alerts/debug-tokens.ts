import type { VercelRequest, VercelResponse } from '@vercel/node';
import { createClient } from '@supabase/supabase-js';

export default async function handler(req: VercelRequest, res: VercelResponse) {
  const secret = req.query.secret as string;
  if (!secret || secret !== process.env.ACTIONS_SECRET) {
    return res.status(401).json({ error: 'Unauthorized' });
  }
  const supabase = createClient(process.env.SUPABASE_URL!, process.env.SUPABASE_SERVICE_ROLE_KEY!);
  const { data, error } = await supabase.from('push_tokens').select('token, active, created_at');
  return res.status(200).json({ rows: data, error: error?.message });
}
