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
  resolveTransition, isTerminal, computeReminderFireTimes, LeadAction, LeadStatus,
} from '../_lib/leadStateMachine';

export default async function handler(req: VercelRequest, res: VercelResponse) {
  if (req.method !== 'POST') {
    return res.status(405).json({ error: 'Method not allowed' });
  }

  const supabase = getServiceClient();

  // 1. Authenticate the actor from their JWT (trust anchor for the ledger).
  const actor = await getAuthedActor(req, supabase);
  if (!actor) return res.status(401).json({ error: 'Unauthorized' });

  const { knockId, action, note, appointmentAt } = req.body as {
    knockId?: string;
    action?: LeadAction;
    note?: string;
    appointmentAt?: string; // ISO — required for schedule/reschedule
  };
  if (!knockId || !action) {
    return res.status(400).json({ error: 'Missing required fields: knockId, action' });
  }
  if ((action === 'schedule' || action === 'reschedule') && !appointmentAt) {
    return res.status(400).json({ error: 'Missing appointmentAt for scheduling' });
  }

  // 2. Load the knock (current status + cycle + ownership).
  const { data: knock, error: knockErr } = await supabase
    .from('knocks')
    .select('id, user_id, team_id, label, status, cycle_number, service_type, appointment_at, address, latitude, longitude')
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

  // recover and reschedule share the single per-cycle recovery allowance.
  const recoveryUsed = (cycleEvents ?? []).some(e => e.action === 'recover' || e.action === 'reschedule');
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

  // 3c. Nudge cap — max 2 per cycle, only while the runner hasn't acknowledged.
  if (action === 'nudge') {
    const nudgeCount = (cycleEvents ?? []).filter(e => e.action === 'nudge').length;
    if (nudgeCount >= 2) {
      return res.status(409).json({ error: 'Nudge limit reached (2 per cycle)' });
    }
    const acknowledged = (cycleEvents ?? []).some(e => e.action === 'confirm');
    if (acknowledged) {
      return res.status(409).json({ error: 'Runner already acknowledged' });
    }
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

  // Update the knock's status (skip for idempotent actions like nudge — status unchanged).
  const knockUpdate: Record<string, unknown> = { status: toStatus };
  if (action === 'ping') knockUpdate.service_type = 'live';
  if (action === 'schedule' || action === 'reschedule') {
    knockUpdate.service_type = 'scheduled';
    knockUpdate.appointment_at = appointmentAt;
  }
  // Terminal actions mirror the lifecycle outcome onto the map pin's label.
  if (rule.terminal && isTerminal(toStatus)) knockUpdate.label = toStatus;

  if (!rule.idempotent) {
    const { error: updErr } = await supabase
      .from('knocks')
      .update(knockUpdate)
      .eq('id', knockId);
    if (updErr) {
      console.error('[Transition] knock update error:', updErr);
      return res.status(500).json({ error: 'Failed to update lead' });
    }
  }

  // ── Scheduled-reminder bookkeeping ──────────────────────────────────────────
  // schedule/reschedule: (re)create the reminder set. confirm/arch_*: cancel pending.
  try {
    if (action === 'schedule' || action === 'reschedule') {
      // Cancel any leftover pending reminders from a prior cycle/schedule, then seed fresh.
      await supabase.from('scheduled_reminders')
        .update({ canceled_at: new Date().toISOString() })
        .eq('knock_id', knockId).is('sent_at', null).is('canceled_at', null);

      const appt = new Date(appointmentAt as string);
      const runnerId = await resolveRunnerId(supabase, knock);
      if (runnerId) {
        // Proportional reminders scaled to the lead window (booking → appointment),
        // with a day-of safety net for far-out bookings. See computeReminderFireTimes.
        const now = new Date();
        const fires = computeReminderFireTimes(now, appt, now);
        const rows = fires.map(f => ({
          knock_id: knockId,
          runner_user_id: runnerId,
          team_id: knock.team_id ?? actor.teamId ?? null,
          appointment_at: appt.toISOString(),
          fire_at: f.fireAt.toISOString(),
          kind: f.kind,
        }));
        if (rows.length) await supabase.from('scheduled_reminders').insert(rows);
      }
    } else if (action === 'confirm' || action === 'arch_soft' || action === 'arch_hard') {
      // Acknowledged or dead — stop pending reminders.
      await supabase.from('scheduled_reminders')
        .update({ canceled_at: new Date().toISOString() })
        .eq('knock_id', knockId).is('sent_at', null).is('canceled_at', null);
    }
  } catch (remErr: any) {
    console.warn('[Transition] reminder bookkeeping failed:', remErr?.message);
  }

  // Ensure a lead_cycles row exists for this cycle; update its bookkeeping.
  // (Skip for idempotent nudge — no state change to record.)
  if (!rule.idempotent) {
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
  }

  // 5. Push the counterparty. MUST await — on Vercel the function freezes the
  //    instant the handler returns, suspending any in-flight fetch, which delivers
  //    the push only on the NEXT invocation (the "ping arrives one action late" bug).
  //    Best-effort: a push failure must not fail the transition itself.
  try {
    await notifyCounterparty(supabase, {
      knock,
      actorId: actor.userId,
      actorRole: actor.role,
      action,
      toStatus,
    });
  } catch (err: any) {
    console.warn('[Transition] notify failed:', err?.message);
  }

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

  // A user may have multiple active tokens (multiple devices / reinstalls).
  // maybeSingle() ERRORS on >1 row — fetch all and push to each.
  const { data: tokenRows } = await supabase
    .from('push_tokens')
    .select('token')
    .eq('user_id', recipientId)
    .eq('active', true);
  const tokens = (tokenRows ?? []).map(r => r.token).filter(Boolean);
  if (tokens.length === 0) return;

  const addr = knock.address ?? `${knock.latitude?.toFixed?.(4)}, ${knock.longitude?.toFixed?.(4)}`;
  const title = LABEL_FOR_ACTION[action] ?? 'Lead updated';

  await axios.post(
    'https://exp.host/--/api/v2/push/send',
    tokens.map(token => ({
      to: token,
      title,
      body: addr,
      data: { type: 'lead_update', knockId: knock.id, status: toStatus, action,
              lat: knock.latitude, lng: knock.longitude, address: knock.address },
      sound: 'default',
      priority: 'high',
    })),
    { headers: { 'Content-Type': 'application/json', Accept: 'application/json' }, timeout: 10000 }
  );
}

const LABEL_FOR_ACTION: Record<string, string> = {
  ping: '🔔 New live lead',
  schedule: '📅 New scheduled inspection',
  confirm: '👍 Inspection confirmed',
  complete: '✅ Inspection completed',
  processing: '⏳ Lead processing',
  signed: '🔏 Lead signed',
  arch_soft: '↩️ Lead returned — recover it',
  arch_hard: '🪦 Lead archived',
  retarget: '🎯 Lead to retarget',
  revive: '♻️ Lead revived',
  recover: '🔁 Lead re-pinged',
  reschedule: '📅 Inspection rescheduled',
  nudge: '👈 Nudge — confirm this lead',
};

/** The runner who should receive scheduled reminders = the knock's team owner. */
async function resolveRunnerId(
  supabase: ReturnType<typeof getServiceClient>,
  knock: any
): Promise<string | null> {
  if (!knock.team_id) return null;
  const { data: team } = await supabase
    .from('teams')
    .select('owner_id')
    .eq('id', knock.team_id)
    .maybeSingle();
  return team?.owner_id ?? null;
}
