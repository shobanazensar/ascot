import { test, expect } from "../fixtures/testFixtures";
import { readFileSync } from "fs";
import path from "path";
import { PolicycenterPage } from "../pages/PolicycenterPage";

// TC00010 - Personal Auto rating
// Creates a Personal Auto submission from the test data, quotes it and validates every coverage premium, the Total Premium,
// Taxes & Surcharges and the Total Cost. Then edits the policy transaction (removes the coverages listed in edit.changes),
// re-quotes and validates that the Total Cost is correctly reflected after the edit.
//
// Test data:   test-data/tc00010-rating.json (inputs and expected amounts, from PA_Rating_Actuarial_Calculator_v2.xlsx)
// Demo run:    npm run test:rating:demo   (headed; values are typed key by key and each validation is shown on screen)
// Fast run:    PRESENTATION=off npx playwright test tests/tc00010-rating.spec.ts

// PolicyCenter application URL (override with the POLICYCENTER_URL environment variable)
const POLICYCENTER_URL = process.env.POLICYCENTER_URL || "https://pc-dev-gwcpdev.zensar.zeta1-andromeda.guidewire.net/PolicyCenter.do";

type CoverageInput = { coverage: string; level: "line" | "vehicle"; selected: boolean; value?: string; note?: string };
type ExpectedQuote = {
  totalPremium: number;
  taxes: number;
  totalCost: number;
  removedCoverages?: string[];
  coverages: Record<string, { termAmount: number; premium: number }>;
};
type RatingData = {
  testCaseId: string;
  presentation: { enabled: boolean; typingDelayMs: number; pauseAfterInputMs: number; pauseAfterValidationMs: number };
  policy: { termType: string; effectiveDate: string; uwCompany: string; state: string };
  drivers: Array<{
    type: "existing" | "new"; name: string; age: number; percent: string;
    firstName?: string; lastName?: string; dateOfBirth?: string; licenseNumber?: string; licenseState?: string;
    yearFirstLicensed?: string; addressLine1?: string; city?: string; state?: string; zip?: string; addressType?: string;
  }>;
  vehicle: {
    vin: string; year: string; make: string; model: string; costNew: string; licenseState: string;
    garagedAt: string; primaryUse: string; passiveRestraint: string; antiTheft: string;
  };
  coverages: CoverageInput[];
  initialQuote: { description: string; expected: ExpectedQuote };
  edit: { description: string; changes: CoverageInput[]; expected: ExpectedQuote };
};

const data: RatingData = JSON.parse(readFileSync(path.join(__dirname, "..", "test-data", "tc00010-rating.json"), "utf8"));
const credentials: { username: string; password: string } =
  JSON.parse(readFileSync(path.join(__dirname, "..", "test-data", "credentials.json"), "utf8"));

const toCents = (dollars: number) => Math.round(dollars * 100);
const money = (cents: number) => `$${(cents / 100).toLocaleString("en-US", { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`;
const mark = (ok: boolean) => (ok ? "✔" : "✘");

test.describe("TC00010 - Personal Auto rating", () => {
  test("TC00010_PA_Rating: quote, edit and re-quote, validating the total cost", async ({ page, logger }, testInfo) => {
    const presentation = { ...data.presentation, enabled: data.presentation.enabled && process.env.PRESENTATION !== "off" };
    test.setTimeout(presentation.enabled ? 900_000 : 300_000);

    const pc = new PolicycenterPage(page);
    pc.setPresentation(presentation);
    let step = 0;

    // PolicyCenter raises browser confirm() dialogs (Special Approve, Edit Policy Transaction); answer OK
    page.on("dialog", dialog => dialog.accept());

    // Reads the Quote screen, shows and logs every value against the expected one, and asserts it.
    // Returns the quote (in cents) so the edit can be compared with the initial quote.
    const validateQuote = async (label: string, expected: ExpectedQuote) => {
      await pc.openQuoteScreen();
      const totals = await pc.getQuoteTotals();

      // 1. Each coverage: 6-month term amount and written premium
      const coverageLines: string[] = [];
      let sumOfPremiums = 0;
      for (const [coverage, exp] of Object.entries(expected.coverages)) {
        const actual = await pc.getCoverageAmounts(coverage);
        sumOfPremiums += actual.premium;
        const ok = actual.termAmount === toCents(exp.termAmount) && actual.premium === toCents(exp.premium);
        const line = `${mark(ok)} ${coverage}: term ${money(actual.termAmount)} → premium ${money(actual.premium)}` +
          (ok ? "" : `  (expected ${money(toCents(exp.termAmount))} → ${money(toCents(exp.premium))})`);
        coverageLines.push(line);
        logger.step(++step, `${label} | ${line}`);
        expect.soft(actual.termAmount, `${label}: ${coverage} term amount`).toBe(toCents(exp.termAmount));
        expect.soft(actual.premium, `${label}: ${coverage} written premium`).toBe(toCents(exp.premium));
      }
      for (const coverage of expected.removedCoverages || []) {
        const stillThere = (await pc.findCoverageAmounts(coverage)) !== null;
        const line = `${mark(!stillThere)} ${coverage}: ${stillThere ? "still on the quote" : "removed"}`;
        coverageLines.push(line);
        logger.step(++step, `${label} | ${line}`);
        expect.soft(stillThere, `${label}: ${coverage} should no longer be on the quote`).toBe(false);
      }
      const coveragesOk = coverageLines.every(l => l.startsWith("✔"));
      await pc.showValidation(`${label}: coverage premiums`, coverageLines, coveragesOk);

      // 2. Totals: Total Premium = sum of coverage premiums, Total Cost = Total Premium + Taxes, and each equals the expected value
      const checks = [
        { name: "Total Premium", actual: totals.totalPremium, expected: toCents(expected.totalPremium) },
        { name: "Taxes & Surcharges", actual: totals.taxes, expected: toCents(expected.taxes) },
        { name: "Total Cost", actual: totals.totalCost, expected: toCents(expected.totalCost) },
      ];
      const totalLines = checks.map(c => `${mark(c.actual === c.expected)} ${c.name}: ${money(c.actual)}  (expected ${money(c.expected)})`);
      const sumOk = sumOfPremiums === totals.totalPremium;
      const costOk = totals.totalCost === totals.totalPremium + totals.taxes;
      totalLines.push(`${mark(sumOk)} Sum of coverage premiums ${money(sumOfPremiums)} = Total Premium ${money(totals.totalPremium)}`);
      totalLines.push(`${mark(costOk)} Total Premium ${money(totals.totalPremium)} + Taxes ${money(totals.taxes)} = Total Cost ${money(totals.totalCost)}`);
      totalLines.forEach(l => logger.step(++step, `${label} | ${l}`));

      await pc.highlightQuoteTotals(true);
      await pc.showValidation(`${label}: total cost`, totalLines, totalLines.every(l => l.startsWith("✔")));
      await pc.highlightQuoteTotals(false);
      await pc.hideValidation();

      for (const c of checks) expect.soft(c.actual, `${label}: ${c.name}`).toBe(c.expected);
      expect.soft(sumOfPremiums, `${label}: sum of coverage premiums should equal Total Premium`).toBe(totals.totalPremium);
      expect.soft(totals.totalCost, `${label}: Total Cost should equal Total Premium + Taxes & Surcharges`).toBe(totals.totalPremium + totals.taxes);

      await testInfo.attach(`${label} - rating validation`, { body: [...coverageLines, "", ...totalLines].join("\n"), contentType: "text/plain" });
      return totals;
    };

    // ---------- Login and new Personal Auto submission ----------
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
    logger.step(++step, `Policy Info: ${data.policy.termType} term, effective ${data.policy.effectiveDate}, ${data.policy.uwCompany}`);
    await pc.setPolicyInfo(data.policy);
    await pc.clickNext();

    // ---------- Drivers ----------
    for (const [index, driver] of data.drivers.entries()) {
      if (driver.type === "existing") {
        logger.step(++step, `Drivers: Add > Existing Driver > ${driver.name} (age ${driver.age})`);
        await pc.addExistingDriver(driver.name);
      } else {
        logger.step(++step, `Drivers: Add > New Person > ${driver.name} (age ${driver.age})`);
        await pc.addNewPersonDriver(driver as Required<typeof driver>, index);
      }
    }
    logger.step(++step, "Drivers: Roles tab, 0 accidents and 0 violations for every driver");
    for (let i = 0; i < data.drivers.length; i++) await pc.setDriverNoAccidentsOrViolations(i);
    await pc.clickNextThroughWarning();

    // ---------- Vehicle ----------
    const v = data.vehicle;
    logger.step(++step, `Vehicle: ${v.year} ${v.make} ${v.model}, VIN ${v.vin}, Cost New ${v.costNew}, garaged at ${v.garagedAt}`);
    await pc.clickCreateVehicleButton();
    await pc.fillVehicleIdentity(v);
    await pc.selectLicenseState(v.licenseState);
    await pc.selectGaragedAt(v.garagedAt);
    await pc.fillCostNew(v.costNew);
    await pc.selectPrimaryUse(v.primaryUse);
    await pc.selectPassiveRestraintSystem(v.passiveRestraint);
    await pc.selectAntiTheftDiscount(v.antiTheft);
    logger.step(++step, `Assign drivers: ${data.drivers.map(d => `${d.name} ${d.percent}%`).join(", ")}`);
    await pc.assignDriversWithUsage(data.drivers);
    await pc.clickNextThroughWarning();

    // ---------- Coverages ----------
    for (const c of data.coverages) {
      logger.step(++step, `PA Coverages: ${c.selected ? "select" : "unselect"} ${c.coverage}${c.value ? ` = ${c.value}` : ""}${c.note ? ` (${c.note})` : ""}`);
      await pc.applyCoverage(c);
    }

    // ---------- Quote 1 ----------
    logger.step(++step, `Quote: ${data.initialQuote.description}`);
    await pc.quoteThroughWarning();
    await pc.approveUnderwritingIssuesIfAny();
    const initial = await validateQuote("Initial quote", data.initialQuote.expected);

    // ---------- Edit and re-quote ----------
    logger.step(++step, data.edit.description);
    await pc.editPolicyTransaction();
    await pc.openPACoverages();
    for (const c of data.edit.changes) {
      logger.step(++step, `PA Coverages: ${c.selected ? "select" : "unselect"} ${c.coverage}${c.value ? ` = ${c.value}` : ""}`);
      await pc.applyCoverage(c);
    }
    logger.step(++step, "Quote again after the edit");
    await pc.quoteThroughWarning();
    await pc.approveUnderwritingIssuesIfAny();
    const edited = await validateQuote("After edit", data.edit.expected);

    // ---------- Change caused by the edit ----------
    // The premium must drop by exactly the premium of the removed coverages, and the Total Cost by that plus the tax change
    const removedPremium = (data.edit.expected.removedCoverages || [])
      .reduce((sum, name) => sum + toCents(data.initialQuote.expected.coverages[name]?.premium ?? 0), 0);
    const premiumChange = initial.totalPremium - edited.totalPremium;
    const costChange = initial.totalCost - edited.totalCost;
    const taxChange = initial.taxes - edited.taxes;
    const changeLines = [
      `${mark(premiumChange === removedPremium)} Total Premium ${money(initial.totalPremium)} → ${money(edited.totalPremium)}: down ${money(premiumChange)} (removed coverage premium ${money(removedPremium)})`,
      `${mark(costChange === premiumChange + taxChange)} Total Cost ${money(initial.totalCost)} → ${money(edited.totalCost)}: down ${money(costChange)} = premium ${money(premiumChange)} + tax ${money(taxChange)}`,
    ];
    changeLines.forEach(l => logger.step(++step, `Edit impact | ${l}`));
    await pc.showValidation("Edit impact on the total cost", changeLines, changeLines.every(l => l.startsWith("✔")));
    await pc.hideValidation();
    await testInfo.attach("Edit impact", { body: changeLines.join("\n"), contentType: "text/plain" });
    expect.soft(premiumChange, "Total Premium should drop by the premium of the removed coverages").toBe(removedPremium);
    expect.soft(costChange, "Total Cost change should equal the premium change plus the tax change").toBe(premiumChange + taxChange);

    const submissionNumber = await pc.readSubmissionNumber().catch(() => "unknown");
    logger.step(++step, `Submission ${submissionNumber}: rating validated (left as a quoted submission, not issued)`);
    if (testInfo.errors.length === 0) logger.success("TC00010 rating validation completed");
  });
});
