import { test, expect } from "../fixtures/testFixtures";
import { existsSync, readFileSync } from 'fs';
import path from 'path';
import { ClaimcenterPage } from "../pages/ClaimcenterPage";
import { saveCreatedClaim } from "../utils/createdClaim";
import { loadCreatedPolicy } from "../utils/createdPolicy";

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

// DSL: TC00011
test.describe("Finish on Step 5 creates the claim and shows the New Claim Saved confirmation message", () => {
  test("TC00011", async ({ page, logger }) => {
    const runtimeConfig = loadRuntimeConfig("TC00011");
    const credentials = { username: "su", password: "gw" };
    const claimcenterPage = new ClaimcenterPage(page);

    // The claim is created against the policy the PolicyCenter spec just issued (saved in test-data/created-policy.json)
    const policy = loadCreatedPolicy();
    const today = new Date();
    const lossDate = `${String(today.getMonth() + 1).padStart(2, '0')}/${String(today.getDate()).padStart(2, '0')}/${today.getFullYear()}`;
    const insured = "TEST ACCOUNT"; // the policy's insured / reporter
    // The policy's vehicle makes a business rule create the claim's Vehicle exposure.
    const vehicle = "2023 Toyota Avalon";

    logger.step(1, 'Navigate to ClaimCenter');
    await claimcenterPage.goto(runtimeConfig.appUrl || "https://cc-dev-gwcpdev.zensar.zeta1-andromeda.guidewire.net/ClaimCenter.do");

    logger.step(2, 'Log in');
    await claimcenterPage.login(credentials.username, credentials.password);

    logger.step(3, 'Claim dropdown > New Claim');
    await claimcenterPage.openNewClaim();

    logger.step(4, `Step 1 of 5: search for policy ${policy.policyNumber} (issued by the PolicyCenter spec)`);
    await claimcenterPage.searchPolicyByNumber(policy.policyNumber);

    logger.step(5, `Select policy ${policy.policyNumber} (effective ${policy.effectiveDate}) from the results list`);
    await claimcenterPage.selectPolicy(policy.policyNumber, policy.effectiveDate);

    logger.step(5.5, `Set Loss Date ${lossDate} and click Next`);
    await claimcenterPage.setLossDateAndNext(lossDate);
    await claimcenterPage.expectInfoBar(policy.policyNumber, lossDate);

    logger.step(6, `Step 2 of 5: Basic information (reporter ${insured}) and Next`);
    await claimcenterPage.fillBasicInfoAndNext("Phone", insured, "Self/Insured");

    logger.step(7, `Step 3 of 5: Loss Cause "Collision with motor vehicle", Location, Fault Rating "Other party at fault", add vehicle "${vehicle}", and Next`);
    await claimcenterPage.fillClaimInfoAndNext("Collision with motor vehicle", { faultRating: "Other party at fault", vehicle });

    logger.step(8, 'Step 4 of 5: Services, Next');
    await claimcenterPage.goNextFromServices();

    logger.step(9, 'Step 5 of 5: Finish (a second Finish accepts the "coverage is in question" warning)');
    await claimcenterPage.finishClaimAcceptingWarnings();

    logger.step(10, 'New Claim Saved confirmation message is displayed');
    await claimcenterPage.expectNewClaimSaved();

    logger.step(11, 'No validation error or save failure message is displayed');
    await claimcenterPage.expectNoSaveErrors();

    logger.step(12, 'Click "View <claim #>, the newly saved claim"');
    await claimcenterPage.viewNewlySavedClaim();

    logger.step(13, 'Save the claim number so the payment spec can open this claim');
    const claimNumber = await claimcenterPage.readOpenClaimNumber();
    saveCreatedClaim(claimNumber);
    logger.info(`Created claim ${claimNumber}`);

    logger.success('Test completed successfully');
  });
});
