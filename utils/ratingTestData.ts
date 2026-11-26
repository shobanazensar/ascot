import { readFileSync } from "fs";
import path from "path";
import { PolicyCoverage, PolicyRatingInput } from "./paRatingEngine";

// Shape of test-data/tc00010-rating-policies.json

export type TestDriver = {
  type: "existing" | "new"; name: string; age: number; percent: string;
  firstName?: string; lastName?: string; dateOfBirth?: string; licenseNumber?: string; licenseState?: string;
  yearFirstLicensed?: string; addressLine1?: string; city?: string; state?: string; zip?: string; addressType?: string;
};

export type TestPolicy = {
  id: string;
  title: string;
  enabled?: boolean;
  policy: { termType: string; effectiveDate: string; expirationDate: string; uwCompany: string; state: string };
  rating: { garagingZip: string; vehicleType: string; transactionType?: "New Business" | "Renewal"; multiCarDiscount?: number };
  drivers: TestDriver[];
  vehicle: {
    vin: string; year: string; make: string; model: string; costNew: string; licenseState: string;
    garagedAt: string; primaryUse: string; passiveRestraint: string; antiTheft: string;
  };
  coverages: PolicyCoverage[];
  edit?: { description: string; changes: PolicyCoverage[] };
};

export type RatingPoliciesFile = {
  testCaseId: string;
  presentation: { enabled: boolean; typingDelayMs: number; pauseAfterInputMs: number; pauseAfterValidationMs: number };
  policies: TestPolicy[];
};

export const RATING_POLICIES_PATH = path.join(__dirname, "..", "test-data", "tc00010-rating-policies.json");

/** Loads the policies file (override with RATING_POLICIES=<path>) and returns it with only the enabled policies. */
export function loadRatingPolicies(file = process.env.RATING_POLICIES || RATING_POLICIES_PATH): RatingPoliciesFile {
  const data: RatingPoliciesFile = JSON.parse(readFileSync(path.resolve(file), "utf8"));
  const ids = data.policies.map(p => p.id);
  const duplicate = ids.find((id, i) => ids.indexOf(id) !== i);
  if (duplicate) throw new Error(`${file}: policy id "${duplicate}" is used more than once`);
  return { ...data, policies: data.policies.filter(p => p.enabled !== false) };
}

/** Rating engine input for a test policy, with an optional coverage list (e.g. after an edit). */
export function toRatingInput(p: TestPolicy, coverages: PolicyCoverage[] = p.coverages): PolicyRatingInput {
  return {
    state: p.policy.state,
    garagingZip: p.rating.garagingZip,
    uwCompany: p.policy.uwCompany,
    effectiveDate: p.policy.effectiveDate,
    expirationDate: p.policy.expirationDate,
    transactionType: p.rating.transactionType,
    multiCarDiscount: p.rating.multiCarDiscount,
    vehicleType: p.rating.vehicleType,
    vehicleCost: Number(String(p.vehicle.costNew).replace(/[$,]/g, "")),
    drivers: p.drivers.map(d => ({ name: d.name, age: d.age, percent: d.percent })),
    coverages,
  };
}
