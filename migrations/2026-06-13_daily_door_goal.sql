-- migrations/2026-06-13_daily_door_goal.sql
-- Team-wide daily door goal for analytics v1 (owner sets in Settings).
-- No new RLS needed: member read via "Members can read their team";
-- owner write via "Owner manages team".
ALTER TABLE teams ADD COLUMN IF NOT EXISTS daily_door_goal INTEGER NOT NULL DEFAULT 75
  CHECK (daily_door_goal BETWEEN 1 AND 500);
