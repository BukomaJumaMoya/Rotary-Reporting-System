import 'dotenv/config';
import { defineConfig } from 'prisma/config';

// The datasource must ALWAYS be declared, even with no environment. Schema-only
// commands (generate, validate, migrate diff --from-empty) never connect, but they do
// need to know the target — and `migrate diff` answers with an EMPTY script rather than
// an error when it does not, which reads as "no drift" and is the worst possible
// failure mode for a schema verification step. So an unset variable becomes a URL that
// cannot resolve and says why in the connection error.
const unset = 'postgresql://DATABASE_URL_IS_NOT_SET@DATABASE_URL_IS_NOT_SET:5432/postgres';

const url = process.env['DATABASE_URL'] ?? unset;

// Migrations must run over a direct connection: a transaction pooler cannot execute
// the DDL Prisma emits. Falls back to the pooled URL locally, where they are the same.
const directUrl = process.env['DIRECT_DATABASE_URL'] ?? url;

export default defineConfig({
  schema: 'prisma/schema.prisma',
  migrations: {
    path: 'prisma/migrations',
  },
  datasource: {
    url,
    directUrl,
    // Prisma replays the migration history into this database to check for
    // drift. It is created and dropped on demand and must never point at a
    // database holding real data.
    shadowDatabaseUrl: process.env['SHADOW_DATABASE_URL'] ?? `${url}_shadow`,
  },
});
