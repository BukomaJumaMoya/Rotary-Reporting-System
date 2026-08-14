/**
 * Synthetic member data. **Never real member data, on any machine, ever.**
 *
 * Deliberately NOT faker. Two reasons, both specific to this project:
 *
 *  * faker generates Western names, and a district demo populated with them is useless
 *    for the conversation the demo exists to have. The name lists below are Ugandan, so
 *    the seeded dataset looks like the district it models. Curating them was needed for
 *    the club names anyway, which faker could never have produced.
 *  * it is one more dependency in a repository that is district property and has one
 *    part-time maintainer, and this npm has a documented habit of pruning platform
 *    binaries on a workspace-scoped install (see docs/10-Build-Log.md §6).
 *
 * Deterministic, from a fixed seed: the same command produces the same database, so a
 * bug reproduced on one laptop reproduces on another and a screenshot keeps matching the
 * data behind it.
 */

/**
 * Mulberry32 — a small, fast, well-distributed PRNG.
 *
 * `Math.random()` cannot be seeded, which would make every run of the seed produce a
 * different dataset and every "it worked yesterday" impossible to check.
 */
export function createRandom(seed: number): () => number {
  let state = seed >>> 0;
  return () => {
    state = (state + 0x6d2b79f5) >>> 0;
    let t = state;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

export interface Random {
  next(): number;
  int(minInclusive: number, maxInclusive: number): number;
  pick<T>(items: readonly T[]): T;
  chance(probability: number): boolean;
  shuffle<T>(items: readonly T[]): T[];
}

export function random(seed: number): Random {
  const next = createRandom(seed);

  const int = (min: number, max: number): number => min + Math.floor(next() * (max - min + 1));

  const pick = <T>(items: readonly T[]): T => {
    const item = items[int(0, items.length - 1)];
    // noUncheckedIndexedAccess: the index is in range by construction, but the compiler
    // cannot know that and an empty list is a real caller error worth failing on.
    if (item === undefined) throw new Error('pick() called with an empty list');
    return item;
  };

  return {
    next,
    int,
    pick,
    chance: (probability) => next() < probability,
    shuffle: <T>(items: readonly T[]): T[] => {
      const copy = [...items];
      for (let i = copy.length - 1; i > 0; i -= 1) {
        const j = int(0, i);
        const a = copy[i];
        const b = copy[j];
        if (a !== undefined && b !== undefined) {
          copy[i] = b;
          copy[j] = a;
        }
      }
      return copy;
    },
  };
}

/** Common Ugandan given names, mixed across regions and both genders. */
const GIVEN_NAMES = [
  'Aisha',
  'Allan',
  'Amos',
  'Andrew',
  'Angella',
  'Annet',
  'Arthur',
  'Barbara',
  'Brian',
  'Bruno',
  'Carol',
  'Charity',
  'Christine',
  'Cynthia',
  'Daniel',
  'David',
  'Denis',
  'Diana',
  'Doreen',
  'Edgar',
  'Edith',
  'Edward',
  'Elizabeth',
  'Emmanuel',
  'Esther',
  'Eunice',
  'Faith',
  'Fred',
  'Gerald',
  'Gloria',
  'Grace',
  'Harriet',
  'Henry',
  'Ibrahim',
  'Innocent',
  'Irene',
  'Isaac',
  'Ivan',
  'Jackline',
  'Jonathan',
  'Joseph',
  'Josephine',
  'Joshua',
  'Joy',
  'Juliet',
  'Justine',
  'Kenneth',
  'Lillian',
  'Loyce',
  'Lydia',
  'Martin',
  'Mercy',
  'Michael',
  'Miriam',
  'Moses',
  'Nicholas',
  'Norah',
  'Patience',
  'Patrick',
  'Paul',
  'Peace',
  'Peter',
  'Phiona',
  'Prossy',
  'Racheal',
  'Raymond',
  'Rebecca',
  'Richard',
  'Ritah',
  'Robert',
  'Ronald',
  'Rose',
  'Ruth',
  'Samuel',
  'Sarah',
  'Shamim',
  'Sharon',
  'Simon',
  'Solomon',
  'Sophie',
  'Stella',
  'Stephen',
  'Susan',
  'Sylvia',
  'Timothy',
  'Tracy',
  'Trevor',
  'Vincent',
  'Viola',
  'Winnie',
  'Yasin',
  'Zainab',
] as const;

/** Ugandan surnames, drawn across Baganda, Basoga, Banyankole, Acholi and Bagisu names. */
const SURNAMES = [
  'Aciro',
  'Akello',
  'Amongi',
  'Asiimwe',
  'Atim',
  'Babirye',
  'Bagonza',
  'Bakunda',
  'Balikuddembe',
  'Byaruhanga',
  'Kabuye',
  'Kagaba',
  'Kagwa',
  'Kakuru',
  'Kalema',
  'Kamya',
  'Kansiime',
  'Kasozi',
  'Katumba',
  'Kayemba',
  'Kemigisha',
  'Kibirige',
  'Kigozi',
  'Kiggundu',
  'Kirabo',
  'Kisakye',
  'Kiwanuka',
  'Lubega',
  'Lukwago',
  'Lutaaya',
  'Muhwezi',
  'Mukasa',
  'Mukiibi',
  'Mulindwa',
  'Musoke',
  'Mutebi',
  'Mwesigwa',
  'Nabbanja',
  'Nabukenya',
  'Nakato',
  'Nakayiza',
  'Namara',
  'Namubiru',
  'Nankya',
  'Nassuna',
  'Ndagire',
  'Nsereko',
  'Ntale',
  'Nuwagaba',
  'Nyakato',
  'Obonyo',
  'Ochieng',
  'Odongo',
  'Ojok',
  'Okello',
  'Okot',
  'Oloya',
  'Opio',
  'Ssebugwawo',
  'Ssekandi',
  'Ssemakula',
  'Ssempala',
  'Ssentongo',
  'Tumusiime',
  'Tusiime',
  'Wafula',
  'Wamala',
  'Wanyama',
  'Were',
  'Zziwa',
] as const;

const CITIES = [
  'Kampala',
  'Entebbe',
  'Jinja',
  'Mbarara',
  'Gulu',
  'Mbale',
  'Masaka',
  'Lira',
  'Fort Portal',
  'Soroti',
  'Kabale',
  'Arua',
  'Hoima',
  'Mukono',
  'Wakiso',
] as const;

const OCCUPATIONS = [
  'Accountant',
  'Advocate',
  'Architect',
  'Banker',
  'Civil Engineer',
  'Clinical Officer',
  'Data Analyst',
  'Dentist',
  'Entrepreneur',
  'Graphic Designer',
  'Human Resource Officer',
  'Journalist',
  'Lecturer',
  'Logistics Officer',
  'Marketing Officer',
  'Medical Officer',
  'Nurse',
  'Pharmacist',
  'Procurement Officer',
  'Project Manager',
  'Software Developer',
  'Teacher',
  'Veterinary Officer',
] as const;

const EMPLOYERS = [
  'Absa Bank Uganda',
  'Airtel Uganda',
  'Centenary Bank',
  'DFCU Bank',
  'Independent',
  'Makerere University',
  'Ministry of Health',
  'MTN Uganda',
  'NSSF Uganda',
  'Roofings Group',
  'Self-employed',
  'Stanbic Bank Uganda',
  'UMEME',
  'Uganda Breweries',
] as const;

export interface SyntheticPerson {
  firstName: string;
  lastName: string;
  otherNames: string | null;
  gender: string | null;
  dateOfBirth: Date;
  email: string;
  phone: string;
  city: string;
  occupation: string;
  employer: string;
}

/**
 * One synthetic member.
 *
 * `index` makes the email and phone unique without a collision check: `persons.email` is
 * uniquely indexed, and a seed that fails two thirds of the way through on a duplicate is
 * a seed nobody trusts.
 *
 * The domain is `example.org` — reserved by RFC 2606 precisely so test data cannot reach
 * a real inbox. Phone numbers sit in Uganda's +256 79 range with a sequential tail, which
 * is deliberately not a real subscriber block.
 */
export function syntheticPerson(rng: Random, index: number): SyntheticPerson {
  const firstName = rng.pick(GIVEN_NAMES);
  const lastName = rng.pick(SURNAMES);

  return {
    firstName,
    lastName,
    otherNames: rng.chance(0.3) ? rng.pick(GIVEN_NAMES) : null,
    gender: rng.chance(0.95) ? rng.pick(['F', 'M']) : null,
    // Rotaract is 18–30, so ages cluster there. Dates are UTC midnight to match `@db.Date`.
    dateOfBirth: new Date(Date.UTC(1997 + rng.int(0, 11), rng.int(0, 11), rng.int(1, 28))),
    email: `${firstName.toLowerCase()}.${lastName.toLowerCase()}.${index}@example.org`,
    phone: `+2567${String(90000000 + index).slice(0, 8)}`,
    city: rng.pick(CITIES),
    occupation: rng.pick(OCCUPATIONS),
    employer: rng.pick(EMPLOYERS),
  };
}
