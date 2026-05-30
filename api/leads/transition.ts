/**
 * Lead lifecycle transition — the ONLY writer of lifecycle state.
 *
 * POST { knockId, action, note? }   (Authorization: Bearer <supabase jwt>)
 *
 * Flow:
 *   1. Verify JWT → real actor {userId, role, teamId}. (no token → 401)
 *   2. Load the knock's current status + cycle.
 *   3. resolveTransition() validates role + legality + per-cycle allowances.
 *   4. Append a lead_events row (the work ledger), update knocks.status,
 *      mirror label + close the cycle on terminal actions, ensure a lead_cycles row.
 *   5. Best-effort push to the counterparty (setter <-> runner "entanglement").
 *
 * Writes use the service-role client (bypasses RLS); legality is enforced here.
 */

import type { VercelRequest, VercelResponse } from '@vercel/node';
import axios from 'axios';
import { getServiceClient, getAuthedActor } from '../_lib/auth';
import {
  resolveTransition, isTerminal, LeadAction, LeadStatus,
} from '../_lib/leadStateMachine';

export default async function handler(req: VercelRequest, res: VercelResponse) {
  if (req.method !== 'POST') {
    return res.status(405).json({ error: 'Method not allowed' });
  }

  const supabase = getServiceClient();

  // 1. Authenticate the actor from their JWT (trust anchor for the ledger).
  const actor = await getAuthedActor(req, supabase);
  if (!actor) return res.status(401).json({ error: 'Unauthorized' });

  const { knockId, action, note } = req.body as {
    knockId?: string;
    action?: LeadAction;
    note?: string;
  };
  if (!knockId || !action) {
    return res.status(400).json({ error: 'Missing required fields: knockId, action' });
  }

  // 2. Load the knock (current status + cycle + ownership).
  const { data: knock, error: knockErr } = await supabase
    .from('knocks')
    .select('id, user_id, team_id, label, status, cycle_number, address, latitude, longitude')
    .eq('id', knockId)
    .maybeSingle();

  if (knockErr) {
    console.error('[Transition] knock load error:', knockErr);
    return res.status(500).json({ error: 'Failed to load lead' });
  }
  if (!knock) return res.status(404).json({ error: 'Lead not found' });

  // Same-team guard: actor must belong to the knock's team.
  if (knock.team_id && actor.teamId && knock.team_id !== actor.teamId) {
    return res.status(403).json({ error: 'Lead belongs to another team' });
  }

  const currentStatus = (knock.status ?? null) as LeadStatus | null;
  const cycleNumber = knock.cycle_number ?? 1;

  // 3a. Derive per-cycle allowances from the append-only ledger.
  const { data: cycleEvents } = await supabase
    .from('lead_events')
    .select('action')
    .eq('knock_id', knockId)
    .eq('cycle_number', cycleNumber);

  const recoveryUsed = (cycleEvents ?? []).some(e => e.action === 'recover');
  const overrideUsed = (cycleEvents ?? []).some(e => e.action === 'revive');

  // 3b. Validate the transition.
  const result = resolveTransition({
    action,
    currentStatus,
    role: actor.role,
    recoveryUsed,
    overrideUsed,
  });
  if (!result.ok || !result.rule) {
    return res.status(result.code ?? 409).json({ error: result.error });
  }

  const rule = result.rule;
  const toStatus = rule.to;

  // 4. Append the ledger event.
  const { error: eventErr } = await supabase.from('lead_events').insert({
    knock_id: knockId,
    cycle_number: cycleNumber,
    actor_user_id: actor.userId,
    actor_role: actor.role,
    action,
    from_status: currentStatus,
    to_status: toStatus,
    note: note ?? null,
    team_id: knock.team_id ?? actor.teamId ?? null,
  });
  if (eventErr) {
    console.error('[Transition] lead_events insert error:', eventErr);
    return res.status(500).json({ error: 'Failed to record event' });
  }

  // Update the knock's status; on the `ping` entry mark service_type=live.
  const knockUpdate: Record<string, unknown> = { status: toStatus };
  if (action === 'ping') knockUpdate.service_type = 'live';
  // Terminal actions mirror the lifecycle outcome onto the map pin's label.
  if (rule.terminal && isTerminal(toStatus)) knockUpdate.label = toStatus;

  const { error: updErr } = await supabase
    .from('knocks')
    .update(knockUpdate)
    .eq('id', knockId);
  if (updErr) {
    console.error('[Transition] knock update error:', updErr);
    return res.status(500).json({ error: 'Failed to update lead' });
  }

  // Ensure a lead_cycles row exists for this cycle; update its bookkeeping.
  await supabase.from('lead_cycles').upsert(
    {
      knock_id: knockId,
      cycle_number: cycleNumber,
      team_id: knock.team_id ?? actor.teamId ?? null,
      ...(rule.usesOverride ? { override_used: true } : {}),
      ...(rule.terminal
        ? { closed_at: new Date().toISOString(), final_status: toStatus }
        : {}),
    },
    { onConflict: 'knock_id,cycle_number' }
  );

  // 5. Best-effort push to the counterparty (don't fail the request on push error).
  notifyCounterparty(supabase, {
    knock,
    actorId: actor.userId,
    actorRole: actor.role,
    action,
    toStatus,
  }).catch(err => console.warn('[Transition] notify failed:', err?.message));

  return res.status(200).json({ ok: true, status: toStatus, label: knockUpdate.label ?? knock.label });
}

/**
 * Push the other party. Runner actions notify the setter who owns the knock;
 * setter actions (ping/recover) notify the team owner. Looks up an active token
 * by user_id (push_tokens.user_id added in Phase E2).
 */
async function notifyCounterparty(
  supabase: ReturnType<typeof getServiceClient>,
  args: {
    knock: any;
    actorId: string;
    actorRole: 'owner' | 'member' | null;
    action: LeadAction;
    toStatus: LeadStatus;
  }
) {
  const { knock, actorId, actorRole, action, toStatus } = args;

  // Determine recipient: if a runner acted, tell the setter (knock.user_id);
  // if a setter acted, tell the team owner.
  let recipientId: string | null = null;
  if (actorRole === 'owner') {
    recipientId = knock.user_id ?? null;
  } else {
    const { data: team } = await supabase
      .from('teams')
      .select('owner_id')
      .eq('id', knock.team_id)
      .maybeSingle();
    recipientId = team?.owner_id ?? null;
  }
  if (!recipientId || recipientId === actorId) return;

  const { data: tokenRow } = await supabase
    .from('push_tokens')
    .select('token')
    .eq('user_id', recipientId)
    .eq('active', true)
    .maybeSingle();
  if (!tokenRow?.token) return;

  const addr = knock.address ?? `${knock.latitude?.toFixed?.(4)}, ${knock.longitude?.toFixed?.(4)}`;
  const title = LABEL_FOR_ACTION[action] ?? 'Lead updated';

  await axios.post(
    'https://exp.host/--/api/v2/push/send',
    [{
      to: tokenRow.token,
      title,
      body: addr,
      data: { type: 'lead_update', knockId: knock.id, status: toStatus, action,
              lat: knock.latitude, lng: knock.longitude, address: knock.address },
      sound: 'default',
      priority: 'high',
    }],
    { headers: { 'Content-Type': 'application/json', Accept: 'application/json' }, timeout: 10000 }
  );
}

const LABEL_FOR_ACTION: Record<string, string> = {
  ping: '🔔 New live lead',
  complete: '✅ Inspection completed',
  processing: '⏳ Lead processing',
  signed: '🔏 Lead signed',
  arch_soft: '↩️ Lead returned — recover it',
  arch_hard: '🛑 Lead archived',
  retarget: '🎯 Lead to retarget',
  revive: '♻️ Lead revived',
  recover: '🔁 Lead re-pinged',
};
