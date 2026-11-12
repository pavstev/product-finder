import {
  mulberry32,
  pick,
  pickWeighted,
  type Random,
  randomInt,
  sampleIndexes,
  type Weighted,
} from './rng.js';

/** A synthetic catalogue for the benchmarks. Value sets and weights come from data/products.csv. */

/** The header of the real export, in the same order. */
export const CSV_HEADER = [
  'sku',
  'name',
  'chemical_name',
  'function',
  'application_area',
  'region',
  'certifications',
  'status',
  'launch_year',
  'description',
] as const;

export type CsvColumn = (typeof CSV_HEADER)[number];
export type CsvRow = Record<CsvColumn, string>;

/** The real SKUs run from P-10001 to P-10200. Generated ones start here, so they never collide. */
export const FIRST_SKU_NUMBER = 200001;
/** The real export has 66 of 202 rows without certifications. */
export const EMPTY_CERTIFICATIONS_SHARE = 0.33;
/** Share of rows whose name or status differs in the changed variant. */
export const CHANGED_SHARE = 0.05;
/** Share of rows the changed variant leaves out. */
export const MISSING_SHARE = 0.01;

/** Words from INCI names. In product names they give trigram search the same hits as chemical names. */
export const CHEMICAL_WORDS = ['Glucoside', 'Polyquaternium', 'Betaine', 'Ester', 'Silicone'] as const;

/** First word of the real names, for example Quorin in "Quorin SF 470". */
const NAME_STEMS = [
  'Axolan',
  'Brevana',
  'Calvera',
  'Hydrova',
  'Lumexa',
  'Meridan',
  'Novarel',
  'Oleanor',
  'Puraxin',
  'Quorin',
  'Siltera',
  'Sylvane',
  'Ternix',
  'Terravin',
  'Velumin',
  'Zelora',
] as const;

interface FunctionProfile {
  name: string;
  /** The two letters in the real names, for example SF in "Quorin SF 470". */
  code: string;
  chemicals: readonly string[];
  /** The second sentence of the real descriptions. */
  claims: readonly string[];
}

const FUNCTIONS: readonly Weighted<FunctionProfile>[] = [
  [
    {
      name: 'Surfactant',
      code: 'SF',
      chemicals: [
        'Cocamidopropyl Betaine',
        'Coco-Glucoside',
        'Decyl Glucoside',
        'Fatty Alcohol Ethoxylate',
        'Lauryl Glucoside',
        'Sodium Dodecylbenzenesulfonate',
        'Sodium Laureth Sulfate',
      ],
      claims: [
        'Readily biodegradable and easy to process.',
        'Low-foaming grade for machine applications.',
        'Delivers stable foam and good wetting.',
        'Provides efficient cleaning at low concentration.',
      ],
    },
    25,
  ],
  [
    {
      name: 'Emulsifier',
      code: 'EF',
      chemicals: [
        'Glyceryl Stearate',
        'Lecithin',
        'Mono- and Diglycerides',
        'Polysorbate 80',
        'Sorbitan Oleate',
      ],
      claims: [
        'Forms stable emulsions over a wide pH range.',
        'Improves dispersion of active ingredients.',
        'Enables cold-process formulation.',
        'Effective at low use levels.',
      ],
    },
    20,
  ],
  [
    {
      name: 'Preservative',
      code: 'PR',
      chemicals: [
        'Benzisothiazolinone',
        'Benzyl Alcohol',
        'Phenoxyethanol',
        'Potassium Sorbate',
        'Sodium Benzoate',
      ],
      claims: [
        'Effective over a wide pH range.',
        'Globally approved preservative system.',
        'Compatible with most formulation ingredients.',
        'Broad-spectrum antimicrobial efficacy.',
      ],
    },
    26,
  ],
  [
    {
      name: 'Solvent',
      code: 'SV',
      chemicals: [
        'Butyl Glycol',
        'Dipropylene Glycol Methyl Ether',
        'Ethyl Lactate',
        'Glycerin',
        'Propylene Glycol',
      ],
      claims: [
        'Excellent solvency for resins and actives.',
        'Bio-based grade available.',
        'Improves freeze-thaw stability.',
        'Low odour and low volatility.',
      ],
    },
    28,
  ],
  [
    {
      name: 'Rheology Modifier',
      code: 'RM',
      chemicals: ['Bentonite', 'Carbomer', 'Fumed Silica', 'Hydroxyethylcellulose', 'Xanthan Gum'],
      claims: [
        'Efficient thickener for clear gels.',
        'Stabilizes suspensions and emulsions.',
        'Electrolyte-tolerant viscosity builder.',
        'Provides shear-thinning flow behaviour.',
      ],
    },
    33,
  ],
  [
    {
      name: 'Polymer',
      code: 'PO',
      chemicals: [
        'Acrylic Copolymer',
        'Polyquaternium-10',
        'Polyvinyl Alcohol',
        'Polyvinylpyrrolidone',
        'Sodium Polyacrylate',
      ],
      claims: [
        'Provides anti-redeposition in detergents.',
        'Excellent film-forming properties.',
        'Water-soluble and easy to handle.',
        'Improves binding and adhesion.',
      ],
    },
    29,
  ],
  [
    {
      name: 'Antioxidant',
      code: 'AO',
      chemicals: [
        'Ascorbic Acid',
        'Ascorbyl Palmitate',
        'Butylated Hydroxytoluene',
        'Rosemary Extract',
        'Tocopherol',
      ],
      claims: [
        'Effective at low dosage.',
        'Naturally derived option available.',
        'Thermally stable during processing.',
        'Extends shelf life by preventing oxidation.',
      ],
    },
    19,
  ],
  [
    {
      name: 'Emollient',
      code: 'EM',
      chemicals: [
        'Caprylic/Capric Triglyceride',
        'Coco-Caprylate',
        'Ethylhexyl Stearate',
        'Isopropyl Myristate',
        'Squalane',
      ],
      claims: [
        'Silicone alternative with a smooth after-feel.',
        'Provides a light, non-greasy feel.',
        'Good solvent for lipophilic actives.',
        'Excellent spreading properties.',
      ],
    },
    22,
  ],
];

const APPLICATION_AREAS: readonly Weighted<string>[] = [
  ['Personal Care', 50],
  ['Home Care', 35],
  ['Coatings', 30],
  ['Pharmaceuticals', 28],
  ['Food & Nutrition', 20],
  ['Agriculture', 14],
  ['Industrial Cleaning', 13],
  ['Textiles', 9],
  ['Plastics', 3],
];

const REGIONS: readonly Weighted<string>[] = [
  ['Global', 63],
  ['EMEA', 44],
  ['Asia Pacific', 36],
  ['North America', 36],
  ['Latin America', 23],
];

/** Sorted by code unit, as in the real export: "Kosher|RSPO Mass Balance|Readily Biodegradable". */
const CERTIFICATIONS = [
  'EU Ecolabel',
  'Halal',
  'Kosher',
  'REACH Registered',
  'RSPO Mass Balance',
  'Readily Biodegradable',
  'Vegan',
] as const;

/** The real export spells the statuses like this. The mix is the one the plan asks for, not the real one. */
const STATUSES: readonly Weighted<string>[] = [
  ['Active', 80],
  ['Phase-out', 10],
  ['Discontinued', 10],
];

const FIRST_LAUNCH_YEAR = 2005;
const LAST_LAUNCH_YEAR = 2025;

export interface CatalogOptions {
  rows: number;
  seed: number;
}

export interface GeneratedCatalog {
  /** The export, one row per product. */
  rows: CsvRow[];
  /** The same rows, with CHANGED_SHARE renamed or given a new status and MISSING_SHARE left out. */
  changedRows: CsvRow[];
  changed: number;
  missing: number;
}

/** The export and its changed variant. The same options give the same rows. */
export function generateCatalog({ rows, seed }: CatalogOptions): GeneratedCatalog {
  const random = mulberry32(seed);
  const base = Array.from({ length: rows }, (_, index) => generateRow(random, index));
  return { rows: base, ...changeRows(random, base) };
}

/** CSV text like the real export: LF line ends, a final LF, quotes only where a field needs them. */
export function toCsv(rows: readonly CsvRow[]): string {
  const lines = [CSV_HEADER.join(',')];
  for (const row of rows) {
    lines.push(CSV_HEADER.map((column) => csvField(row[column])).join(','));
  }
  return `${lines.join('\n')}\n`;
}

function csvField(value: string): string {
  return /[",\r\n]/.test(value) ? `"${value.replaceAll('"', '""')}"` : value;
}

function generateRow(random: Random, index: number): CsvRow {
  const profile = pickWeighted(random, FUNCTIONS);
  const name = [
    pick(random, NAME_STEMS),
    pick(random, CHEMICAL_WORDS),
    profile.code,
    String(randomInt(random, 10, 99) * 10),
  ].join(' ');
  const chemical = pick(random, profile.chemicals);
  const area = pickWeighted(random, APPLICATION_AREAS);
  const region = pickWeighted(random, REGIONS);
  const certificationList = certifications(random);
  const status = pickWeighted(random, STATUSES);
  const launchYear = randomInt(random, FIRST_LAUNCH_YEAR, LAST_LAUNCH_YEAR);
  const claim = pick(random, profile.claims);
  return {
    sku: `P-${FIRST_SKU_NUMBER + index}`,
    name,
    chemical_name: chemical,
    function: profile.name,
    application_area: area,
    region,
    certifications: certificationList,
    status,
    launch_year: String(launchYear),
    description: `${profile.name} based on ${chemical} for ${area.toLowerCase()} applications. ${claim}`,
  };
}

/** Empty, or one to three different certifications in the real order. */
function certifications(random: Random): string {
  if (random() < EMPTY_CERTIFICATIONS_SHARE) {
    return '';
  }
  return sampleIndexes(random, CERTIFICATIONS.length, randomInt(random, 1, 3))
    .sort((a, b) => a - b)
    .map((index) => CERTIFICATIONS[index])
    .join('|');
}

/** The import benchmark input: the same SKUs in the same order, a few renamed or moved, a few gone. */
function changeRows(random: Random, rows: readonly CsvRow[]): Omit<GeneratedCatalog, 'rows'> {
  const changed = Math.round(rows.length * CHANGED_SHARE);
  const missing = Math.round(rows.length * MISSING_SHARE);
  const picked = sampleIndexes(random, rows.length, changed + missing);
  const toChange = new Set(picked.slice(0, changed));
  const toDrop = new Set(picked.slice(changed));

  const changedRows: CsvRow[] = [];
  rows.forEach((row, index) => {
    if (toDrop.has(index)) {
      return;
    }
    changedRows.push(toChange.has(index) ? changeRow(random, row) : row);
  });
  return { changedRows, changed, missing };
}

/** Half of the changes rename the product. The other half give it one of the two other statuses. */
function changeRow(random: Random, row: CsvRow): CsvRow {
  if (random() < 0.5) {
    return { ...row, name: `${row.name} Plus` };
  }
  const others = STATUSES.map(([status]) => status).filter((status) => status !== row.status);
  return { ...row, status: pick(random, others) };
}
