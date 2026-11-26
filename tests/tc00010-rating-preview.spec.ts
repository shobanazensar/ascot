import { test, expect } from "@playwright/test";
import { applyCoverageChanges, loadRateBook, ratePolicy, RatingResult } from "../utils/paRatingEngine";
import { loadRatingPolicies, toRatingInput } from "../utils/ratingTestData";

// TC00010 - rating preview (no browser, no PolicyCenter)
// Rates every enabled policy in test-data/tc00010-rating-policies.json with the rate book in test-data/rating/pa-rate-book.json
// and prints the step-by-step build-up of every premium, the Total Premium, Taxes & Surcharges and the Total Cost
// (initial quote and after the edit). Use it to see what a data or rate change does before running the UI test.
//
// Run:  npm run rating:preview

const rateBook = loadRateBook();
const data = loadRatingPolicies();
const money = (cents: number) =>
  `${cents < 0 ? "-" : ""}$${(Math.abs(cents) / 100).toLocaleString("en-US", { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`;

const print = (heading: string, r: RatingResult) => [`--- ${heading}`, ...r.explanation.map(l => `  ${l}`)].join("\n");

test.describe("TC00010 rating preview", () => {
  for (const policy of data.policies) {
    test(`${policy.id}: ${policy.title}`, async ({}, testInfo) => {
      const initial = ratePolicy(toRatingInput(policy), rateBook);
      const blocks = [print("Initial quote", initial)];

      // The rating is internally consistent
      expect(initial.totalPremium).toBe(initial.rated.reduce((s, c) => s + c.writtenPremium, 0));
      expect(initial.totalCost).toBe(initial.totalPremium + initial.taxes);

      if (policy.edit) {
        const edited = ratePolicy(toRatingInput(policy, applyCoverageChanges(policy.coverages, policy.edit.changes)), rateBook);
        blocks.push(print(`After edit: ${policy.edit.description}`, edited));
        blocks.push(`--- Edit impact\n  Total Premium ${money(initial.totalPremium)} → ${money(edited.totalPremium)}, ` +
          `Taxes ${money(initial.taxes)} → ${money(edited.taxes)}, Total Cost ${money(initial.totalCost)} → ${money(edited.totalCost)} ` +
          `(change ${money(edited.totalCost - initial.totalCost)})`);
        expect(edited.totalCost).toBe(edited.totalPremium + edited.taxes);
      }

      const report = `${policy.id}: ${policy.title}\n${blocks.join("\n")}`;
      console.log(`\n${report}\n`);
      await testInfo.attach(`${policy.id} - expected rating`, { body: report, contentType: "text/plain" });
    });
  }
});
