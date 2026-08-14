/**
 * The organisation D9218 is being formed as: three regions, six clusters, twenty clubs.
 *
 * The club names are real Ugandan place and institution names, which is the point — a
 * demo populated with Western placeholder names is useless for the conversation the demo
 * exists to have. The RI club IDs are NOT real: they sit in a contiguous synthetic block
 * so nothing here can be mistaken for, or reconciled against, RI's register.
 */

export interface RegionSeed {
  code: string;
  name: string;
  clusters: string[];
}

export const REGIONS: RegionSeed[] = [
  { code: 'CENTRAL', name: 'Central Region', clusters: ['Kampala Metro', 'Greater Wakiso'] },
  { code: 'EASTERN', name: 'Eastern Region', clusters: ['Busoga', 'Bugisu and Teso'] },
  {
    code: 'WESTERN',
    name: 'Western Region',
    clusters: ['Ankole and Kigezi', 'Rwenzori and Bunyoro'],
  },
];

export interface ClubSeed {
  name: string;
  slug: string;
  /** Synthetic. Not an RI identifier. */
  riClubId: bigint;
  baseType: 'CBC' | 'IBC' | 'ECLUB';
  tier: 'T1' | 'T2' | 'IBC';
  cluster: string;
  /** IBCs only. */
  hostInstitution?: string;
  isVirtual?: boolean;
  meetingDay: number;
  meetingVenue: string;
  /** How many of the 300 synthetic members belong here. */
  memberCount: number;
}

/**
 * Tier is frozen from the affiliation at rollover and reflects size: T1 for the larger
 * community-based clubs, T2 for the smaller ones, and IBC for institution-based clubs,
 * which are assessed against their own tier because a university club's year is a
 * semester and its membership turns over completely.
 */
export const CLUBS: ClubSeed[] = [
  // --- Central: Kampala Metro ------------------------------------------------
  {
    name: 'Rotaract Club of Kampala',
    slug: 'rc-kampala',
    riClubId: 900001n,
    baseType: 'CBC',
    tier: 'T1',
    cluster: 'Kampala Metro',
    meetingDay: 3,
    meetingVenue: 'Kampala Club, Nakasero',
    memberCount: 24,
  },
  {
    name: 'Rotaract Club of Kololo',
    slug: 'rc-kololo',
    riClubId: 900002n,
    baseType: 'CBC',
    tier: 'T1',
    cluster: 'Kampala Metro',
    meetingDay: 2,
    meetingVenue: 'Fairway Hotel, Kololo',
    memberCount: 21,
  },
  {
    name: 'Rotaract Club of Nakawa',
    slug: 'rc-nakawa',
    riClubId: 900003n,
    baseType: 'CBC',
    tier: 'T2',
    cluster: 'Kampala Metro',
    meetingDay: 4,
    meetingVenue: 'Nakawa Business Park',
    memberCount: 14,
  },
  {
    name: 'Rotaract Club of Muyenga',
    slug: 'rc-muyenga',
    riClubId: 900004n,
    baseType: 'CBC',
    tier: 'T2',
    cluster: 'Kampala Metro',
    meetingDay: 3,
    meetingVenue: 'Cassia Lodge, Muyenga',
    memberCount: 12,
  },
  {
    name: 'Rotaract Club of Makerere University',
    slug: 'rc-makerere',
    riClubId: 900005n,
    baseType: 'IBC',
    tier: 'IBC',
    cluster: 'Kampala Metro',
    hostInstitution: 'Makerere University',
    meetingDay: 5,
    meetingVenue: 'Main Campus, Makerere',
    memberCount: 22,
  },

  // --- Central: Greater Wakiso -----------------------------------------------
  {
    name: 'Rotaract Club of Entebbe',
    slug: 'rc-entebbe',
    riClubId: 900006n,
    baseType: 'CBC',
    tier: 'T1',
    cluster: 'Greater Wakiso',
    meetingDay: 2,
    meetingVenue: 'Imperial Botanical Beach Hotel',
    memberCount: 19,
  },
  {
    name: 'Rotaract Club of Kyambogo University',
    slug: 'rc-kyambogo',
    riClubId: 900007n,
    baseType: 'IBC',
    tier: 'IBC',
    cluster: 'Greater Wakiso',
    hostInstitution: 'Kyambogo University',
    meetingDay: 4,
    meetingVenue: 'Kyambogo Main Campus',
    memberCount: 20,
  },
  {
    name: 'Rotaract Club of Mukono',
    slug: 'rc-mukono',
    riClubId: 900008n,
    baseType: 'CBC',
    tier: 'T2',
    cluster: 'Greater Wakiso',
    meetingDay: 3,
    meetingVenue: 'Colline Hotel, Mukono',
    memberCount: 11,
  },
  {
    name: 'Rotaract e-Club of Uganda',
    slug: 're-club-uganda',
    riClubId: 900009n,
    baseType: 'ECLUB',
    tier: 'T2',
    cluster: 'Greater Wakiso',
    isVirtual: true,
    meetingDay: 1,
    meetingVenue: 'Online',
    memberCount: 13,
  },

  // --- Eastern: Busoga --------------------------------------------------------
  {
    name: 'Rotaract Club of Jinja',
    slug: 'rc-jinja',
    riClubId: 900010n,
    baseType: 'CBC',
    tier: 'T1',
    cluster: 'Busoga',
    meetingDay: 3,
    meetingVenue: 'Source of the Nile Hotel, Jinja',
    memberCount: 18,
  },
  {
    name: 'Rotaract Club of Iganga',
    slug: 'rc-iganga',
    riClubId: 900011n,
    baseType: 'CBC',
    tier: 'T2',
    cluster: 'Busoga',
    meetingDay: 4,
    meetingVenue: 'Iganga Town Hall',
    memberCount: 10,
  },
  {
    name: 'Rotaract Club of Busitema University',
    slug: 'rc-busitema',
    riClubId: 900012n,
    baseType: 'IBC',
    tier: 'IBC',
    cluster: 'Busoga',
    hostInstitution: 'Busitema University',
    meetingDay: 5,
    meetingVenue: 'Busitema Main Campus',
    memberCount: 16,
  },

  // --- Eastern: Bugisu and Teso ----------------------------------------------
  {
    name: 'Rotaract Club of Mbale',
    slug: 'rc-mbale',
    riClubId: 900013n,
    baseType: 'CBC',
    tier: 'T1',
    cluster: 'Bugisu and Teso',
    meetingDay: 2,
    meetingVenue: 'Mbale Resort Hotel',
    memberCount: 17,
  },
  {
    name: 'Rotaract Club of Soroti',
    slug: 'rc-soroti',
    riClubId: 900014n,
    baseType: 'CBC',
    tier: 'T2',
    cluster: 'Bugisu and Teso',
    meetingDay: 4,
    meetingVenue: 'Soroti Hotel',
    memberCount: 9,
  },

  // --- Western: Ankole and Kigezi ---------------------------------------------
  {
    name: 'Rotaract Club of Mbarara',
    slug: 'rc-mbarara',
    riClubId: 900015n,
    baseType: 'CBC',
    tier: 'T1',
    cluster: 'Ankole and Kigezi',
    meetingDay: 3,
    meetingVenue: 'Lake View Resort Hotel, Mbarara',
    memberCount: 18,
  },
  {
    name: 'Rotaract Club of Kabale',
    slug: 'rc-kabale',
    riClubId: 900016n,
    baseType: 'CBC',
    tier: 'T2',
    cluster: 'Ankole and Kigezi',
    meetingDay: 2,
    meetingVenue: 'White Horse Inn, Kabale',
    memberCount: 10,
  },
  {
    name: 'Rotaract Club of Mbarara University',
    slug: 'rc-must',
    riClubId: 900017n,
    baseType: 'IBC',
    tier: 'IBC',
    cluster: 'Ankole and Kigezi',
    hostInstitution: 'Mbarara University of Science and Technology',
    meetingDay: 5,
    meetingVenue: 'MUST Main Campus',
    memberCount: 15,
  },

  // --- Western: Rwenzori and Bunyoro ------------------------------------------
  {
    name: 'Rotaract Club of Fort Portal',
    slug: 'rc-fort-portal',
    riClubId: 900018n,
    baseType: 'CBC',
    tier: 'T1',
    cluster: 'Rwenzori and Bunyoro',
    meetingDay: 3,
    meetingVenue: 'Mountains of the Moon Hotel',
    memberCount: 16,
  },
  {
    name: 'Rotaract Club of Hoima',
    slug: 'rc-hoima',
    riClubId: 900019n,
    baseType: 'CBC',
    tier: 'T2',
    cluster: 'Rwenzori and Bunyoro',
    meetingDay: 4,
    meetingVenue: 'Hoima Resort Hotel',
    memberCount: 8,
  },
  {
    name: 'Rotaract Club of Kasese',
    slug: 'rc-kasese',
    riClubId: 900020n,
    baseType: 'CBC',
    tier: 'T2',
    cluster: 'Rwenzori and Bunyoro',
    meetingDay: 2,
    meetingVenue: 'Rwenzori International Hotel',
    memberCount: 7,
  },
];

/** 300 members exactly, so the seed's own arithmetic is checked rather than assumed. */
export const TOTAL_MEMBERS = CLUBS.reduce((sum, club) => sum + club.memberCount, 0);

export const DISTRICT = {
  riDistrictCode: '9218',
  name: 'Rotaract District 9218',
  countryCode: 'UG',
  timezone: 'Africa/Kampala',
  currencyCode: 'UGX',
  /** The district's charter date, and the system's launch date. */
  charteredOn: new Date(Date.UTC(2027, 6, 1)),
};

export const ROTARY_YEARS = [
  {
    label: '2026-27',
    startsOn: new Date(Date.UTC(2026, 6, 1)),
    endsOn: new Date(Date.UTC(2027, 5, 30)),
    riTheme: null,
  },
  {
    label: '2027-28',
    startsOn: new Date(Date.UTC(2027, 6, 1)),
    endsOn: new Date(Date.UTC(2028, 5, 30)),
    riTheme: null,
  },
] as const;

export const CURRENT_YEAR_LABEL = '2027-28';
export const PREVIOUS_YEAR_LABEL = '2026-27';
