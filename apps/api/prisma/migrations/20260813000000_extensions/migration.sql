-- Extensions must exist BEFORE the tables migration: persons.email is CITEXT,
-- so CREATE TABLE persons fails outright without citext. This is why the
-- extensions live in their own migration ordered ahead of the Prisma one,
-- rather than in the raw SQL migration that follows it.
--
--   pgcrypto  gen_random_uuid() — in core since PG 13, kept for parity with
--             docs/schema.sql and for older targets
--   citext    case-insensitive email
--   pg_trgm   trigram indexes for club and member search

CREATE EXTENSION IF NOT EXISTS pgcrypto;
CREATE EXTENSION IF NOT EXISTS citext;
CREATE EXTENSION IF NOT EXISTS pg_trgm;
