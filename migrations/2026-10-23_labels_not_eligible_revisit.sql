-- 2026-10-23: two new setter labels (owner request).
--   not_eligible — for sale/rent sign or unmaintained; property disqualified.
--   revisit      — door didn't open, but roof worth coming back for (damage/age).
-- Same drop-and-recreate pattern as 2026-05-29_F2a (the CHECK name can vary).
-- PASTE IN SUPABASE SQL EDITOR **BEFORE** the app update ships — until this runs,
-- saving either new label fails the knocks_label_chk constraint.

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
    'arch_hard','not_eligible','revisit'
  ));
END $$;

-- Verify: should return the new constraint definition including both new labels.
SELECT pg_get_constraintdef(oid) FROM pg_constraint WHERE conname = 'knocks_label_chk';
