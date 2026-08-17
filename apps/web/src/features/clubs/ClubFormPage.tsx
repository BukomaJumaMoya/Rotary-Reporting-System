import { useState } from 'react';
import { useNavigate, useParams } from 'react-router-dom';
import { ApiError, api } from '../../lib/api';
import {
  Button,
  Card,
  ErrorState,
  Input,
  PageHeader,
  Select,
  SkeletonList,
} from '../../components/ui';
import { queryKeys, useApiMutation, useList } from '../../lib/queries';
import { useAuth, useScope } from '../auth/useAuth';
import type { Club, ClubResponse } from './types';

/**
 * Charter a club, or edit one.
 *
 * One form for both, because the fields are the same and two forms drift. The difference is
 * which permission opens it and whether `baseType` may still be changed — a chartered club
 * does not become an e-club, and the field is disabled rather than removed so the value is
 * still readable.
 *
 * The gate here is presentation. `PATCH /clubs/:id` refuses another club's edit server-side
 * and answers 404, so a member who reaches this URL by typing it gets the same answer.
 */

const BASE_TYPES = [
  { value: 'CBC', label: 'Community based' },
  { value: 'IBC', label: 'Institution based' },
  { value: 'ECLUB', label: 'E-club' },
];

const STATUSES = [
  { value: 'ACTIVE', label: 'Active' },
  { value: 'PROVISIONAL', label: 'Provisional' },
  { value: 'SUSPENDED', label: 'Suspended' },
  { value: 'TERMINATED', label: 'Terminated' },
  { value: 'MERGED', label: 'Merged' },
];

/** 0 = Sunday, matching the column and Postgres EXTRACT(DOW). */
const DAYS = [
  { value: '0', label: 'Sunday' },
  { value: '1', label: 'Monday' },
  { value: '2', label: 'Tuesday' },
  { value: '3', label: 'Wednesday' },
  { value: '4', label: 'Thursday' },
  { value: '5', label: 'Friday' },
  { value: '6', label: 'Saturday' },
];

interface FormState {
  name: string;
  riClubId: string;
  baseType: string;
  status: string;
  charteredOn: string;
  charteredMemberCount: string;
  sponsorRotaryClub: string;
  hostInstitution: string;
  meetingDay: string;
  meetingTime: string;
  meetingVenue: string;
  isVirtual: boolean;
  postalAddress: string;
  ursbNumber: string;
  bankName: string;
}

const EMPTY: FormState = {
  name: '',
  riClubId: '',
  baseType: 'CBC',
  status: 'ACTIVE',
  charteredOn: '',
  charteredMemberCount: '',
  sponsorRotaryClub: '',
  hostInstitution: '',
  meetingDay: '',
  meetingTime: '',
  meetingVenue: '',
  isVirtual: false,
  postalAddress: '',
  ursbNumber: '',
  bankName: '',
};

function fromClub(club: Club): FormState {
  return {
    name: club.name,
    riClubId: club.riClubId ?? '',
    baseType: club.baseType,
    status: club.status,
    charteredOn: club.charteredOn ?? '',
    charteredMemberCount: club.charteredMemberCount?.toString() ?? '',
    sponsorRotaryClub: club.sponsorRotaryClub ?? '',
    hostInstitution: club.hostInstitution ?? '',
    meetingDay: club.meetingDay?.toString() ?? '',
    meetingTime: club.meetingTime ?? '',
    meetingVenue: club.meetingVenue ?? '',
    isVirtual: club.isVirtual,
    postalAddress: club.postalAddress ?? '',
    ursbNumber: club.ursbNumber ?? '',
    bankName: club.bankName ?? '',
  };
}

/** An empty text field means "clear it", which on the wire is null rather than "". */
function orNull(value: string): string | null {
  return value.trim() === '' ? null : value.trim();
}

function toPayload(form: FormState): Record<string, unknown> {
  return {
    name: form.name.trim(),
    riClubId: orNull(form.riClubId),
    baseType: form.baseType,
    status: form.status,
    charteredOn: orNull(form.charteredOn),
    charteredMemberCount:
      form.charteredMemberCount.trim() === '' ? null : Number(form.charteredMemberCount),
    sponsorRotaryClub: orNull(form.sponsorRotaryClub),
    hostInstitution: orNull(form.hostInstitution),
    meetingDay: form.meetingDay === '' ? null : Number(form.meetingDay),
    meetingTime: orNull(form.meetingTime),
    meetingVenue: orNull(form.meetingVenue),
    isVirtual: form.isVirtual,
    postalAddress: orNull(form.postalAddress),
    ursbNumber: orNull(form.ursbNumber),
    bankName: orNull(form.bankName),
  };
}

/**
 * Loads what the form needs, decides whether to show it, and mounts it once.
 *
 * The split is not decoration. Holding form state in this component would mean seeding it
 * from the fetched club in an effect, and setState in an effect is a cascading render —
 * worse, it silently discards whatever the member had typed the moment the query refetches
 * in the background. Mounting `ClubForm` with the loaded values as its INITIAL state, keyed
 * on the club id, gives one initialisation and no effect.
 */
export function ClubFormPage({ mode }: { mode: 'create' | 'edit' }) {
  const { id = '' } = useParams();
  const { permissions } = useAuth();
  const scope = useScope();

  // Held back in create mode: there is no id to fetch, and firing anyway sends a request
  // that can only 404.
  const existing = useList<ClubResponse>([...queryKeys.clubs, id], `/clubs/${id}`, undefined, {
    enabled: mode === 'edit',
  });

  const mayEdit =
    mode === 'create'
      ? permissions.has('club:create:district')
      : permissions.has('club:update:district') ||
        (permissions.has('club:update:own') && scope.coversClub(id));

  if (!mayEdit) {
    return (
      <Card>
        <p className="text-text-secondary text-table">
          You do not have permission to {mode === 'create' ? 'charter a club' : 'edit this club'}.
        </p>
      </Card>
    );
  }

  if (mode === 'create') return <ClubForm mode="create" id="" initial={EMPTY} name={null} />;

  if (existing.isPending) return <SkeletonList rows={4} />;
  if (existing.isError) {
    return <ErrorState error={existing.error} onRetry={() => void existing.refetch()} />;
  }

  const club = existing.data.data;
  return (
    <ClubForm key={club.id} mode="edit" id={club.id} initial={fromClub(club)} name={club.name} />
  );
}

function ClubForm({
  mode,
  id,
  initial,
  name: clubName,
}: {
  mode: 'create' | 'edit';
  id: string;
  initial: FormState;
  name: string | null;
}) {
  const navigate = useNavigate();
  const [form, setForm] = useState<FormState>(initial);
  const [fieldErrors, setFieldErrors] = useState<Record<string, string>>({});

  const set = <K extends keyof FormState>(key: K, value: FormState[K]) => {
    setForm((current) => ({ ...current, [key]: value }));
  };

  const save = useApiMutation(
    async (payload: Record<string, unknown>) =>
      mode === 'create'
        ? api.post<ClubResponse>('/clubs', payload)
        : api.patch<ClubResponse>(`/clubs/${id}`, payload),
    {
      invalidate: [queryKeys.clubs],
      successMessage: mode === 'create' ? 'Club chartered' : 'Club updated',
    },
  );

  const submit = (event: React.FormEvent) => {
    event.preventDefault();
    setFieldErrors({});

    save.mutate(toPayload(form), {
      onSuccess: (result) => {
        navigate(`/clubs/${result.data.id}`);
      },
      onError: (error: unknown) => {
        // Field-level messages from a 400 go back to the field they belong to, rather
        // than only into a toast the member has to translate into "which box".
        if (error instanceof ApiError) setFieldErrors(error.fieldErrors);
      },
    });
  };

  return (
    <>
      <PageHeader
        title={mode === 'create' ? 'Charter a club' : `Edit ${clubName ?? 'club'}`}
        description={
          mode === 'create'
            ? 'The club is affiliated to this district for the current Rotary Year.'
            : 'The club’s web address does not change when its name does — officers share links.'
        }
      />

      <form onSubmit={submit} className="flex flex-col gap-4">
        <Card title="Identity">
          <div className="grid gap-3 sm:grid-cols-2">
            <Input
              label="Name"
              required
              value={form.name}
              error={fieldErrors['name']}
              onChange={(event) => set('name', event.target.value)}
            />
            <Input
              label="RI Club ID"
              inputMode="numeric"
              hint="Required for any club that will be assessed."
              value={form.riClubId}
              error={fieldErrors['riClubId']}
              onChange={(event) => set('riClubId', event.target.value)}
            />
            <Select
              label="Type"
              value={form.baseType}
              options={BASE_TYPES}
              // A chartered club does not change what kind of club it is. Disabled rather
              // than hidden, so the value is still readable.
              disabled={mode === 'edit'}
              onChange={(event) => set('baseType', event.target.value)}
            />
            <Select
              label="Status"
              value={form.status}
              options={STATUSES}
              onChange={(event) => set('status', event.target.value)}
            />
            <Input
              label="Chartered on"
              type="date"
              value={form.charteredOn}
              error={fieldErrors['charteredOn']}
              onChange={(event) => set('charteredOn', event.target.value)}
            />
            <Input
              label="Charter members"
              inputMode="numeric"
              value={form.charteredMemberCount}
              onChange={(event) => set('charteredMemberCount', event.target.value)}
            />
            <Input
              label="Sponsor Rotary club"
              value={form.sponsorRotaryClub}
              onChange={(event) => set('sponsorRotaryClub', event.target.value)}
            />
            <Input
              label="Host institution"
              hint="Institution-based clubs only."
              value={form.hostInstitution}
              onChange={(event) => set('hostInstitution', event.target.value)}
            />
          </div>
        </Card>

        <Card title="Meeting">
          <div className="grid gap-3 sm:grid-cols-2">
            <Select
              label="Day"
              value={form.meetingDay}
              placeholder="Not set"
              options={DAYS}
              onChange={(event) => set('meetingDay', event.target.value)}
            />
            <Input
              label="Time"
              type="time"
              value={form.meetingTime}
              error={fieldErrors['meetingTime']}
              onChange={(event) => set('meetingTime', event.target.value)}
            />
            <Input
              label="Venue"
              value={form.meetingVenue}
              onChange={(event) => set('meetingVenue', event.target.value)}
            />
            <label className="flex min-h-11 items-center gap-3 text-table">
              <input
                type="checkbox"
                className="h-5 w-5"
                checked={form.isVirtual}
                onChange={(event) => set('isVirtual', event.target.checked)}
              />
              Meets online
            </label>
          </div>
        </Card>

        <Card title="Administration">
          <div className="grid gap-3 sm:grid-cols-2">
            <Input
              label="Postal address"
              value={form.postalAddress}
              onChange={(event) => set('postalAddress', event.target.value)}
            />
            <Input
              label="URSB number"
              value={form.ursbNumber}
              onChange={(event) => set('ursbNumber', event.target.value)}
            />
            <Input
              label="Bank"
              value={form.bankName}
              onChange={(event) => set('bankName', event.target.value)}
            />
          </div>
        </Card>

        <div className="flex flex-wrap gap-3">
          <Button type="submit" isLoading={save.isPending}>
            {mode === 'create' ? 'Charter club' : 'Save changes'}
          </Button>
          <Button type="button" variant="secondary" onClick={() => navigate(-1)}>
            Cancel
          </Button>
        </div>
      </form>
    </>
  );
}
