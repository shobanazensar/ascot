import { test, expect } from "../fixtures/testFixtures";
import { ClaimcenterPage } from "../pages/ClaimcenterPage";
import { healLocator } from "../utils/selfHealing";

const appUrl =
  process.env.AUTOPLAYPILOT_APP_URL ||
  process.env.LOCATOR_APP_URL ||
  "https://cc-dev-gwcpdev.zensar.zeta1-andromeda.guidewire.net/ClaimCenter.do";

const validCredentials = { username: "su", password: "gw" };
const lossDate = "11/05/2026";
const policy = { number: "P000143542", effectiveDate: "07/25/2026" };

test.describe("Login locators are broken on purpose so the AutoPlay Pilot AI agent can self-heal them, then the entire New Claim flow runs", () => {
  test("Login self-healing then entire New Claim flow", async ({ page, logger }) => {
    const claimcenterPage = new ClaimcenterPage(page);

    logger.step(1, 'Navigate to ClaimCenter');
    await claimcenterPage.goto(appUrl);

    // The primary Username locator below is deliberately WRONG (wrong role), as if the UI had changed. It goes through
    // the built-in self-healing (utils/selfHealing.ts): when the primary does not match, the fallbacks are tried, the first
    // working one is used, and the heal is logged and written to healing-report.json. The real element is a textbox.
    logger.step(2, 'Username: enter the username (primary locator is broken on purpose, role "combobox"; self-heals)');
    const usernameBox = await healLocator('login.username', [
      page.getByRole('combobox', { name: 'Username' }),
      page.getByRole('textbox', { name: 'Username' }),
      page.getByLabel('Username'),
      page.locator('input[name*="Username" i]'),
    ]);
    await usernameBox.fill(validCredentials.username);

    logger.step(3, 'Password: enter the password');
    await page.getByRole('textbox', { name: 'Password' }).fill(validCredentials.password);

    logger.step(4, 'Log In: click the button');
    await page.getByRole('button', { name: 'Log In' }).click();

    logger.step(5, 'Login succeeded: the main screen (Claim menu) is displayed');
    await expect(page.getByRole('menuitem', { name: 'Claim' }).first()).toBeVisible();

    // The rest of the flow runs on the same session, using the page object.
    logger.step(6, 'Claim dropdown > New Claim');
    await claimcenterPage.openNewClaim();

    logger.step(7, 'Step 1 of 5: search for the policy holder by name "Ray Newton"');
    await claimcenterPage.searchPolicyByName("Ray", "Newton");

    logger.step(8, `Select policy ${policy.number} (effective ${policy.effectiveDate}) from the results list`);
    await claimcenterPage.selectPolicy(policy.number, policy.effectiveDate);

    logger.step(9, `Set Loss Date ${lossDate} and click Next`);
    await claimcenterPage.setLossDateAndNext(lossDate);
    await claimcenterPage.expectInfoBar(policy.number, lossDate);

    logger.step(10, 'Step 2 of 5: Basic information (reporter Ray Newton) and Next');
    await claimcenterPage.fillBasicInfoAndNext("Phone", "Ray Newton", "Self/Insured");

    logger.step(11, 'Step 3 of 5: Loss Cause "Collision with motor vehicle", Location, and Next');
    await claimcenterPage.fillClaimInfoAndNext("Collision with motor vehicle");

    logger.step(12, 'Step 4 of 5: Services, Next');
    await claimcenterPage.goNextFromServices();

    logger.step(13, 'Step 5 of 5: Finish');
    await claimcenterPage.finishClaim();

    logger.step(14, 'New Claim Saved confirmation message is displayed');
    await claimcenterPage.expectNewClaimSaved();

    logger.step(15, 'No validation error or save failure message is displayed');
    await claimcenterPage.expectNoSaveErrors();

    logger.step(16, 'Click "View <claim #>, the newly saved claim"');
    await claimcenterPage.viewNewlySavedClaim();

    logger.success('Login (after AI self-healing) and the entire New Claim flow completed');
  });
});
