/**
 * Server-side role/team lookup.
 *
 * The mobile client filters UI by role for convenience, but it cannot be trusted
 * for money/access decisions. Every lifecycle transition endpoint (F2b+) must call
 * getActorContext() and enforce the rule server-side — e.g. a setter (member) must
 * not be able to write a `signed` status.
 *
 * Uses the service-role key (same pattern as api/alerts/ping-owner.ts).
 */

import { createClient, SupabaseClient } from '@supabase/supabase-js';

export type TeamRole = 'owner' | 'member';

export interface ActorContext {
  userId: string;
  role: TeamRole | null;   // null = not on a team
  teamId: string | null;
}

export function getServiceClient(): SupabaseClient {
  const url = process.env.SUPABASE_URL;
  const key = process.env.SUPABASE_SERVICE_ROLE_KEY;
  if (!url || !key) throw new Error('Supabase env vars missing');
  return createClient(url, key);
}

/**
 * Verify the caller's Supabase JWT (Authorization: Bearer <token>) and resolve
 * their real user id + team role. This is the trust anchor for the work ledger:
 * the client cannot claim to be someone else, so a setter can't record a
 * runner-only validation against their own tally.
 *
 * Returns null when the token is missing/invalid (caller should 401).
 */
export async function getAuthedActor(
  req: { headers: Record<string, string | string[] | undefined> },
  client?: SupabaseClient
): Promise<ActorContext | null> {
  const raw = req.headers['authorization'] ?? req.headers['Authorization'];
  const header = Array.isArray(raw) ? raw[0] : raw;
  const token = header?.startsWith('Bearer ') ? header.slice(7) : undefined;
  if (!token) return null;

  const supabase = client ?? getServiceClient();
  const { data, error } = await supabase.auth.getUser(token);
  if (error || !data?.user) return null;

  return getActorContext(data.user.id, supabase);
}

/**
 * Resolve a user's team role + team id from team_members.
 * Returns role/teamId null when the user isn't on a team.
 */
export async function getActorContext(
  userId: string,
  client?: SupabaseClient
): Promise<ActorContext> {
  const supabase = client ?? getServiceClient();
  const { data, error } = await supabase
    .from('team_members')
    .select('role, team_id')
    .eq('user_id', userId)
    .maybeSingle();

  if (error) {
    console.error('[auth] getActorContext error:', error);
    return { userId, role: null, teamId: null };
  }

  return {
    userId,
    role: (data?.role as TeamRole) ?? null,
    teamId: (data?.team_id as string) ?? null,
  };
}

export function isOwner(ctx: ActorContext): boolean {
  return ctx.role === 'owner';
}
