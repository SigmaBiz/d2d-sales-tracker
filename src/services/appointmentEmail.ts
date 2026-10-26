/**
 * Appointment confirmation — opens a prefilled mail draft to the homeowner with
 * the owner cc'd, so the doorstep promise ("you'll get a confirmation") becomes
 * a real artifact both sides can point at.
 *
 * ζ-verdict: mailto (Z₂ today) over a transactional provider (Z₁ until set up).
 * A server-sent email needs an account, an API key and a verified sending domain
 * — unverified sending lands in spam, which is worse than no email at all. mailto
 * has no vendor, no key, no deliverability risk, sends from the real business
 * inbox so replies come back somewhere useful, and works the moment it ships.
 * The cost is one tap on Send, which also keeps the message editable per door.
 *
 * Phase 2 swaps the body-building below behind a server route; the copy here is
 * the spec for that email, so keep them in sync when it lands.
 */

import { Linking } from 'react-native';

export interface ConfirmationArgs {
  address?: string;
  contactName?: string;
  contactEmail?: string;
  /** ISO string; omit for a "we'll follow up" note with no fixed time. */
  appointmentAt?: string;
  /** cc — the owner's own address, so there's a copy on their side. */
  ccEmail?: string;
  businessName?: string;
  businessPhone?: string;
}

function formatWhen(iso?: string): string | null {
  if (!iso) return null;
  const d = new Date(iso);
  if (isNaN(d.getTime())) return null;
  return d.toLocaleString('en-US', {
    weekday: 'long', month: 'long', day: 'numeric',
    hour: 'numeric', minute: '2-digit',
  });
}

export function buildConfirmationSubject(args: ConfirmationArgs): string {
  const when = formatWhen(args.appointmentAt);
  return when
    ? `Roof inspection confirmed — ${when}`
    : 'Following up on your roof';
}

export function buildConfirmationBody(args: ConfirmationArgs): string {
  const when = formatWhen(args.appointmentAt);
  const who = args.contactName?.trim();
  const biz = args.businessName || 'Sigma Roofing';
  const lines: string[] = [];

  lines.push(who ? `Hi ${who},` : 'Hi,');
  lines.push('');
  lines.push(
    when
      ? `Thanks for your time today. Confirming your free roof inspection:`
      : `Thanks for your time today — just so you have my information in writing.`
  );
  lines.push('');
  if (when) {
    lines.push(`  When:  ${when}`);
  }
  if (args.address) {
    lines.push(`  Where: ${args.address}`);
  }
  lines.push('');
  lines.push(
    when
      ? 'The inspection takes about 20 minutes and there is no cost or obligation. If that time stops working, just reply here or give me a call and we will move it.'
      : 'If you notice anything after the recent storms, reply here or give me a call and I will take a look — no cost or obligation.'
  );
  lines.push('');
  lines.push('Thanks,');
  lines.push(biz);
  if (args.businessPhone) lines.push(args.businessPhone);

  return lines.join('\n');
}

/**
 * Opens the mail composer. Returns false when there's no address to send to or
 * no mail client — callers should surface that rather than silently no-op.
 */
export async function openConfirmationDraft(args: ConfirmationArgs): Promise<boolean> {
  const to = args.contactEmail?.trim();
  if (!to) return false;

  const params = [
    `subject=${encodeURIComponent(buildConfirmationSubject(args))}`,
    `body=${encodeURIComponent(buildConfirmationBody(args))}`,
  ];
  if (args.ccEmail?.trim()) params.push(`cc=${encodeURIComponent(args.ccEmail.trim())}`);

  const url = `mailto:${encodeURIComponent(to)}?${params.join('&')}`;
  try {
    await Linking.openURL(url);
    return true;
  } catch {
    return false;
  }
}
