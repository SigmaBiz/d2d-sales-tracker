-- 2026-11-09: three curb-side disqualifier labels (owner request).
--   new_roof     🆕 roof is already new — nothing to sell
--   no_damage    👌 assessed from the curb, no storm damage
--   roofing_sign 🪧 competitor's yard sign — street already being worked
--
-- These are "doors that don't count as knocks": assessed WITHOUT knocking, so
-- the app excludes them from the Doors denominator (NON_DOOR_LABELS in
-- utils/analytics.ts) and they never drag the open rate. not_eligible stays as
-- the general catch-all.
--
-- Same drop-and-recreate pattern as the earlier label migrations (the CHECK
-- constraint name has varied historically, so it is looked up rather than assumed).
-- PASTE IN SUPABASE SQL EDITOR **BEFORE** the app update ships — until this
-- runs, saving any of the three fails knocks_label_chk.

DO $$
DECLARE con_name TEXT;
BEGIN
  SELECT c.conname INTO con_name
  FROM pg_constraint c
  JOIN pg_class t ON t.oid = c.conrelid
  WHERE t.relname = 'knocks'
    AND c.contype = 'c'
    AND pg_get_constraintdef(c.oid) ILIKE '%no_home%';

  IF con_name IS NOT NULL THEN
    EXECUTE format('ALTER TABLE knocks DROP CONSTRAINT %I', con_name);
  END IF;

  ALTER TABLE knocks ADD CONSTRAINT knocks_label_chk CHECK (label IN (
    'no_home','not_interested','no_soliciting','renter','conversation',
    'inspected','signed','follow_up','lead','scout','flaked','retarget',
    'arch_hard','not_eligible','revisit',
    'new_roof','no_damage','roofing_sign'
  ));
END $$;

-- Verify: all three new labels should appear in the returned definition.
SELECT pg_get_constraintdef(oid) FROM pg_constraint WHERE conname = 'knocks_label_chk';
