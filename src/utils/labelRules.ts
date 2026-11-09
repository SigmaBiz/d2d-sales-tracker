/**
 * Label progression rules — pure, no I/O (mirrors utils/analytics.ts).
 *
 * Owner's model (2026-11-08): the app tracks CONVERSION, not contacts. Progress
 * is discretised to lead → inspected → follow_up → signed, and it only moves
 * forward: "once inspected it can't go back to being a lead, because a lead
 * presupposes it is to GET an inspection."
 *
 * Requirements, in the owner's words:
 *  - `inspected` is the milestone and is the ONLY stage that does NOT require a
 *    name and phone — you can inspect a roof without getting either.
 *  - `lead` DOES require name + phone ("we want to command respect").
 *  - `follow_up` is the post-inspection state, held until signed.
 *
 * RESOLVED by the owner 2026-11-09 (was flagged as an assumption):
 *  - A pre-inspection follow-up IS JUST A LEAD. There is no pre-inspection
 *    follow_up state.
 *  - `lead` therefore covers both: the booked pre-inspection follow-up, AND a
 *    plain warm lead where we hold contact info — appointment or not. What makes
 *    it a lead rather than a cold address is the CONTACT'S EXPECTATION that they
 *    will be contacted.
 *  - `follow_up` is strictly POST-inspection: the roof has been looked at and we
 *    are working it toward signed.
 * Consequence: follow_up (and signed) can only be reached from an inspected
 * door. Allowing a jump straight to follow_up would destroy the one thing the
 * funnel exists to measure — whether a roof was actually looked at, and when.
 */

import { KnockOutcome } from '../types';

/**
 * Position in the conversion funnel. Labels absent from this map sit outside the
 * progression entirely (curb-side disqualifiers, no-answers, hard rejections)
 * and are therefore never blocked by the monotonicity rule.
 */
export const LABEL_RANK: Partial<Record<KnockOutcome, number>> = {
  conversation: 1,
  lead:         2,
  inspected:    3,
  follow_up:    4,
  signed:       5,
};

/** Stages that require a reachable human on file. inspected deliberately omitted. */
const NEEDS_CONTACT: KnockOutcome[] = ['lead', 'follow_up'];

/**
 * Minimum rank a door must ALREADY hold before it can take this label.
 * Both post-inspection states require an actual inspection on record — that is
 * what makes knock→inspected→signed timings meaningful rather than guesswork.
 */
const MIN_PRIOR_RANK: Partial<Record<KnockOutcome, number>> = {
  follow_up: LABEL_RANK.inspected!,
  signed:    LABEL_RANK.inspected!,
};

export interface LabelContext {
  hasName: boolean;
  hasPhone: boolean;
}

export interface LabelVerdict {
  ok: boolean;
  /** Short, user-facing reason — shown under the picker when a label is blocked. */
  reason?: string;
}

/**
 * May `next` be applied to a door currently labelled `current`?
 * `current` is null/undefined for a brand-new door.
 */
export function canApplyLabel(
  current: KnockOutcome | null | undefined,
  next: KnockOutcome,
  ctx: LabelContext
): LabelVerdict {
  if (NEEDS_CONTACT.includes(next)) {
    if (!ctx.hasName && !ctx.hasPhone) {
      return { ok: false, reason: 'needs a name + phone (Contact tab)' };
    }
    if (!ctx.hasName) return { ok: false, reason: 'needs a name (Contact tab)' };
    if (!ctx.hasPhone) return { ok: false, reason: 'needs a valid phone (Contact tab)' };
  }

  const from = current ? LABEL_RANK[current] : undefined;
  const to = LABEL_RANK[next];

  // Forward gate: post-inspection states need an inspection on record first.
  const minPrior = MIN_PRIOR_RANK[next];
  if (minPrior !== undefined && (from ?? 0) < minPrior) {
    return { ok: false, reason: 'mark Inspected first' };
  }
  // Only constrain moves WITHIN the funnel. Leaving it (e.g. marking a stale
  // lead not_interested) stays allowed — the door is being closed out, not
  // regressed.
  if (from !== undefined && to !== undefined && to < from) {
    return { ok: false, reason: `already ${current!.replace('_', ' ')} — can't go back` };
  }

  return { ok: true };
}

/** Convenience for rendering: every blocked label with its reason. */
export function blockedReasons(
  current: KnockOutcome | null | undefined,
  candidates: KnockOutcome[],
  ctx: LabelContext
): Record<string, string> {
  const out: Record<string, string> = {};
  for (const c of candidates) {
    const v = canApplyLabel(current, c, ctx);
    if (!v.ok && v.reason) out[c] = v.reason;
  }
  return out;
}
