import { test, expect } from "../fixtures/testFixtures";
import { readFileSync } from "fs";
import path from "path";
import { PolicycenterPage } from "../pages/PolicycenterPage";
import { applyCoverageChanges, coverageLevel, loadRateBook, ratePolicy, RatingResult } from "../utils/paRatingEngine";
import { loadRatingPolicies, toRatingInput } from "../utils/ratingTestData";

// TC00010 - Personal Auto rating, expected amounts calculated from the rate book
// One test per enabled policy in test-data/tc00010-rating-policies.json. For each policy: create a Personal Auto submission,
// quote it, and validate every coverage term amount and written premium, the Total Premium, Taxes & Surcharges and the Total
// Cost against the rating engine (utils/paRatingEngine.ts - a port of PA_Rating_Actuarial_Calculator_v2.xlsx), which rates the
// policy from base rate x coverage factor x UW company factor x multi-car x min(vehicle cost, vehicle type) x driver age factor
// using the tables in test-data/rating/pa-rate-book.json. Then apply the policy's edit, re-quote and validate again.
// Nothing expected is hard-coded: change the policy data or the rate book and the expected amounts follow.
//
// Preview expected amounts:  npm run rating:preview          (no browser)
// Fast run (all policies):   npm run test:rating:calc
// One policy:                npm run test:rating:calc -- -g "TC00010-02"
// Demo run (headed):         npm run test:rating:calc:demo

// PolicyCenter application URL (override with the POLICYCENTER_URL environment variable)
const POLICYCENTER_URL = process.env.POLICYCENTER_URL || "https://pc-dev-gwcpdev.zensar.zeta1-andromeda.guidewire.net/PolicyCenter.do";

const rateBook = loadRateBook();
const data = loadRatingPolicies();
const credentials: { username: string; password: string } =
  JSON.parse(readFileSync(path.join(__dirname, "..", "test-data", "credentials.json"), "utf8"));

const money = (cents: number) =>
  `${cents < 0 ? "-" : ""}$${(Math.abs(cents) / 100).toLocaleString("en-US", { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`;
const mark = (ok: boolean) => (ok ? "✔" : "✘");

test.describe("TC00010 - Personal Auto rating (calculated from the rate book)", () => {
  for (const policy of data.policies) {
    test(`${policy.id}: ${policy.title}`, async ({ page, logger }, testInfo) => {
      const presentation = { ...data.presentation, enabled: data.presentation.enabled && process.env.PRESENTATION !== "off" };
      test.setTimeout(presentation.enabled ? 900_000 : 300_000);

      // Expected amounts for this policy, before and after the edit
      const initialCoverages = policy.coverages;
      const editedCoverages = policy.edit ? applyCoverageChanges(initialCoverages, policy.edit.changes) : initialCoverages;
      const initialExpected = ratePolicy(toRatingInput(policy, initialCoverages), rateBook);
      const editExpected = ratePolicy(toRatingInput(policy, editedCoverages), rateBook);

      const pc = new PolicycenterPage(page);
      pc.setPresentation(presentation);
      let step = 0;

      // PolicyCenter raises browser confirm() dialogs (Special Approve, Edit Policy Transaction); answer OK
      page.on("dialog", dialog => dialog.accept());

      const reportCalculation = async (label: string, expected: RatingResult) => {
        expected.explanation.forEach(l => logger.step(++step, `${label} | calculated: ${l}`));
        await testInfo.attach(`${policy.id} ${label} - expected calculation`, { body: expected.explanation.join("\n"), contentType: "text/plain" });
      };

      // Reads the Quote screen, compares every value with the calculated one, and asserts it
      const validateQuote = async (label: string, expected: RatingResult, removedCoverages: string[] = []) => {
        await pc.openQuoteScreen();
        const totals = await pc.getQuoteTotals();

        // 1. Each rated coverage: 6-month term amount and written premium
        const coverageLines: string[] = [];
        let sumOfPremiums = 0;
        for (const exp of expected.rated) {
          const actual = await pc.getCoverageAmounts(exp.quoteName);
          sumOfPremiums += actual.premium;
          const ok = actual.termAmount === exp.termAmount && actual.premium === exp.writtenPremium;
          const line = `${mark(ok)} ${exp.quoteName}: term ${money(actual.termAmount)} → premium ${money(actual.premium)}` +
            (ok ? "" : `  (calculated ${money(exp.termAmount)} → ${money(exp.writtenPremium)})`);
          coverageLines.push(line);
          logger.step(++step, `${label} | ${line}`);
          expect.soft(actual.termAmount, `${label}: ${exp.quoteName} term amount`).toBe(exp.termAmount);
          expect.soft(actual.premium, `${label}: ${exp.quoteName} written premium`).toBe(exp.writtenPremium);
        }
        // Selected but not rated in this state (e.g. PIP Kentucky in CA): the engine gives $0
        for (const c of expected.coverages.filter(c => c.status !== "Rated" && c.status !== "Not selected")) {
          const line = `• ${c.quoteName}: ${c.status} - not expected on the quote`;
          coverageLines.push(line);
          logger.step(++step, `${label} | ${line}`);
        }
        for (const coverage of removedCoverages) {
          const stillThere = (await pc.findCoverageAmounts(coverage)) !== null;
          const line = `${mark(!stillThere)} ${coverage}: ${stillThere ? "still on the quote" : "removed"}`;
          coverageLines.push(line);
          logger.step(++step, `${label} | ${line}`);
          expect.soft(stillThere, `${label}: ${coverage} should no longer be on the quote`).toBe(false);
        }
        await pc.showValidation(`${policy.id} ${label}: coverage premiums`, coverageLines, !coverageLines.some(l => l.startsWith("✘")));

        // 2. Totals against the calculated values, plus the screen's own arithmetic
        const checks = [
          { name: "Total Premium", actual: totals.totalPremium, expected: expected.totalPremium },
          { name: "Taxes & Surcharges", actual: totals.taxes, expected: expected.taxes },
          { name: "Total Cost", actual: totals.totalCost, expected: expected.totalCost },
        ];
        const totalLines = checks.map(c => `${mark(c.actual === c.expected)} ${c.name}: ${money(c.actual)}  (calculated ${money(c.expected)})`);
        const sumOk = sumOfPremiums === totals.totalPremium;
        const costOk = totals.totalCost === totals.totalPremium + totals.taxes;
        totalLines.push(`${mark(sumOk)} Sum of coverage premiums ${money(sumOfPremiums)} = Total Premium ${money(totals.totalPremium)}`);
        totalLines.push(`${mark(costOk)} Total Premium ${money(totals.totalPremium)} + Taxes ${money(totals.taxes)} = Total Cost ${money(totals.totalCost)}`);
        totalLines.forEach(l => logger.step(++step, `${label} | ${l}`));

        await pc.highlightQuoteTotals(true);
        await pc.showValidation(`${policy.id} ${label}: total cost`, totalLines, totalLines.every(l => l.startsWith("✔")));
        await pc.highlightQuoteTotals(false);
        await pc.hideValidation();

        for (const c of checks) expect.soft(c.actual, `${label}: ${c.name}`).toBe(c.expected);
        expect.soft(sumOfPremiums, `${label}: sum of coverage premiums should equal Total Premium`).toBe(totals.totalPremium);
        expect.soft(totals.totalCost, `${label}: Total Cost should equal Total Premium + Taxes & Surcharges`).toBe(totals.totalPremium + totals.taxes);

        await testInfo.attach(`${policy.id} ${label} - rating validation`, { body: [...coverageLines, "", ...totalLines].join("\n"), contentType: "text/plain" });
        return totals;
      };

      // ---------- Login and new Personal Auto submission ----------
      logger.step(++step, `${policy.id}: ${policy.title}`);
      logger.step(++step, `Open PolicyCenter (${POLICYCENTER_URL}) and log in as ${credentials.username}`);
      await pc.goto(POLICYCENTER_URL);
      await pc.enterUsername(credentials.username);
      await pc.enterPassword(credentials.password);
      await pc.clickLogin();

      logger.step(++step, "Account menu > first account > Actions > New Submission > Personal Auto");
      await pc.openAccountMenu();
      await pc.selectFirstRecentAccount();
      await pc.openActions();
      await pc.chooseNewSubmission();
      await pc.selectPersonalAuto();
      await pc.clickNext();
      await pc.clickNext();

      // ---------- Policy Info ----------
      logger.step(++step, `Policy Info: ${policy.policy.termType} term, effective ${policy.policy.effectiveDate}, ${policy.policy.uwCompany}`);
      await pc.setPolicyInfo(policy.policy);
      await pc.clickNext();

      // ---------- Drivers ----------
      for (const [index, driver] of policy.drivers.entries()) {
        if (driver.type === "existing") {
          logger.step(++step, `Drivers: Add > Existing Driver > ${driver.name} (age ${driver.age})`);
          await pc.addExistingDriver(driver.name);
        } else {
          logger.step(++step, `Drivers: Add > New Person > ${driver.name} (age ${driver.age})`);
          await pc.addNewPersonDriver(driver as Required<typeof driver>, index);
        }
      }
      logger.step(++step, "Drivers: Roles tab, 0 accidents and 0 violations for every driver");
      for (let i = 0; i < policy.drivers.length; i++) await pc.setDriverNoAccidentsOrViolations(i);
      await pc.clickNextThroughWarning();

      // ---------- Vehicle ----------
      const v = policy.vehicle;
      logger.step(++step, `Vehicle: ${v.year} ${v.make} ${v.model}, VIN ${v.vin}, Cost New ${v.costNew}, garaged at ${v.garagedAt}`);
      await pc.clickCreateVehicleButton();
      await pc.fillVehicleIdentity(v);
      await pc.selectLicenseState(v.licenseState);
      await pc.selectGaragedAt(v.garagedAt);
      await pc.fillCostNew(v.costNew);
      await pc.selectPrimaryUse(v.primaryUse);
      await pc.selectPassiveRestraintSystem(v.passiveRestraint);
      await pc.selectAntiTheftDiscount(v.antiTheft);
      logger.step(++step, `Assign drivers: ${policy.drivers.map(d => `${d.name} ${d.percent}%`).join(", ")}`);
      await pc.assignDriversWithUsage(policy.drivers);
      await pc.clickNextThroughWarning();

      // ---------- Coverages ----------
      for (const c of initialCoverages) {
        logger.step(++step, `PA Coverages: ${c.selected ? "select" : "unselect"} ${c.coverage}${c.value ? ` = ${c.value}` : ""}${c.note ? ` (${c.note})` : ""}`);
        await pc.applyCoverage({ ...c, level: coverageLevel(c.coverage, rateBook) });
      }

      // ---------- Quote 1 ----------
      logger.step(++step, "Quote");
      await reportCalculation("Initial quote", initialExpected);
      await pc.quoteThroughWarning();
      await pc.approveUnderwritingIssuesIfAny();
      const initial = await validateQuote("Initial quote", initialExpected);

      // ---------- Edit and re-quote ----------
      if (policy.edit) {
        logger.step(++step, policy.edit.description);
        await pc.editPolicyTransaction();
        await pc.openPACoverages();
        for (const c of policy.edit.changes) {
          logger.step(++step, `PA Coverages: ${c.selected ? "select" : "unselect"} ${c.coverage}${c.value ? ` = ${c.value}` : ""}`);
          await pc.applyCoverage({ ...c, level: coverageLevel(c.coverage, rateBook) });
        }
        logger.step(++step, "Quote again after the edit");
        await reportCalculation("After edit", editExpected);
        await pc.quoteThroughWarning();
        await pc.approveUnderwritingIssuesIfAny();
        const ratedAfterEdit = new Set(editExpected.rated.map(c => c.quoteName));
        const removed = initialExpected.rated.map(c => c.quoteName).filter(name => !ratedAfterEdit.has(name));
        const edited = await validateQuote("After edit", editExpected, removed);

        // ---------- Change caused by the edit: actual change vs calculated change ----------
        const changes = [
          { name: "Total Premium", from: initial.totalPremium, to: edited.totalPremium, expected: editExpected.totalPremium - initialExpected.totalPremium },
          { name: "Taxes & Surcharges", from: initial.taxes, to: edited.taxes, expected: editExpected.taxes - initialExpected.taxes },
          { name: "Total Cost", from: initial.totalCost, to: edited.totalCost, expected: editExpected.totalCost - initialExpected.totalCost },
        ];
        const changeLines = changes.map(c =>
          `${mark(c.to - c.from === c.expected)} ${c.name} ${money(c.from)} → ${money(c.to)}: change ${money(c.to - c.from)} (calculated ${money(c.expected)})`);
        changeLines.forEach(l => logger.step(++step, `Edit impact | ${l}`));
        await pc.showValidation(`${policy.id} edit impact on the total cost`, changeLines, changeLines.every(l => l.startsWith("✔")));
        await pc.hideValidation();
        await testInfo.attach(`${policy.id} edit impact`, { body: changeLines.join("\n"), contentType: "text/plain" });
        for (const c of changes) expect.soft(c.to - c.from, `${c.name} change after the edit should match the calculated change`).toBe(c.expected);
      }

      const submissionNumber = await pc.readSubmissionNumber().catch(() => "unknown");
      logger.step(++step, `Submission ${submissionNumber}: rating validated (left as a quoted submission, not issued)`);
      if (testInfo.errors.length === 0) logger.success(`${policy.id} calculated rating validation completed`);
    });
  }
});
