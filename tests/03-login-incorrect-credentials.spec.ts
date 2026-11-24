import { test, expect } from "../fixtures/testFixtures";
import { ClaimcenterPage } from "../pages/ClaimcenterPage";

const appUrl =
  process.env.AUTOPLAYPILOT_APP_URL ||
  process.env.LOCATOR_APP_URL ||
  "https://cc-dev-gwcpdev.zensar.zeta1-andromeda.guidewire.net/ClaimCenter.do";

const incorrectCredentials = { username: "su", password: "GW" };

test.describe("Login with incorrect credentials", () => {
  // This test is expected to FAIL (used to check defect intelligence in AutoPlay Pilot test execution):
  // it logs in with an incorrect password and expects the main screen, which ClaimCenter does not show,
  // because it rejects the login with "The username or password may be incorrect".
  test("Login incorrect credentials", async ({ page, logger }) => {
    const claimcenterPage = new ClaimcenterPage(page);

    logger.step(1, 'Navigate to ClaimCenter');
    await claimcenterPage.goto(appUrl);

    logger.step(2, 'Log in with incorrect credentials');
    await claimcenterPage.attemptLogin(incorrectCredentials.username, incorrectCredentials.password);

    logger.step(3, 'Login should succeed: the main screen (Claim menu) is displayed');
    await expect(
      page.getByRole('menuitem', { name: 'Claim' }).first(),
      'Login failed: the main screen (Claim menu) was not displayed after logging in with the given credentials',
    ).toBeVisible();

    logger.success('Logged in and the main screen is displayed');
  });
});
