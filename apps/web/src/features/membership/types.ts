import type {
  MembershipEvent,
  MembershipStats,
  PaginationMeta,
  Person,
  RosterEntry,
  Transition,
} from '@dis/contracts';

/** Response shapes for the membership screens, typed against the contracts package. */

export type { MembershipEvent, MembershipStats, Person, RosterEntry, Transition };

interface ListOf<T> {
  data: T[];
  meta: PaginationMeta;
}

export interface SingleOf<T> {
  data: T;
}

export type MembershipEventListResponse = ListOf<MembershipEvent>;
export type RosterListResponse = ListOf<RosterEntry>;
export type TransitionListResponse = ListOf<Transition>;
export type PersonListResponse = ListOf<Person>;
export type MembershipStatsResponse = SingleOf<MembershipStats>;
export type MembershipEventResponse = SingleOf<MembershipEvent>;
