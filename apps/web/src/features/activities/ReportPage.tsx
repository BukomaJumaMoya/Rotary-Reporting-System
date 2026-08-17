import { useEffect, useRef, useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { useQueryClient } from '@tanstack/react-query';
import type { ActivityField, ActivityType } from '@dis/contracts';
import { Button, Card, Input, PageHeader, Select, SkeletonList } from '../../components/ui';
import { cx } from '../../lib/cx';
import { compressImage, formatBytes } from '../../lib/images';
import { submit as queueSubmission } from '../../lib/offline/submit';
import { queryKeys, useList } from '../../lib/queries';
import { useToast } from '../../lib/toast';
import { useAuth, useOwnClub } from '../auth/useAuth';
import type { ClubListResponse } from '../clubs/types';
import {
  clearDraft,
  clearHandoffFiles,
  emptyDraft,
  loadDraft,
  peekHandoffFiles,
  saveDraft,
  type Draft,
} from './draft';

/**
 * THE screen. A club secretary, on an Android phone, at eleven at night, on metered data.
 *
 * Four steps, because four short screens beat one long form on a 360px display — and because
 * a form that shows every field for every type shows fourteen fields of which four apply.
 * Step 2 is rendered from the TYPE's own declaration: `requires_*` and `field_config`. There
 * is no per-type branch anywhere in this file, which is what makes adding an activity type a
 * row rather than a release.
 *
 * Progress survives navigating away and back, and a REFUSED report can be reopened here from
 * the pending screen with everything still in it — see `draft.ts`, which owns both.
 */

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

/**
 * A photograph waiting to go, already shrunk.
 *
 * `url` is created ONCE, when the photograph is added, and revoked when it is removed.
 * `URL.createObjectURL` in the render body would leak one blob URL per render — invisible on
 * a laptop, fatal on a phone holding four images.
 */
interface Photo {
  blob: Blob;
  /** What the camera produced. Equal to `blob.size` for one restored from the outbox. */
  originalBytes: number;
  url: string;
}

/** A photograph coming back from a refused submission: already compressed, nothing to save. */
function restoredPhoto(blob: Blob): Photo {
  return { blob, originalBytes: blob.size, url: URL.createObjectURL(blob) };
}

export function ReportPage() {
  const navigate = useNavigate();
  const toast = useToast();
  const queryClient = useQueryClient();
  const { permissions } = useAuth();
  /**
   * A club officer belongs to ONE club, and the system already knows which. Asking them to
   * pick it from all 68 is asking them to tell us something we can see — and it is the
   * control most likely to be got wrong on a phone at eleven at night.
   */
  const ownClub = useOwnClub();
  const [draft, setDraft] = useState<Draft>(loadDraft);
  // Peeked here and cleared in the effect below: a `useState` initialiser runs twice under
  // StrictMode and React discards the first result, so consuming it here would hand the
  // photographs to a render that is thrown away and leave the surviving one empty.
  const [photos, setPhotos] = useState<Photo[]>(() => peekHandoffFiles().map(restoredPhoto));
  const [isCompressing, setIsCompressing] = useState(false);
  const [fieldErrors, setFieldErrors] = useState<Record<string, string>>({});
  const [isSubmitting, setIsSubmitting] = useState(false);
  const fileInput = useRef<HTMLInputElement>(null);

  useEffect(() => clearHandoffFiles(), []);

  /**
   * The club this report is FOR — derived, not stored.
   *
   * For a member with one club it comes from their appointment, so it is never draft state
   * and cannot go stale: a draft saved before a rollover, or before `/auth/me` resolved,
   * still reports against whatever the CURRENT appointment says. Only a member who genuinely
   * has to choose keeps a chosen value in the draft.
   */
  const clubId = ownClub?.id ?? draft.clubId;

  const originalBytes = photos.reduce((total, photo) => total + photo.originalBytes, 0);
  const sendBytes = photos.reduce((total, photo) => total + photo.blob.size, 0);
  const savedBytes = originalBytes - sendBytes;

  /**
   * Shrinks each photograph as it is chosen, not at submission time.
   *
   * Here, because this is where the member is already waiting for the camera to hand the
   * file over. Doing it at Submit would put a multi-second pause on the one tap that must
   * feel instant — and would mean the outbox held full-size originals, which is the wrong
   * thing for a phone to store while it waits for signal.
   */
  const addPhotos = async (chosen: File[]) => {
    if (chosen.length === 0) return;
    setIsCompressing(true);

    // Serial. Four 8-megapixel decodes at once is how a mid-range Android runs out of memory
    // and the browser kills the tab — with the report in it.
    for (const file of chosen) {
      const result = await compressImage(file);
      setPhotos((current) => [
        ...current,
        {
          blob: result.blob,
          originalBytes: result.originalBytes,
          url: URL.createObjectURL(result.blob),
        },
      ]);
    }

    setIsCompressing(false);
  };

  const removePhoto = (index: number) => {
    setPhotos((current) => {
      const photo = current[index];
      if (photo) URL.revokeObjectURL(photo.url);
      return current.filter((_, position) => position !== index);
    });
  };

  // Persisted on every change rather than on a timer: the tab that gets killed is the one
  // that was backgrounded, and a timer that has not fired yet has saved nothing.
  useEffect(() => {
    saveDraft(draft);
  }, [draft]);

  const types = useList<GroupedTypes>(queryKeys.activityTypes, '/activity-types', {
    isActive: true,
  });
  const clubs = useList<ClubListResponse>(
    [...queryKeys.clubs, 'picker'],
    '/clubs',
    { pageSize: 100 },
    // A member with one club never opens the picker, so never pay for it. On metered data
    // that is 4 KB nobody needed.
    { enabled: ownClub === null },
  );

  const set = <K extends keyof Draft>(key: K, value: Draft[K]) => {
    setDraft((current) => ({ ...current, [key]: value }));
  };

  if (!permissions.has('activity:create:club')) {
    return (
      <Card>
        <p className="text-text-secondary text-sm">
          You do not have permission to report an activity.
        </p>
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
      hostScopeId: clubId,
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

    // Through the OUTBOX, not straight to the API.
    //
    // The report is written to this device before any request is attempted, so a secretary
    // who taps Submit in a basement, on a bus, or on a connection that dies mid-request has
    // filed it either way. Photographs travel with it and go up after the activity exists.
    setIsSubmitting(true);
    const result = await queueSubmission({
      id: draft.activityId,
      kind: 'Activity',
      label: draft.title.trim() || type.name,
      endpoint: '/activities',
      body: payload,
      files: photos.map((photo) => photo.blob),
    });
    setIsSubmitting(false);

    // A 4xx that is genuinely about this report — a missing narrative, an absent area of
    // focus. The item is on the pending screen, but the fix belongs here, on the field, so
    // the member stays on the form with the message beside the control that caused it.
    if (!result.delivered && result.error) {
      setFieldErrors(result.fieldErrors);
      toast.error(result.error);
      setDraft((current) => ({ ...current, step: 2 }));
      return;
    }

    // The draft is cleared either way: the outbox owns the data now. Leaving it behind would
    // let the member edit a report that is already queued and produce two — and if they do
    // want to change it, "Correct it" on the pending screen is the way, because that path
    // keeps the id.
    clearDraft();
    setDraft(emptyDraft());
    // The outbox holds the blobs now, so these previews are the last reference to release.
    for (const photo of photos) URL.revokeObjectURL(photo.url);
    setPhotos([]);

    if (result.delivered) {
      await queryClient.invalidateQueries({ queryKey: queryKeys.activities });
      navigate(`/activities/${draft.activityId}`);
      return;
    }

    // Queued. Not an error, and never presented as one — the work is safe and will go on
    // its own. The activity detail page would 404, so the pending screen is where to land.
    toast.success('Saved on this phone. It will be sent when there is a connection.');
    navigate('/pending');
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
              <h3 className="text-text-muted mb-2 text-xs font-semibold tracking-wide uppercase">
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
                        ? 'border-accent bg-accent-subtle text-accent-text'
                        : 'border-border-subtle hover:bg-surface-sunken',
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
            {ownClub ? (
              /*
               * Not a control. A club secretary has one club and the system knows which, so
               * this states it rather than asking — one fewer decision on the screen that
               * matters most, and one fewer way to file a report against the wrong club.
               */
              <p className="text-text-secondary text-sm">
                Reporting for <span className="text-text-primary font-medium">{ownClub.name}</span>
              </p>
            ) : (
              <Select
                label="Club"
                value={draft.clubId}
                placeholder="Choose your club"
                hint="You cover more than one club, so this one is yours to choose."
                options={(clubs.data?.data ?? []).map((club) => ({
                  value: club.id,
                  label: club.name,
                }))}
                onChange={(event) => set('clubId', event.target.value)}
              />
            )}
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
              <span className="text-text-secondary text-sm font-medium">What happened</span>
              {/* No length limit. The predecessor's was a logged complaint. */}
              <textarea
                rows={5}
                className="border-border rounded-lg border px-3 py-2 text-base"
                value={draft.description}
                onChange={(event) => set('description', event.target.value)}
              />
            </label>

            {/* Everything below is rendered from the TYPE. No per-type branch exists here. */}
            {type.requiresReport && (
              <label className="flex flex-col gap-1.5">
                <span className="text-text-secondary text-sm font-medium">Narrative report *</span>
                <textarea
                  rows={5}
                  className={cx(
                    'rounded-lg border px-3 py-2 text-base',
                    fieldErrors['narrativeReport'] ? 'border-danger' : 'border-border',
                  )}
                  value={draft.narrativeReport}
                  onChange={(event) => set('narrativeReport', event.target.value)}
                />
                {fieldErrors['narrativeReport'] && (
                  <span role="alert" className="text-danger-text text-xs">
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
                <legend className="text-text-secondary mb-1 text-sm font-medium">
                  Area of focus *
                </legend>
                {fieldErrors['areaOfFocusCodes'] && (
                  <p role="alert" className="text-danger-text mb-1 text-xs">
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
              nextDisabled={!clubId || draft.title.trim().length < 3}
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
              void addPhotos(Array.from(event.target.files ?? []));
              event.target.value = '';
            }}
          />

          <div className="flex flex-wrap gap-3">
            {photos.map((photo, index) => (
              <div key={photo.url} className="relative">
                <img
                  // Created once when the photograph is added and revoked when it goes.
                  // Calling createObjectURL in the render body leaks one blob URL per render,
                  // which on a phone holding four images is a tab the system eventually kills.
                  src={photo.url}
                  alt=""
                  className="border-border-subtle h-24 w-24 rounded-lg border object-cover"
                />
                <button
                  type="button"
                  onClick={() => removePhoto(index)}
                  className="bg-danger absolute -top-2 -right-2 h-6 w-6 rounded-full text-white"
                  aria-label="Remove"
                >
                  ×
                </button>
              </div>
            ))}
            <Button
              variant="secondary"
              onClick={() => fileInput.current?.click()}
              isLoading={isCompressing}
            >
              Add a photo
            </Button>
          </div>

          {/*
            The saving, stated. Members pay per megabyte and have every reason to assume an
            app is spending their data carelessly — showing the number is how that assumption
            gets corrected, and it costs one line.
          */}
          {savedBytes > 0 && (
            <p className="text-success-text mt-3 text-xs">
              Photographs made smaller before sending: {formatBytes(originalBytes)} →{' '}
              {formatBytes(sendBytes)}, saving {formatBytes(savedBytes)} of your data.
            </p>
          )}

          <p className="text-text-muted mt-3 text-xs">
            Location data is removed from every photograph before it is stored.
          </p>

          <StepButtons
            onBack={() => set('step', 2)}
            onNext={() => set('step', 4)}
            nextDisabled={type.requiresPhoto && photos.length === 0}
          />
        </Card>
      )}

      {draft.step === 4 && type && (
        <Card title="Check and submit">
          <dl className="grid gap-2 text-sm">
            <Row label="Type" value={type.name} />
            <Row
              label="Club"
              value={
                ownClub?.name ?? clubs.data?.data.find((club) => club.id === clubId)?.name ?? '—'
              }
            />
            <Row label="Title" value={draft.title} />
            <Row label="When" value={draft.startsAt.replace('T', ' ')} />
            <Row label="Where" value={draft.venue || '—'} />
            <Row
              label="Photographs"
              value={
                photos.length === 0
                  ? 'None'
                  : `${photos.length} · ${formatBytes(sendBytes)} to send`
              }
            />
          </dl>

          <div className="mt-4 flex flex-wrap gap-3">
            <Button isLoading={isSubmitting} onClick={() => void finish()}>
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
              ? 'bg-accent text-white'
              : index + 1 < current
                ? 'bg-accent-subtle text-accent-text'
                : 'bg-surface-sunken text-text-muted',
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
      <dt className="text-text-muted">{label}</dt>
      <dd className="text-text-primary text-right">{value}</dd>
    </div>
  );
}
