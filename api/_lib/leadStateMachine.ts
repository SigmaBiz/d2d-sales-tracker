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
  | 'scheduled' | 'pinged' | 'confirmed' | 'completed' | 'processing'
  | 'signed' | 'arch_soft' | 'arch_hard' | 'retarget';
export type LeadAction =
  | 'ping' | 'schedule' | 'confirm' | 'complete' | 'processing' | 'signed'
  | 'arch_soft' | 'arch_hard' | 'retarget' | 'revive' | 'recover'
  | 'nudge' | 'reschedule';

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
  /** idempotent action (status unchanged) — ledger event only, e.g. nudge */
  idempotent?: boolean;
}

/**
 * Lead transitions for BOTH service types (live + scheduled).
 *
 * LIVE:      (none) --ping[setter]--> pinged --complete[runner]--> completed → processing → signed
 * SCHEDULED: (none) --schedule[setter]--> scheduled --confirm[runner]--> confirmed --complete--> ...
 *
 * Setter's quantized cycle: after pinging/scheduling the setter exits (nudge only).
 * If the runner RETURNS a lead (arch_soft), the SETTER owns the recover-or-kill
 * decision — recover/reschedule (re-enter) OR arch_hard 🪦 (kill). Applies to both flows.
 *
 * Multiple rules per action are disambiguated by (from + role) in resolveTransition().
 */
export const LIVE_TRANSITIONS: Record<LeadAction, TransitionRule[]> = {
  // ── Entry ────────────────────────────────────────────────────────────────
  ping:       [{ from: null, to: 'pinged', role: 'member' }],
  schedule:   [{ from: null, to: 'scheduled', role: 'member' }],

  // ── Runner advances ──────────────────────────────────────────────────────
  confirm:    [{ from: 'scheduled', to: 'confirmed', role: 'owner' }], // acknowledge a scheduled lead
  complete: [
    { from: 'pinged',    to: 'completed', role: 'owner' }, // live
    { from: 'confirmed', to: 'completed', role: 'owner' }, // scheduled
  ],
  processing: [{ from: 'completed', to: 'processing', role: 'owner' }],
  signed:     [{ from: 'processing', to: 'signed', role: 'owner', terminal: true }],
  retarget: [
    { from: 'completed',  to: 'retarget', role: 'owner', terminal: true },
    { from: 'processing', to: 'retarget', role: 'owner', terminal: true },
  ],

  // ── Runner returns the lead to the setter ────────────────────────────────
  arch_soft: [
    { from: 'pinged',    to: 'arch_soft', role: 'owner' }, // live
    { from: 'scheduled', to: 'arch_soft', role: 'owner' }, // scheduled (unconfirmed)
    { from: 'confirmed', to: 'arch_soft', role: 'owner' }, // scheduled (confirmed but not run)
  ],

  // ── Setter responds to a returned lead (recover-or-kill) ─────────────────
  recover:    [{ from: 'arch_soft', to: 'pinged',    role: 'member', usesRecovery: true }], // live re-ping
  reschedule: [{ from: 'arch_soft', to: 'scheduled', role: 'member', usesRecovery: true }], // scheduled re-book
  arch_hard: [
    { from: 'arch_soft', to: 'arch_hard', role: 'member', terminal: true }, // setter kills the returned lead 🪦
    { from: 'pinged',    to: 'arch_hard', role: 'owner',  terminal: true }, // runner hard dead-end (live)
    { from: 'scheduled', to: 'arch_hard', role: 'owner',  terminal: true }, // runner hard dead-end (scheduled)
    { from: 'confirmed', to: 'arch_hard', role: 'owner',  terminal: true },
  ],

  // ── Setter nudge (idempotent; gated to max 2 + unacked in the endpoint) ──
  nudge: [
    { from: 'scheduled', to: 'scheduled', role: 'member', idempotent: true },
    { from: 'pinged',    to: 'pinged',    role: 'member', idempotent: true },
  ],

  // ── Admin override ───────────────────────────────────────────────────────
  revive: [{
    from: 'arch_hard', to: 'processing', role: 'owner',
    usesOverride: true, requiresOverrideAvailable: true,
  }],
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

  const from = currentStatus ?? null;
  const fromMatches = rules.filter(r => r.from === from);
  if (fromMatches.length === 0) {
    return {
      ok: false,
      code: 409,
      error: `Cannot '${action}' from status '${currentStatus ?? 'none'}'`,
    };
  }

  // Disambiguate by role: an action can have several edges from the same status
  // with different roles (e.g. arch_hard is setter-from-arch_soft but runner-from-pinged).
  const match = fromMatches.find(r => r.role === role);
  if (!match) {
    return {
      ok: false,
      code: 403,
      error: `Action '${action}' from '${from ?? 'none'}' requires role '${fromMatches[0].role}'`,
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
