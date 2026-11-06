// Payroll withholding estimates. Pure, integer cents throughout.
//
// Federal: IRS Publication 15-T, Worksheet 1A (percentage method for
// automated payroll, Form W-4 2020 or later). Figures below were read from
// the 2026 edition at irs.gov/publications/p15t on 2026-11-05. A new tax year
// needs a new entry in FEDERAL_TABLES; the estimator refuses to guess a year
// it has no table for (it falls back to the latest one and flags it).

export type FilingStatus = "single" | "married_joint" | "head_of_household";

interface Bracket {
  /** Adjusted annual wage at least this (cents). */
  over: number;
  /** Tentative annual amount at the start of the bracket (cents). */
  base: number;
  /** Rate in basis points (1% = 100). */
  rateBp: number;
}

interface FederalYear {
  /** Worksheet 1A line 1g: subtracted when the Step 2 box is NOT checked. */
  line1g: { married_joint: number; other: number };
  standard: Record<FilingStatus, Bracket[]>;
}

const D = (dollars: number) => Math.round(dollars * 100);

export const FEDERAL_TABLES: Record<number, FederalYear> = {
  2026: {
    line1g: { married_joint: D(12_900), other: D(8_600) },
    standard: {
      single: [
        { over: D(0), base: D(0), rateBp: 0 },
        { over: D(7_500), base: D(0), rateBp: 1000 },
        { over: D(19_900), base: D(1_240), rateBp: 1200 },
        { over: D(57_900), base: D(5_800), rateBp: 2200 },
        { over: D(113_200), base: D(17_966), rateBp: 2400 },
        { over: D(209_275), base: D(41_024), rateBp: 3200 },
        { over: D(263_725), base: D(58_448), rateBp: 3500 },
        { over: D(648_100), base: D(192_979.25), rateBp: 3700 },
      ],
      married_joint: [
        { over: D(0), base: D(0), rateBp: 0 },
        { over: D(19_300), base: D(0), rateBp: 1000 },
        { over: D(44_100), base: D(2_480), rateBp: 1200 },
        { over: D(120_100), base: D(11_600), rateBp: 2200 },
        { over: D(230_700), base: D(35_932), rateBp: 2400 },
        { over: D(422_850), base: D(82_048), rateBp: 3200 },
        { over: D(531_750), base: D(116_896), rateBp: 3500 },
        { over: D(788_000), base: D(206_583.5), rateBp: 3700 },
      ],
      head_of_household: [
        { over: D(0), base: D(0), rateBp: 0 },
        { over: D(15_550), base: D(0), rateBp: 1000 },
        { over: D(33_250), base: D(1_770), rateBp: 1200 },
        { over: D(83_000), base: D(7_740), rateBp: 2200 },
        { over: D(121_250), base: D(16_155), rateBp: 2400 },
        { over: D(217_300), base: D(39_207), rateBp: 3200 },
        { over: D(271_750), base: D(56_631), rateBp: 3500 },
        { over: D(656_150), base: D(191_171), rateBp: 3700 },
      ],
    },
  },
};

/** Social Security wage base by year (cents). */
const SS_WAGE_BASE: Record<number, number> = { 2026: D(184_500) };

export const MEDICARE_BP = 145;
export const SOCIAL_SECURITY_BP = 620;

export interface TaxSetup {
  federal: {
    filingStatus: FilingStatus;
    /** W-4 Step 2 checkbox (multiple jobs). */
    step2: boolean;
    /** W-4 Step 3 annual credits (cents). */
    step3Credits: number;
    /** W-4 Step 4(a) other income, annual (cents). */
    step4aOtherIncome: number;
    /** W-4 Step 4(b) deductions, annual (cents). */
    step4bDeductions: number;
    /** W-4 Step 4(c) extra withholding per pay period (cents). */
    step4cExtra: number;
  };
  state:
    | { kind: "none" }
    | {
        kind: "illinois";
        /** IL-W-4 line 1 allowances. */
        basicAllowances: number;
        /** IL-W-4 line 2 allowances. */
        additionalAllowances: number;
        /** Extra withholding per pay period (cents). */
        extra: number;
      }
    | {
        kind: "flat";
        label: string;
        rateBp: number;
      };
  /** Pre-tax deductions per pay period (cents), e.g. health insurance. */
  pretaxPerPeriod: number;
  /** After-tax deductions per pay period (cents). */
  posttaxPerPeriod: number;
}

export const DEFAULT_TAX_SETUP: TaxSetup = {
  federal: {
    filingStatus: "single",
    step2: false,
    step3Credits: 0,
    step4aOtherIncome: 0,
    step4bDeductions: 0,
    step4cExtra: 0,
  },
  state: { kind: "illinois", basicAllowances: 0, additionalAllowances: 0, extra: 0 },
  pretaxPerPeriod: 0,
  posttaxPerPeriod: 0,
};

/** Illinois withholding allowance values per year (cents). */
// 2026 line-1 value is $2,925 per secondary sources (IL-700-T 2026); it only
// matters when allowances > 0. The W&M stub claims 0, verified to the cent.
const IL_ALLOWANCE: Record<number, { basic: number; additional: number }> = {
  2026: { basic: D(2_925), additional: D(1_000) },
};
const IL_RATE_BP = 495;

/** Round half away from zero: n * bp / 10000 in integer cents. */
export function pct(cents: number, bp: number): number {
  const v = (cents * bp) / 10_000;
  return Math.sign(v) * Math.round(Math.abs(v));
}

function pickYear<T>(table: Record<number, T>, year: number): { year: number; value: T; exact: boolean } {
  if (table[year]) return { year, value: table[year]!, exact: true };
  const years = Object.keys(table).map(Number).sort((a, b) => a - b);
  const fallback = years.filter((y) => y <= year).pop() ?? years[0]!;
  return { year: fallback, value: table[fallback]!, exact: false };
}

export function federalWithholding(
  taxableWages: number,
  periodsPerYear: number,
  setup: TaxSetup["federal"],
  year: number,
): { cents: number; tableYear: number; exactYear: boolean } {
  const { value: t, year: tableYear, exact } = pickYear(FEDERAL_TABLES, year);
  // Worksheet 1A step 1
  const annual = taxableWages * periodsPerYear + setup.step4aOtherIncome; // 1c + 1d = 1e
  const line1g = setup.step2 ? 0 : setup.filingStatus === "married_joint" ? t.line1g.married_joint : t.line1g.other;
  const adjusted = Math.max(0, annual - (setup.step4bDeductions + line1g)); // 1i
  // Step 2: STANDARD schedule (parseTaxSetup never sets step2, see there)
  const brackets = t.standard[setup.filingStatus];
  let row = brackets[0]!;
  for (const b of brackets) if (adjusted >= b.over) row = b;
  const tentativeAnnual = row.base + ((adjusted - row.over) * row.rateBp) / 10_000;
  const perPeriod = tentativeAnnual / periodsPerYear; // 2h
  // Step 3 credits
  const afterCredits = Math.max(0, perPeriod - setup.step3Credits / periodsPerYear);
  // Step 4 extra
  return { cents: Math.round(afterCredits) + setup.step4cExtra, tableYear, exactYear: exact };
}

export function illinoisWithholding(
  taxableWages: number,
  periodsPerYear: number,
  state: Extract<TaxSetup["state"], { kind: "illinois" }>,
  year: number,
): number {
  const { value: a } = pickYear(IL_ALLOWANCE, year);
  const exemption = (state.basicAllowances * a.basic + state.additionalAllowances * a.additional) / periodsPerYear;
  const base = Math.max(0, taxableWages - exemption);
  return pct(Math.round(base), IL_RATE_BP) + state.extra;
}

export interface WithholdingLines {
  federal: number;
  socialSecurity: number;
  medicare: number;
  state: number;
  stateLabel: string | null;
  pretax: number;
  posttax: number;
  totalWithheld: number;
  net: number;
  /** True when the federal table for the pay year was missing (fallback used). */
  federalTableIsStale: boolean;
}

export function withholding(
  gross: number,
  periodsPerYear: number,
  setup: TaxSetup,
  payYear: number,
  /** Social Security wages already paid this calendar year before this check. */
  ytdSocialSecurityWages = 0,
): WithholdingLines {
  const pretax = Math.min(gross, setup.pretaxPerPeriod);
  const taxable = gross - pretax;
  const fed = federalWithholding(taxable, periodsPerYear, setup.federal, payYear);
  const wageBase = pickYear(SS_WAGE_BASE, payYear).value;
  const ssWages = Math.max(0, Math.min(taxable, wageBase - ytdSocialSecurityWages));
  const socialSecurity = pct(ssWages, SOCIAL_SECURITY_BP);
  const medicare = pct(taxable, MEDICARE_BP);
  let state = 0;
  let stateLabel: string | null = null;
  if (setup.state.kind === "illinois") {
    state = illinoisWithholding(taxable, periodsPerYear, setup.state, payYear);
    stateLabel = "Illinois";
  } else if (setup.state.kind === "flat") {
    state = pct(taxable, setup.state.rateBp);
    stateLabel = setup.state.label;
  }
  const totalWithheld = fed.cents + socialSecurity + medicare + state;
  const posttax = setup.posttaxPerPeriod;
  return {
    federal: fed.cents,
    socialSecurity,
    medicare,
    state,
    stateLabel,
    pretax,
    posttax,
    totalWithheld,
    net: gross - pretax - totalWithheld - posttax,
    federalTableIsStale: !fed.exactYear,
  };
}

export function periodsPerYearFor(periodDays: number): number {
  if (periodDays === 7) return 52;
  if (periodDays === 14) return 26;
  if (periodDays === 28) return 13;
  return Math.max(1, Math.round(365 / periodDays));
}

/** Normalise untrusted JSON into a TaxSetup (fail closed to defaults). */
export function parseTaxSetup(raw: unknown): TaxSetup {
  const o = (raw && typeof raw === "object" ? raw : {}) as Record<string, any>;
  const f = (o.federal && typeof o.federal === "object" ? o.federal : {}) as Record<string, any>;
  const int = (v: unknown, min = 0, max = 1e11) =>
    typeof v === "number" && Number.isFinite(v) ? Math.min(max, Math.max(min, Math.round(v))) : 0;
  const status: FilingStatus =
    f.filingStatus === "married_joint" || f.filingStatus === "head_of_household" ? f.filingStatus : "single";
  let state: TaxSetup["state"] = DEFAULT_TAX_SETUP.state;
  const s = o.state as Record<string, any> | undefined;
  if (s?.kind === "none") state = { kind: "none" };
  else if (s?.kind === "flat")
    state = { kind: "flat", label: String(s.label ?? "State").slice(0, 40), rateBp: int(s.rateBp, 0, 2000) };
  else if (s?.kind === "illinois")
    state = {
      kind: "illinois",
      basicAllowances: int(s.basicAllowances, 0, 20),
      additionalAllowances: int(s.additionalAllowances, 0, 20),
      extra: int(s.extra),
    };
  return {
    federal: {
      filingStatus: status,
      // The Step-2-checkbox schedule is not modelled; never claim we handle it.
      step2: false,
      step3Credits: int(f.step3Credits),
      step4aOtherIncome: int(f.step4aOtherIncome),
      step4bDeductions: int(f.step4bDeductions),
      step4cExtra: int(f.step4cExtra),
    },
    state,
    pretaxPerPeriod: int(o.pretaxPerPeriod),
    posttaxPerPeriod: int(o.posttaxPerPeriod),
  };
}
