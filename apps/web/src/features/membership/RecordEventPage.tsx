import { useState } from 'react';
import { useNavigate, useSearchParams } from 'react-router-dom';
import { useQueryClient } from '@tanstack/react-query';
import { Button, Card, Input, PageHeader, Select, SkeletonList } from '../../components/ui';
import { cx } from '../../lib/cx';
import { submit as queueSubmission } from '../../lib/offline/submit';
import { queryKeys, useList } from '../../lib/queries';
import { useToast } from '../../lib/toast';
import { uuid } from '../../lib/uuid';
import { useAuth, useOwnClub } from '../auth/useAuth';
import type { ClubListResponse } from '../clubs/types';
import type { PersonListResponse } from './types';

/**
 * Recording a membership event — the most-used screen a club secretary has.
 *
 * Optimised hard, because the alternative is a secretary who goes back to WhatsApp. Event
 * type first and largest, most common first; the form then ADAPTS rather than showing every
 * field every time; and the person is searchable-or-creatable inline, because forcing an
 * "add person" journey first is how a two-tap job becomes a two-screen one.
 *
 * The client generates the event id, so tapping Save twice on a bad connection produces one
 * row (ADR-006). The server answers 200 rather than 409 for the replay.
 *
 * Both writes go through the OUTBOX, and the event DEPENDS on the person. A secretary
 * inducting somebody new offline queues two records: the person, then the event that names
 * them. Sending the event first would earn a `422` for a person who simply has not arrived
 * yet, so the queue holds it until its prerequisite is gone.
 */

/** Most common first. This order is the whole screen. */
const EVENT_TYPES = [
  { value: 'INDUCT', label: 'Induct', hint: 'A new member joins' },
  { value: 'TRANSFER_IN', label: 'Transfer in', hint: 'From another club' },
  { value: 'TRANSFER_OUT', label: 'Transfer out', hint: 'To another club' },
  { value: 'TERMINATE', label: 'Terminate', hint: 'Membership ends' },
  { value: 'TRANSITION_TO_ROTARY', label: 'To Rotary', hint: 'Joins a Rotary club' },
  { value: 'REINSTATE', label: 'Reinstate', hint: 'A former member returns' },
  { value: 'CATEGORY_CHANGE', label: 'Category', hint: 'Active, honorary, corporate' },
  { value: 'JOIN', label: 'Join', hint: 'Historical — use Induct for new members' },
] as const;

const REASON_CODES = [
  { value: 'RELOCATION', label: 'Relocated' },
  { value: 'STUDIES_ENDED', label: 'Studies ended' },
  { value: 'NON_PAYMENT', label: 'Dues unpaid' },
  { value: 'AGE', label: 'Aged out' },
  { value: 'INACTIVE', label: 'Stopped attending' },
  { value: 'PERSONAL', label: 'Personal reasons' },
  { value: 'OTHER', label: 'Other' },
];

const CATEGORIES = [
  { value: 'ACTIVE', label: 'Active' },
  { value: 'HONORARY', label: 'Honorary' },
  { value: 'CORPORATE', label: 'Corporate' },
];

type EventType = (typeof EVENT_TYPES)[number]['value'];

const NEEDS_COUNTERPARTY = new Set<EventType>(['TRANSFER_IN', 'TRANSFER_OUT']);
const NEEDS_REASON = new Set<EventType>(['TERMINATE', 'TRANSFER_OUT']);
const NEEDS_ROTARY_CLUB = new Set<EventType>(['TRANSITION_TO_ROTARY']);

export function RecordEventPage() {
  const navigate = useNavigate();
  const toast = useToast();
  const queryClient = useQueryClient();
  const [params] = useSearchParams();
  const { permissions } = useAuth();
  // One club, already known. See ReportPage — same reasoning, and this screen is the one a
  // secretary uses most.
  const ownClub = useOwnClub();

  const [chosenClubId, setChosenClubId] = useState(params.get('clubId') ?? '');
  const [eventType, setEventType] = useState<EventType | ''>('');
  const [personId, setPersonId] = useState('');
  const [personSearch, setPersonSearch] = useState('');
  const [newPerson, setNewPerson] = useState<{ firstName: string; lastName: string } | null>(null);
  const [effectiveOn, setEffectiveOn] = useState(new Date().toISOString().slice(0, 10));
  const [memberCategory, setMemberCategory] = useState('ACTIVE');
  const [reasonCode, setReasonCode] = useState('');
  const [reasonNote, setReasonNote] = useState('');
  const [counterpartyClubId, setCounterpartyClubId] = useState('');
  const [rotaryClubName, setRotaryClubName] = useState('');
  const [fieldErrors, setFieldErrors] = useState<Record<string, string>>({});
  const [isSaving, setIsSaving] = useState(false);

  // Derived, never stored: a member with one club cannot pick the wrong one, and cannot
  // be left holding a stale one after a rollover.
  const clubId = ownClub?.id ?? chosenClubId;

  const clubs = useList<ClubListResponse>(
    [...queryKeys.clubs, 'picker'],
    '/clubs',
    { pageSize: 100 },
    // The counterparty picker for a transfer still needs the list, so this is only skipped
    // when the member has one club AND the event is not a transfer.
    { enabled: ownClub === null || NEEDS_COUNTERPARTY.has(eventType as EventType) },
  );
  const persons = useList<PersonListResponse>(
    [...queryKeys.persons, 'picker'],
    '/persons',
    { pageSize: 20, ...(personSearch.length >= 2 ? { q: personSearch } : {}) },
    { enabled: personSearch.length >= 2 },
  );

  if (!permissions.has('membership:write:club')) {
    return (
      <Card>
        <p className="text-text-secondary text-table">
          You do not have permission to record membership events.
        </p>
      </Card>
    );
  }

  const submit = async (event: React.FormEvent) => {
    event.preventDefault();
    setFieldErrors({});
    if (!clubId || !eventType) return;

    setIsSaving(true);

    // The person first, if the secretary typed a name rather than picking one. Inline,
    // because forcing a separate "add member" journey turns a two-tap job into a two-screen
    // one and is where a secretary gives up.
    //
    // The id is generated HERE, before anything is sent, which is what lets the event that
    // references this person be queued in the same breath while offline.
    let subjectId = personId;
    let personQueueId: string | null = null;

    if (!subjectId && newPerson) {
      subjectId = uuid();
      personQueueId = subjectId;
      setPersonId(subjectId);

      const person = await queueSubmission({
        id: subjectId,
        kind: 'Member',
        label: `${newPerson.firstName} ${newPerson.lastName}`,
        endpoint: '/persons',
        body: { id: subjectId, ...newPerson },
      });

      // Refused — most plausibly this account may record events but may not register a new
      // member. Stop here and say so: queueing the event behind a person who will never
      // exist would report the failure as "something it depends on could not be saved",
      // which tells the secretary nothing they can act on.
      if (!person.delivered && person.error) {
        setFieldErrors(person.fieldErrors);
        toast.error(person.error);
        setIsSaving(false);
        return;
      }
    }
    if (!subjectId) {
      setIsSaving(false);
      return;
    }

    // The CLIENT generates the id, so tapping Save twice on a bad connection produces one
    // row rather than two members.
    const eventId = uuid();

    const result = await queueSubmission({
      id: eventId,
      kind: 'Membership event',
      label: `${eventType.replace(/_/g, ' ').toLowerCase()} — ${
        newPerson ? `${newPerson.firstName} ${newPerson.lastName}` : 'member'
      }`,
      endpoint: '/membership/events',
      dependsOn: personQueueId,
      body: {
        id: eventId,
        personId: subjectId,
        clubId,
        eventType,
        memberCategory,
        effectiveOn,
        reasonCode: NEEDS_REASON.has(eventType) && reasonCode ? reasonCode : null,
        reasonNote: reasonNote.trim() === '' ? null : reasonNote.trim(),
        counterpartyClubId: NEEDS_COUNTERPARTY.has(eventType) ? counterpartyClubId || null : null,
        rotaryClubName: NEEDS_ROTARY_CLUB.has(eventType) ? rotaryClubName.trim() || null : null,
      },
    });

    setIsSaving(false);

    if (!result.delivered && result.error) {
      setFieldErrors(result.fieldErrors);
      toast.error(result.error);
      return;
    }

    if (result.delivered) {
      await queryClient.invalidateQueries({ queryKey: queryKeys.membership });
      await queryClient.invalidateQueries({ queryKey: queryKeys.persons });
      toast.success('Recorded');
      navigate(`/clubs/${clubId}/membership`);
      return;
    }

    // Queued. The roster will not show this member yet, so sending the secretary to the
    // membership screen would show them a list that appears not to have taken their work.
    toast.success('Saved on this phone. It will be sent when there is a connection.');
    navigate('/pending');
  };

  return (
    <>
      <PageHeader
        title="Record a membership event"
        description="The log is append-only. A mistake is corrected by recording another event, never by editing this one."
      />

      <form onSubmit={(event) => void submit(event)} className="flex flex-col gap-4">
        {/* STEP 1. Type first and largest: it is the decision that shapes everything else. */}
        <Card title="What happened?">
          <div className="grid grid-cols-2 gap-2 sm:grid-cols-3 lg:grid-cols-4">
            {EVENT_TYPES.map((option) => (
              <button
                key={option.value}
                type="button"
                onClick={() => setEventType(option.value)}
                className={cx(
                  'min-h-16 rounded-lg border p-3 text-left',
                  eventType === option.value
                    ? 'border-accent bg-accent-subtle text-accent-text'
                    : 'border-border-subtle hover:bg-surface-sunken',
                )}
              >
                <span className="block text-table font-medium">{option.label}</span>
                <span className="text-text-muted block text-meta">{option.hint}</span>
              </button>
            ))}
          </div>
        </Card>

        {eventType && (
          <>
            <Card title="Who, and where?">
              <div className="flex flex-col gap-3">
                {ownClub ? (
                  <p className="text-text-secondary text-table">
                    Recording for{' '}
                    <span className="text-text-primary font-medium">{ownClub.name}</span>
                  </p>
                ) : (
                  <Select
                    label="Club"
                    value={clubId}
                    placeholder="Choose a club"
                    hint="You cover more than one club, so this one is yours to choose."
                    options={(clubs.data?.data ?? []).map((club) => ({
                      value: club.id,
                      label: club.name,
                    }))}
                    onChange={(changed) => setChosenClubId(changed.target.value)}
                  />
                )}

                <PersonPicker
                  search={personSearch}
                  onSearch={(value) => {
                    setPersonSearch(value);
                    setPersonId('');
                    setNewPerson(null);
                  }}
                  results={persons.data?.data ?? []}
                  isSearching={persons.isFetching}
                  selectedId={personId}
                  newPerson={newPerson}
                  onSelect={(id) => {
                    setPersonId(id);
                    setNewPerson(null);
                  }}
                  onCreate={setNewPerson}
                />

                <Input
                  label="Effective on"
                  type="date"
                  value={effectiveOn}
                  error={fieldErrors['effectiveOn']}
                  onChange={(changed) => setEffectiveOn(changed.target.value)}
                />
              </div>
            </Card>

            {/* STEP 3. The form ADAPTS. A termination does not ask for a Rotary club. */}
            {(NEEDS_COUNTERPARTY.has(eventType) ||
              NEEDS_REASON.has(eventType) ||
              NEEDS_ROTARY_CLUB.has(eventType) ||
              eventType === 'CATEGORY_CHANGE') && (
              <Card title="Details">
                <div className="flex flex-col gap-3">
                  {NEEDS_COUNTERPARTY.has(eventType) && (
                    <Select
                      label={eventType === 'TRANSFER_IN' ? 'Transferred from' : 'Transferred to'}
                      value={counterpartyClubId}
                      placeholder="Choose a club in this district"
                      hint="The other club is told, so both sides agree before the district's figures do."
                      options={(clubs.data?.data ?? [])
                        .filter((club) => club.id !== clubId)
                        .map((club) => ({ value: club.id, label: club.name }))}
                      onChange={(changed) => setCounterpartyClubId(changed.target.value)}
                    />
                  )}

                  {NEEDS_ROTARY_CLUB.has(eventType) && (
                    <Input
                      label="Receiving Rotary club"
                      required
                      value={rotaryClubName}
                      error={fieldErrors['rotaryClubName']}
                      hint="Transitions are the most contested figure in the district's return."
                      onChange={(changed) => setRotaryClubName(changed.target.value)}
                    />
                  )}

                  {NEEDS_REASON.has(eventType) && (
                    <Select
                      label="Reason"
                      value={reasonCode}
                      placeholder="Choose a reason"
                      options={REASON_CODES}
                      onChange={(changed) => setReasonCode(changed.target.value)}
                    />
                  )}

                  {eventType === 'CATEGORY_CHANGE' && (
                    <Select
                      label="New category"
                      value={memberCategory}
                      options={CATEGORIES}
                      onChange={(changed) => setMemberCategory(changed.target.value)}
                    />
                  )}

                  <Input
                    label="Note"
                    value={reasonNote}
                    hint="Optional. Anything the district would want to know later."
                    onChange={(changed) => setReasonNote(changed.target.value)}
                  />
                </div>
              </Card>
            )}

            <div className="flex flex-wrap gap-3">
              <Button
                type="submit"
                isLoading={isSaving}
                disabled={!clubId || (!personId && !newPerson)}
              >
                Record
              </Button>
              <Button type="button" variant="secondary" onClick={() => navigate(-1)}>
                Cancel
              </Button>
            </div>
          </>
        )}
      </form>
    </>
  );
}

/**
 * Search, or type a name that is not there.
 *
 * The "or create" half is the point. A secretary inducting somebody who has never been in
 * the system should not have to leave this screen, go and add a person, and come back —
 * that journey is where the tenth induction of the evening stops being recorded.
 */
function PersonPicker({
  search,
  onSearch,
  results,
  isSearching,
  selectedId,
  newPerson,
  onSelect,
  onCreate,
}: {
  search: string;
  onSearch: (value: string) => void;
  results: { id: string; firstName: string; lastName: string; clubs?: { name: string }[] }[];
  isSearching: boolean;
  selectedId: string;
  newPerson: { firstName: string; lastName: string } | null;
  onSelect: (id: string) => void;
  onCreate: (person: { firstName: string; lastName: string } | null) => void;
}) {
  const words = search.trim().split(/\s+/).filter(Boolean);
  const canCreate = words.length >= 2 && !selectedId;

  const selected = results.find((person) => person.id === selectedId);

  return (
    <div className="flex flex-col gap-2">
      <Input
        label="Member"
        placeholder="Type a name"
        value={search}
        hint="Search for an existing member, or type a full name to add somebody new."
        onChange={(event) => onSearch(event.target.value)}
      />

      {selected && (
        <p className="text-success-text text-table">
          Selected: {selected.firstName} {selected.lastName}
        </p>
      )}
      {newPerson && (
        <p className="text-success-text text-table">
          Will add: {newPerson.firstName} {newPerson.lastName}
        </p>
      )}

      {search.length >= 2 && !selectedId && !newPerson && (
        <div className="border-border-subtle max-h-56 overflow-y-auto rounded-lg border">
          {isSearching && <SkeletonList rows={2} />}
          {results.map((person) => (
            <button
              key={person.id}
              type="button"
              onClick={() => onSelect(person.id)}
              className="hover:bg-surface-sunken flex min-h-11 w-full flex-col items-start px-3 py-2 text-left"
            >
              <span className="text-table">
                {person.firstName} {person.lastName}
              </span>
              {person.clubs?.[0] && (
                <span className="text-text-muted text-meta">{person.clubs[0].name}</span>
              )}
            </button>
          ))}
          {!isSearching && results.length === 0 && (
            <p className="text-text-muted px-3 py-2 text-table">Nobody found.</p>
          )}
          {canCreate && (
            <button
              type="button"
              onClick={() =>
                onCreate({ firstName: words[0] ?? '', lastName: words.slice(1).join(' ') })
              }
              className="text-accent hover:bg-surface-sunken border-border-subtle min-h-11 w-full border-t px-3 py-2 text-left text-table font-medium"
            >
              Add “{search.trim()}” as a new member
            </button>
          )}
        </div>
      )}
    </div>
  );
}
