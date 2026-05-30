/**
 * US phone helpers (F2d) — format + validate, free/offline via libphonenumber-js.
 *
 * Format-and-heuristic only: confirms a well-formed, plausible US number. Does NOT
 * verify the line is real/active (that would need a carrier lookup / OTP — deferred).
 */

import { AsYouType, parsePhoneNumberFromString } from 'libphonenumber-js';

/** Pretty-print as the user types, e.g. "4055551234" → "(405) 555-1234". */
export function formatAsYouTypeUS(input: string): string {
  return new AsYouType('US').input(input);
}

/** True when the input is a valid US phone number. */
export function isValidUSPhone(input: string): boolean {
  if (!input) return false;
  const p = parsePhoneNumberFromString(input, 'US');
  return !!p && p.isValid() && p.country === 'US';
}

/** Normalized E.164 ("+14055551234") for storage, or undefined if not valid. */
export function toE164(input: string): string | undefined {
  const p = parsePhoneNumberFromString(input, 'US');
  return p && p.isValid() ? p.number : undefined;
}
