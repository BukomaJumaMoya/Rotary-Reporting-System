import type {
  Affiliation,
  Club,
  ClubSummary,
  Cluster,
  PaginationMeta,
  Region,
} from '@dis/contracts';

/**
 * Response shapes for the club screens, named once.
 *
 * Typed against the CONTRACTS package rather than hand-written interfaces, so a field
 * renamed on the server is a compile error here rather than an empty cell somebody notices
 * in March.
 */

export type { Affiliation, Club, ClubSummary, Cluster, Region };

interface ListOf<T> {
  data: T[];
  meta: PaginationMeta;
}

export interface SingleOf<T> {
  data: T;
}

export type ClubListResponse = ListOf<Club>;
export type ClusterListResponse = ListOf<Cluster>;
export type RegionListResponse = ListOf<Region>;
export type ClubResponse = SingleOf<Club>;
export type ClubSummaryResponse = SingleOf<ClubSummary>;
