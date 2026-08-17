import { useState } from 'react';
import type { ActivityField, ActivityType, FieldConfig } from '@dis/contracts';
import {
  Badge,
  Button,
  Card,
  Checkbox,
  Dialog,
  EmptyState,
  ErrorState,
  Input,
  PageHeader,
  Select,
  SkeletonList,
} from '../../components/ui';
import { Icon } from '../../components/ui/icons';
import { api } from '../../lib/api';
import { queryKeys, useApiMutation, useList } from '../../lib/queries';
import { useAuth } from '../auth/useAuth';

/**
 * Activity types — the screen axiom 4 exists for.
 *
 * "Extra activities should not require a photo" is the district's own request, and here it is
 * a checkbox rather than a ticket. Adding a type is an insert; it needs no deployment and no
 * client release, because the reporting form is rendered from what this screen declares.
 *
 * The `field_config` builder has a LIVE PREVIEW beside it, because a declaration you cannot
 * see the consequences of is a declaration somebody gets wrong and only discovers when forty
 * secretaries hit it.
 */

const CATEGORIES = [
  'FELLOWSHIP',
  'SERVICE',
  'INTERNATIONAL',
  'YOUTH',
  'PLD',
  'GOVERNANCE',
  'CLUSTER',
  'DISTRICT',
  'COMMITTEE',
] as const;

const SCOPES = ['CLUB', 'CLUSTER', 'REGION', 'DISTRICT', 'COMMITTEE'] as const;

const FIELD_KINDS = [
  { value: 'text', label: 'Text' },
  { value: 'number', label: 'Number' },
  { value: 'date', label: 'Date' },
  { value: 'select', label: 'Choice' },
  { value: 'boolean', label: 'Yes / no' },
];

const REQUIREMENTS = [
  { key: 'requiresPhoto', label: 'A photograph' },
  { key: 'requiresReport', label: 'A written report' },
  { key: 'requiresAttendance', label: 'An attendance list' },
  { key: 'requiresPartner', label: 'A partner organisation' },
  { key: 'requiresAreaOfFocus', label: 'An area of focus' },
] as const;

interface ListResponse {
  data: ActivityType[];
}

export function ActivityTypesPage() {
  const { permissions } = useAuth();
  const mayManage = permissions.has('activitytype:manage:district');
  const [editing, setEditing] = useState<ActivityType | null>(null);
  const [creating, setCreating] = useState(false);

  const types = useList<ListResponse>(queryKeys.activityTypes, '/activity-types/flat');

  if (types.isPending) return <SkeletonList rows={5} />;
  if (types.isError) return <ErrorState error={types.error} onRetry={() => void types.refetch()} />;

  const byCategory = CATEGORIES.map((category) => ({
    category,
    types: types.data.data.filter((type) => type.category === category),
  })).filter((group) => group.types.length > 0);

  return (
    <>
      <PageHeader
        title="Activity types"
        description="Configuration, not code. A new type is a row — no deployment, no client release."
        action={mayManage ? <Button onClick={() => setCreating(true)}>New type</Button> : null}
      />

      {byCategory.length === 0 ? (
        <Card>
          <EmptyState title="No activity types" />
        </Card>
      ) : (
        <div className="flex flex-col gap-4">
          {byCategory.map((group) => (
            <Card key={group.category} title={group.category}>
              <ul className="flex flex-col gap-2">
                {group.types.map((type) => (
                  <li
                    key={type.id}
                    className="border-border-subtle flex flex-wrap items-center justify-between gap-2 rounded-lg border p-3"
                  >
                    <div className="min-w-0">
                      <p className="text-text-primary font-medium">
                        {type.name}{' '}
                        <span className="text-text-muted font-mono text-meta">{type.code}</span>
                      </p>
                      <p className="text-text-muted text-meta">
                        {REQUIREMENTS.filter((requirement) => type[requirement.key])
                          .map((requirement) => requirement.label)
                          .join(' · ') || 'Nothing required'}
                        {type.fieldConfig.fields.length > 0
                          ? ` · ${type.fieldConfig.fields.length} extra field(s)`
                          : ''}
                      </p>
                    </div>
                    <div className="flex flex-wrap items-center gap-2">
                      {type.isTemplate && <Badge tone="info">Shared</Badge>}
                      {!type.isActive && <Badge tone="warning">Inactive</Badge>}
                      {!type.isScoringEligible && <Badge>Not scored</Badge>}
                      <Badge>{type.activityCount} used</Badge>
                      {mayManage && !type.isTemplate && (
                        <Button variant="ghost" onClick={() => setEditing(type)}>
                          Edit
                        </Button>
                      )}
                    </div>
                  </li>
                ))}
              </ul>
            </Card>
          ))}
        </div>
      )}

      {(creating || editing) && (
        <TypeDialog
          type={editing}
          onClose={() => {
            setCreating(false);
            setEditing(null);
          }}
        />
      )}
    </>
  );
}

interface FormState {
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
  isActive: boolean;
  sequence: number;
  fields: ActivityField[];
}

function TypeDialog({ type, onClose }: { type: ActivityType | null; onClose: () => void }) {
  const [form, setForm] = useState<FormState>({
    code: type?.code ?? '',
    name: type?.name ?? '',
    category: type?.category ?? 'SERVICE',
    allowedHostScopes: type?.allowedHostScopes ?? ['CLUB'],
    requiresPhoto: type?.requiresPhoto ?? false,
    requiresReport: type?.requiresReport ?? false,
    requiresAttendance: type?.requiresAttendance ?? false,
    requiresPartner: type?.requiresPartner ?? false,
    requiresAreaOfFocus: type?.requiresAreaOfFocus ?? false,
    isScoringEligible: type?.isScoringEligible ?? true,
    isActive: type?.isActive ?? true,
    sequence: type?.sequence ?? 0,
    fields: type?.fieldConfig.fields ?? [],
  });

  const set = <K extends keyof FormState>(key: K, value: FormState[K]) => {
    setForm((current) => ({ ...current, [key]: value }));
  };

  const save = useApiMutation(
    async (body: Record<string, unknown>) =>
      type ? api.patch(`/activity-types/${type.id}`, body) : api.post('/activity-types', body),
    {
      invalidate: [queryKeys.activityTypes],
      successMessage: type ? 'Activity type saved' : 'Activity type created',
    },
  );

  const payload = (): Record<string, unknown> => {
    const fieldConfig: FieldConfig = { fields: form.fields };
    const base = {
      name: form.name.trim(),
      category: form.category,
      allowedHostScopes: form.allowedHostScopes,
      requiresPhoto: form.requiresPhoto,
      requiresReport: form.requiresReport,
      requiresAttendance: form.requiresAttendance,
      requiresPartner: form.requiresPartner,
      requiresAreaOfFocus: form.requiresAreaOfFocus,
      isScoringEligible: form.isScoringEligible,
      sequence: form.sequence,
      fieldConfig,
    };
    // `code` is immutable after creation: the seed and any scoring rule refer to a type by
    // it, so it is absent from the patch rather than disabled and sent.
    return type ? { ...base, isActive: form.isActive } : { ...base, code: form.code.trim() };
  };

  return (
    <Dialog
      isOpen
      title={type ? `Edit ${type.name}` : 'New activity type'}
      onClose={onClose}
      footer={
        <>
          <Button variant="secondary" onClick={onClose}>
            Cancel
          </Button>
          <Button
            isLoading={save.isPending}
            onClick={() => save.mutate(payload(), { onSuccess: onClose })}
          >
            Save
          </Button>
        </>
      }
    >
      <div className="grid gap-4 lg:grid-cols-2">
        <div className="flex flex-col gap-3">
          {!type && (
            <Input
              label="Code"
              value={form.code}
              hint="Upper snake case. Immutable once created — rules refer to a type by it."
              onChange={(event) => set('code', event.target.value.toUpperCase())}
            />
          )}
          <Input
            label="Name"
            value={form.name}
            onChange={(event) => set('name', event.target.value)}
          />
          <Select
            label="Category"
            value={form.category}
            options={CATEGORIES.map((category) => ({ value: category, label: category }))}
            onChange={(event) => set('category', event.target.value)}
          />

          <fieldset>
            <legend className="text-text-secondary mb-1 text-table font-medium">
              Who may host it
            </legend>
            {SCOPES.map((scope) => (
              <Checkbox
                key={scope}
                label={scope}
                checked={form.allowedHostScopes.includes(scope)}
                onChange={(checked) =>
                  set(
                    'allowedHostScopes',
                    checked
                      ? [...form.allowedHostScopes, scope]
                      : form.allowedHostScopes.filter((value) => value !== scope),
                  )
                }
              />
            ))}
          </fieldset>

          <fieldset>
            <legend className="text-text-secondary mb-1 text-table font-medium">
              What it requires
            </legend>
            {REQUIREMENTS.map((requirement) => (
              <Checkbox
                key={requirement.key}
                label={requirement.label}
                checked={form[requirement.key]}
                onChange={(checked) => set(requirement.key, checked)}
              />
            ))}
            <Checkbox
              label="Counts towards the scorecard"
              checked={form.isScoringEligible}
              onChange={(checked) => set('isScoringEligible', checked)}
            />
            {type && (
              <Checkbox
                label="Active"
                checked={form.isActive}
                onChange={(checked) => set('isActive', checked)}
              />
            )}
          </fieldset>

          <FieldBuilder fields={form.fields} onChange={(fields) => set('fields', fields)} />
        </div>

        {/* The live preview. A declaration whose consequences you cannot see is one somebody
            gets wrong and only discovers when forty secretaries hit it. */}
        <div className="border-border-subtle rounded-lg border p-3">
          <h3 className="text-text-secondary mb-3 text-table font-semibold">
            What a secretary will see
          </h3>
          <FormPreview form={form} />
        </div>
      </div>
    </Dialog>
  );
}

function FieldBuilder({
  fields,
  onChange,
}: {
  fields: ActivityField[];
  onChange: (fields: ActivityField[]) => void;
}) {
  const update = (index: number, patch: Partial<ActivityField>) => {
    onChange(
      fields.map((field, position) => (position === index ? { ...field, ...patch } : field)),
    );
  };

  return (
    <fieldset>
      <legend className="text-text-secondary mb-1 text-table font-medium">Extra fields</legend>
      <p className="text-text-muted mb-2 text-meta">
        Stored on the activity under the key you choose. Renaming a key later orphans the data
        already recorded under the old one, so choose it once.
      </p>

      <div className="flex flex-col gap-3">
        {fields.map((field, index) => (
          <div
            key={index}
            className="border-border-subtle flex flex-col gap-2 rounded-lg border p-2"
          >
            <div className="grid gap-2 sm:grid-cols-2">
              <Input
                label="Key"
                value={field.key}
                onChange={(event) => update(index, { key: event.target.value })}
              />
              <Input
                label="Label"
                value={field.label}
                onChange={(event) => update(index, { label: event.target.value })}
              />
              <Select
                label="Kind"
                value={field.type}
                options={FIELD_KINDS}
                onChange={(event) =>
                  update(index, { type: event.target.value as ActivityField['type'] })
                }
              />
              {field.type === 'select' && (
                <Input
                  label="Choices"
                  value={(field.options ?? []).join(', ')}
                  hint="Comma separated"
                  onChange={(event) =>
                    update(index, {
                      options: event.target.value
                        .split(',')
                        .map((option) => option.trim())
                        .filter(Boolean),
                    })
                  }
                />
              )}
            </div>
            <div className="flex items-center justify-between">
              <Checkbox
                label="Required"
                checked={field.required}
                onChange={(checked) => update(index, { required: checked })}
              />
              <Button
                variant="ghost"
                onClick={() => onChange(fields.filter((_, position) => position !== index))}
              >
                Remove
              </Button>
            </div>
          </div>
        ))}

        <Button
          variant="secondary"
          onClick={() =>
            onChange([...fields, { key: '', label: '', type: 'text', required: false }])
          }
        >
          Add a field
        </Button>
      </div>
    </fieldset>
  );
}

/**
 * The reporting form, as this declaration would render it.
 *
 * Deliberately the same shape the real form uses, so what an administrator sees here is what
 * a secretary gets — a preview that is a different renderer is a preview that lies.
 */
function FormPreview({ form }: { form: FormState }) {
  return (
    <div className="pointer-events-none flex flex-col gap-3 opacity-90">
      <Input label="Title" value="" readOnly onChange={() => undefined} />
      <Input
        label="Date and time"
        type="datetime-local"
        value=""
        readOnly
        onChange={() => undefined}
      />
      {form.requiresReport && (
        <Input label="Narrative report" value="" readOnly onChange={() => undefined} />
      )}
      {form.requiresPhoto && (
        <p className="text-text-secondary text-table flex items-center gap-2">
          <Icon name="camera" className="size-4 shrink-0" />
          At least one photograph is required
        </p>
      )}
      {form.requiresAttendance && (
        <p className="text-text-secondary text-table flex items-center gap-2">
          <Icon name="members" className="size-4 shrink-0" />
          An attendance list is required
        </p>
      )}
      {form.requiresPartner && (
        <p className="text-text-secondary text-table flex items-center gap-2">
          <Icon name="committees" className="size-4 shrink-0" />A partner organisation is required
        </p>
      )}
      {form.requiresAreaOfFocus && (
        <p className="text-text-secondary text-table flex items-center gap-2">
          <Icon name="activities" className="size-4 shrink-0" />
          An area of focus is required
        </p>
      )}

      {form.fields.map((field, index) => (
        <div key={index}>
          {field.type === 'boolean' ? (
            <Checkbox
              label={field.label || field.key || 'Untitled'}
              checked={false}
              onChange={() => undefined}
            />
          ) : field.type === 'select' ? (
            <Select
              label={`${field.label || field.key || 'Untitled'}${field.required ? ' *' : ''}`}
              value=""
              placeholder="Choose"
              options={(field.options ?? []).map((option) => ({ value: option, label: option }))}
              onChange={() => undefined}
            />
          ) : (
            <Input
              label={`${field.label || field.key || 'Untitled'}${field.required ? ' *' : ''}`}
              type={field.type === 'number' ? 'number' : field.type === 'date' ? 'date' : 'text'}
              value=""
              hint={field.helpText}
              readOnly
              onChange={() => undefined}
            />
          )}
        </div>
      ))}

      {form.fields.length === 0 && (
        <p className="text-text-muted text-meta">No extra fields — the form is the standard one.</p>
      )}
    </div>
  );
}
