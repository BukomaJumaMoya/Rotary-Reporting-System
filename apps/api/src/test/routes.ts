import type { Express, Router } from 'express';
import { MOUNTS_KEY, type MountedRouter } from '../app.js';

/**
 * Every route the application has registered, discovered from the app itself.
 *
 * Discovery rather than a list, because a list is a thing somebody has to remember to
 * update, and the PII harness is worth exactly as much as its coverage on the day
 * somebody adds a careless endpoint. A route added in M4 is walked by the harness in M4
 * without anyone doing anything.
 *
 * The prefixes come from the mount registry `createApp` keeps, not from the router tree:
 * Express 5 compiles a mount path into a matcher and does not keep the string, so
 * `/api/v1/auth/login` is not recoverable from `layer.path` — that field holds whatever
 * path last matched a request. `assertAllRoutersDiscovered` closes the gap the registry
 * opens, by refusing a router that was mounted around the helper.
 */
export interface DiscoveredRoute {
  method: string;
  /** The full Express path pattern, e.g. `/api/v1/auth/password/reset`. */
  path: string;
}

interface RouterLayer {
  route?: { path?: unknown; methods?: Record<string, boolean> };
  handle?: { stack?: RouterLayer[] };
}

function stackOf(value: unknown): RouterLayer[] {
  const stack = (value as { stack?: RouterLayer[] } | undefined)?.stack;
  return Array.isArray(stack) ? stack : [];
}

function walk(stack: RouterLayer[], prefix: string, found: DiscoveredRoute[]): void {
  for (const layer of stack) {
    if (layer.route) {
      const routePath = typeof layer.route.path === 'string' ? layer.route.path : '';
      for (const [method, enabled] of Object.entries(layer.route.methods ?? {})) {
        // Express registers HEAD alongside GET; walking it twice tests one handler twice.
        if (!enabled || method.toUpperCase() === 'HEAD') continue;
        found.push({ method: method.toUpperCase(), path: `${prefix}${routePath}` || '/' });
      }
      continue;
    }

    // A router nested inside a router — sub-routes keep the parent's prefix.
    const nested = layer.handle?.stack;
    if (nested) walk(nested, prefix, found);
  }
}

function mountsOf(app: Express): MountedRouter[] {
  const mounts = app.get(MOUNTS_KEY) as MountedRouter[] | undefined;
  return mounts ?? [];
}

/** Every route registered on the app, including those inside mounted routers. */
export function discoverRoutes(app: Express): DiscoveredRoute[] {
  const found: DiscoveredRoute[] = [];

  // Routes declared directly on the app rather than in a router. None today, and the
  // walk covers them anyway so that stays true if one appears.
  const appRouter = (app as unknown as { router?: Router }).router;
  for (const layer of stackOf(appRouter)) {
    if (layer.route) walk([layer], '', found);
  }

  for (const { prefix, router } of mountsOf(app)) {
    walk(stackOf(router), prefix, found);
  }

  return found;
}

/**
 * Refuses an app whose router stack holds more routers than the mount registry knows
 * about — that is, one mounted with `app.use(...)` instead of the helper.
 *
 * Without this the registry would be a list after all, and its failure mode would be the
 * quiet one: a new module's routes simply never walked by the PII harness, which passes.
 */
export function assertAllRoutersDiscovered(app: Express): void {
  const appRouter = (app as unknown as { router?: Router }).router;
  const mountedRouters = stackOf(appRouter).filter((layer) => !layer.route && layer.handle?.stack);

  const recorded = mountsOf(app).length;
  if (mountedRouters.length !== recorded) {
    throw new Error(
      `${mountedRouters.length} routers are mounted on the app but ${recorded} were ` +
        'recorded. Register routers through the `mount` helper in createApp, or the ' +
        'unauthenticated-PII harness will not walk them.',
    );
  }
}

/** Substitutes a syntactically valid value for every `:param`, so the route is reachable. */
export function concreteUrl(path: string): string {
  return path.replace(/:([A-Za-z0-9_]+)\??/g, (_match, name: string) =>
    // A uuid for anything that looks like an id, since most params here are uuids and a
    // 400 from a malformed one would end the walk before it reached the handler.
    /id$/i.test(name) ? '00000000-0000-4000-8000-000000000000' : 'probe',
  );
}
