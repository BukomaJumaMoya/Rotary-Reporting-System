import type {
  ActivityType,
  ActivityTypeListQuery,
  CreateActivityType,
  RequestContext,
  UpdateActivityType,
} from '@dis/contracts';
import { activityCategories, fieldConfigSchema } from '@dis/contracts';
import { db } from '../../platform/db.js';
import { AppError, ErrorCode, notFound } from '../../platform/errors.js';

/**
 * Activity types — the configuration axiom 4 rests on.
 *
 * "Extra activities should not require a photo" is the district's own request, and it is a
 * checkbox on a row here rather than a ticket. A new activity type is an INSERT: never a new
 * table, never a deployment, never a client release — which is what `field_config` buys, at
 * the cost of a format that has to be right the first time.
 */

const SELECT = {
  id: true,
  districtId: true,
  code: true,
  name: true,
  category: true,
  allowedHostScopes: true,
  requiresPhoto: true,
  requiresReport: true,
  requiresAttendance: true,
  requiresPartner: true,
  requiresAreaOfFocus: true,
  isScoringEligible: true,
  fieldConfig: true,
  sequence: true,
  isActive: true,
  _count: { select: { activities: true } },
} as const;

type Row = {
  id: string;
  districtId: string | null;
  code: string;
  name: string;
  category: string;
  allowedHostScopes: string[];
  requiresPhoto: boolean;
  requiresReport: boolean;
  requiresAttendance: boolean;
  requiresPartner: boolean;
  requiresAreaOfFocus: boolean;
  isScoringEligible: boolean;
  fieldConfig: unknown;
  sequence: number;
  isActive: boolean;
  _count: { activities: number };
};

/**
 * Parses `field_config` on the way OUT as well as on the way in.
 *
 * The column is JSONB and its contents were written by an earlier version of this code, a
 * migration, or the seed. A row that no longer parses is rendered as a type with no extra
 * fields rather than as a 500 — the type's own flags still work, and a broken declaration
 * should not take the reporting screen down with it.
 */
function parseFieldConfig(value: unknown): ActivityType['fieldConfig'] {
  const parsed = fieldConfigSchema.safeParse(value ?? {});
  if (parsed.success) return parsed.data;
  console.error('[activity] field_config did not parse; rendering the type without extra fields');
  return { fields: [] };
}

function serialise(row: Row): ActivityType {
  return {
    id: row.id,
    districtId: row.districtId,
    isTemplate: row.districtId === null,
    code: row.code,
    name: row.name,
    category: row.category as ActivityType['category'],
    allowedHostScopes: row.allowedHostScopes as ActivityType['allowedHostScopes'],
    requiresPhoto: row.requiresPhoto,
    requiresReport: row.requiresReport,
    requiresAttendance: row.requiresAttendance,
    requiresPartner: row.requiresPartner,
    requiresAreaOfFocus: row.requiresAreaOfFocus,
    isScoringEligible: row.isScoringEligible,
    fieldConfig: parseFieldConfig(row.fieldConfig),
    sequence: row.sequence,
    isActive: row.isActive,
    activityCount: row._count.activities,
  };
}

export async function list(
  ctx: RequestContext,
  query: ActivityTypeListQuery,
): Promise<ActivityType[]> {
  const rows = await db(ctx).activityType.findMany({
    where: {
      ...(query.category ? { category: query.category } : {}),
      ...(query.isActive === undefined ? {} : { isActive: query.isActive }),
      // Templates carry `district_id IS NULL` and the scope rule is `sharedWhenNull`, so
      // excluding them means saying so.
      ...(query.includeTemplates === false ? { districtId: ctx.districtId } : {}),
    },
    select: SELECT,
    orderBy: [{ sequence: 'asc' }, { name: 'asc' }],
  });

  return rows.map((row) => serialise(row as Row));
}

/**
 * Grouped by category, which is how the reporting flow presents them.
 *
 * Grouped on the SERVER so the ordering is one decision. A client grouping a flat list
 * would have to know the category order too, and the second copy is the one that drifts.
 */
export async function listGrouped(
  ctx: RequestContext,
  query: ActivityTypeListQuery,
): Promise<{ category: ActivityType['category']; types: ActivityType[] }[]> {
  const types = await list(ctx, query);

  return activityCategories
    .map((category) => ({
      category,
      types: types.filter((type) => type.category === category),
    }))
    .filter((group) => group.types.length > 0);
}

export async function get(ctx: RequestContext, id: string): Promise<ActivityType> {
  const row = await db(ctx).activityType.findFirst({ where: { id }, select: SELECT });
  if (!row) throw notFound();
  return serialise(row);
}

/**
 * A template — `district_id NULL` — belongs to every district and to none of them.
 * Readable by all, editable by no one through the API: changing the shared catalogue is a
 * migration, made once, deliberately, for everybody.
 */
function assertEditable(row: Row): void {
  if (row.districtId === null) {
    throw new AppError(
      403,
      ErrorCode.TEMPLATE_IMMUTABLE,
      'Shared activity types cannot be edited. Create one for your district instead.',
      { code: row.code },
    );
  }
}

export async function create(
  ctx: RequestContext,
  input: CreateActivityType,
): Promise<ActivityType> {
  const existing = await db(ctx).activityType.findFirst({
    where: { code: input.code, districtId: ctx.districtId },
    select: { id: true },
  });
  if (existing) {
    throw new AppError(409, ErrorCode.DUPLICATE_CODE, 'An activity type with that code exists', {
      code: input.code,
    });
  }

  const created = await db(ctx).activityType.create({
    data: {
      code: input.code,
      name: input.name,
      category: input.category,
      allowedHostScopes: input.allowedHostScopes,
      requiresPhoto: input.requiresPhoto,
      requiresReport: input.requiresReport,
      requiresAttendance: input.requiresAttendance,
      requiresPartner: input.requiresPartner,
      requiresAreaOfFocus: input.requiresAreaOfFocus,
      isScoringEligible: input.isScoringEligible,
      // Validated by the contract before it gets here, so what lands in JSONB is a shape
      // the renderer and the validator both understand.
      fieldConfig: input.fieldConfig ?? { fields: [] },
      sequence: input.sequence,
    },
  });

  return get(ctx, created.id);
}

export async function update(
  ctx: RequestContext,
  id: string,
  input: UpdateActivityType,
): Promise<ActivityType> {
  const row = await db(ctx).activityType.findFirst({ where: { id }, select: SELECT });
  if (!row) throw notFound();
  assertEditable(row);

  const data: Record<string, unknown> = {};
  const assign = (key: string, value: unknown): void => {
    if (value !== undefined) data[key] = value;
  };

  assign('name', input.name);
  assign('category', input.category);
  assign('allowedHostScopes', input.allowedHostScopes);
  assign('requiresPhoto', input.requiresPhoto);
  assign('requiresReport', input.requiresReport);
  assign('requiresAttendance', input.requiresAttendance);
  assign('requiresPartner', input.requiresPartner);
  assign('requiresAreaOfFocus', input.requiresAreaOfFocus);
  assign('isScoringEligible', input.isScoringEligible);
  assign('fieldConfig', input.fieldConfig);
  assign('sequence', input.sequence);
  assign('isActive', input.isActive);

  if (Object.keys(data).length > 0) {
    await db(ctx).activityType.updateMany({ where: { id }, data });
  }

  return get(ctx, id);
}
