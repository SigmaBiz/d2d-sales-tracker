/**
 * Join Team by invite code.
 *
 * The `teams` table is RLS-locked so a non-member cannot read a team row — which
 * means the client can't resolve an invite code to a team id before joining
 * (chicken-and-egg). This endpoint does the lookup + membership insert with the
 * service-role key, authenticated by the caller's JWT, so invite codes stay
 * non-enumerable while joins still work.
 *
 * POST { inviteCode }   (Authorization: Bearer <supabase jwt>)
 * → { success, team: { id, name, invite_code } } or { error }
 */

import type { VercelRequest, VercelResponse } from '@vercel/node';
import { getServiceClient, getAuthedActor } from '../_lib/auth';

export default async function handler(req: VercelRequest, res: VercelResponse) {
  if (req.method !== 'POST') {
    return res.status(405).json({ error: 'Method not allowed' });
  }

  const supabase = getServiceClient();

  // Authenticate the caller from their JWT.
  const actor = await getAuthedActor(req, supabase);
  if (!actor) return res.status(401).json({ error: 'Unauthorized' });

  const { inviteCode } = req.body as { inviteCode?: string };
  const code = inviteCode?.toUpperCase().trim();
  if (!code) return res.status(400).json({ error: 'Missing invite code' });

  // 1. Resolve the code → team (service role bypasses RLS).
  const { data: team, error: lookupErr } = await supabase
    .from('teams')
    .select('id, name, invite_code')
    .eq('invite_code', code)
    .maybeSingle();

  if (lookupErr) {
    console.error('[JoinTeam] lookup error:', lookupErr);
    return res.status(500).json({ error: 'Lookup failed' });
  }
  if (!team) return res.status(404).json({ error: 'Invalid invite code' });

  // 2. Already a member? Return success idempotently.
  const { data: existing } = await supabase
    .from('team_members')
    .select('team_id, role')
    .eq('user_id', actor.userId)
    .eq('team_id', team.id)
    .maybeSingle();

  if (existing) {
    return res.status(200).json({ success: true, team });
  }

  // 3. Insert membership as a member.
  const { error: joinErr } = await supabase.from('team_members').insert({
    team_id: team.id,
    user_id: actor.userId,
    role: 'member',
  });

  if (joinErr) {
    if (joinErr.code === '23505') {
      return res.status(200).json({ success: true, team }); // race: already joined
    }
    console.error('[JoinTeam] insert error:', joinErr);
    return res.status(500).json({ error: joinErr.message });
  }

  console.log(`[JoinTeam] ${actor.userId} joined team ${team.id}`);
  return res.status(200).json({ success: true, team });
}
