import { test, expect } from "../fixtures/testFixtures";
import { readFileSync } from 'fs';
import path from 'path';
import { saveCreatedPolicy } from "../utils/createdPolicy";
import { PolicycenterPage } from "../pages/PolicycenterPage";

// TC00011 Forms: same flow as tests/00-policycenter.spec.ts without the cost validation. It validates the Forms generated for
// Towing and Labor + Mexico Coverage, checks that the AppEvents message for the quote carries the same form descriptions,
// then removes both coverages, re-quotes and validates both forms are gone from the Forms screen and from the AppEvents message.
//
// Run:        npm run test:forms        (headless, presentation off)
// Demo run:   npm run test:forms:demo   (headed; values are typed key by key and each validation is shown in a banner)

// PolicyCenter application URL (override with the POLICYCENTER_URL environment variable)
const POLICYCENTER_URL = process.env.POLICYCENTER_URL || "https://pc-dev-gwcpdev.zensar.zeta1-andromeda.guidewire.net/PolicyCenter.do";
const CREDENTIALS = { username: process.env.PC_USERNAME || "su", password: process.env.PC_PASSWORD || "gw" };
// The account the submission is created on. It must have the existing driver from the test data (John Smith): TEST ACCOUNT does.
// Opened by number rather than "first recent account", because the recent list changes whenever anyone opens an account.
const ACCOUNT_NUMBER = process.env.PC_ACCOUNT_NUMBER || "3327200028";

// Submission inputs and presentation settings come from test-data/tc00010-rating.json (shared with the E2E and rating tests)
const ratingData = JSON.parse(readFileSync(path.join(__dirname, '..', 'test-data', 'tc00010-rating.json'), 'utf8'));
const driverByType = (type: string) => ratingData.drivers.find((d: any) => d.type === type);
const rating = {
  policy: ratingData.policy,
  drivers: { john: driverByType('existing'), emma: driverByType('new') },
  vehicle: ratingData.vehicle,
  coverages: ratingData.coverages as { coverage: string; level: 'line' | 'vehicle'; selected: boolean; value?: string; note?: string }[],
};

// The two coverages under test and the form each one generates
const COVERAGES_UNDER_TEST = [
  { coverage: "Towing and Labor", level: "vehicle" as const, form: /Towing and Labor/i },
  { coverage: "Mexico Coverage - Limited", level: "line" as const, form: /MEXICO/i },
];

// Every event in an AppEvents message payload has a "data" attribute holding a JSON string; form events carry the form
// name in data.description. Returns whether the payload is valid JSON, its event count and the descriptions found.
const readPayload = (payloadText: string): { validJson: boolean; eventCount: number; descriptions: string[] } => {
  let payload: any;
  try { payload = JSON.parse(payloadText); } catch { return { validJson: false, eventCount: 0, descriptions: [] }; }
  const events: any[] = Array.isArray(payload) ? payload : [payload];
  const descriptions: string[] = [];
  for (const event of events) {
    let data = event?.data;
    if (typeof data === 'string') {
      try { data = JSON.parse(data); } catch { continue; }
    }
    if (data && typeof data.description === 'string') descriptions.push(data.description.trim());
  }
  return { validJson: true, eventCount: events.length, descriptions };
};

type Check = { ok: boolean; text: string };
const mark = (ok: boolean) => (ok ? "✔" : "✘");

test.describe("Forms generated for Towing and Labor and Mexico Coverage, and their AppEvents messages", () => {
  test("TC00011_PA_Forms", async ({ page, logger }, testInfo) => {
    // Banners and highlights as in TC00010, but values are filled in one go rather than typed key by key
    const presentation = { ...ratingData.presentation, enabled: ratingData.presentation.enabled && process.env.PRESENTATION !== "off", typeKeyByKey: false };
    test.setTimeout(presentation.enabled ? 20 * 60_000 : 10 * 60_000); // two quotes and two AppEvents round trips on a slow dev server
    const policycenterPage = new PolicycenterPage(page);
    policycenterPage.setPresentation(presentation);
    let step = 0;

    // PolicyCenter raises browser confirm() dialogs (Special Approve, Edit Policy Transaction); answer OK
    page.on("dialog", dialog => dialog.accept());

    // Logs every check, shows them in the on-screen banner (presentation mode), attaches them to the report and asserts them.
    // Soft assertions, as in TC00010, so a demo keeps going and every banner is shown; the test still fails at the end.
    const validate = async (title: string, checks: Check[], highlight?: (on: boolean) => Promise<void>) => {
      const lines = checks.map(c => `${mark(c.ok)} ${c.text}`);
      lines.forEach(l => logger.step(++step, `${title} | ${l}`));
      await highlight?.(true);
      await policycenterPage.showValidation(title, lines, checks.every(c => c.ok));
      if (policycenterPage.presentationEnabled) {
        await testInfo.attach(`${title} - banner`, { body: await page.screenshot(), contentType: "image/png" });
      }
      await highlight?.(false);
      await policycenterPage.hideValidation();
      await testInfo.attach(title, { body: lines.join("\n"), contentType: "text/plain" });
      for (const c of checks) expect.soft(c.ok, `${title}: ${c.text}`).toBe(true);
    };

    // Forms screen: the forms listed must be the expected ones for the selected coverages
    const validateForms = async (label: string, coveragesSelected: boolean, formsBefore?: string[]) => {
      await policycenterPage.openForms();
      const forms = await policycenterPage.getFormDescriptions();
      logger.step(++step, `Forms (${label}): ${forms.join(', ')}`);
      const checks: Check[] = [
        { ok: forms.length > 0, text: `Forms listed: ${forms.length}` },
        { ok: forms.some(f => /Dec Sheet/i.test(f)), text: "Dec Sheet is listed" },
        { ok: forms.some(f => /PERSONAL AUTO POLICY/i.test(f)), text: "PERSONAL AUTO POLICY is listed" },
      ];
      for (const c of COVERAGES_UNDER_TEST) {
        const listed = forms.find(f => c.form.test(f));
        checks.push(coveragesSelected
          ? { ok: !!listed, text: listed ? `${listed} is listed (${c.coverage} selected)` : `No form for ${c.coverage}, which is selected` }
          : { ok: !listed, text: listed ? `${listed} is still listed after removing ${c.coverage}` : `${c.coverage} form removed` });
      }
      if (formsBefore) {
        const expected = formsBefore.length - COVERAGES_UNDER_TEST.length;
        checks.push({ ok: forms.length === expected, text: `Only the 2 forms were removed: ${formsBefore.length} → ${forms.length} forms (expected ${expected})` });
      }
      await validate(`Forms (${label})`, checks, on => policycenterPage.highlightFormsList(on));
      return forms;
    };

    // AppEvents: open the message before the last one for the account and validate data.description against the Forms screen
    const validateAppEvents = async (label: string, accountNumber: string, forms: string[], coveragesSelected: boolean) => {
      logger.step(++step, `AppEvents (${label}): Administration > Monitoring > Message Queues > AppEvents`);
      await policycenterPage.openMessageQueues();
      await policycenterPage.openAppEventsDestination();

      logger.step(++step, `AppEvents (${label}): Accounts with any unfinished messages > account ${accountNumber}`);
      await policycenterPage.selectDetailedStatistics("Accounts with any unfinished messages");
      await policycenterPage.openUnfinishedAccount(accountNumber);

      const message = await policycenterPage.openMessageBeforeLast();
      logger.step(++step, `AppEvents (${label}): opened the event before the last one (Order ${message.order}, ${message.eventName})`);
      const payloadText = await policycenterPage.getMessagePayload();
      await testInfo.attach(`AppEvents payload - ${label}`, { body: payloadText, contentType: "application/json" });

      const { validJson, eventCount, descriptions } = readPayload(payloadText);
      logger.step(++step, `AppEvents (${label}): data.description values: ${descriptions.join(', ')}`);
      const checks: Check[] = [
        { ok: validJson, text: validJson ? `Message payload is valid JSON (${eventCount} events)` : "Message payload is not valid JSON" },
        { ok: descriptions.length > 0, text: `data.description found in ${descriptions.length} events` },
      ];
      for (const form of forms) {
        checks.push({ ok: descriptions.includes(form), text: `"${form}" ${descriptions.includes(form) ? "is" : "is NOT"} in data.description` });
      }
      for (const d of descriptions.filter(d => !forms.includes(d))) {
        checks.push({ ok: false, text: `"${d}" is in data.description but not listed on the Forms screen` });
      }
      for (const c of COVERAGES_UNDER_TEST) {
        const present = descriptions.find(d => c.form.test(d));
        checks.push(coveragesSelected
          ? { ok: !!present, text: present ? `${c.coverage} form present in data.description` : `${c.coverage} form missing from data.description` }
          : { ok: !present, text: present ? `"${present}" still in data.description` : `${c.coverage} form not in data.description` });
      }
      await validate(`AppEvents JSON (${label})`, checks, on => policycenterPage.highlightMessagePayload(on));
    };

    logger.step(++step, `Open PolicyCenter (${POLICYCENTER_URL}) and log in`);
    await policycenterPage.goto(POLICYCENTER_URL);
    await policycenterPage.enterUsername(CREDENTIALS.username);
    await policycenterPage.enterPassword(CREDENTIALS.password);
    await policycenterPage.clickLogin();

    logger.step(++step, `Account tab: open account ${ACCOUNT_NUMBER}`);
    await policycenterPage.openAccountByNumber(ACCOUNT_NUMBER);
    const accountNumber = await policycenterPage.readAccountNumber();
    logger.step(++step, `Account used for the policy: ${accountNumber}`);

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

    logger.step(++step, `Drivers page: Add > Existing Driver > ${rating.drivers.john.name}`);
    await policycenterPage.addExistingDriver(rating.drivers.john.name);
    logger.step(++step, `Drivers page: Add > New Person > ${rating.drivers.emma.name}`);
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

    // Step 1: PA Coverages, Towing and Labor and Mexico Coverage must both be selected
    for (const c of rating.coverages) {
      logger.step(++step, `PA Coverages: ${c.selected ? 'select' : 'unselect'} ${c.coverage}${c.value ? ` = ${c.value}` : ''}${c.note ? ` (${c.note})` : ''}`);
      await policycenterPage.applyCoverage(c);
    }
    const selectedChecks: Check[] = [];
    for (const c of COVERAGES_UNDER_TEST) {
      if (!(await policycenterPage.isCoverageSelected(c.coverage, c.level))) {
        await policycenterPage.applyCoverage({ coverage: c.coverage, level: c.level, selected: true, value: rating.coverages.find(rc => rc.coverage === c.coverage)?.value });
      }
      const selected = await policycenterPage.isCoverageSelected(c.coverage, c.level);
      selectedChecks.push({ ok: selected, text: `${c.coverage} is ${selected ? "selected" : "NOT selected"}` });
    }
    await validate("PA Coverages (before quote)", selectedChecks);

    // Step 2: quote (no cost validation)
    logger.step(++step, 'Quote (click Quote again if a warning appears), Special Approve any underwriting issues');
    await policycenterPage.quoteThroughWarning();
    await policycenterPage.approveUnderwritingIssuesIfAny();

    // Step 3: Forms, Towing and Labor and Mexico Coverage forms must be listed
    const formsBefore = await validateForms("with Towing and Labor + Mexico", true);

    // The submission number is shown on the wizard pages; read it now, it is needed to come back after AppEvents
    const submissionNumber = await policycenterPage.readSubmissionNumber();
    logger.step(++step, `Submission number: ${submissionNumber}`);

    // Step 4: AppEvents, the form descriptions in the message must match the Forms screen
    await validateAppEvents("after the first quote", accountNumber, formsBefore, true);

    // Step 5: Edit, remove Towing and Labor and Mexico Coverage and quote again (no cost validation)
    logger.step(++step, `Policy tab: search Sub # ${submissionNumber}`);
    await policycenterPage.searchSubmission(submissionNumber);

    logger.step(++step, 'Edit Policy Transaction (OK on dialog), PA Coverages: unselect Towing and Labor and Mexico Coverage');
    await policycenterPage.editPolicyTransaction();
    await policycenterPage.openPACoverages();
    await policycenterPage.setTowingAndLaborSelected(false);
    await policycenterPage.setMexicoCoverage(false);
    const unselectedChecks: Check[] = [];
    for (const c of COVERAGES_UNDER_TEST) {
      const selected = await policycenterPage.isCoverageSelected(c.coverage, c.level);
      unselectedChecks.push({ ok: !selected, text: `${c.coverage} is ${selected ? "still selected" : "unselected"}` });
    }
    await validate("PA Coverages (after the edit)", unselectedChecks);

    logger.step(++step, 'Quote again (click Quote again if a warning appears), Special Approve any underwriting issues');
    await policycenterPage.quoteThroughWarning();
    await policycenterPage.approveUnderwritingIssuesIfAny();

    // Step 6: Forms, both forms must be removed and the others kept
    const formsAfter = await validateForms("after removing Towing and Labor + Mexico", false, formsBefore);

    // Step 7: AppEvents, the form descriptions must match the Forms screen and no longer include Towing and Labor or Mexico
    await validateAppEvents("after the edit", accountNumber, formsAfter, false);

    // Issue the policy, as in the PolicyCenter E2E test
    logger.step(++step, `Policy tab: search Sub # ${submissionNumber}`);
    await policycenterPage.searchSubmission(submissionNumber);

    logger.step(++step, 'Bind Options > Issue Policy, confirm the popup with OK');
    await policycenterPage.issuePolicy();

    logger.step(++step, 'Open "View Policy" and read the policy number');
    const policyNumber = await policycenterPage.viewIssuedPolicyAndReadNumber();
    logger.step(++step, `Policy number: ${policyNumber}`);
    expect(policyNumber, 'Policy number should be 10 digits').toMatch(/^\d{10}$/);
    saveCreatedPolicy({ policyNumber, submissionNumber, effectiveDate: rating.policy.effectiveDate });

    if (testInfo.errors.length === 0) logger.success('TC00011 forms validation completed');
  });
});
