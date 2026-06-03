/**
 * Client-side lead lifecycle helpers — ADVISORY ONLY.
 *
 * Mirrors the server state machine (api/_lib/leadStateMachine.ts) so the UI can
 * show the right action buttons for the current status + role. The server is the
 * sole authority: it re-validates every transition and rejects illegal ones, so
 * this never needs to be perfectly in sync to be safe — it's just for UX.
 */

import { KnockOutcome } from '../types';

export type LeadStatus =
  | 'scheduled' | 'pinged' | 'confirmed' | 'completed' | 'processing'
  | 'signed' | 'arch_soft' | 'arch_hard' | 'retarget';
export type LeadAction =
  | 'ping' | 'schedule' | 'confirm' | 'complete' | 'processing' | 'signed'
  | 'arch_soft' | 'arch_hard' | 'retarget' | 'revive' | 'recover'
  | 'nudge' | 'reschedule';
export type Role = 'owner' | 'member';

export interface ActionOption {
  action: LeadAction;
  label: string;       // button text
  emoji: string;
  destructive?: boolean;
}

const ACTION_META: Record<LeadAction, { label: string; emoji: string; destructive?: boolean }> = {
  ping:       { label: 'Ping Owner', emoji: '🔔' },
  schedule:   { label: 'Schedule', emoji: '📅' },
  confirm:    { label: 'Acknowledge', emoji: '👍' },
  complete:   { label: 'Mark Completed', emoji: '✅' },
  processing: { label: 'Mark Processing', emoji: '⏳' },
  signed:     { label: 'Mark Signed', emoji: '🔏' },
  arch_soft:  { label: 'Return (Soft Arch)', emoji: '↩️' },
  arch_hard:  { label: 'Archive (Hard)', emoji: '🪦', destructive: true },
  retarget:   { label: 'Retarget', emoji: '🎯' },
  revive:     { label: 'Revive', emoji: '♻️' },
  recover:    { label: 'Recover Lead', emoji: '🔁' },
  nudge:      { label: 'Nudge Runner', emoji: '👈' },
  reschedule: { label: 'Reschedule', emoji: '🔁' },
};

/**
 * Legal next actions for the LEAD LOG (the shared LeadActionMenu) given status + role.
 * Advisory copy of the server LIVE_TRANSITIONS — the server re-validates everything.
 *
 * IMPORTANT (quantized cycle): the SETTER's only Log action is `nudge`. The setter's
 * recover/reschedule/arch_hard response to a returned (arch_soft) lead lives in the LAB
 * (knock detail → Contact tab), not here. So this function returns NO setter actions on
 * arch_soft — only the runner's options. `nudgeUsedUp` hides nudge once the cap is hit.
 */
export function legalActions(
  status: LeadStatus | null,
  role: Role | null,
  opts: { recoveryUsed?: boolean; overrideUsed?: boolean; acknowledged?: boolean; nudgeUsedUp?: boolean } = {}
): ActionOption[] {
  const isRunner = role === 'owner';
  const isSetter = role === 'member';
  const out: LeadAction[] = [];

  switch (status) {
    case null:
      // entry (ping/schedule) handled by the contact-form buttons, not the menu
      break;
    case 'scheduled':
      if (isRunner) out.push('confirm', 'arch_soft', 'arch_hard');
      if (isSetter && !opts.acknowledged && !opts.nudgeUsedUp) out.push('nudge');
      break;
    case 'pinged':
      if (isRunner) out.push('complete', 'arch_soft', 'arch_hard');
      if (isSetter && !opts.nudgeUsedUp) out.push('nudge');
      break;
    case 'confirmed':
      if (isRunner) out.push('complete', 'arch_soft', 'arch_hard');
      break;
    case 'arch_soft':
      // Setter's recover/arch_hard lives in the lab, NOT the Log. Runner: nothing here
      // (the ball is in the setter's court until they re-enter or kill it).
      break;
    case 'completed':
      if (isRunner) out.push('processing', 'retarget');
      break;
    case 'processing':
      if (isRunner) out.push('signed', 'retarget');
      break;
    case 'arch_hard':
      if (isRunner && !opts.overrideUsed) out.push('revive');
      break;
    // terminal: signed, retarget → no further actions
    default:
      break;
  }

  return out.map(a => ({ action: a, ...ACTION_META[a] }));
}

/**
 * The setter's re-entry options shown in the LAB (detail → Contact tab) when a lead
 * has been returned (arch_soft). Default action first. service_type decides re-enter verb.
 */
export function setterReentryActions(serviceType?: string): ActionOption[] {
  const reenter: LeadAction = serviceType === 'scheduled' ? 'reschedule' : 'recover';
  return ([reenter, 'arch_hard'] as LeadAction[]).map(a => ({ action: a, ...ACTION_META[a] }));
}

/** Human-readable status pill text. */
export const STATUS_LABEL: Record<LeadStatus, string> = {
  scheduled: 'Scheduled',
  pinged: 'Pinged',
  confirmed: 'Confirmed',
  completed: 'Completed',
  processing: 'Processing',
  signed: 'Signed',
  arch_soft: 'Returned',
  arch_hard: 'Archived',
  retarget: 'Retarget',
};

export const STATUS_COLOR: Record<LeadStatus, string> = {
  scheduled: '#a16207', // amber
  pinged: '#2563eb',
  confirmed: '#0891b2',
  completed: '#16a34a',
  processing: '#d97706',
  signed: '#15803d',
  arch_soft: '#9ca3af',
  arch_hard: '#dc2626',
  retarget: '#7c3aed',
};

export const TERMINAL_STATUSES: LeadStatus[] = ['signed', 'arch_hard', 'retarget'];
export function isTerminal(status?: LeadStatus | null): boolean {
  return !!status && TERMINAL_STATUSES.includes(status);
}
