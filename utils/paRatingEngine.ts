import { readFileSync } from "fs";
import path from "path";

/**
 * Personal Auto rating engine - a TypeScript port of PA_Rating_Actuarial_Calculator_v2.xlsx
 * (PolicyCenter rate book "PA RTM Demo Rating", Edition 3).
 *
 * Per coverage (standard routines pa_cov_premium_rr / pa_veh_cov_premium_rr):
 *   Base Rate      table:BaseRate(coverage, state, ZIP), rounded to 0.001
 *   Adjusted Rate  Base Rate x Coverage Factor x 2nd-term (tort) Factor x UW Company Factor x Multi-Car Factor
 *                  x min(Vehicle Cost Factor, Vehicle Type Factor) [x Driver Age Factor, vehicle-level only]
 *   Term Amount    vehicle type "other" below table:MinPremium -> MinPremium rounded up to $10;
 *                  otherwise line-level rounded half up, vehicle-level rounded up to $1
 *   Renewal cap    renewal + vehicle-level + prior term amount -> table:AutomaticRenewalCap, rounded down to $1
 *   Written        Term Amount x policy days / rated-term days, rounded per settings.writtenPremiumRounding
 * Mexico (flat):   Base Rate rounded to $1, not prorated
 * PIP NJ:          Liability Base Rate x Liability "100K" factor x PIP NJ base rate x PIP Med-secondary factor, rounded to cents
 * State tax:       table:PAStateTax(state) x total written premium, rounded to cents for FL / NY, otherwise whole dollars
 * Rated driver:    youngest driver under table:YouthfulDriverAge, otherwise the driver with the highest % use
 *
 * Rate tables live in test-data/rating/pa-rate-book.json; edit them to test a rate change.
 * All money returned by the engine is in cents so comparisons with the Quote screen are exact.
 */

// ---------- Types ----------

export type Level = "line" | "vehicle";
export type Rounding = "nearest" | "up" | "down";

export type RateBook = {
  settings: {
    ratedTermMonths: number;
    writtenPremiumRounding: Record<Level, Rounding>;
    taxRoundToCentsStates: string[];
    pipNJLiabilityValue: string;
  };
  vehicleTypes: Record<string, string>;
  coverages: Array<{ code: string; name: string; level: Level; routine: "standard" | "flat" | "pipNJ"; termCode?: string; secondTermCode?: string }>;
  tables: {
    baseRate: Array<{ coverage: string; state: string; zip: string; rate: number }>;
    coverageFactor: Array<{ coverage: string; term: string; value: string; state: string; factor: number }>;
    uwCompany: Array<{ code: string; name: string; state: string; factor: number }>;
    vehicleCost: Array<{ min: number | null; max: number | null; state: string; factor: number }>;
    vehicleType: Array<{ state: string; type: string; factor: number }>;
    driverAge: Array<{ min: number | null; max: number | null; factor: number }>;
    youthfulDriverAge: Array<{ state: string; age: number }>;
    minPremium: Array<{ coverage: string; amount: number }>;
    renewalCap: Array<{ coverage: string; min: number | null; max: number | null; amount: number | null; percent: number | null }>;
    stateTax: Array<{ state: string; rate: number }>;
  };
};

/** One coverage as it appears in the test data (same shape the UI steps use). */
export type PolicyCoverage = {
  coverage: string;        // UI name, e.g. "Collision" (must exist in rateBook.coverages)
  selected: boolean;
  value?: string;          // limit / deductible / package picked in the UI, e.g. "25/50/25", "10,000", "500"
  ratingValue?: string;    // rate-book term value when it differs from the UI text (default: value without commas)
  secondValue?: string;    // 2nd rated term value (Liability Full / Limited Tort: "full" | "limited"); blank = factor 1
  priorTermAmount?: number; // renewal only, vehicle-level: prior term amount for the renewal cap
  note?: string;
};

/** Everything the engine needs to rate one policy. */
export type PolicyRatingInput = {
  state: string;            // "California" or "CA"
  garagingZip: string;
  uwCompany: string;        // UW company name as in the UI, e.g. "Acme Medium Hazard Insurance"
  effectiveDate: string;    // MM/DD/YYYY
  expirationDate: string;   // MM/DD/YYYY
  transactionType?: "New Business" | "Renewal";
  multiCarDiscount?: number; // 1 for a single vehicle
  vehicleType: string;      // "Passenger/Light Truck" (or a type code such as "auto")
  vehicleCost: number;      // whole dollars
  drivers: Array<{ name: string; age: number; percent: string | number }>;
  coverages: PolicyCoverage[];
};

export type RatedCoverage = {
  coverage: string;   // UI name
  quoteName: string;  // row name on the Quote screen ("<coverage> Coverage")
  code: string;
  level: Level;
  status: "Rated" | "Not selected" | string; // or "No base rate for XX"
  factors: Record<string, number>;
  adjustedRate: number;
  termAmount: number;     // cents
  writtenPremium: number; // cents
  explanation: string;
};

export type RatingResult = {
  coverages: RatedCoverage[];        // every coverage in the input, including unselected ones
  rated: RatedCoverage[];            // only coverages that carry a premium
  totalPremium: number;              // cents
  taxRate: number;
  taxes: number;                     // cents
  totalCost: number;                 // cents
  policyDays: number;
  ratedTermDays: number;
  proRataFactor: number;
  ratedDriver: { name: string; age: number; rule: string } | null;
  policyFactors: Record<string, number | string>;
  explanation: string[];             // human-readable build-up, one line per step
};

// ---------- Rate book ----------

export const DEFAULT_RATE_BOOK_PATH = path.join(__dirname, "..", "test-data", "rating", "pa-rate-book.json");

export function loadRateBook(file = DEFAULT_RATE_BOOK_PATH): RateBook {
  return JSON.parse(readFileSync(file, "utf8"));
}

// ---------- Helpers ----------

const STATE_CODES: Record<string, string> = {
  Alabama: "AL", Alaska: "AK", Arizona: "AZ", Arkansas: "AR", California: "CA", Colorado: "CO", Connecticut: "CT", Delaware: "DE",
  "District of Columbia": "DC", Florida: "FL", Georgia: "GA", Hawaii: "HI", Idaho: "ID", Illinois: "IL", Indiana: "IN", Iowa: "IA",
  Kansas: "KS", Kentucky: "KY", Louisiana: "LA", Maine: "ME", Maryland: "MD", Massachusetts: "MA", Michigan: "MI", Minnesota: "MN",
  Mississippi: "MS", Missouri: "MO", Montana: "MT", Nebraska: "NE", Nevada: "NV", "New Hampshire": "NH", "New Jersey": "NJ",
  "New Mexico": "NM", "New York": "NY", "North Carolina": "NC", "North Dakota": "ND", Ohio: "OH", Oklahoma: "OK", Oregon: "OR",
  Pennsylvania: "PA", "Rhode Island": "RI", "South Carolina": "SC", "South Dakota": "SD", Tennessee: "TN", Texas: "TX", Utah: "UT",
  Vermont: "VT", Virginia: "VA", Washington: "WA", "West Virginia": "WV", Wisconsin: "WI", Wyoming: "WY",
};
export const toStateCode = (state: string): string => {
  if (/^[A-Z]{2}$/.test(state)) return state;
  const code = STATE_CODES[state];
  if (!code) throw new Error(`Unknown state "${state}"`);
  return code;
};

// Strip floating-point noise (Excel works to 15 significant digits) before rounding, so 106.875000000001 rounds like 106.875
const clean = (x: number) => Math.round(x * 1e9) / 1e9;
export const roundTo = (x: number, decimals: number, mode: Rounding = "nearest"): number => {
  const f = 10 ** decimals;
  const v = clean(x * f);
  const r = mode === "up" ? Math.ceil(v) : mode === "down" ? Math.floor(v) : Math.sign(v) * Math.floor(Math.abs(v) + 0.5);
  return r / f;
};
const cents = (dollars: number) => Math.round(dollars * 100);
const fmt = (n: number, d = 3) => String(Number(n.toFixed(d)));
const usd = (c: number) => `$${(c / 100).toLocaleString("en-US", { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`;

const parseDate = (mdy: string): Date => {
  const [m, d, y] = mdy.split("/").map(Number);
  return new Date(Date.UTC(y, m - 1, d));
};
const DAY = 86_400_000;
const addMonths = (date: Date, months: number): Date => {
  // Excel EDATE: same day-of-month, clipped to the end of the target month
  const y = date.getUTCFullYear(), m = date.getUTCMonth() + months, d = date.getUTCDate();
  const last = new Date(Date.UTC(y, m + 1, 0)).getUTCDate();
  return new Date(Date.UTC(y, m, Math.min(d, last)));
};

/**
 * PolicyCenter table lookup: each key is [rowValue, inputValue, weight]. A blank row value is a wildcard;
 * a non-blank one must equal the input. The matching row with the highest total weight wins (first one on a tie).
 * Extra predicates (ranges) must all hold.
 */
function lookup<T>(rows: T[], keys: (row: T) => Array<[string, string, number]>, extra?: (row: T) => boolean): T | undefined {
  let best: T | undefined;
  let bestScore = -1;
  for (const row of rows) {
    if (extra && !extra(row)) continue;
    let score = 0;
    let ok = true;
    for (const [rowValue, input, weight] of keys(row)) {
      if (rowValue === "") continue;
      if (rowValue !== input) { ok = false; break; }
      score += weight;
    }
    if (ok && score > bestScore) { best = row; bestScore = score; }
  }
  return best;
}
const inRange = (value: number, min: number | null, max: number | null, maxExclusive = false) =>
  (min === null || value >= min) && (max === null || (maxExclusive ? value < max : value <= max));

// ---------- Engine ----------

export function ratePolicy(input: PolicyRatingInput, rateBook: RateBook = loadRateBook()): RatingResult {
  const t = rateBook.tables;
  const s = rateBook.settings;
  const state = toStateCode(input.state);
  const zip = String(input.garagingZip);
  const vehType = rateBook.vehicleTypes[input.vehicleType] ?? input.vehicleType;
  const renewal = input.transactionType === "Renewal";

  const need = <T>(value: T | undefined, what: string): T => {
    if (value === undefined) throw new Error(`Rate book: no ${what} row matches this policy`);
    return value;
  };

  // A. Policy-level factors
  const uwRow = need(t.uwCompany.find(r => r.name === input.uwCompany || r.code === input.uwCompany), `UW company "${input.uwCompany}"`);
  const uwFactor = need(lookup(t.uwCompany, r => [[r.code, uwRow.code, 10], [r.state, state, 1]]), "UWCompanyFactor").factor;
  const multiCar = input.multiCarDiscount ?? 1;
  const vcFactor = need(lookup(t.vehicleCost, r => [[r.state, state, 1]], r => inRange(input.vehicleCost, r.min, r.max)), `VehicleCostFactor for $${input.vehicleCost}`).factor;
  const vtFactor = need(lookup(t.vehicleType, r => [[r.state, state, 10], [r.type, vehType, 1]]), "VehicleTypeFactor").factor;
  const minVehicleFactor = Math.min(vcFactor, vtFactor);

  // Rated driver: youngest youthful driver, otherwise highest % use
  const youthfulAge = need(lookup(t.youthfulDriverAge, r => [[r.state, state, 1]]), "YouthfulDriverAge").age;
  const drivers = input.drivers.filter(d => d.name && Number.isFinite(d.age));
  let ratedDriver: RatingResult["ratedDriver"] = null;
  if (drivers.length) {
    const youthful = drivers.filter(d => d.age < youthfulAge);
    if (youthful.length) {
      const youngest = Math.min(...youthful.map(d => d.age));
      const d = drivers.find(x => x.age === youngest)!;
      ratedDriver = { name: d.name, age: d.age, rule: `youngest driver under ${youthfulAge}` };
    } else {
      const pct = (d: { percent: string | number }) => Number(d.percent);
      const max = Math.max(...drivers.map(pct));
      const d = drivers.find(x => pct(x) === max)!;
      ratedDriver = { name: d.name, age: d.age, rule: "highest % use (no youthful driver)" };
    }
  }
  const driverAgeFactor = ratedDriver
    ? need(lookup(t.driverAge, () => [], r => inRange(ratedDriver!.age, r.min, r.max)), `DriverAgeFactor for age ${ratedDriver.age}`).factor
    : NaN;

  const eff = parseDate(input.effectiveDate);
  const exp = parseDate(input.expirationDate);
  const policyDays = Math.round((exp.getTime() - eff.getTime()) / DAY);
  const ratedTermDays = Math.round((addMonths(eff, s.ratedTermMonths).getTime() - eff.getTime()) / DAY);
  const proRata = policyDays / ratedTermDays;

  const baseRateFor = (code: string, jurisdiction = state) =>
    lookup(t.baseRate, r => [[r.coverage, code, 100], [r.state, jurisdiction, 10], [r.zip, zip, 1]])?.rate;
  const coverageFactorFor = (code: string, term: string, value: string, jurisdiction = state) =>
    lookup(t.coverageFactor, r => [[r.coverage, code, 1000], [r.term, term, 100], [r.value, value, 10], [r.state, jurisdiction, 1]])?.factor;

  // B-D. Coverages
  const coverages: RatedCoverage[] = input.coverages.map(c => {
    const def = rateBook.coverages.find(d => d.name === c.coverage || d.code === c.coverage);
    if (!def) throw new Error(`Rate book: unknown coverage "${c.coverage}" (add it to coverages in pa-rate-book.json)`);
    const base: RatedCoverage = {
      coverage: def.name, quoteName: `${def.name} Coverage`, code: def.code, level: def.level,
      status: "Not selected", factors: {}, adjustedRate: 0, termAmount: 0, writtenPremium: 0, explanation: "not selected",
    };
    if (!c.selected) return base;

    // PIP New Jersey (pa_pip_nj_basic_rr)
    if (def.routine === "pipNJ") {
      if (state !== "NJ") return { ...base, status: "NJ only - not rated", explanation: "NJ only - not rated" };
      const liabBase = need(baseRateFor("PALiabilityCov"), "BaseRate for PALiabilityCov");
      const liab100K = need(coverageFactorFor("PALiabilityCov", "PALiability", s.pipNJLiabilityValue, "NJ"), "Liability 100K factor");
      const pipFactor = need(baseRateFor(def.code, "NJ"), "BaseRate for PAPIP_NJ");
      const secondary = need(coverageFactorFor(def.code, def.termCode!, c.ratingValue ?? c.value ?? "false", "NJ"), "PIP NJ secondary factor");
      const adjusted = liabBase * liab100K * pipFactor * secondary;
      const term = roundTo(adjusted, 2);
      const written = roundTo(term * proRata, 0);
      return {
        ...base, status: "Rated", factors: { liabBase, liab100K, pipFactor, secondary }, adjustedRate: adjusted,
        termAmount: cents(term), writtenPremium: cents(written),
        explanation: `${fmt(liabBase)} × ${fmt(liab100K)} × ${fmt(pipFactor)} × ${fmt(secondary)} = ${fmt(adjusted, 4)} → term ${usd(cents(term))} × ${policyDays}/${ratedTermDays} → ${usd(cents(written))}`,
      };
    }

    const rate = baseRateFor(def.code);
    if (rate === undefined) return { ...base, status: `No base rate for ${state}`, explanation: `no base rate for ${state} - $0` };

    // Mexico Coverage - Limited (pa_cov_flatrate_rr)
    if (def.routine === "flat") {
      const term = roundTo(rate, 0);
      return {
        ...base, status: "Rated", factors: { baseRate: rate }, adjustedRate: rate, termAmount: cents(term), writtenPremium: cents(term),
        explanation: `flat base rate ${fmt(rate)} → ${usd(cents(term))} (not prorated)`,
      };
    }

    // Standard routines
    const baseRate = roundTo(rate, 3);
    // No rated term (e.g. Rental, Towing): blank term and value, so only the coverage's own or the countrywide default row matches
    const termValue = def.termCode ? (c.ratingValue ?? (c.value ?? "").replace(/,/g, "")) : "";
    const covFactor = need(coverageFactorFor(def.code, def.termCode ?? "", termValue), `CoverageFactor for ${def.code} ${termValue}`);
    const secondFactor = def.secondTermCode ? need(coverageFactorFor(def.code, def.secondTermCode, c.secondValue ?? ""), `2nd term factor for ${def.code}`) : 1;
    const ageFactor = def.level === "vehicle" ? driverAgeFactor : 1;
    if (!Number.isFinite(ageFactor)) throw new Error("Rating: enter at least one driver with an age (needed for the driver age factor)");
    const adjusted = baseRate * covFactor * secondFactor * uwFactor * multiCar * minVehicleFactor * ageFactor;

    const minPremium = lookup(t.minPremium, r => [[r.coverage, def.code, 1]])?.amount;
    const minApplies = minPremium !== undefined && vehType === "other" && clean(adjusted) < minPremium;
    let term = minApplies ? roundTo(minPremium! / 10, 0, "up") * 10 : roundTo(adjusted, 0, def.level === "vehicle" ? "up" : "nearest");
    let capNote = "";
    if (renewal && def.level === "vehicle" && c.priorTermAmount !== undefined) {
      const cap = lookup(t.renewalCap, r => [[r.coverage, def.code, 1]], r => inRange(term, r.min, r.max, true));
      if (cap?.amount != null) { const capped = roundTo(Math.min(term, c.priorTermAmount + cap.amount), 0, "down"); capNote = ` capped (prior ${c.priorTermAmount} + $${cap.amount}) → ${capped}`; term = capped; }
      else if (cap?.percent != null) { const capped = roundTo(Math.min(term, c.priorTermAmount * (1 + cap.percent / 100)), 0, "down"); capNote = ` capped (prior ${c.priorTermAmount} + ${cap.percent}%) → ${capped}`; term = capped; }
    }
    const writtenRounding = s.writtenPremiumRounding[def.level];
    const written = roundTo(term * proRata, 0, writtenRounding);

    const factorText = [
      `base ${fmt(baseRate)}`, `cov ${fmt(covFactor)}`, ...(def.secondTermCode ? [`tort ${fmt(secondFactor)}`] : []),
      `UW ${fmt(uwFactor)}`, `multi-car ${fmt(multiCar)}`, `min(cost ${fmt(vcFactor)}, type ${fmt(vtFactor)})=${fmt(minVehicleFactor)}`,
      ...(def.level === "vehicle" ? [`age ${fmt(ageFactor)}`] : []),
    ].join(" × ");
    return {
      ...base, status: "Rated", adjustedRate: adjusted,
      factors: { baseRate, coverageFactor: covFactor, secondTermFactor: secondFactor, uwFactor, multiCar, minVehicleFactor, driverAgeFactor: ageFactor },
      termAmount: cents(term), writtenPremium: cents(written),
      explanation: `${factorText} = ${fmt(adjusted, 4)} → term ${usd(cents(term))}` +
        (minApplies ? ` (minimum premium ${minPremium})` : ` (${def.level === "vehicle" ? "rounded up" : "nearest dollar"})`) + capNote +
        ` × ${policyDays}/${ratedTermDays} = ${fmt(term * proRata, 2)} → ${usd(cents(written))} (${writtenRounding === "up" ? "rounded up" : writtenRounding === "down" ? "rounded down" : "nearest dollar"})`,
    };
  });

  // E. Totals and state tax
  const rated = coverages.filter(c => c.status === "Rated" && c.writtenPremium > 0);
  const totalPremium = rated.reduce((sum, c) => sum + c.writtenPremium, 0);
  const taxRate = need(lookup(t.stateTax, r => [[r.state, state, 1]]), "PAStateTax").rate;
  const taxDecimals = s.taxRoundToCentsStates.includes(state) ? 2 : 0;
  const taxes = cents(roundTo(taxRate * (totalPremium / 100), taxDecimals));
  const totalCost = totalPremium + taxes;

  const policyFactors = {
    state, garagingZip: zip, uwCompanyCode: uwRow.code, uwFactor, multiCar, vehicleType: vehType,
    vehicleCostFactor: vcFactor, vehicleTypeFactor: vtFactor, minVehicleFactor, driverAgeFactor,
  };
  const explanation = [
    `Policy: ${state} ${zip}, ${input.uwCompany} (UW ${fmt(uwFactor)}), vehicle ${vehType} $${input.vehicleCost} → cost ${fmt(vcFactor)} / type ${fmt(vtFactor)} → min ${fmt(minVehicleFactor)}`,
    `Rated driver: ${ratedDriver ? `${ratedDriver.name}, age ${ratedDriver.age} (${ratedDriver.rule}) → driver age factor ${fmt(driverAgeFactor)}` : "none"}`,
    `Pro-rata: ${policyDays} policy days / ${ratedTermDays} days in the ${s.ratedTermMonths}-month rated term = ${fmt(proRata, 4)}`,
    ...rated.map(c => `${c.quoteName}: ${c.explanation}`),
    ...coverages.filter(c => c.status !== "Rated" && c.status !== "Not selected").map(c => `${c.quoteName}: ${c.status} ($0)`),
    `Total Premium = ${rated.map(c => (c.writtenPremium / 100).toFixed(0)).join(" + ")} = ${usd(totalPremium)}`,
    `Taxes & Surcharges = ${fmt(taxRate * 100, 4)}% × ${usd(totalPremium)} = ${fmt(taxRate * totalPremium / 100, 4)} → ${usd(taxes)}`,
    `Total Cost = ${usd(totalPremium)} + ${usd(taxes)} = ${usd(totalCost)}`,
  ];

  return { coverages, rated, totalPremium, taxRate, taxes, totalCost, policyDays, ratedTermDays, proRataFactor: proRata, ratedDriver, policyFactors, explanation };
}

/** Applies edit changes (by coverage name) to a coverage list: a change replaces the matching coverage's fields, or is added. */
export function applyCoverageChanges(coverages: PolicyCoverage[], changes: PolicyCoverage[]): PolicyCoverage[] {
  const result = coverages.map(c => ({ ...c }));
  for (const change of changes) {
    const i = result.findIndex(c => c.coverage === change.coverage);
    if (i >= 0) result[i] = { ...result[i], ...change };
    else result.push({ ...change });
  }
  return result;
}

/** Coverage level (line / vehicle) from the rate book, used to drive the UI step for a coverage. */
export function coverageLevel(coverage: string, rateBook: RateBook = loadRateBook()): Level {
  const def = rateBook.coverages.find(d => d.name === coverage || d.code === coverage);
  if (!def) throw new Error(`Rate book: unknown coverage "${coverage}"`);
  return def.level;
}
