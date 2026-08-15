-- club_rosters: a CORRECTION retracts, it does not become the member's state.
--
-- schema.sql v1.9. Found by the hand-computed statistics fixture in M2 session 6, which is
-- the second defect that fixture class has caught in this view — v1.0 had the supersede
-- predicate inverted, and this is the other half of the same idea.
--
-- THE BUG. `ranked` took the latest live event per (person, club) and kept the person if
-- its type was a joining one. A CORRECTION is a live event, and it is not a joining type,
-- so retracting anything left the person OFF the roster — correct when what was retracted
-- was a JOIN ("this member never joined"), and exactly wrong when it was a TERMINATE
-- recorded against the wrong person. The club would correct the mistake and the member
-- would stay deleted.
--
-- THE FIX. A CORRECTION is a retraction, not a state. It still excludes its target through
-- the `live` predicate; it is then itself excluded from the ranking, so the member's state
-- falls back to whatever the previous live event said. Retract a JOIN and there is no
-- joining event left, so they are off the roster. Retract a TERMINATE and the JOIN
-- underneath is the latest live event again, so they are back on it. Both readings of
-- "this never happened" now behave the way the phrase means.
--
-- Corrections that REPLACE a fact are untouched: those carry a real event type, so they
-- rank normally and supersede what they correct.

DROP MATERIALIZED VIEW IF EXISTS club_rosters;

CREATE MATERIALIZED VIEW club_rosters AS
WITH live AS (
  SELECT me.*
  FROM membership_events me
  WHERE NOT EXISTS (
    SELECT 1 FROM membership_events c WHERE c.supersedes_event_id = me.id
  )
), ranked AS (
  SELECT DISTINCT ON (person_id, club_id)
         person_id, club_id, district_id, event_type, member_category, effective_on
  FROM live
  -- A retraction is not a state. It has already done its work by superseding its target.
  WHERE event_type <> 'CORRECTION'
  ORDER BY person_id, club_id, effective_on DESC, created_at DESC
)
SELECT person_id, club_id, district_id, member_category, effective_on AS since
FROM ranked
WHERE event_type IN ('JOIN','INDUCT','TRANSFER_IN','REINSTATE','CATEGORY_CHANGE');

CREATE UNIQUE INDEX club_rosters_pk ON club_rosters (person_id, club_id);
CREATE INDEX club_rosters_club ON club_rosters (club_id);
