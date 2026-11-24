import { test, expect } from "../fixtures/testFixtures";
import { existsSync, readFileSync } from 'fs';
import path from 'path';
import { saveCreatedPolicy } from "../utils/createdPolicy";
import { PolicycenterPage } from "../pages/PolicycenterPage";

// PolicyCenter application URL (override with the POLICYCENTER_URL environment variable).
// Always PolicyCenter: the shared qa-autopilot.config.json on this branch points at ClaimCenter, so it is not used here.
const POLICYCENTER_URL = process.env.POLICYCENTER_URL || "https://pc-dev-gwcpdev.zensar.zeta1-andromeda.guidewire.net/PolicyCenter.do";

const loadRuntimeConfig = (testCaseId: string) => {
  const cfgPath = path.join(process.cwd(), 'qa-autopilot.config.json');
  const credsPath = path.join(process.cwd(), 'test-data', 'credentials.json');
  const testDataPath = path.join(process.cwd(), 'test-data', 'test-data.json');
  let cfg: any = {};
  let creds: any = {};
  let allTestData: any = {};
  try {
    if (existsSync(cfgPath)) {
      cfg = JSON.parse(readFileSync(cfgPath, 'utf8')) || {};
    }
  } catch {
    cfg = {};
  }
  try {
    if (existsSync(credsPath)) {
      creds = JSON.parse(readFileSync(credsPath, 'utf8')) || {};
    }
  } catch {
    creds = {};
  }
  try {
    if (existsSync(testDataPath)) {
      allTestData = JSON.parse(readFileSync(testDataPath, 'utf8')) || {};
    }
  } catch {
    allTestData = {};
  }
  return {
    appUrl: process.env.AUTOPLAYPILOT_APP_URL || process.env.LOCATOR_APP_URL || cfg.appUrl || cfg.locatorAppUrl || cfg.url || "",
    username: process.env.AUTOPLAYPILOT_USERNAME || process.env.LOCATOR_USERNAME || creds.username || cfg.locatorUsername || cfg.username || "",
    password: process.env.AUTOPLAYPILOT_PASSWORD || process.env.LOCATOR_PASSWORD || creds.password || cfg.locatorPassword || cfg.password || "",
    testData: (testCaseId && allTestData[testCaseId]) || allTestData || {},
  };
};

// Inputs and expected results come from test-data/tc00010-rating.json (shared with tests/tc00010-rating.spec.ts),
// built from the "Personal Auto Rating Calculator - PA RTM Demo Rating (Edition 3)" sheet
const ratingData = JSON.parse(readFileSync(path.join(__dirname, '..', 'test-data', 'tc00010-rating.json'), 'utf8'));
const toCents = (dollars: number) => Math.round(dollars * 100);
const driverByType = (type: string) => ratingData.drivers.find((d: any) => d.type === type);
const rating = {
  policy: ratingData.policy,
  drivers: { john: driverByType('existing'), emma: driverByType('new') },
  vehicle: ratingData.vehicle,
  coverages: ratingData.coverages as { coverage: string; level: 'line' | 'vehicle'; selected: boolean; value?: string; note?: string }[],
  // Expected quote after Mexico is removed while every other coverage stays selected, in cents
  expectedAllCoverages: {
    totalPremium: toCents(ratingData.edit.expected.totalPremium),
    taxes: toCents(ratingData.edit.expected.taxes),
    totalCost: toCents(ratingData.edit.expected.totalCost),
    coverages: Object.fromEntries(Object.entries(ratingData.edit.expected.coverages as Record<string, { premium: number }>)
      .map(([name, c]) => [name, toCents(c.premium)])) as Record<string, number>,
  },
};

const dollars = (cents: number) => `$${(cents / 100).toFixed(2)}`;

// Single end-to-end test: login, pick first account, create a Personal Auto submission with the rating-sheet values, quote,
// validate the quote against the sheet and validate Forms before and after removing Mexico coverage
test.describe("Underwriter creates a Personal Auto submission from the first recent account", () => {
  test("TC_PolicyCenter_E2E", async ({ page, logger }) => {
    const runtimeConfig = loadRuntimeConfig("TC00001");
    const credentials = { username: "su", password: "gw" };
    const policycenterPage = new PolicycenterPage(page);
    let step = 0;

    // PolicyCenter raises browser confirm() dialogs (Special Approve, Edit Policy Transaction); answer OK
    page.on("dialog", dialog => dialog.accept());

    // Coverage shown on PA Coverages -> form that must be generated for it.
    // In California only the Mexico coverage has its own form (the NY-only PIP / Uninsured Motorists forms are not generated).
    const coverageForms = [
      { coverage: /Mexico Coverage - Limited/i, form: /LIMITED MEXICO COVERAGE/i },
    ];

    logger.step(++step, `Open PolicyCenter (${POLICYCENTER_URL}) and log in`);
    await policycenterPage.goto(POLICYCENTER_URL);
    await policycenterPage.enterUsername(credentials.username);
    await policycenterPage.enterPassword(credentials.password);
    await policycenterPage.clickLogin();

    logger.step(++step, 'Account menu > first account in the list');
    await policycenterPage.openAccountMenu();
    await policycenterPage.selectFirstRecentAccount();

    logger.step(++step, 'Actions > New Submission');
    await policycenterPage.openActions();
    await policycenterPage.chooseNewSubmission();

    logger.step(++step, 'Select Personal Auto product');
    await policycenterPage.selectPersonalAuto();

    logger.step(++step, 'Next on Offerings page');
    await policycenterPage.clickNext();
    logger.step(++step, 'Next on the following page');
    await policycenterPage.clickNext();

    logger.step(++step, `Policy Info: ${rating.policy.termType} term, effective ${rating.policy.effectiveDate}, ${rating.policy.uwCompany}`);
    await policycenterPage.setPolicyInfo({ termType: rating.policy.termType, effectiveDate: rating.policy.effectiveDate, uwCompany: rating.policy.uwCompany });
    await policycenterPage.clickNext();

    logger.step(++step, `Drivers page: Add > Existing Driver > ${rating.drivers.john.name} (age ${rating.drivers.john.age})`);
    await policycenterPage.addExistingDriver(rating.drivers.john.name);
    logger.step(++step, `Drivers page: Add > New Person > ${rating.drivers.emma.name} (age ${rating.drivers.emma.age})`);
    await policycenterPage.addNewPersonDriver(rating.drivers.emma, 1);
    logger.step(++step, 'Drivers page: Roles tab, 0 accidents and 0 violations for both drivers');
    await policycenterPage.setDriverNoAccidentsOrViolations(0);
    await policycenterPage.setDriverNoAccidentsOrViolations(1);
    logger.step(++step, 'Next to Vehicles page (click Next again if the driver license state warning appears)');
    await policycenterPage.clickNextThroughWarning();

    logger.step(++step, `Create Vehicle: ${rating.vehicle.year} ${rating.vehicle.make} ${rating.vehicle.model}, VIN ${rating.vehicle.vin}`);
    await policycenterPage.clickCreateVehicleButton();
    await policycenterPage.fillVehicleIdentity(rating.vehicle);
    logger.step(++step, `Vehicle: License State ${rating.vehicle.licenseState}, Garaged At ${rating.vehicle.garagedAt}, Cost New ${rating.vehicle.costNew}`);
    await policycenterPage.selectLicenseState(rating.vehicle.licenseState);
    await policycenterPage.selectGaragedAt(rating.vehicle.garagedAt);
    await policycenterPage.fillCostNew(rating.vehicle.costNew);
    await policycenterPage.selectPrimaryUse(rating.vehicle.primaryUse);
    await policycenterPage.selectPassiveRestraintSystem(rating.vehicle.passiveRestraint);
    await policycenterPage.selectAntiTheftDiscount(rating.vehicle.antiTheft);
    logger.step(++step, `Assign Drivers to Vehicles: ${rating.drivers.john.name} ${rating.drivers.john.percent}%, ${rating.drivers.emma.name} ${rating.drivers.emma.percent}%`);
    await policycenterPage.assignDriversWithUsage([rating.drivers.john, rating.drivers.emma]);

    logger.step(++step, 'Next to PA Coverages (click Next again if a warning appears)');
    await policycenterPage.clickNextThroughWarning();

    for (const c of rating.coverages) {
      logger.step(++step, `PA Coverages: ${c.selected ? 'select' : 'unselect'} ${c.coverage}${c.value ? ` = ${c.value}` : ''}${c.note ? ` (${c.note})` : ''}`);
      await policycenterPage.applyCoverage(c);
    }

    // Mexico Coverage is on by default and Towing and Labor is on: keep both for the first quote so their forms can be validated, then remove only Mexico
    logger.step(++step, 'Quote (click Quote again if a warning appears), Special Approve any underwriting issues');
    await policycenterPage.quoteThroughWarning();
    await policycenterPage.approveUnderwritingIssuesIfAny();

    logger.step(++step, 'Quote screen: Total Cost must equal Total Premium + Taxes & Surcharges');
    await policycenterPage.openQuoteScreen();
    const firstQuote = await policycenterPage.getQuoteTotals();
    logger.step(++step, `Quote with Mexico: Total Premium ${dollars(firstQuote.totalPremium)} + Taxes & Surcharges ${dollars(firstQuote.taxes)} = Total Cost ${dollars(firstQuote.totalCost)}`);
    expect(firstQuote.totalPremium, 'Total Premium should be greater than zero').toBeGreaterThan(0);
    expect(firstQuote.totalCost, 'Total Cost should equal Total Premium + Taxes & Surcharges').toBe(firstQuote.totalPremium + firstQuote.taxes);

    logger.step(++step, 'Forms: read the forms generated for the selected coverages');
    await policycenterPage.openForms();
    const formsBefore = await policycenterPage.getFormDescriptions();
    logger.step(++step, `Forms listed: ${formsBefore.join(', ')}`);
    expect(formsBefore.length, 'Forms page should list at least one form').toBeGreaterThan(0);
    expect(formsBefore.join('|'), 'Dec Sheet should be present').toMatch(/Dec Sheet/i);
    expect(formsBefore.join('|'), 'Towing and Labor Costs Coverage form should be present while Towing and Labor is selected').toMatch(/Towing and Labor/i);
    logger.step(++step, `Uninsured Motorists form present: ${formsBefore.some(f => /UNINSURED MOTORISTS/i.test(f))}`);

    logger.step(++step, 'PA Coverages: validate every selected coverage has its form');
    await policycenterPage.openPACoverages();
    const coverageTextBefore = await policycenterPage.getPACoverageText();
    expect(coverageTextBefore, 'Mexico Coverage should be selected before the edit').toMatch(/Mexico Coverage - Limited/i);
    for (const { coverage, form } of coverageForms) {
      const selected = coverage.test(coverageTextBefore);
      const hasForm = formsBefore.some(f => form.test(f));
      expect(hasForm, `Form ${form} presence should match coverage ${coverage} (selected=${selected})`).toBe(selected);
    }

    logger.step(++step, 'Edit Policy Transaction (OK on dialog) and unselect Mexico Coverage');
    await policycenterPage.editPolicyTransaction();
    await policycenterPage.setMexicoCoverage(false);

    logger.step(++step, 'Quote again (click Quote again if a warning appears), Special Approve any underwriting issues');
    await policycenterPage.quoteThroughWarning();
    await policycenterPage.approveUnderwritingIssuesIfAny();

    logger.step(++step, 'Quote screen: validate the premium (all coverages selected)');
    await policycenterPage.openQuoteScreen();
    const quote = await policycenterPage.getQuoteTotals();
    const exp = rating.expectedAllCoverages;
    logger.step(++step, `Total Premium ${dollars(quote.totalPremium)} + Taxes & Surcharges ${dollars(quote.taxes)} = Total Cost ${dollars(quote.totalCost)} (expected: ${dollars(exp.totalPremium)} + ${dollars(exp.taxes)} = ${dollars(exp.totalCost)})`);
    expect(quote.totalPremium, 'Total Premium should match the expected value').toBe(exp.totalPremium);
    expect(quote.taxes, 'Taxes & Surcharges should match the expected value').toBe(exp.taxes);
    expect(quote.totalCost, 'Total Cost should match the expected value').toBe(exp.totalCost);
    expect(quote.totalCost, 'Total Cost should equal Total Premium + Taxes & Surcharges').toBe(quote.totalPremium + quote.taxes);
    for (const [coverageName, expectedPremium] of Object.entries(exp.coverages)) {
      const premium = await policycenterPage.getCoveragePremium(coverageName);
      logger.step(++step, `${coverageName}: ${dollars(premium)} (expected: ${dollars(expectedPremium)})`);
      expect(premium, `${coverageName} premium should match the expected value`).toBe(expectedPremium);
    }

    logger.step(++step, 'Forms: validate only the Mexico form was removed');
    await policycenterPage.openForms();
    const formsAfter = await policycenterPage.getFormDescriptions();
    logger.step(++step, `Forms listed after removing Mexico: ${formsAfter.join(', ')}`);
    expect(formsAfter.some(f => /MEXICO/i.test(f)), 'Mexico form should no longer be listed').toBe(false);
    expect(formsAfter.some(f => /Towing and Labor/i.test(f)), 'Towing and Labor form should still be listed').toBe(true);
    expect(formsAfter.some(f => /Dec Sheet/i.test(f)), 'Dec Sheet should still be listed').toBe(true);
    expect(formsAfter.some(f => /PERSONAL AUTO POLICY/i.test(f)), 'Personal Auto Policy form should still be listed').toBe(true);
    expect(formsAfter.length, 'Only the Mexico form should have been removed').toBe(formsBefore.length - 1);

    // The submission number is shown on the wizard pages; read it now, it is used after the AppEvents check
    const submissionNumber = await policycenterPage.readSubmissionNumber();
    logger.step(++step, `Submission number: ${submissionNumber}`);

    logger.step(++step, 'Administration > Monitoring > Message Queues > AppEvents');
    await policycenterPage.openMessageQueues();
    await policycenterPage.openAppEventsDestination();

    logger.step(++step, 'Detailed Statistics: Accounts with any unfinished messages > first account');
    await policycenterPage.selectDetailedStatistics("Accounts with any unfinished messages");
    const accountNumber = await policycenterPage.openFirstUnfinishedAccount();
    logger.step(++step, `Opened account ${accountNumber}; open the AccountObjectsChanged message`);

    await policycenterPage.openMessageEvent("AccountObjectsChanged");
    const payloadText = await policycenterPage.getMessagePayload();
    logger.step(++step, `Message payload (first 200 chars): ${payloadText.slice(0, 200)}`);
    let payload: any;
    expect(() => { payload = JSON.parse(payloadText); }, 'Message payload should be valid JSON').not.toThrow();
    const events: any[] = Array.isArray(payload) ? payload : [payload];
    expect(events.length, 'Payload should contain at least one event').toBeGreaterThan(0);
    for (const event of events) {
      expect(event?.id, 'Every event should have an id').toBeTruthy();
      expect(event?.type, 'Every event should have a com.guidewire type').toMatch(/^com\.guidewire\./);
    }
    // Events such as AssignmentAdded legitimately carry data: null, and the first account in the queue varies, so only the field must exist
    for (const event of events) expect(event, 'Every event should have a data field').toHaveProperty('data');

    logger.step(++step, `Policy tab: search Sub # ${submissionNumber}`);
    await policycenterPage.searchSubmission(submissionNumber);

    logger.step(++step, 'Bind Options > Issue Policy, confirm the popup with OK');
    await policycenterPage.issuePolicy();

    logger.step(++step, 'Open "View Policy" and read the policy number');
    const policyNumber = await policycenterPage.viewIssuedPolicyAndReadNumber();
    logger.step(++step, `Policy number: ${policyNumber}`);
    expect(policyNumber, 'Policy number should be 10 digits').toMatch(/^\d{10}$/);
    saveCreatedPolicy({ policyNumber, submissionNumber, effectiveDate: rating.policy.effectiveDate });

    logger.success('Test completed successfully');
  });
});
