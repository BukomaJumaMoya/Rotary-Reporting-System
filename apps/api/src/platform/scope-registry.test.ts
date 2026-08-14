import { readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';
import {
  CONTEXT_BOUND_MODELS,
  SOFT_DELETE_ONLY_MODELS,
  UNSCOPED_BY_DESIGN,
  type ScopeRule,
} from './scope.js';

/**
 * The registry against the schema.
 *
 * This is the test that keeps the data access layer honest for the next eleven months.
 * Everything else here proves that scoping works on the tables it knows about; this one
 * proves it knows about all of them. A table added in M3 with a `district_id` and no
 * registry entry produces queries that look exactly like correct ones and quietly return
 * every district's rows — which is a failure nobody notices in a single-tenant
 * production database, and notices very publicly the first time there are two.
 *
 * Reading `schema.prisma` rather than the generated client is deliberate: the schema is
 * the artefact a developer edits, and it is where the omission would be made.
 */

const SCHEMA = readFileSync(new URL('../../prisma/schema.prisma', import.meta.url), 'utf8');

interface SchemaBlock {
  kind: 'model' | 'view';
  name: string;
  hasDistrict: boolean;
  hasYear: boolean;
  hasDeletedAt: boolean;
}

function parseSchema(source: string): SchemaBlock[] {
  const blocks: SchemaBlock[] = [];
  const blockPattern = /^(model|view)\s+(\w+)\s*\{([\s\S]*?)^\}/gm;

  for (const match of source.matchAll(blockPattern)) {
    const [, kind, name, body] = match;
    if (!kind || !name || body === undefined) continue;

    blocks.push({
      kind: kind as 'model' | 'view',
      name,
      // Matched on the mapped COLUMN name rather than the Prisma field: the column is
      // what the where clause has to carry, and a field renamed in TypeScript is still
      // the same scope.
      hasDistrict: /@map\("district_id"\)/.test(body),
      hasYear: /@map\("rotary_year_id"\)/.test(body),
      hasDeletedAt: /@map\("deleted_at"\)/.test(body),
    });
  }
  return blocks;
}

const blocks = parseSchema(SCHEMA);
const rules: Record<string, ScopeRule> = { ...CONTEXT_BOUND_MODELS, ...SOFT_DELETE_ONLY_MODELS };

describe('the scope registry', () => {
  it('parses the schema at all', () => {
    // A regex that silently matched nothing would make every assertion below vacuous.
    expect(blocks.length).toBeGreaterThan(50);
    expect(blocks.map((b) => b.name)).toContain('Activity');
    expect(blocks.filter((b) => b.kind === 'view').map((b) => b.name)).toContain('ClubRoster');
  });

  it('classifies every table carrying a district or a Rotary Year', () => {
    const unclassified = blocks
      .filter((block) => block.hasDistrict || block.hasYear)
      .filter((block) => !(block.name in CONTEXT_BOUND_MODELS))
      .filter((block) => !(block.name in UNSCOPED_BY_DESIGN))
      .map((block) => block.name);

    expect(
      unclassified,
      'Add these to CONTEXT_BOUND_MODELS in scope.ts, or to UNSCOPED_BY_DESIGN with the ' +
        'reason. An unregistered scoped table is a query that returns every district.',
    ).toEqual([]);
  });

  it('filters deleted_at on every table that has it', () => {
    const unfiltered = blocks
      .filter((block) => block.hasDeletedAt)
      .filter((block) => rules[block.name]?.softDelete !== true)
      .map((block) => block.name);

    expect(unfiltered, 'Add `softDelete: true` to these in scope.ts.').toEqual([]);
  });

  it('registers nothing that does not exist in the schema', () => {
    const known = new Set(blocks.map((block) => block.name));
    const phantom = [
      ...Object.keys(CONTEXT_BOUND_MODELS),
      ...Object.keys(SOFT_DELETE_ONLY_MODELS),
      ...Object.keys(UNSCOPED_BY_DESIGN),
    ].filter((name) => !known.has(name));

    // A renamed model leaves a registry entry pointing at nothing, which scopes nothing
    // and reports no error — the same silence as never having registered it.
    expect(phantom).toEqual([]);
  });

  it('claims a district or year filter only where the column exists', () => {
    const byName = new Map(blocks.map((block) => [block.name, block]));

    const wrong: string[] = [];
    for (const [name, rule] of Object.entries(CONTEXT_BOUND_MODELS) as [string, ScopeRule][]) {
      const block = byName.get(name);
      if (!block) continue;
      if (rule.district && !block.hasDistrict) wrong.push(`${name}.districtId`);
      if (rule.year && !block.hasYear) wrong.push(`${name}.rotaryYearId`);
    }

    // A rule naming a column the table does not have produces a Prisma "unknown argument"
    // at runtime, on whichever endpoint happens to touch it first.
    expect(wrong).toEqual([]);
  });

  it('leaves an explicit reason for every exemption', () => {
    for (const [name, reason] of Object.entries(UNSCOPED_BY_DESIGN)) {
      expect(reason.length, `${name} needs a real reason, not a placeholder`).toBeGreaterThan(40);
    }
  });
});
