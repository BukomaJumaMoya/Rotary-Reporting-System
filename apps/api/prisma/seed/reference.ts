/**
 * Reference data: the rows that make the system configurable rather than hard-coded.
 *
 * Every table here is one a district officer may edit through the interface once the
 * governance module lands. None of it is code, and none of it should ever become code
 * (axioms 4 and 5).
 */

/** Permission codes are `resource:action:scope`. The code IS the primary key. */
export const PERMISSIONS: { code: string; description: string }[] = [
  // Organisation
  { code: 'club:read:district', description: 'View clubs affiliated to the district' },
  { code: 'club:create:district', description: 'Charter a new club' },
  { code: 'club:update:own', description: "Edit your own club's profile" },
  {
    code: 'club:update:district',
    // The other half of `club:update:own`. A district officer correcting a club's RI ID or
    // its charter date needs a door that is not "be a member of that club", and giving them
    // `club:update:own` would not open one — that permission is bounded by the caller's own
    // appointments, which is exactly what makes it safe to give a secretary.
    description: "Edit any affiliated club's profile",
  },
  { code: 'club:affiliate:district', description: 'Affiliate a club to the district for a year' },
  { code: 'cluster:manage:district', description: 'Create and redraw clusters' },

  // People and governance
  { code: 'person:read:club', description: 'View members of clubs in your scope' },
  { code: 'person:create:club', description: 'Register a new member' },
  { code: 'person:update:club', description: 'Edit a member record in your scope' },
  {
    code: 'person:read:contact',
    // The door past `person_visibility`. Safe to give a club secretary precisely because it
    // is bounded by SCOPE: it reaches the contact details of people on their own club's
    // roster and nobody else's. A district-wide holder reaches the district.
    description: 'View contact details of members in your scope, whatever their visibility',
  },
  {
    code: 'person:erase:district',
    description: "Review a member's request to have their record erased",
  },
  {
    code: 'person:invite:district',
    description: 'Invite anyone in the district to create an account',
  },
  {
    code: 'person:invite:club',
    // Safe to give a club secretary: it reaches their own roster and nobody else's.
    description: "Invite members of your own club's roster",
  },
  { code: 'user:manage:district', description: "Reset a member's second factor on their behalf" },
  { code: 'position:manage:district', description: 'Create and edit district positions' },
  { code: 'appointment:read:district', description: 'View appointments across the district' },
  { code: 'appointment:manage:district', description: 'Appoint and revoke officers' },
  { code: 'committee:manage:district', description: 'Create committees and appoint members' },

  // Membership
  { code: 'membership:read:club', description: 'View membership history in your scope' },
  { code: 'membership:write:club', description: 'Record joins, transfers and terminations' },

  // Activity
  { code: 'activity:read:club', description: 'View activities in your scope' },
  { code: 'activity:create:club', description: 'Report an activity for your club' },
  { code: 'activity:verify:district', description: 'Verify a reported activity' },
  { code: 'activitytype:manage:district', description: 'Configure activity types' },

  // Finance
  {
    code: 'finance:read:club',
    // The district's logged complaint was that secretaries could see collections but not
    // expenditure. This permission exists to answer it (docs/05-API-Spec.md §10).
    description: 'View club income AND expenditure',
  },
  { code: 'finance:write:club', description: 'Record club transactions' },
  { code: 'dues:manage:district', description: 'Raise and reconcile district dues' },

  // Assessment
  { code: 'assessment:read:club', description: 'View your own scorecard' },
  { code: 'assessment:score:assigned', description: 'Score the parameters you are assigned' },
  { code: 'assessment:finalise:district', description: 'Finalise and publish assessments' },
  {
    code: 'framework:manage:district',
    description: 'Edit the rubric — parameters, criteria, weights',
  },

  // Year, exports, audit
  {
    code: 'year:read:historical',
    // A READ door. `?year=` moves the whole context to a past year and the data access
    // layer refuses every write through it.
    description: 'Read Rotary Years other than the current one',
  },
  { code: 'year:rollover:district', description: 'Run the year rollover job' },
  { code: 'export:data:scope', description: 'Export the data you can already see' },
  { code: 'audit:read:district', description: 'Read the audit log' },
];

export interface PositionSeed {
  code: string;
  name: string;
  scope: 'DISTRICT' | 'REGION' | 'CLUSTER' | 'CLUB' | 'COMMITTEE';
  sequence: number;
  isUniquePerScope: boolean;
  permissions: string[];
}

/**
 * The D9218 RY2027-28 slate, with `position_permissions` wired from the authorisation
 * matrix in docs/05-API-Spec.md §10.
 *
 * This is CONFIGURATION. The DES changes it without a deployment, which is the whole
 * point of the table — so the matrix below is a starting position, not a definition.
 */
export const POSITIONS: PositionSeed[] = [
  {
    code: 'DRR',
    name: 'District Rotaract Representative',
    scope: 'DISTRICT',
    sequence: 10,
    isUniquePerScope: true,
    permissions: [
      'club:read:district',
      'club:update:district',
      'club:create:district',
      'club:affiliate:district',
      'cluster:manage:district',
      'person:read:club',
      'person:read:contact',
      'appointment:read:district',
      'appointment:manage:district',
      'committee:manage:district',
      'membership:read:club',
      'activity:read:club',
      'activity:verify:district',
      'finance:read:club',
      'dues:manage:district',
      'assessment:read:club',
      'assessment:finalise:district',
      'year:read:historical',
      'export:data:scope',
      'audit:read:district',
    ],
  },
  {
    code: 'DES',
    name: 'District Executive Secretary',
    scope: 'DISTRICT',
    sequence: 20,
    isUniquePerScope: true,
    permissions: [
      'club:read:district',
      'club:update:district',
      'person:read:club',
      'person:read:contact',
      'person:erase:district',
      'position:manage:district',
      'appointment:read:district',
      'appointment:manage:district',
      'committee:manage:district',
      'person:invite:district',
      'user:manage:district',
      'membership:read:club',
      'activity:read:club',
      'activity:verify:district',
      'activitytype:manage:district',
      'finance:read:club',
      'assessment:read:club',
      'year:read:historical',
      'year:rollover:district',
      'export:data:scope',
      'audit:read:district',
    ],
  },
  {
    code: 'DISTRICT_TREASURER',
    name: 'District Treasurer',
    scope: 'DISTRICT',
    sequence: 30,
    isUniquePerScope: true,
    permissions: [
      'club:read:district',
      'finance:read:club',
      'finance:write:club',
      'dues:manage:district',
      'year:read:historical',
      'export:data:scope',
    ],
  },
  {
    code: 'PIME_CHAIR',
    name: 'PIME Chair',
    scope: 'DISTRICT',
    sequence: 40,
    isUniquePerScope: true,
    permissions: [
      'club:read:district',
      'person:read:club',
      'membership:read:club',
      'activity:read:club',
      'activity:verify:district',
      'assessment:read:club',
      'assessment:score:assigned',
      'assessment:finalise:district',
      'framework:manage:district',
      'year:read:historical',
      'export:data:scope',
      'audit:read:district',
    ],
  },
  {
    code: 'ASSESSOR',
    name: 'District Assessor',
    scope: 'DISTRICT',
    sequence: 50,
    isUniquePerScope: false,
    permissions: [
      'club:read:district',
      'activity:read:club',
      'activity:verify:district',
      'assessment:read:club',
      'assessment:score:assigned',
      'export:data:scope',
    ],
  },
  {
    code: 'LDRR',
    name: 'Learning District Rotaract Representative',
    scope: 'REGION',
    sequence: 60,
    isUniquePerScope: true,
    permissions: [
      'club:read:district',
      'person:read:club',
      'membership:read:club',
      'activity:read:club',
      'activity:verify:district',
      'export:data:scope',
    ],
  },
  {
    code: 'ADRR',
    name: 'Assistant District Rotaract Representative',
    scope: 'CLUSTER',
    sequence: 70,
    isUniquePerScope: true,
    permissions: [
      'club:read:district',
      'person:read:club',
      'membership:read:club',
      'activity:read:club',
      'activity:verify:district',
      'assessment:read:club',
      'assessment:score:assigned',
      'export:data:scope',
    ],
  },
  {
    code: 'CLUB_PRESIDENT',
    name: 'Club President',
    scope: 'CLUB',
    sequence: 80,
    isUniquePerScope: true,
    permissions: [
      'club:read:district',
      'club:update:own',
      'person:read:club',
      'person:read:contact',
      'person:create:club',
      'person:update:club',
      'membership:read:club',
      'membership:write:club',
      'activity:read:club',
      'activity:create:club',
      'finance:read:club',
      'assessment:read:club',
      'export:data:scope',
    ],
  },
  {
    code: 'CLUB_SECRETARY',
    name: 'Club Secretary',
    scope: 'CLUB',
    sequence: 90,
    isUniquePerScope: true,
    permissions: [
      'club:read:district',
      'club:update:own',
      'person:read:club',
      'person:read:contact',
      'person:create:club',
      'person:update:club',
      'person:invite:club',
      'membership:read:club',
      'membership:write:club',
      'activity:read:club',
      'activity:create:club',
      // Deliberate: the secretary sees expenditure as well as collections.
      'finance:read:club',
      'assessment:read:club',
      'export:data:scope',
    ],
  },
  {
    code: 'CLUB_TREASURER',
    name: 'Club Treasurer',
    scope: 'CLUB',
    sequence: 100,
    isUniquePerScope: true,
    permissions: [
      'club:read:district',
      'person:read:club',
      'activity:read:club',
      'activity:create:club',
      'finance:read:club',
      'finance:write:club',
      'assessment:read:club',
      'export:data:scope',
    ],
  },
];

/** Rotary's seven areas of focus. Defined by RI, not by the district. */
export const AREAS_OF_FOCUS: { code: string; name: string }[] = [
  { code: 'PEACE', name: 'Peacebuilding and conflict prevention' },
  { code: 'DISEASE', name: 'Disease prevention and treatment' },
  { code: 'WATER', name: 'Water, sanitation and hygiene' },
  { code: 'MATERNAL_CHILD', name: 'Maternal and child health' },
  { code: 'EDUCATION', name: 'Basic education and literacy' },
  { code: 'ECONOMIC', name: 'Community economic development' },
  { code: 'ENVIRONMENT', name: 'Supporting the environment' },
];

export interface ActivityTypeSeed {
  code: string;
  name: string;
  category: string;
  allowedHostScopes: ('DISTRICT' | 'REGION' | 'CLUSTER' | 'CLUB' | 'COMMITTEE')[];
  requiresPhoto: boolean;
  requiresReport: boolean;
  requiresAttendance: boolean;
  requiresPartner: boolean;
  requiresAreaOfFocus: boolean;
  isScoringEligible: boolean;
  sequence: number;
}

/**
 * Activity types covering every category in docs/03-Data-Model.md §5.
 *
 * The requirement flags are the point of this table. "Extra activities should not require
 * a photo" — the district's actual request — is `requiresPhoto: false` on one row, not a
 * ticket.
 */
export const ACTIVITY_TYPES: ActivityTypeSeed[] = [
  {
    code: 'FELLOWSHIP_WEEKLY',
    name: 'Weekly fellowship',
    category: 'FELLOWSHIP',
    allowedHostScopes: ['CLUB'],
    requiresPhoto: false,
    requiresReport: false,
    requiresAttendance: true,
    requiresPartner: false,
    requiresAreaOfFocus: false,
    isScoringEligible: true,
    sequence: 10,
  },
  {
    code: 'FELLOWSHIP_SOCIAL',
    name: 'Social fellowship',
    category: 'FELLOWSHIP',
    allowedHostScopes: ['CLUB', 'CLUSTER'],
    requiresPhoto: true,
    requiresReport: false,
    requiresAttendance: true,
    requiresPartner: false,
    requiresAreaOfFocus: false,
    isScoringEligible: true,
    sequence: 20,
  },
  {
    code: 'SERVICE_PROJECT',
    name: 'Community service project',
    category: 'SERVICE',
    allowedHostScopes: ['CLUB', 'CLUSTER', 'DISTRICT'],
    requiresPhoto: true,
    requiresReport: true,
    requiresAttendance: false,
    requiresPartner: false,
    requiresAreaOfFocus: true,
    isScoringEligible: true,
    sequence: 30,
  },
  {
    code: 'SERVICE_MEDICAL_CAMP',
    name: 'Medical camp',
    category: 'SERVICE',
    allowedHostScopes: ['CLUB', 'CLUSTER', 'DISTRICT'],
    requiresPhoto: true,
    requiresReport: true,
    requiresAttendance: false,
    requiresPartner: true,
    requiresAreaOfFocus: true,
    isScoringEligible: true,
    sequence: 40,
  },
  {
    code: 'INTERNATIONAL_PROJECT',
    name: 'International service project',
    category: 'INTERNATIONAL',
    allowedHostScopes: ['CLUB', 'DISTRICT'],
    requiresPhoto: true,
    requiresReport: true,
    requiresAttendance: false,
    // International service is DERIVED from a partner outside Uganda, never declared,
    // so the partner is mandatory and the scoring engine can verify the claim.
    requiresPartner: true,
    requiresAreaOfFocus: true,
    isScoringEligible: true,
    sequence: 50,
  },
  {
    code: 'YOUTH_INTERACT',
    name: 'Interact club support',
    category: 'YOUTH',
    allowedHostScopes: ['CLUB', 'CLUSTER'],
    requiresPhoto: true,
    requiresReport: true,
    requiresAttendance: false,
    requiresPartner: false,
    requiresAreaOfFocus: false,
    isScoringEligible: true,
    sequence: 60,
  },
  {
    code: 'YOUTH_MENTORSHIP',
    name: 'School mentorship visit',
    category: 'YOUTH',
    allowedHostScopes: ['CLUB'],
    requiresPhoto: true,
    requiresReport: false,
    requiresAttendance: false,
    requiresPartner: false,
    requiresAreaOfFocus: true,
    isScoringEligible: true,
    sequence: 70,
  },
  {
    code: 'PLD_TRAINING',
    name: 'Professional development session',
    category: 'PLD',
    allowedHostScopes: ['CLUB', 'CLUSTER', 'DISTRICT'],
    requiresPhoto: false,
    requiresReport: true,
    requiresAttendance: true,
    requiresPartner: false,
    requiresAreaOfFocus: false,
    isScoringEligible: true,
    sequence: 80,
  },
  {
    code: 'PLD_CAREER_TALK',
    name: 'Career talk',
    category: 'PLD',
    allowedHostScopes: ['CLUB'],
    requiresPhoto: false,
    requiresReport: false,
    requiresAttendance: true,
    requiresPartner: false,
    requiresAreaOfFocus: false,
    isScoringEligible: true,
    sequence: 90,
  },
  {
    code: 'GOVERNANCE_ASSEMBLY',
    name: 'Club assembly',
    category: 'GOVERNANCE',
    allowedHostScopes: ['CLUB'],
    requiresPhoto: false,
    requiresReport: true,
    requiresAttendance: true,
    requiresPartner: false,
    requiresAreaOfFocus: false,
    isScoringEligible: true,
    sequence: 100,
  },
  {
    code: 'GOVERNANCE_EXTRA',
    name: 'Extra club activity',
    category: 'GOVERNANCE',
    allowedHostScopes: ['CLUB'],
    // The district's own request: extra activities should not require a photo. A
    // checkbox, not a ticket.
    requiresPhoto: false,
    requiresReport: false,
    requiresAttendance: false,
    requiresPartner: false,
    requiresAreaOfFocus: false,
    isScoringEligible: false,
    sequence: 110,
  },
  {
    code: 'CLUSTER_MEETING',
    name: 'Cluster meeting',
    category: 'CLUSTER',
    allowedHostScopes: ['CLUSTER'],
    requiresPhoto: false,
    requiresReport: true,
    requiresAttendance: true,
    requiresPartner: false,
    requiresAreaOfFocus: false,
    isScoringEligible: true,
    sequence: 120,
  },
  {
    code: 'DISTRICT_ASSEMBLY',
    name: 'District assembly',
    category: 'DISTRICT',
    allowedHostScopes: ['DISTRICT'],
    requiresPhoto: true,
    requiresReport: true,
    requiresAttendance: true,
    requiresPartner: false,
    requiresAreaOfFocus: false,
    isScoringEligible: true,
    sequence: 130,
  },
  {
    code: 'DISTRICT_DRR_VISIT',
    name: 'DRR club visit',
    category: 'DISTRICT',
    allowedHostScopes: ['DISTRICT', 'CLUSTER'],
    requiresPhoto: true,
    requiresReport: true,
    requiresAttendance: false,
    requiresPartner: false,
    requiresAreaOfFocus: false,
    isScoringEligible: true,
    sequence: 140,
  },
  {
    code: 'COMMITTEE_MEETING',
    name: 'Committee meeting',
    category: 'COMMITTEE',
    allowedHostScopes: ['COMMITTEE'],
    requiresPhoto: false,
    requiresReport: true,
    requiresAttendance: true,
    requiresPartner: false,
    requiresAreaOfFocus: false,
    isScoringEligible: true,
    sequence: 150,
  },
];

export const FINANCE_CATEGORIES: {
  code: string;
  name: string;
  direction: 'INCOME' | 'EXPENDITURE';
}[] = [
  { code: 'DUES_MEMBER', name: 'Member dues', direction: 'INCOME' },
  { code: 'FUNDRAISING', name: 'Fundraising', direction: 'INCOME' },
  { code: 'DONATION', name: 'Donations and sponsorship', direction: 'INCOME' },
  { code: 'GRANT', name: 'Grants', direction: 'INCOME' },
  { code: 'OTHER_INCOME', name: 'Other income', direction: 'INCOME' },
  { code: 'PROJECT_COST', name: 'Project costs', direction: 'EXPENDITURE' },
  { code: 'DUES_DISTRICT', name: 'District dues remitted', direction: 'EXPENDITURE' },
  { code: 'DUES_RI', name: 'RI dues remitted', direction: 'EXPENDITURE' },
  { code: 'ADMIN', name: 'Administration', direction: 'EXPENDITURE' },
  { code: 'TRAVEL', name: 'Travel and transport', direction: 'EXPENDITURE' },
  { code: 'TRAINING', name: 'Training and development', direction: 'EXPENDITURE' },
  { code: 'PUBLIC_IMAGE', name: 'Public image and branding', direction: 'EXPENDITURE' },
  { code: 'BANK_CHARGES', name: 'Bank charges', direction: 'EXPENDITURE' },
];

/**
 * Lookup tables added during implementation and EMPTY until now. `documents.doc_type` and
 * `social_accounts.platform` are foreign keys into them, so without these rows neither a
 * document nor a social account can be created at all.
 */
export const DOCUMENT_TYPES: { code: string; name: string; description: string }[] = [
  { code: 'CHARTER', name: 'Charter certificate', description: 'RI charter certificate' },
  { code: 'CONSTITUTION', name: 'Club constitution', description: 'Adopted club constitution' },
  { code: 'BYLAWS', name: 'Club bylaws', description: 'Adopted club bylaws' },
  {
    code: 'URSB_REGISTRATION',
    name: 'URSB registration',
    description: 'Ugandan registration certificate',
  },
  {
    code: 'BANK_STATEMENT',
    name: 'Bank statement',
    description: 'Club bank statement for a period',
  },
  { code: 'BUDGET', name: 'Approved budget', description: 'Club or district budget as approved' },
  { code: 'MINUTES', name: 'Meeting minutes', description: 'Minutes of an assembly or meeting' },
  {
    code: 'ANNUAL_REPORT',
    name: 'Annual report',
    description: "The club's report for a Rotary Year",
  },
  { code: 'PROJECT_REPORT', name: 'Project report', description: 'Narrative report for a project' },
  { code: 'MOU', name: 'Memorandum of understanding', description: 'Agreement with a partner' },
];

export const SOCIAL_PLATFORMS: { code: string; name: string }[] = [
  { code: 'FACEBOOK', name: 'Facebook' },
  { code: 'INSTAGRAM', name: 'Instagram' },
  { code: 'X', name: 'X' },
  { code: 'LINKEDIN', name: 'LinkedIn' },
  { code: 'TIKTOK', name: 'TikTok' },
  { code: 'YOUTUBE', name: 'YouTube' },
  { code: 'WHATSAPP', name: 'WhatsApp Channel' },
];

/**
 * Templates BEYOND the two a migration already inserts.
 *
 * `AUTH_PASSWORD_RESET` and `AUTH_INVITE` come from `20260813210000_default_notification_templates`
 * because authentication depends on them existing before any district does. They are
 * deliberately absent here, and the seed inserts with `skipDuplicates` so a rerun cannot
 * collide with them either way.
 */
export const NOTIFICATION_TEMPLATES: {
  code: string;
  channel: 'EMAIL' | 'WHATSAPP' | 'SMS';
  subject: string | null;
  body: string;
}[] = [
  {
    code: 'ACTIVITY_VERIFIED',
    channel: 'EMAIL',
    subject: 'Your activity report has been verified',
    body: 'Hello {{firstName}},\n\n"{{activityTitle}}" has been verified by {{verifiedBy}} and now counts towards your club\'s assessment.\n\nRotaract District 9218',
  },
  {
    code: 'ACTIVITY_REJECTED',
    channel: 'EMAIL',
    subject: 'Your activity report needs attention',
    body: 'Hello {{firstName}},\n\n"{{activityTitle}}" could not be verified: {{reason}}\n\nYou can correct and resubmit it.\n\nRotaract District 9218',
  },
  {
    code: 'ASSESSMENT_PUBLISHED',
    channel: 'EMAIL',
    subject: 'Your scorecard for {{periodLabel}} is ready',
    body: 'Hello {{firstName}},\n\n{{clubName}} scored {{totalScore}} of {{maxPossible}} for {{periodLabel}}.\n\nOpen the scorecard to see the evidence behind every criterion, and raise a dispute if something looks wrong.\n\n{{scorecardUrl}}\n\nRotaract District 9218',
  },
  {
    code: 'DUES_REMINDER',
    channel: 'EMAIL',
    subject: 'District dues for {{yearLabel}}',
    body: 'Hello {{firstName}},\n\n{{clubName}} has {{amountOutstanding}} outstanding on its district dues for {{yearLabel}}.\n\nRotaract District 9218',
  },
  {
    code: 'PERIOD_CLOSING',
    channel: 'EMAIL',
    subject: 'Reporting for {{periodLabel}} closes {{deadline}}',
    body: 'Hello {{firstName}},\n\nReporting for {{periodLabel}} closes on {{deadline}}. Anything submitted after that will not be scored for this period.\n\nRotaract District 9218',
  },
];
