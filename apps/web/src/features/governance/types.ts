import type {
  Appointment,
  AuditEntry,
  Committee,
  CommitteeMember,
  CommitteeNode,
  Invitation,
  InvitationResult,
  PaginationMeta,
  Permission,
  Person,
  Position,
  RolloverReport,
} from '@dis/contracts';

/**
 * Response shapes, named once.
 *
 * The client is typed against the CONTRACTS package rather than against hand-written
 * interfaces, so a field renamed on the server is a compile error here rather than an
 * empty cell somebody notices in March.
 */

export type {
  Appointment,
  AuditEntry,
  Committee,
  CommitteeMember,
  CommitteeNode,
  Invitation,
  InvitationResult,
  Permission,
  Person,
  Position,
  RolloverReport,
};

interface ListOf<T> {
  data: T[];
  meta: PaginationMeta;
}

export type PositionListResponse = ListOf<Position>;
export type PermissionListResponse = ListOf<Permission>;
export type AppointmentListResponse = ListOf<Appointment>;
export type CommitteeMemberListResponse = ListOf<CommitteeMember>;
export type InvitationListResponse = ListOf<Invitation>;
export type AuditListResponse = ListOf<AuditEntry>;
export type PersonListResponse = ListOf<Person>;

export interface CommitteeTreeResponse {
  data: CommitteeNode[];
}

export interface SingleOf<T> {
  data: T;
}

export interface InvitationBatchResponse {
  data: { sent: number; failed: number; results: InvitationResult[] };
}
