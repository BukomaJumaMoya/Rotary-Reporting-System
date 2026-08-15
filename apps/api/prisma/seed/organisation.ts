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

/**
 * The rest of D9218's confirmed list, to 68 clubs.
 *
 * Generated from curated Ugandan place and institution names rather than written out
 * longhand: forty-eight more literals would be forty-eight more chances to mistype a slug,
 * and the shape — name, cluster, size — is all any of them contributes. The names are real
 * places; the RI ids stay in the same synthetic block, contiguous with the first twenty, so
 * nothing here can be reconciled against RI's register.
 *
 * The SIZE distribution is the part that matters. M5 scores clubs against a framework
 * published for their tier, so a dataset where every club is the same size would exercise
 * none of the tier logic and none of the ranking. Roughly a third of these cross the T1/T2
 * boundary at forty.
 */
const EXTRA_CLUBS: {
  name: string;
  cluster: string;
  venue: string;
  members: number;
  ibc?: string;
}[] = [
  // Kampala Metro
  { name: 'Bugolobi', cluster: 'Kampala Metro', venue: 'Village Mall, Bugolobi', members: 82 },
  { name: 'Ntinda', cluster: 'Kampala Metro', venue: 'Ntinda Complex', members: 71 },
  { name: 'Kansanga', cluster: 'Kampala Metro', venue: 'Kansanga Trading Centre', members: 58 },
  { name: 'Kabalagala', cluster: 'Kampala Metro', venue: 'Kabalagala', members: 51 },
  { name: 'Naguru', cluster: 'Kampala Metro', venue: 'Naguru Skyz Hotel', members: 97 },
  { name: 'Bukoto', cluster: 'Kampala Metro', venue: 'Bukoto Street', members: 66 },
  { name: 'Kibuli', cluster: 'Kampala Metro', venue: 'Kibuli Hill', members: 41 },
  {
    name: 'Nkumba University',
    cluster: 'Kampala Metro',
    venue: 'Nkumba Main Campus',
    members: 115,
    ibc: 'Nkumba University',
  },
  {
    name: 'Uganda Christian University',
    cluster: 'Kampala Metro',
    venue: 'Mukono Campus',
    members: 90,
    ibc: 'Uganda Christian University',
  },
  {
    name: 'Kampala International University',
    cluster: 'Kampala Metro',
    venue: 'Kansanga Campus',
    members: 104,
    ibc: 'Kampala International University',
  },

  // Greater Wakiso
  { name: 'Kajjansi', cluster: 'Greater Wakiso', venue: 'Kajjansi Town', members: 49 },
  { name: 'Nansana', cluster: 'Greater Wakiso', venue: 'Nansana Municipality', members: 62 },
  { name: 'Kira', cluster: 'Greater Wakiso', venue: 'Kira Town Council', members: 77 },
  { name: 'Kyengera', cluster: 'Greater Wakiso', venue: 'Kyengera', members: 36 },
  { name: 'Gayaza', cluster: 'Greater Wakiso', venue: 'Gayaza Road', members: 45 },
  { name: 'Namugongo', cluster: 'Greater Wakiso', venue: 'Namugongo Shrine Road', members: 54 },
  { name: 'Buloba', cluster: 'Greater Wakiso', venue: 'Buloba Trading Centre', members: 69 },
  {
    name: 'Ndejje University',
    cluster: 'Greater Wakiso',
    venue: 'Ndejje Main Campus',
    members: 81,
    ibc: 'Ndejje University',
  },

  // Busoga
  { name: 'Jinja City', cluster: 'Busoga', venue: 'Jinja Sailing Club', members: 86 },
  { name: 'Njeru', cluster: 'Busoga', venue: 'Njeru Town Council', members: 39 },
  { name: 'Bugembe', cluster: 'Busoga', venue: 'Bugembe Town', members: 52 },
  { name: 'Kamuli', cluster: 'Busoga', venue: 'Kamuli District Headquarters', members: 32 },
  { name: 'Bugiri', cluster: 'Busoga', venue: 'Bugiri Town', members: 28 },
  { name: 'Mayuge', cluster: 'Busoga', venue: 'Mayuge Trading Centre', members: 24 },
  {
    name: 'Kampala University Jinja',
    cluster: 'Busoga',
    venue: 'Jinja Campus',
    members: 73,
    ibc: 'Kampala University, Jinja Campus',
  },

  // Bugisu and Teso
  { name: 'Mbale City', cluster: 'Bugisu and Teso', venue: 'Mbale Resort Hotel', members: 79 },
  { name: 'Sironko', cluster: 'Bugisu and Teso', venue: 'Sironko Town', members: 30 },
  { name: 'Soroti City', cluster: 'Bugisu and Teso', venue: 'Soroti Hotel', members: 64 },
  { name: 'Kumi', cluster: 'Bugisu and Teso', venue: 'Kumi Town', members: 26 },
  { name: 'Tororo', cluster: 'Bugisu and Teso', venue: 'Tororo Town', members: 47 },
  { name: 'Kapchorwa', cluster: 'Bugisu and Teso', venue: 'Kapchorwa Town', members: 22 },
  {
    name: 'Islamic University in Uganda',
    cluster: 'Bugisu and Teso',
    venue: 'Mbale Campus',
    members: 88,
    ibc: 'Islamic University in Uganda',
  },

  // Ankole and Kigezi
  { name: 'Mbarara City', cluster: 'Ankole and Kigezi', venue: 'Lake View Resort', members: 92 },
  { name: 'Bushenyi', cluster: 'Ankole and Kigezi', venue: 'Bushenyi Town', members: 43 },
  { name: 'Ntungamo', cluster: 'Ankole and Kigezi', venue: 'Ntungamo Town', members: 34 },
  { name: 'Kanungu', cluster: 'Ankole and Kigezi', venue: 'Kanungu Town', members: 56 },
  { name: 'Rukungiri', cluster: 'Ankole and Kigezi', venue: 'Rukungiri Town', members: 37 },
  { name: 'Kisoro', cluster: 'Ankole and Kigezi', venue: 'Kisoro Town', members: 21 },
  { name: 'Ibanda', cluster: 'Ankole and Kigezi', venue: 'Ibanda Town', members: 30 },
  {
    name: 'Mbarara University of Science and Technology',
    cluster: 'Ankole and Kigezi',
    venue: 'MUST Main Campus',
    members: 99,
    ibc: 'Mbarara University of Science and Technology',
  },

  // Rwenzori and Bunyoro
  {
    name: 'Fort Portal City',
    cluster: 'Rwenzori and Bunyoro',
    venue: 'Mountains of the Moon Hotel',
    members: 67,
  },
  { name: 'Kikuube', cluster: 'Rwenzori and Bunyoro', venue: 'Kikuube Town', members: 41 },
  { name: 'Hoima City', cluster: 'Rwenzori and Bunyoro', venue: 'Hoima Resort Hotel', members: 75 },
  { name: 'Masindi', cluster: 'Rwenzori and Bunyoro', venue: 'Masindi Hotel', members: 36 },
  { name: 'Kagadi', cluster: 'Rwenzori and Bunyoro', venue: 'Kagadi Town', members: 24 },
  { name: 'Bundibugyo', cluster: 'Rwenzori and Bunyoro', venue: 'Bundibugyo Town', members: 19 },
  { name: 'Kyenjojo', cluster: 'Rwenzori and Bunyoro', venue: 'Kyenjojo Town', members: 28 },
  {
    name: 'Mountains of the Moon University',
    cluster: 'Rwenzori and Bunyoro',
    venue: 'Fort Portal Campus',
    members: 60,
    ibc: 'Mountains of the Moon University',
  },
];

/** T1 under forty, T2 at forty or more, IBC by base type. The same rule the code applies. */
function tierFor(baseType: ClubSeed['baseType'], members: number): ClubSeed['tier'] {
  if (baseType === 'IBC') return 'IBC';
  return members < 40 ? 'T1' : 'T2';
}

for (const [index, extra] of EXTRA_CLUBS.entries()) {
  const baseType: ClubSeed['baseType'] = extra.ibc ? 'IBC' : 'CBC';
  CLUBS.push({
    name: `Rotaract Club of ${extra.name}`,
    slug: `rc-${extra.name
      .toLowerCase()
      .replace(/[^a-z0-9]+/g, '-')
      .replace(/^-|-$/g, '')}`,
    // Contiguous with the hand-written twenty, so the whole block is obviously synthetic.
    riClubId: BigInt(900021 + index),
    baseType,
    tier: tierFor(baseType, extra.members),
    cluster: extra.cluster,
    ...(extra.ibc ? { hostInstitution: extra.ibc } : {}),
    // Spread across the week so the meeting-day filter has something to filter.
    // 0 = Sunday: the column is CHECK (0..6), which the contract now agrees with.
    meetingDay: index % 7,
    meetingVenue: extra.venue,
    memberCount: extra.members,
  });
}

/** The real shape: 68 clubs, which is D9218's confirmed list. */
export const TOTAL_CLUBS = CLUBS.length;

/**
 * Every member across every club.
 *
 * Asserted in `run.ts` rather than merely computed, so the seed's own arithmetic is checked
 * — M5's scoring and the load test both need a dataset of a known size, and a seed that
 * quietly produced 2,847 members would make every performance number a different question
 * from the one being asked.
 */
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
