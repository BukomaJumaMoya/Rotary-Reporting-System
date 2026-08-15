-- Two indexes, from the EXPLAIN ANALYZE pass in M2 session 10 against the real shape:
-- 68 clubs, 3,000 members, 3,239 membership events, 1,327 activities.
--
-- Both are invisible to Prisma's differ — one is partial, the other is on a materialised
-- view — so they live here rather than in schema.prisma, and `migrate diff` still reports
-- an empty migration. Every OTHER index this milestone needed already existed.

-- 1. The supersede anti-join.
--
-- `club_rosters` and the as-at reconstruction both ask "has anything superseded this event",
-- which is a NOT EXISTS against a column with no index. At 3,239 rows the planner picks a
-- sequential scan and takes 8ms; the membership log is the one table here that grows without
-- bound — every year adds every join, transfer and termination the district recorded — so
-- this is the query whose plan matters in 2032 rather than today.
--
-- PARTIAL, because only corrections carry the column: roughly one row in a hundred, so the
-- index is a fraction of the size of the full one and answers exactly the question asked.
CREATE INDEX me_supersedes ON membership_events (supersedes_event_id)
  WHERE supersedes_event_id IS NOT NULL;

-- 2. The roster's district filter.
--
-- `club_rosters` had indexes on (person_id, club_id) and on club_id, but nothing on
-- district_id — and EVERY read of it filters by district, because that is what the scope
-- layer injects. The person list, which joins the view to `persons`, was the slowest query
-- measured at 8ms for exactly this reason.
CREATE INDEX club_rosters_district ON club_rosters (district_id);
