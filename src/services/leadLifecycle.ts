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
  | 'pinged' | 'confirmed' | 'completed' | 'processing'
  | 'signed' | 'arch_soft' | 'arch_hard' | 'retarget';
export type LeadAction =
  | 'ping' | 'confirm' | 'complete' | 'processing' | 'signed'
  | 'arch_soft' | 'arch_hard' | 'retarget' | 'revive' | 'recover';
export type Role = 'owner' | 'member';

export interface ActionOption {
  action: LeadAction;
  label: string;       // button text
  emoji: string;
  destructive?: boolean;
}

const ACTION_META: Record<LeadAction, { label: string; emoji: string; destructive?: boolean }> = {
  ping:       { label: 'Ping Owner', emoji: '🔔' },
  confirm:    { label: 'Acknowledge', emoji: '👍' },
  complete:   { label: 'Mark Completed', emoji: '✅' },
  processing: { label: 'Mark Processing', emoji: '⏳' },
  signed:     { label: 'Mark Signed', emoji: '🔏' },
  arch_soft:  { label: 'Return (Soft Arch)', emoji: '↩️' },
  arch_hard:  { label: 'Archive (Hard)', emoji: '🛑', destructive: true },
  retarget:   { label: 'Retarget', emoji: '🎯' },
  revive:     { label: 'Revive', emoji: '♻️' },
  recover:    { label: 'Recover Lead', emoji: '🔁' },
};

/**
 * Legal next actions for the LIVE flow given current status + role.
 * Keep in lockstep with LIVE_TRANSITIONS on the server (advisory copy).
 * `recoveryUsed` / `overrideUsed` hide allowances already spent this cycle.
 */
export function legalActions(
  status: LeadStatus | null,
  role: Role | null,
  opts: { recoveryUsed?: boolean; overrideUsed?: boolean } = {}
): ActionOption[] {
  const isRunner = role === 'owner';
  const isSetter = role === 'member';
  const out: LeadAction[] = [];

  switch (status) {
    case null:
      // entry handled by the contact-form Ping button, not the action menu
      break;
    case 'pinged':
      if (isRunner) out.push('complete', 'arch_soft', 'arch_hard');
      break;
    case 'arch_soft':
      if (isSetter && !opts.recoveryUsed) out.push('recover');
      if (isRunner) out.push('arch_hard');
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
    // terminal: signed, retarget → no further actions in F2b
    default:
      break;
  }

  return out.map(a => ({ action: a, ...ACTION_META[a] }));
}

/** Human-readable status pill text. */
export const STATUS_LABEL: Record<LeadStatus, string> = {
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
