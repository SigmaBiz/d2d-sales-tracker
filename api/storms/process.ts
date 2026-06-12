/**
 * Owner-only: trigger the GitHub Actions GRIB2 pipeline for a storm date,
 * straight from the phone. Past dates skip the 90-minute MESH-accumulation
 * wait (~7 min run); dates older than a week skip the crew-wide
 * "Hail Map Ready" push so backfills don't spam the field.
 */
import type { VercelRequest, VercelResponse } from '@vercel/node';
import axios from 'axios';
import { getAuthedActor, getServiceClient } from '../_lib/auth';

/** Today's date in the business's timezone — NOT UTC. An evening CDT storm is
 *  still "today" locally while already "tomorrow" in UTC; comparing in
 *  America/Chicago keeps skip_wait semantics matching the owner's intent. */
function todayCentral(): string {
  return new Intl.DateTimeFormat('en-CA', { timeZone: 'America/Chicago' }).format(new Date());
}

export default async function handler(req: VercelRequest, res: VercelResponse) {
  if (req.method !== 'POST') {
    return res.status(405).json({ error: 'Method not allowed' });
  }

  const actor = await getAuthedActor(req, getServiceClient());
  if (!actor) return res.status(401).json({ error: 'Unauthorized' });
  if (actor.role !== 'owner') return res.status(403).json({ error: 'Owner only' });

  const { date, notify } = req.body as { date?: string; notify?: boolean };
  if (!date || !/^\d{4}-\d{2}-\d{2}$/.test(date)) {
    return res.status(400).json({ error: 'date must be YYYY-MM-DD' });
  }
  const todayCT = todayCentral();
  if (date < '2019-10-01') {
    return res.status(400).json({ error: 'MESH archives start 2019-10-01' });
  }
  if (date > todayCT) {
    return res.status(400).json({ error: 'date is in the future' });
  }

  const token = process.env.GITHUB_ACTIONS_TOKEN;
  const repo = process.env.GITHUB_REPO;
  const ref = process.env.GITHUB_WORKFLOW_REF || 'main';
  if (!token || !repo) {
    return res.status(500).json({ error: 'GITHUB_ACTIONS_TOKEN / GITHUB_REPO not configured' });
  }

  const skipWait = date < todayCT;
  const ageDays = (Date.parse(todayCT) - Date.parse(date)) / 86400000;
  const sendNotify = notify ?? ageDays <= 7;

  try {
    await axios.post(
      `https://api.github.com/repos/${repo}/actions/workflows/hail-swath.yml/dispatches`,
      {
        ref,
        inputs: {
          storm_date: date,
          alert_id: `manual-${actor.userId}`,
          skip_wait: String(skipWait),
          notify: String(sendNotify),
        },
      },
      {
        headers: {
          Authorization: `Bearer ${token}`,
          Accept: 'application/vnd.github+json',
          'X-GitHub-Api-Version': '2022-11-28',
        },
        timeout: 8000,
      }
    );
  } catch (err: any) {
    const status = err?.response?.status;
    console.error('[storms/process] dispatch failed:', status, err?.response?.data ?? err?.message);
    return res.status(502).json({ error: `GitHub dispatch failed (${status ?? 'network'})` });
  }

  console.log(`[storms/process] dispatched ${date} (skipWait=${skipWait}, notify=${sendNotify}) by ${actor.userId}`);
  return res.status(202).json({ queued: true, date, skipWait, notify: sendNotify });
}
