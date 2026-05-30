/**
 * Lead lifecycle state machine — single source of truth for legal transitions.
 *
 * Two-axis model: a door keeps a stable `label` (the map pin); `status` tracks the
 * inspection lifecycle. When a terminal action fires, its status is mirrored back
 * onto the door's `label` so the map reflects the outcome.
 *
 * This drives the work ledger (lead_events): only a runner can record the
 * validation events (complete/processing/signed/arch/...) that make a setter's
 * lead payable. The endpoint enforces what this table declares.
 *
 * F2b scope = LIVE service type. Scheduled transitions (confirm/nudge/reschedule)
 * arrive in F2c; the `confirmed` status and a couple of scheduled-only edges are
 * declared here but the scheduled entry action (`schedule`) is added in F2c.
 */

export type Role = 'owner' | 'member'; // owner = runner/admin, member = setter
export type LeadStatus =
  | 'pinged' | 'confirmed' | 'completed' | 'processing'
  | 'signed' | 'arch_soft' | 'arch_hard' | 'retarget';
export type LeadAction =
  | 'ping' | 'confirm' | 'complete' | 'processing' | 'signed'
  | 'arch_soft' | 'arch_hard' | 'retarget' | 'revive' | 'recover';

export interface TransitionRule {
  /** allowed current status; null = the entry action (no active lifecycle yet) */
  from: LeadStatus | null;
  to: LeadStatus;
  /** who may perform it */
  role: Role;
  /** terminal actions mirror `to` onto knocks.label and close the cycle */
  terminal?: boolean;
  /** consumes the single per-cycle override (revive) */
  usesOverride?: boolean;
  /** requires an override to still be available */
  requiresOverrideAvailable?: boolean;
  /** consumes the setter's single soft-arch recovery */
  usesRecovery?: boolean;
}

/**
 * LIVE flow:
 *   (none) --ping[setter]--> pinged
 *   pinged --complete[runner]--> completed
 *   pinged --arch_soft[runner]--> arch_soft        (recoverable; setter gets one recover)
 *   arch_soft --recover[setter]--> pinged          (the single recovery; re-ping)
 *   arch_soft --arch_hard[runner]--> arch_hard     (give up after failed recovery)
 *   completed --processing[runner]--> processing
 *   completed --retarget[runner]--> retarget (terminal)
 *   processing --signed[runner]--> signed (terminal, payable close)
 *   processing --retarget[runner]--> retarget (terminal)
 *   arch_hard --revive[runner/admin]--> processing (override; homeowner re-engaged)
 *   pinged --arch_hard[runner]--> arch_hard        (hard dead-end straight from pinged)
 */
export const LIVE_TRANSITIONS: Record<LeadAction, TransitionRule[]> = {
  ping:       [{ from: null, to: 'pinged', role: 'member' }],
  complete:   [{ from: 'pinged', to: 'completed', role: 'owner' }],
  arch_soft:  [{ from: 'pinged', to: 'arch_soft', role: 'owner' }],
  recover:    [{ from: 'arch_soft', to: 'pinged', role: 'member', usesRecovery: true }],
  arch_hard: [
    { from: 'arch_soft', to: 'arch_hard', role: 'owner', terminal: true },
    { from: 'pinged',    to: 'arch_hard', role: 'owner', terminal: true },
  ],
  processing: [{ from: 'completed', to: 'processing', role: 'owner' }],
  signed:     [{ from: 'processing', to: 'signed', role: 'owner', terminal: true }],
  retarget: [
    { from: 'completed',  to: 'retarget', role: 'owner', terminal: true },
    { from: 'processing', to: 'retarget', role: 'owner', terminal: true },
  ],
  revive: [{
    from: 'arch_hard', to: 'processing', role: 'owner',
    usesOverride: true, requiresOverrideAvailable: true,
  }],
  confirm: [], // scheduled-only — wired in F2c
};

/** Statuses that mirror onto the door label when reached (terminal). */
export const TERMINAL_STATUSES: LeadStatus[] = ['signed', 'arch_hard', 'retarget'];

export interface ResolveArgs {
  action: LeadAction;
  currentStatus: LeadStatus | null;
  role: Role | null;
  recoveryUsed?: boolean;     // a soft-arch recovery already spent this cycle
  overrideUsed?: boolean;     // the single override already spent this cycle
}

export interface ResolveResult {
  ok: boolean;
  rule?: TransitionRule;
  error?: string;
  code?: number; // 403 role, 409 illegal transition / exhausted allowance
}

/**
 * Resolve whether an action is legal given the current status, the actor's role,
 * and per-cycle allowances. Pure function — no I/O — so it's unit-testable and
 * shared in spirit with the client's legalActions() (which is advisory only).
 */
export function resolveTransition(args: ResolveArgs): ResolveResult {
  const { action, currentStatus, role, recoveryUsed, overrideUsed } = args;
  const rules = LIVE_TRANSITIONS[action];
  if (!rules || rules.length === 0) {
    return { ok: false, error: `Unknown or unsupported action: ${action}`, code: 400 };
  }

  // Find a rule whose `from` matches the current status.
  const match = rules.find(r => r.from === (currentStatus ?? null));
  if (!match) {
    return {
      ok: false,
      code: 409,
      error: `Cannot '${action}' from status '${currentStatus ?? 'none'}'`,
    };
  }

  if (role !== match.role) {
    return {
      ok: false,
      code: 403,
      error: `Action '${action}' requires role '${match.role}'`,
    };
  }

  if (match.usesRecovery && recoveryUsed) {
    return { ok: false, code: 409, error: 'Recovery already used for this cycle' };
  }
  if (match.requiresOverrideAvailable && overrideUsed) {
    return { ok: false, code: 409, error: 'Override already used for this cycle' };
  }

  return { ok: true, rule: match };
}

export function isTerminal(status: LeadStatus): boolean {
  return TERMINAL_STATUSES.includes(status);
}
