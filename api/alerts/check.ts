/**
 * Tier 1 — Real-Time Hail Alert Checker
 *
 * Called by Vercel cron every 2 minutes during storm season.
 * Also callable manually via GET /api/alerts/check.
 *
 * Flow:
 * 1. Fetch active NWS alerts for Oklahoma (JSON API, no GRIB2)
 * 2. Filter to OKC Metro counties + hail >= 1"
 * 3. Skip alerts we've already fired (dedup via Supabase)
 * 4. Fetch Expo push tokens from Supabase
 * 5. Send push notifications via Expo Push API
 * 6. Record fired alert IDs in Supabase
 */

import type { VercelRequest, VercelResponse } from '@vercel/node';
import axios from 'axios';
import { createClient } from '@supabase/supabase-js';
import { recordNotification } from '../_lib/notify';

// OKC Metro counties — NWS Universal Geographic Code (UGC) format
// These are the counties that must be in the alert's affected area
const OKC_METRO_COUNTY_UGCS = new Set([
  'OKC040', // Oklahoma County (OKC proper, Midwest City, Del City, Bethany)
  'OKC027', // Cleveland County (Moore, Norman)
  'OKC017', // Canadian County (Yukon, Mustang, El Reno)
  'OKC083', // Logan County (Edmond northern portion)
  'OKC051', // Grady County (Chickasha area, SW metro fringe)
  'OKC087', // McClain County (Newcastle, Blanchard)
]);

// NWS alert event types that indicate severe weather with hail potential
const HAIL_ALERT_EVENTS = new Set([
  'Severe Thunderstorm Warning',
  'Tornado Warning',
  'Tornado Emergency',
]);

const MIN_HAIL_INCHES = 1.0;

// Supabase client (service role key for server-side writes)
function getSupabaseClient() {
  const url = process.env.SUPABASE_URL;
  const key = process.env.SUPABASE_SERVICE_ROLE_KEY;

  if (!url || !key) {
    throw new Error('SUPABASE_URL and SUPABASE_SERVICE_ROLE_KEY must be set');
  }

  return createClient(url, key);
}

interface NWSAlert {
  id: string;
  properties: {
    event: string;
    headline: string;
    description: string;
    areaDesc: string;
    geocode: {
      UGC: string[];
      FIPS6: string[];
    };
    parameters: {
      hailSize?: string[];
      [key: string]: string[] | undefined;
    };
    expires: string;
    sent: string;
  };
}

/**
 * Extract hail size in inches from NWS alert text and parameters.
 * NWS reports hail in inches: "HAIL...1.75 IN" or parameters.hailSize: ["1.75"]
 */
function extractHailSize(alert: NWSAlert): number {
  // Check structured parameters first (most reliable)
  const hailParam = alert.properties.parameters?.hailSize;
  if (hailParam && hailParam.length > 0) {
    const parsed = parseFloat(hailParam[0]);
    if (!isNaN(parsed)) return parsed;
  }

  // Fall back to description text parsing
  const text = `${alert.properties.headline} ${alert.properties.description}`;

  // Patterns: "HAIL...1.75 IN", "hail up to 2 inches", "quarter size (1.00 inch)"
  const patterns = [
    /HAIL[.\s]+(\d+(?:\.\d+)?)\s*IN/i,
    /hail(?:\s+up\s+to)?\s+(\d+(?:\.\d+)?)\s*inch/i,
    /(\d+(?:\.\d+)?)\s*inch\s+hail/i,
    /(\d+(?:\.\d+)?)"?\s+hail/i,
  ];

  for (const pattern of patterns) {
    const match = text.match(pattern);
    if (match) {
      const size = parseFloat(match[1]);
      if (!isNaN(size) && size > 0) return size;
    }
  }

  // If it's a Tornado Warning with no explicit hail, assume potential
  if (alert.properties.event === 'Tornado Warning' ||
      alert.properties.event === 'Tornado Emergency') {
    return MIN_HAIL_INCHES; // Tornado warnings get minimum threshold treatment
  }

  return 0;
}

/**
 * Check if an alert affects OKC Metro counties
 */
function affectsOKCMetro(alert: NWSAlert): boolean {
  const ugcs = alert.properties.geocode?.UGC || [];
  return ugcs.some(ugc => OKC_METRO_COUNTY_UGCS.has(ugc));
}

/**
 * Send push notifications via Expo Push API
 */
async function sendExpoNotifications(tokens: string[], title: string, body: string, data: object): Promise<void> {
  if (tokens.length === 0) return;

  const messages = tokens.map(token => ({
    to: token,
    title,
    body,
    data,
    sound: 'default',
    priority: 'high',
    channelId: 'hail-alerts',
  }));

  // Expo push API accepts up to 100 messages per request
  const chunks: typeof messages[] = [];
  for (let i = 0; i < messages.length; i += 100) {
    chunks.push(messages.slice(i, i + 100));
  }

  for (const chunk of chunks) {
    await axios.post('https://exp.host/--/api/v2/push/send', chunk, {
      headers: {
        'Content-Type': 'application/json',
        'Accept': 'application/json',
        'Accept-Encoding': 'gzip, deflate',
      },
      timeout: 10000,
    });
  }
}

/**
 * Trigger GitHub Actions workflow to process MESH swath for a given storm date.
 * Non-fatal if it fails — swath can still be processed manually.
 */
async function triggerSwathProcessing(stormDate: string, alertId: string): Promise<void> {
  const token = process.env.GITHUB_ACTIONS_TOKEN;
  const repo = process.env.GITHUB_REPO; // e.g. "username/d2d-sales-tracker"
  if (!token || !repo) {
    console.warn('[Alerts] GITHUB_ACTIONS_TOKEN or GITHUB_REPO not set — skipping swath trigger');
    return;
  }

  // The workflow must exist on the dispatched ref. The app's working branch is
  // not main, so the ref is configurable; the dispatch had silently 404'd for
  // every storm until this was made explicit (found 2026-06-12).
  const ref = process.env.GITHUB_WORKFLOW_REF || 'main';

  await axios.post(
    `https://api.github.com/repos/${repo}/actions/workflows/hail-swath.yml/dispatches`,
    { ref, inputs: { storm_date: stormDate, alert_id: alertId } },
    {
      headers: {
        Authorization: `Bearer ${token}`,
        Accept: 'application/vnd.github+json',
        'X-GitHub-Api-Version': '2022-11-28',
      },
      timeout: 8000,
    }
  );
  console.log(`[Alerts] GitHub Actions swath workflow triggered for ${stormDate}`);
}

export default async function handler(req: VercelRequest, res: VercelResponse) {
  // Allow GET (cron or manual check) and POST (webhook)
  if (req.method !== 'GET' && req.method !== 'POST') {
    return res.status(405).json({ error: 'Method not allowed' });
  }

  console.log('[Alerts] Check triggered');

  const supabase = getSupabaseClient();

  // 1. Fetch active NWS alerts for Oklahoma
  let nwsAlerts: NWSAlert[] = [];
  try {
    const response = await axios.get<{ features: NWSAlert[] }>(
      'https://api.weather.gov/alerts/active?area=OK',
      {
        headers: {
          'User-Agent': 'D2D-Sales-Tracker/1.0 (hail intelligence canvassing tool)',
          'Accept': 'application/geo+json',
        },
        timeout: 8000,
      }
    );
    nwsAlerts = response.data.features || [];
    console.log(`[Alerts] Fetched ${nwsAlerts.length} active NWS alerts for Oklahoma`);
  } catch (err) {
    console.error('[Alerts] NWS API error:', err);
    return res.status(502).json({ error: 'NWS API unavailable', detail: String(err) });
  }

  // 2. Filter to relevant alerts
  const relevantAlerts = nwsAlerts.filter(alert => {
    if (!HAIL_ALERT_EVENTS.has(alert.properties.event)) return false;
    if (!affectsOKCMetro(alert)) return false;
    const hailSize = extractHailSize(alert);
    if (hailSize < MIN_HAIL_INCHES) return false;
    return true;
  });

  console.log(`[Alerts] ${relevantAlerts.length} relevant OKC Metro hail alerts (>= ${MIN_HAIL_INCHES}")`);

  if (relevantAlerts.length === 0) {
    return res.status(200).json({
      checked: nwsAlerts.length,
      relevant: 0,
      fired: 0,
      message: 'No active OKC Metro hail alerts'
    });
  }

  // 3. Dedup — filter out alerts we've already fired
  const alertIds = relevantAlerts.map(a => a.id);
  const { data: firedRows } = await supabase
    .from('fired_alerts')
    .select('alert_id')
    .in('alert_id', alertIds);

  const alreadyFiredIds = new Set((firedRows || []).map((r: { alert_id: string }) => r.alert_id));
  const newAlerts = relevantAlerts.filter(a => !alreadyFiredIds.has(a.id));

  console.log(`[Alerts] ${newAlerts.length} new (not yet fired), ${alreadyFiredIds.size} already fired`);

  if (newAlerts.length === 0) {
    return res.status(200).json({
      checked: nwsAlerts.length,
      relevant: relevantAlerts.length,
      fired: 0,
      message: 'All relevant alerts already fired'
    });
  }

  // 4. Fetch push tokens from Supabase (with user_id for the in-app feed)
  const { data: tokenRows, error: tokenError } = await supabase
    .from('push_tokens')
    .select('token, user_id')
    .eq('active', true);

  if (tokenError) {
    console.error('[Alerts] Error fetching push tokens:', tokenError);
    return res.status(500).json({ error: 'Failed to fetch push tokens' });
  }

  const tokens: string[] = (tokenRows || []).map((r: { token: string }) => r.token);
  const recipientUserIds: string[] = [
    ...new Set((tokenRows || []).map((r: any) => r.user_id).filter(Boolean)),
  ];
  console.log(`[Alerts] ${tokens.length} active push tokens, ${recipientUserIds.length} users`);

  // 5. Fire notifications for each new alert
  let fired = 0;
  for (const alert of newAlerts) {
    const hailSize = extractHailSize(alert);
    const sizeEmoji = hailSize >= 2.0 ? '🚨' : '⚠️';
    const title = `${sizeEmoji} Hail Alert — ${hailSize.toFixed(2)}" hail`;
    const body = `${alert.properties.event} in OKC Metro. Open app to see hail map and target neighborhoods.`;

    try {
      if (tokens.length > 0) {
        await sendExpoNotifications(tokens, title, body, {
          type: 'nws_hail_alert',
          alertId: alert.id,
          event: alert.properties.event,
          hailSize,
          areaDesc: alert.properties.areaDesc,
          expires: alert.properties.expires,
        });
        console.log(`[Alerts] Fired: ${title} to ${tokens.length} devices`);
      }

      // In-app feed: one row per recipient user (hail = non-urgent, no teleport coords).
      for (const uid of recipientUserIds) {
        await recordNotification(supabase, {
          userId: uid, type: 'hail', urgent: false,
          title, body, data: { alertId: alert.id, hailSize, event: alert.properties.event },
        });
      }

      // 6. Record as fired to prevent duplicates
      await supabase.from('fired_alerts').insert({
        alert_id: alert.id,
        event: alert.properties.event,
        hail_size: hailSize,
        area_desc: alert.properties.areaDesc,
        expires_at: alert.properties.expires,
        tokens_notified: tokens.length,
      });

      // 7. Trigger GitHub Actions to process MESH swath (~90 min delayed)
      const stormDate = new Date().toISOString().slice(0, 10);
      await triggerSwathProcessing(stormDate, alert.id).catch(err =>
        console.warn('[Alerts] Actions webhook failed (non-fatal):', err)
      );

      fired++;
    } catch (err) {
      console.error(`[Alerts] Error firing alert ${alert.id}:`, err);
    }
  }

  return res.status(200).json({
    checked: nwsAlerts.length,
    relevant: relevantAlerts.length,
    fired,
    tokens: tokens.length,
    alerts: newAlerts.map(a => ({
      id: a.id,
      event: a.properties.event,
      hailSize: extractHailSize(a),
      areaDesc: a.properties.areaDesc,
    })),
  });
}
