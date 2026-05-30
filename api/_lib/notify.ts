/**
 * In-app notification feed writer (F2e).
 *
 * Records a row in `notifications` (RLS-scoped to the recipient) alongside the
 * Expo push that endpoints already send. The bell badge = unread count; urgent
 * rows drive the shake + buzz. Best-effort: a feed-write failure must never fail
 * the push or the transaction that triggered it.
 */

import type { SupabaseClient } from '@supabase/supabase-js';

export interface NotificationInput {
  userId: string;            // recipient
  teamId?: string | null;
  type: string;              // lead_update | lead_reminder | nudge | hail
  urgent?: boolean;          // drives shake + buzz
  title?: string;
  body?: string;
  knockId?: string | null;   // for teleport (nullable; hail has none)
  lat?: number | null;
  lng?: number | null;
  data?: Record<string, unknown>;
}

export async function recordNotification(
  supabase: SupabaseClient,
  n: NotificationInput
): Promise<void> {
  if (!n.userId) return;
  try {
    await supabase.from('notifications').insert({
      user_id: n.userId,
      team_id: n.teamId ?? null,
      type: n.type,
      urgent: n.urgent ?? false,
      title: n.title ?? null,
      body: n.body ?? null,
      knock_id: n.knockId ?? null,
      lat: n.lat ?? null,
      lng: n.lng ?? null,
      data: n.data ?? null,
    });
  } catch (err: any) {
    console.warn('[notify] recordNotification failed:', err?.message);
  }
}
