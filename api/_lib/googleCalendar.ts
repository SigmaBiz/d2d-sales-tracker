/**
 * Google Calendar — thin REST client.
 *
 * Deliberately NOT the `googleapis` package: this needs exactly three calls
 * (token refresh, freeBusy, insert event) and axios is already a dependency.
 * Pulling in googleapis would add tens of MB to every lambda for no gain.
 *
 * Single-calendar by design — it books the OWNER's calendar via a stored refresh
 * token. A second canvasser would need their own OAuth grant; revisit before
 * this ships to a team.
 */

import axios from 'axios';

const TOKEN_URL = 'https://oauth2.googleapis.com/token';
const CAL_BASE = 'https://www.googleapis.com/calendar/v3';

export interface Interval {
  start: string; // ISO
  end: string;   // ISO
}

/**
 * Cached across invocations: Vercel reuses warm lambda instances, so this saves
 * a token round-trip on most requests. Refreshed 60s before actual expiry.
 */
let cachedToken: { token: string; expiresAt: number } | null = null;

export function calendarConfigured(): boolean {
  return Boolean(
    process.env.GOOGLE_OAUTH_CLIENT_ID &&
    process.env.GOOGLE_OAUTH_CLIENT_SECRET &&
    process.env.GOOGLE_CALENDAR_REFRESH_TOKEN
  );
}

export function calendarId(): string {
  return process.env.GOOGLE_CALENDAR_ID || 'primary';
}

async function getAccessToken(): Promise<string> {
  if (cachedToken && cachedToken.expiresAt > Date.now() + 60_000) {
    return cachedToken.token;
  }
  if (!calendarConfigured()) {
    throw new Error('Google Calendar is not configured on this deployment');
  }

  const body = new URLSearchParams({
    client_id: process.env.GOOGLE_OAUTH_CLIENT_ID!,
    client_secret: process.env.GOOGLE_OAUTH_CLIENT_SECRET!,
    refresh_token: process.env.GOOGLE_CALENDAR_REFRESH_TOKEN!,
    grant_type: 'refresh_token',
  });

  const { data } = await axios.post(TOKEN_URL, body.toString(), {
    headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
    timeout: 10_000,
  });

  cachedToken = {
    token: data.access_token,
    expiresAt: Date.now() + (data.expires_in ?? 3600) * 1000,
  };
  return cachedToken.token;
}

/** Busy intervals on the owner's calendar between two instants. */
export async function freeBusy(timeMin: string, timeMax: string): Promise<Interval[]> {
  const token = await getAccessToken();
  const { data } = await axios.post(
    `${CAL_BASE}/freeBusy`,
    { timeMin, timeMax, items: [{ id: calendarId() }] },
    { headers: { Authorization: `Bearer ${token}` }, timeout: 10_000 }
  );
  const busy = data?.calendars?.[calendarId()]?.busy ?? [];
  return busy as Interval[];
}

export interface CreateEventArgs {
  startISO: string;
  endISO: string;
  summary: string;
  description?: string;
  location?: string;
  /** Homeowner. Google emails them a real, acceptable invite. */
  attendeeEmail?: string;
}

export async function createEvent(
  args: CreateEventArgs
): Promise<{ eventId: string; htmlLink: string }> {
  const token = await getAccessToken();
  const body: Record<string, unknown> = {
    summary: args.summary,
    description: args.description,
    location: args.location,
    start: { dateTime: args.startISO },
    end: { dateTime: args.endISO },
  };
  if (args.attendeeEmail) {
    body.attendees = [{ email: args.attendeeEmail }];
  }

  const { data } = await axios.post(
    // sendUpdates=all is what actually mails the homeowner the invite —
    // without it the attendee is attached silently and never notified.
    `${CAL_BASE}/calendars/${encodeURIComponent(calendarId())}/events?sendUpdates=all`,
    body,
    { headers: { Authorization: `Bearer ${token}` }, timeout: 15_000 }
  );

  return { eventId: data.id, htmlLink: data.htmlLink };
}
