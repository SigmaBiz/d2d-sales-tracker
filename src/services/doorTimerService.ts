/**
 * Door timer — the escape hatch.
 *
 * ζ-verdict: a JS setInterval countdown is Z₁ — it dies the moment the phone
 * locks or the app backgrounds, which is precisely when you're standing at a
 * door being talked at. An OS-scheduled notification is Z₂: it fires regardless
 * of app state. So the alarm is ALWAYS a scheduled notification; the on-screen
 * chip's interval is cosmetic only and never the thing that saves you.
 *
 * The dominant failure mode is a STRAY alarm — buzzing two minutes after you
 * walked away. Every path that ends or extends a door must cancel the pending
 * notification first, so exactly one is outstanding at a time.
 */

import * as Notifications from 'expo-notifications';
import { Vibration, Platform } from 'react-native';
import { DoorPhase, CAP_SECONDS } from '../utils/pacing';

/** Same pattern as the urgent NotifBell buzz — reads as a page, not a ping. */
const ESCAPE_VIBRATION = [0, 400, 150, 400, 150, 400];

class DoorTimer {
  private scheduledId: string | null = null;
  private startedAt: number | null = null;
  private phase: DoorPhase = 'knocking';

  /** Seconds since this door opened; 0 when no door is active. */
  elapsedSeconds(): number {
    if (this.startedAt === null) return 0;
    return (Date.now() - this.startedAt) / 1000;
  }

  isRunning(): boolean {
    return this.startedAt !== null;
  }

  currentPhase(): DoorPhase {
    return this.phase;
  }

  /** Cap for the current phase, in seconds. null = exempt (no alarm). */
  capSeconds(): number | null {
    return CAP_SECONDS[this.phase];
  }

  /**
   * Begin a door. Resets elapsed time and arms the alarm for `phase`'s cap.
   * Safe to call when one is already running — the old alarm is cancelled.
   */
  async start(phase: DoorPhase = 'knocking'): Promise<void> {
    await this.cancelPending();
    this.startedAt = Date.now();
    this.phase = phase;
    await this.arm(CAP_SECONDS[phase]);
  }

  /**
   * Move to a longer phase mid-door. The cap is measured from the ORIGINAL
   * knock, not from now — "+10 for a pre-inspection" means the door is allowed
   * 15 minutes total, not 10 more on top of however long you've already burned.
   */
  async extend(phase: DoorPhase): Promise<void> {
    if (this.startedAt === null) return;
    await this.cancelPending();
    this.phase = phase;
    const cap = CAP_SECONDS[phase];
    if (cap === null) return;                     // exempt — leave it disarmed
    const remaining = cap - this.elapsedSeconds();
    await this.arm(remaining);
  }

  /** End the door. ALWAYS cancels the pending alarm — this kills stray buzzes. */
  async stop(): Promise<void> {
    await this.cancelPending();
    this.startedAt = null;
    this.phase = 'knocking';
  }

  /** Schedule the alarm `seconds` out. <=0 means the cap already passed. */
  private async arm(seconds: number | null): Promise<void> {
    if (seconds === null) return;                 // exempt
    if (seconds <= 0) {
      // Already over cap (e.g. extending late) — buzz now rather than never.
      this.fireNow();
      return;
    }
    try {
      this.scheduledId = await Notifications.scheduleNotificationAsync({
        content: {
          title: '📞 Incoming — Dispatch',
          body: 'Next door is waiting. Wrap it up.',
          sound: true,
          data: { type: 'door_timer' },
          vibrate: ESCAPE_VIBRATION,
          priority: Notifications.AndroidNotificationPriority.MAX,
        },
        trigger: {
          type: Notifications.SchedulableTriggerInputTypes.TIME_INTERVAL,
          seconds: Math.ceil(seconds),
          repeats: false,
        },
      });
    } catch (err) {
      console.warn('[DoorTimer] Failed to schedule escape alarm:', err);
      this.scheduledId = null;
    }
  }

  private fireNow(): void {
    Vibration.vibrate(ESCAPE_VIBRATION, false);
  }

  private async cancelPending(): Promise<void> {
    const id = this.scheduledId;
    this.scheduledId = null;
    if (!id) return;
    try {
      await Notifications.cancelScheduledNotificationAsync(id);
    } catch (err) {
      console.warn('[DoorTimer] Failed to cancel escape alarm:', err);
    }
  }

  /**
   * Belt-and-braces sweep for orphaned door alarms — e.g. the app was killed
   * mid-door, so stop() never ran and a notification is still queued. Call on
   * app/map focus. Only touches our own notifications.
   */
  async clearOrphans(): Promise<void> {
    try {
      const pending = await Notifications.getAllScheduledNotificationsAsync();
      await Promise.all(
        pending
          .filter(n => (n.content?.data as any)?.type === 'door_timer')
          .map(n => Notifications.cancelScheduledNotificationAsync(n.identifier))
      );
      this.scheduledId = null;
    } catch (err) {
      console.warn('[DoorTimer] Orphan sweep failed:', err);
    }
  }
}

export const DoorTimerService = new DoorTimer();
export { Platform };
