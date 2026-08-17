import type { IconName } from '../ui/icons';

/**
 * THE NAVIGATION MODEL.
 *
 * One list, read by both the sidebar and the command palette. Kept apart from either so the
 * two cannot disagree — a palette that can reach a screen the sidebar has hidden, or the
 * reverse, is a permission bug that looks like a design inconsistency.
 *
 * `permission` is presentation only, as everywhere on the client. The server re-checks every
 * one of these routes and would refuse a member who arrived by typing the URL.
 */

export interface NavItem {
  to: string;
  label: string;
  icon: IconName;
  /** Undefined means every signed-in member sees it. */
  permission?: string;
  /** Extra words the palette should match on, for things people call by another name. */
  keywords?: string;
}

export interface NavGroup {
  /** Rendered as a micro, tracked, muted heading. Hidden in the rail. */
  label: string;
  items: NavItem[];
}

/**
 * Grouped, because flat navigation fails at this size.
 *
 * With forty-odd screens across thirteen positions, a flat list is a wall. Every item is
 * filtered through the member's permissions, so a club secretary sees Overview and My Club
 * and never learns the rest exist; the district secretary sees all five.
 */
export const NAV_GROUPS: NavGroup[] = [
  {
    label: 'Overview',
    items: [{ to: '/', label: 'Dashboard', icon: 'dashboard', keywords: 'home start' }],
  },
  {
    label: 'My Club',
    items: [
      {
        to: '/report',
        label: 'Report activity',
        icon: 'report',
        permission: 'activity:create:club',
        keywords: 'file new project fellowship service',
      },
      {
        to: '/activities',
        label: 'Activities',
        icon: 'activities',
        permission: 'activity:read:club',
        keywords: 'projects reports events',
      },
      {
        to: '/membership/record',
        label: 'Members',
        icon: 'members',
        permission: 'membership:write:club',
        keywords: 'roster join induct resign',
      },
      {
        to: '/membership/transitions',
        label: 'Transitions',
        icon: 'transitions',
        permission: 'membership:read:club',
        keywords: 'rotary bridge departures',
      },
    ],
  },
  {
    label: 'Finance',
    items: [
      {
        to: '/finance/transactions',
        label: 'Transactions',
        icon: 'money',
        permission: 'finance:read:club',
        keywords: 'income expenditure payments cash',
      },
      {
        to: '/finance/budget',
        label: 'Budget',
        icon: 'budget',
        permission: 'finance:read:club',
        keywords: 'plan lines approval',
      },
      {
        to: '/finance/dues',
        label: 'Dues',
        icon: 'dues',
        permission: 'finance:read:club',
        keywords: 'invoice subscription arrears',
      },
      {
        to: '/finance/trf',
        label: 'TRF',
        icon: 'trf',
        permission: 'finance:read:club',
        keywords: 'foundation giving annual fund polio endowment',
      },
    ],
  },
  {
    label: 'District',
    items: [
      {
        to: '/clubs',
        label: 'Clubs',
        icon: 'clubs',
        permission: 'club:read:district',
        keywords: 'directory charter',
      },
      {
        to: '/admin/clusters',
        label: 'Clusters',
        icon: 'clusters',
        permission: 'cluster:manage:district',
        keywords: 'regions zones',
      },
    ],
  },
  {
    label: 'Administration',
    items: [
      {
        to: '/admin/positions',
        label: 'Positions',
        icon: 'positions',
        permission: 'position:manage:district',
        keywords: 'roles permissions matrix',
      },
      {
        to: '/admin/appointments',
        label: 'Appointments',
        icon: 'appointments',
        permission: 'appointment:read:district',
        keywords: 'officers terms slate',
      },
      {
        to: '/admin/committees',
        label: 'Committees',
        icon: 'committees',
        permission: 'committee:manage:district',
        keywords: 'sub-committees delegation',
      },
      {
        to: '/admin/invitations',
        label: 'Invitations',
        icon: 'invites',
        permission: 'person:invite:club',
        keywords: 'invite onboard email',
      },
      {
        to: '/admin/activity-types',
        label: 'Activity types',
        icon: 'types',
        permission: 'activitytype:manage:district',
        keywords: 'configuration fields form builder',
      },
      {
        to: '/admin/audit',
        label: 'Audit',
        icon: 'audit',
        permission: 'audit:read:district',
        keywords: 'log history changes',
      },
      {
        to: '/admin/rollover',
        label: 'Rollover',
        icon: 'rollover',
        permission: 'year:rollover:district',
        keywords: 'rotary year close new',
      },
    ],
  },
];

/**
 * `g`-prefixed jumps, shown in the `?` cheatsheet.
 *
 * Deliberately few. A shortcut nobody can remember is a shortcut nobody uses, and four that
 * people learn beat twenty they do not.
 */
export const GO_SHORTCUTS: Record<string, string> = {
  d: '/',
  c: '/clubs',
  a: '/activities',
  r: '/report',
};
