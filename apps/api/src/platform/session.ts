import connectPgSimple from 'connect-pg-simple';
import session from 'express-session';
import type { RequestHandler } from 'express';
import pg from 'pg';
import { config, isProduction } from './config.js';

/**
 * express-session stores the authenticated user id and nothing else. Everything a
 * request needs beyond that — district, year, permissions, scopes — is resolved from
 * the database on each request by the context middleware (session 4).
 *
 * That is the point of ADR-003. Permissions change mid-year when an appointment is
 * revoked; anything cached in the cookie would keep a removed officer working until it
 * expired.
 */
declare module 'express-session' {
  interface SessionData {
    userId?: string;
  }
}

const PgStore = connectPgSimple(session);

/** Own pool, small: session reads are frequent, short, and must not queue behind Prisma. */
const sessionPool = new pg.Pool({
  connectionString: config.DATABASE_URL,
  max: 5,
});

export function createSessionMiddleware(): RequestHandler {
  return session({
    name: config.SESSION_COOKIE_NAME,
    secret: config.SESSION_SECRET,
    store: new PgStore({
      pool: sessionPool,
      tableName: 'session',
      // The table is created by a Prisma migration, not by this library — otherwise it
      // would exist in the database and in no migration.
      createTableIfMissing: false,
      // Sweep expired rows hourly. Without this the table grows without limit.
      pruneSessionInterval: 60 * 60,
    }),
    resave: false,
    saveUninitialized: false,
    rolling: true,
    proxy: isProduction,
    cookie: {
      httpOnly: true,
      // Lax, not Strict: Strict drops the cookie on cross-site navigation, so following
      // a link from an email into the app would present as logged out.
      sameSite: 'lax',
      secure: isProduction || config.COOKIE_SECURE,
      maxAge: config.SESSION_TTL_HOURS * 60 * 60 * 1000,
      path: '/',
    },
  });
}

export async function closeSessionPool(): Promise<void> {
  await sessionPool.end();
}
