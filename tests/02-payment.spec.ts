import { test, expect } from "../fixtures/testFixtures";
import { ClaimcenterPage } from "../pages/ClaimcenterPage";
import { loadCreatedClaim } from "../utils/createdClaim";

const appUrl =
  process.env.AUTOPLAYPILOT_APP_URL ||
  process.env.LOCATOR_APP_URL ||
  "https://cc-dev-gwcpdev.zensar.zeta1-andromeda.guidewire.net/ClaimCenter.do";

const credentials = { username: "su", password: "gw" };
// The claim is the one created from the policy issued in PolicyCenter: its drivers are John Smith (main driver) and Emma Smith,
// the insured is TEST ACCOUNT, and its only reserve line is "Vehicle inspection" with $500, which the two checks split.
const driver = "John Smith";
const payee = "TEST ACCOUNT"; // the exposure's claimant: the Check wizard only lists its reserve lines for this payee
const payment = { type: "Partial", amount: "300" };
const secondPayment = { amount: "200" }; // the rest of the $500 Vehicle inspection reserve

// Runs after the claim creation spec (tests/01-new-claim-creation.spec.ts), which saves the number of the claim it
// created. This spec opens that claim, updates the incident of its Vehicle exposure, pays a partial check, runs the
// Financials Escalation batch process and checks how the payment moves on.
test.describe("Update the vehicle incident of the new claim's exposure, pay a partial check and run the Financials Escalation batch", () => {
  test("Vehicle incident and payment", async ({ page, logger }) => {
    const claimcenterPage = new ClaimcenterPage(page);
    const claimNumber = loadCreatedClaim();

    logger.step(1, 'Navigate to ClaimCenter');
    await claimcenterPage.goto(appUrl);

    logger.step(2, 'Log in');
    await claimcenterPage.login(credentials.username, credentials.password);

    logger.step(3, `Open the newly created claim ${claimNumber}`);
    await claimcenterPage.openClaimByNumber(claimNumber);

    // ---- Vehicle incident on the exposure ----------------------------------------------------------------------
    logger.step(4, 'Claim left menu > Exposures');
    await claimcenterPage.openExposures();

    logger.step(5, 'Open the Vehicle exposure (Type hyperlink "Vehicle")');
    await claimcenterPage.openExposure("Vehicle");

    logger.step(6, 'Click Edit');
    await claimcenterPage.clickEditExposure();

    logger.step(7, `Incident Overview > Vehicle dropdown > Edit Incident Details: driver ${driver}, damage description "details", loss occurred "At premises", OK`);
    await claimcenterPage.editVehicleIncidentDetails(driver, "details", "At premises", "Self/Insured");

    logger.step(8, 'Click Update');
    await claimcenterPage.updateExposure();

    // ---- Payment -----------------------------------------------------------------------------------------------
    logger.step(9, 'Claim left menu > Financials > Transactions: the reserves are Submitting or Awaiting submission');
    await claimcenterPage.openTransactions();
    const reserveStatus = await claimcenterPage.expectTransactionStatus("Reserve", /^(Submitting|Awaiting submission)$/);
    logger.info(`Reserve status before the payment: ${reserveStatus}`);

    logger.step(10, 'Claim left menu > Financials > Summary: Vehicle inspection reserve dropdown > Create Check (the Actions > Check list shows no reserve line for this claim)');
    await claimcenterPage.openFinancialsSummary();
    await claimcenterPage.createCheckFromSummary("Vehicle inspection USD");

    logger.step(11, `Check step 1 of 3: payee ${payee}, Next`);
    await claimcenterPage.selectCheckPayeeAndNext(payee);

    logger.step(12, `Check step 2 of 3: the reserve line, payment type ${payment.type}, amount ${payment.amount}, Next`);
    await claimcenterPage.enterCheckPaymentAndNext(payment.type, payment.amount, { applyDeductible: false });

    logger.step(13, 'Check step 3 of 3: Finish (a second Finish accepts the "coverage is in question" warning)');
    await claimcenterPage.finishCheck();

    logger.step(14, 'Claim left menu > Financials > Transactions: the payment is Awaiting submission');
    await claimcenterPage.openTransactions();
    await claimcenterPage.expectTransactionStatus("Payment", "Awaiting submission");

    // ---- Batch process -----------------------------------------------------------------------------------------
    logger.step(15, 'Alt+Shift+T > Batch Process Info: run Financials Escalation, wait 2 seconds, Refresh until it is Completed');
    await claimcenterPage.openBatchProcessInfo();
    await claimcenterPage.runBatchProcess("Financials Escalation");

    logger.step(16, 'Actions > Return to ClaimCenter');
    await claimcenterPage.returnToClaimCenter();

    logger.step(17, 'Claim dropdown > first claim in the list');
    const openedClaim = await claimcenterPage.openFirstRecentClaim();
    expect(openedClaim, 'the first claim of the list is the claim that was worked on').toBe(claimNumber);

    logger.step(18, 'Claim left menu > Financials > Transactions: the payment has moved on from Awaiting submission');
    await claimcenterPage.openTransactions();
    const paymentStatus = await claimcenterPage.expectTransactionStatus("Payment", /^(?!Awaiting submission$).+/);
    logger.info(`Payment status after the Financials Escalation batch: ${paymentStatus}`);

    // ---- Second payment, from the Financials Summary ------------------------------------------------------------
    logger.step(19, 'Transactions: filter "All transaction types" > Payments, the payment is Submitting');
    await claimcenterPage.filterTransactions("Payments");
    await claimcenterPage.expectPaymentsStatus("Submitting", 1);

    logger.step(20, 'Claim left menu > Financials > Summary');
    await claimcenterPage.openFinancialsSummary();

    logger.step(21, 'Vehicle inspection reserve: dropdown > Create Check');
    await claimcenterPage.createCheckFromSummary("Vehicle inspection USD");

    logger.step(22, `Check step 1 of 3: payee ${payee}, Next`);
    await claimcenterPage.selectCheckPayeeAndNext(payee);

    logger.step(23, `Check step 2 of 3: Vehicle inspection reserve line, amount ${secondPayment.amount}, Next`);
    await claimcenterPage.enterCheckPaymentAndNext(payment.type, secondPayment.amount, { reserveLineNumber: 1, applyDeductible: false });

    logger.step(24, 'Check step 3 of 3: Finish (a second Finish accepts the "coverage is in question" warning)');
    await claimcenterPage.finishCheck();

    logger.step(25, 'Alt+Shift+T > Batch Process Info: run Financials Escalation again, wait 2 seconds, Refresh until it is Completed');
    await claimcenterPage.openBatchProcessInfo();
    await claimcenterPage.runBatchProcess("Financials Escalation");

    logger.step(26, 'Actions > Return to ClaimCenter, then Claim dropdown > first claim in the list');
    await claimcenterPage.returnToClaimCenter();
    await claimcenterPage.openFirstRecentClaim();

    logger.step(27, 'Claim left menu > Financials > Transactions > Payments: both payments are Submitting');
    await claimcenterPage.openTransactions();
    await claimcenterPage.filterTransactions("Payments");
    await claimcenterPage.expectPaymentsStatus("Submitting", 2);

    logger.success('Vehicle incident updated, both checks paid and the Financials Escalation batch moved the payments on');
  });
});
