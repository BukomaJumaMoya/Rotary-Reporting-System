import { useEffect, useRef, useState } from 'react';
import { useNavigate } from 'react-router-dom';
import type { ActivityField, ActivityType } from '@dis/contracts';
import { ApiError, api, apiRequest } from '../../lib/api';
import { Button, Card, Input, PageHeader, Select, SkeletonList } from '../../components/ui';
import { cx } from '../../lib/cx';
import { queryKeys, useApiMutation, useList } from '../../lib/queries';
import { uuid } from '../../lib/uuid';
import { useAuth } from '../auth/useAuth';
import type { ClubListResponse } from '../clubs/types';

/**
 * THE screen. A club secretary, on an Android phone, at eleven at night, on metered data.
 *
 * Four steps, because four short screens beat one long form on a 360px display — and because
 * a form that shows every field for every type shows fourteen fields of which four apply.
 * Step 2 is rendered from the TYPE's own declaration: `requires_*` and `field_config`. There
 * is no per-type branch anywhere in this file, which is what makes adding an activity type a
 * row rather than a release.
 *
 * Progress survives navigating away and back — sessionStorage, not a server draft. A
 * secretary who taps a notification mid-report and comes back should not start again, and a
 * draft on the server is a row somebody has to clean up.
 *
 * The activity id is generated HERE, so submitting twice on a bad connection produces one
 * activity (ADR-006) — through `uuid()`, never `crypto.randomUUID()`, which is
 * secure-context only and therefore undefined on any http:// origin that is not localhost.
 */

const DRAFT_KEY = 'dis:report-draft';

interface Draft {
  step: number;
  activityId: string;
  activityTypeId: string;
  clubId: string;
  title: string;
  description: string;
  startsAt: string;
  venue: string;
  narrativeReport: string;
  attendanceMembers: string;
  attendanceGuests: string;
  beneficiariesCount: string;
  extra: Record<string, string>;
  areaOfFocusCodes: string[];
}

function emptyDraft(): Draft {
  return {
    step: 1,
    activityId: uuid(),
    activityTypeId: '',
    clubId: '',
    title: '',
    description: '',
    // Most reports are filed about something that has just happened, so "now" is right far
    // more often than an empty field.
    startsAt: new Date(Date.now() - new Date().getTimezoneOffset() * 60_000)
      .toISOString()
      .slice(0, 16),
    venue: '',
    narrativeReport: '',
    attendanceMembers: '',
    attendanceGuests: '',
    beneficiariesCount: '',
    extra: {},
    areaOfFocusCodes: [],
  };
}

function loadDraft(): Draft {
  try {
    const stored = sessionStorage.getItem(DRAFT_KEY);
    if (!stored) return emptyDraft();
    return { ...emptyDraft(), ...(JSON.parse(stored) as Partial<Draft>) };
  } catch {
    // A corrupt draft is not worth an error screen; it is worth a fresh form.
    return emptyDraft();
  }
}

const AREAS = [
  { code: 'PEACE', label: 'Peacebuilding' },
  { code: 'DISEASE', label: 'Disease prevention' },
  { code: 'WATER', label: 'Water and sanitation' },
  { code: 'MATERNAL_CHILD', label: 'Maternal and child health' },
  { code: 'EDUCATION', label: 'Education and literacy' },
  { code: 'ECONOMIC', label: 'Economic development' },
  { code: 'ENVIRONMENT', label: 'The environment' },
];

interface GroupedTypes {
  data: { category: string; types: ActivityType[] }[];
}

export function ReportPage() {
  const navigate = useNavigate();
  const { permissions } = useAuth();
  const [draft, setDraft] = useState<Draft>(loadDraft);
  const [files, setFiles] = useState<File[]>([]);
  const [fieldErrors, setFieldErrors] = useState<Record<string, string>>({});
  const fileInput = useRef<HTMLInputElement>(null);

  // Persisted on every change rather than on a timer: the tab that gets killed is the one
  // that was backgrounded, and a timer that has not fired yet has saved nothing.
  useEffect(() => {
    sessionStorage.setItem(DRAFT_KEY, JSON.stringify(draft));
  }, [draft]);

  const types = useList<GroupedTypes>(queryKeys.activityTypes, '/activity-types', {
    isActive: true,
  });
  const clubs = useList<ClubListResponse>([...queryKeys.clubs, 'picker'], '/clubs', {
    pageSize: 100,
  });

  const set = <K extends keyof Draft>(key: K, value: Draft[K]) => {
    setDraft((current) => ({ ...current, [key]: value }));
  };

  const submit = useApiMutation(
    async (body: Record<string, unknown>) =>
      api.post<{ data: { id: string } }>('/activities', body),
    { invalidate: [queryKeys.activities, queryKeys.clubs] },
  );

  if (!permissions.has('activity:create:club')) {
    return (
      <Card>
        <p className="text-ink-600 text-sm">You do not have permission to report an activity.</p>
      </Card>
    );
  }

  const allTypes = (types.data?.data ?? []).flatMap((group) => group.types);
  const type = allTypes.find((candidate) => candidate.id === draft.activityTypeId);

  const finish = async () => {
    if (!type) return;
    setFieldErrors({});

    const payload: Record<string, unknown> = {
      id: draft.activityId,
      activityTypeId: draft.activityTypeId,
      hostScopeType: 'CLUB',
      hostScopeId: draft.clubId,
      title: draft.title.trim(),
      description: draft.description.trim() || null,
      startsAt: new Date(draft.startsAt).toISOString(),
      venue: draft.venue.trim() || null,
      status: 'HELD',
      narrativeReport: draft.narrativeReport.trim() || null,
      attendanceMembers: draft.attendanceMembers ? Number(draft.attendanceMembers) : null,
      attendanceGuests: draft.attendanceGuests ? Number(draft.attendanceGuests) : null,
      beneficiariesCount: draft.beneficiariesCount ? Number(draft.beneficiariesCount) : null,
      extra: draft.extra,
      areaOfFocusCodes: draft.areaOfFocusCodes,
    };

    const created = await submit.mutateAsync(payload).catch((error: unknown) => {
      if (error instanceof ApiError) {
        // The server names the field it is missing in `details.key`, so the message lands
        // on the control rather than in a toast the member has to translate.
        const key = typeof error.details?.['key'] === 'string' ? error.details['key'] : null;
        setFieldErrors(key ? { [key]: error.message } : error.fieldErrors);
      }
      return null;
    });
    if (!created) return;

    // Photographs after the activity exists — they need its id. Sequentially, because a
    // phone on 3G uploading four images at once finishes none of them first.
    for (const file of files) {
      const form = new FormData();
      form.append('file', file);
      await apiRequest(`/activities/${created.data.id}/media`, {
        method: 'POST',
        formData: form,
      }).catch(() => undefined);
    }

    sessionStorage.removeItem(DRAFT_KEY);
    navigate(`/activities/${created.data.id}`);
  };

  if (types.isPending) return <SkeletonList rows={4} />;

  return (
    <>
      <PageHeader
        title="Report an activity"
        description="Four steps. Your progress is kept if you leave this page."
      />

      <Steps current={draft.step} />

      {draft.step === 1 && (
        <Card title="What kind of activity?">
          {(types.data?.data ?? []).map((group) => (
            <div key={group.category} className="mb-4">
              <h3 className="text-ink-500 mb-2 text-xs font-semibold tracking-wide uppercase">
                {group.category}
              </h3>
              <div className="grid grid-cols-2 gap-2 sm:grid-cols-3">
                {group.types.map((candidate) => (
                  <button
                    key={candidate.id}
                    type="button"
                    onClick={() =>
                      setDraft((current) => ({
                        ...current,
                        activityTypeId: candidate.id,
                        step: 2,
                      }))
                    }
                    className={cx(
                      'min-h-16 rounded-lg border p-3 text-left text-sm',
                      draft.activityTypeId === candidate.id
                        ? 'border-cranberry-500 bg-cranberry-50 text-cranberry-700'
                        : 'border-ink-200 hover:bg-ink-50',
                    )}
                  >
                    {candidate.name}
                  </button>
                ))}
              </div>
            </div>
          ))}
        </Card>
      )}

      {draft.step === 2 && type && (
        <Card title={type.name}>
          <div className="flex flex-col gap-3">
            <Select
              label="Club"
              value={draft.clubId}
              placeholder="Choose your club"
              options={(clubs.data?.data ?? []).map((club) => ({
                value: club.id,
                label: club.name,
              }))}
              onChange={(event) => set('clubId', event.target.value)}
            />
            <Input
              label="Title"
              required
              value={draft.title}
              error={fieldErrors['title']}
              onChange={(event) => set('title', event.target.value)}
            />
            <Input
              label="When"
              type="datetime-local"
              value={draft.startsAt}
              onChange={(event) => set('startsAt', event.target.value)}
            />
            <Input
              label="Where"
              value={draft.venue}
              onChange={(event) => set('venue', event.target.value)}
            />

            <label className="flex flex-col gap-1.5">
              <span className="text-ink-700 text-sm font-medium">What happened</span>
              {/* No length limit. The predecessor's was a logged complaint. */}
              <textarea
                rows={5}
                className="border-ink-300 rounded-lg border px-3 py-2 text-base"
                value={draft.description}
                onChange={(event) => set('description', event.target.value)}
              />
            </label>

            {/* Everything below is rendered from the TYPE. No per-type branch exists here. */}
            {type.requiresReport && (
              <label className="flex flex-col gap-1.5">
                <span className="text-ink-700 text-sm font-medium">Narrative report *</span>
                <textarea
                  rows={5}
                  className={cx(
                    'rounded-lg border px-3 py-2 text-base',
                    fieldErrors['narrativeReport'] ? 'border-danger-600' : 'border-ink-300',
                  )}
                  value={draft.narrativeReport}
                  onChange={(event) => set('narrativeReport', event.target.value)}
                />
                {fieldErrors['narrativeReport'] && (
                  <span role="alert" className="text-danger-700 text-xs">
                    {fieldErrors['narrativeReport']}
                  </span>
                )}
              </label>
            )}

            {type.requiresAttendance && (
              <div className="grid grid-cols-2 gap-3">
                <Input
                  label="Members present"
                  inputMode="numeric"
                  value={draft.attendanceMembers}
                  onChange={(event) => set('attendanceMembers', event.target.value)}
                />
                <Input
                  label="Guests"
                  inputMode="numeric"
                  value={draft.attendanceGuests}
                  onChange={(event) => set('attendanceGuests', event.target.value)}
                />
              </div>
            )}

            <Input
              label="People reached"
              inputMode="numeric"
              value={draft.beneficiariesCount}
              onChange={(event) => set('beneficiariesCount', event.target.value)}
            />

            {type.requiresAreaOfFocus && (
              <fieldset>
                <legend className="text-ink-700 mb-1 text-sm font-medium">Area of focus *</legend>
                {fieldErrors['areaOfFocusCodes'] && (
                  <p role="alert" className="text-danger-700 mb-1 text-xs">
                    {fieldErrors['areaOfFocusCodes']}
                  </p>
                )}
                <div className="grid grid-cols-2 gap-1">
                  {AREAS.map((area) => (
                    <label key={area.code} className="flex min-h-11 items-center gap-2 text-sm">
                      <input
                        type="checkbox"
                        className="h-5 w-5"
                        checked={draft.areaOfFocusCodes.includes(area.code)}
                        onChange={(event) =>
                          set(
                            'areaOfFocusCodes',
                            event.target.checked
                              ? [...draft.areaOfFocusCodes, area.code]
                              : draft.areaOfFocusCodes.filter((code) => code !== area.code),
                          )
                        }
                      />
                      {area.label}
                    </label>
                  ))}
                </div>
              </fieldset>
            )}

            {type.fieldConfig.fields.map((field) => (
              <DeclaredField
                key={field.key}
                field={field}
                value={draft.extra[field.key] ?? ''}
                error={fieldErrors[field.key]}
                onChange={(value) => set('extra', { ...draft.extra, [field.key]: value })}
              />
            ))}

            <StepButtons
              onBack={() => set('step', 1)}
              onNext={() => set('step', 3)}
              nextDisabled={!draft.clubId || draft.title.trim().length < 3}
            />
          </div>
        </Card>
      )}

      {draft.step === 3 && type && (
        <Card title={type.requiresPhoto ? 'Photographs (required)' : 'Photographs'}>
          <input
            ref={fileInput}
            type="file"
            accept="image/*"
            // `capture` opens the camera directly on a phone. The member is standing at the
            // project; making them go through the gallery is a step for nothing.
            capture="environment"
            multiple
            className="hidden"
            onChange={(event) => {
              setFiles([...files, ...Array.from(event.target.files ?? [])]);
              event.target.value = '';
            }}
          />

          <div className="flex flex-wrap gap-3">
            {files.map((file, index) => (
              <div key={index} className="relative">
                <img
                  src={URL.createObjectURL(file)}
                  alt=""
                  className="border-ink-200 h-24 w-24 rounded-lg border object-cover"
                />
                <button
                  type="button"
                  onClick={() => setFiles(files.filter((_, position) => position !== index))}
                  className="bg-danger-600 absolute -top-2 -right-2 h-6 w-6 rounded-full text-white"
                  aria-label="Remove"
                >
                  ×
                </button>
              </div>
            ))}
            <Button variant="secondary" onClick={() => fileInput.current?.click()}>
              Add a photo
            </Button>
          </div>

          <p className="text-ink-500 mt-3 text-xs">
            Location data is removed from every photograph before it is stored.
          </p>

          <StepButtons
            onBack={() => set('step', 2)}
            onNext={() => set('step', 4)}
            nextDisabled={type.requiresPhoto && files.length === 0}
          />
        </Card>
      )}

      {draft.step === 4 && type && (
        <Card title="Check and submit">
          <dl className="grid gap-2 text-sm">
            <Row label="Type" value={type.name} />
            <Row
              label="Club"
              value={clubs.data?.data.find((club) => club.id === draft.clubId)?.name ?? '—'}
            />
            <Row label="Title" value={draft.title} />
            <Row label="When" value={draft.startsAt.replace('T', ' ')} />
            <Row label="Where" value={draft.venue || '—'} />
            <Row label="Photographs" value={String(files.length)} />
          </dl>

          <div className="mt-4 flex flex-wrap gap-3">
            <Button isLoading={submit.isPending} onClick={() => void finish()}>
              Submit
            </Button>
            <Button variant="secondary" onClick={() => set('step', 3)}>
              Back
            </Button>
          </div>
        </Card>
      )}
    </>
  );
}

function Steps({ current }: { current: number }) {
  const labels = ['Type', 'Details', 'Photos', 'Check'];
  return (
    <ol className="mb-4 flex gap-1">
      {labels.map((label, index) => (
        <li
          key={label}
          className={cx(
            'flex-1 rounded-full py-1 text-center text-xs font-medium',
            index + 1 === current
              ? 'bg-cranberry-500 text-white'
              : index + 1 < current
                ? 'bg-cranberry-100 text-cranberry-700'
                : 'bg-ink-100 text-ink-500',
          )}
        >
          {label}
        </li>
      ))}
    </ol>
  );
}

function StepButtons({
  onBack,
  onNext,
  nextDisabled,
}: {
  onBack: () => void;
  onNext: () => void;
  nextDisabled?: boolean;
}) {
  return (
    <div className="mt-4 flex gap-3">
      <Button variant="secondary" onClick={onBack}>
        Back
      </Button>
      <Button onClick={onNext} disabled={nextDisabled}>
        Continue
      </Button>
    </div>
  );
}

/** One field the TYPE declared. The renderer knows the five kinds and nothing else. */
function DeclaredField({
  field,
  value,
  error,
  onChange,
}: {
  field: ActivityField;
  value: string;
  error: string | undefined;
  onChange: (value: string) => void;
}) {
  const label = `${field.label}${field.required ? ' *' : ''}`;

  if (field.type === 'boolean') {
    return (
      <label className="flex min-h-11 items-center gap-3 text-sm">
        <input
          type="checkbox"
          className="h-5 w-5"
          checked={value === 'true'}
          onChange={(event) => onChange(String(event.target.checked))}
        />
        {label}
      </label>
    );
  }

  if (field.type === 'select') {
    return (
      <Select
        label={label}
        value={value}
        error={error}
        hint={field.helpText}
        placeholder="Choose"
        options={(field.options ?? []).map((option) => ({ value: option, label: option }))}
        onChange={(event) => onChange(event.target.value)}
      />
    );
  }

  return (
    <Input
      label={label}
      type={field.type === 'number' ? 'number' : field.type === 'date' ? 'date' : 'text'}
      inputMode={field.type === 'number' ? 'numeric' : undefined}
      value={value}
      error={error}
      hint={field.helpText}
      onChange={(event) => onChange(event.target.value)}
    />
  );
}

function Row({ label, value }: { label: string; value: string }) {
  return (
    <div className="flex justify-between gap-4">
      <dt className="text-ink-500">{label}</dt>
      <dd className="text-ink-900 text-right">{value}</dd>
    </div>
  );
}
