import { test, expect } from "../fixtures/testFixtures";
import { readFileSync } from 'fs';
import path from 'path';
import { ClaimcenterPage } from "../pages/ClaimcenterPage";

// TC00009 Claim Creation: creates a claim on an EXISTING policy (no PolicyCenter prerequisite) and takes it up to payments.
//
// 1. Policy: the candidate policies in test-data/tc00009-claim.json are tried in order; the first one that is found,
//    belongs to the insured, is in force on the loss date and lists a vehicle is used for the claim.
// 2. Reserve: ClaimCenter normally gives the claim's Vehicle exposure a reserve. If the reserve line is missing (or smaller
//    than the payment), the test creates it (Exposures > Create Reserve) before paying.
// 3. Payment: one check from the reserve line, then the Financials Escalation batch moves it to Submitting.
//
// Run:  npm run test:claim                (add -- --headed to watch; PRESENTATION=off skips the banners and the delay)
// CC_POLICY_NUMBER=<policy #>       tries that policy first
// CC_RESERVE_CATEGORY=<category>    pays from another cost category (e.g. "Vehicle appraisal", which is not created
//                                   automatically, so the test has to create the reserve)

const CLAIMCENTER_URL = process.env.CLAIMCENTER_URL || "https://cc-dev-gwcpdev.zensar.zeta1-andromeda.guidewire.net/ClaimCenter.do";
const CREDENTIALS = { username: process.env.CC_USERNAME || "su", password: process.env.CC_PASSWORD || "gw" };

type Candidate = { policyNumber: string; vehicle?: string };
const data = JSON.parse(readFileSync(path.join(__dirname, '..', 'test-data', 'tc00009-claim.json'), 'utf8'));
const CANDIDATES: Candidate[] = [
  ...(process.env.CC_POLICY_NUMBER ? [{ policyNumber: process.env.CC_POLICY_NUMBER }] : []),
  ...(data.policy.candidates as Candidate[]).filter(c => c.policyNumber !== process.env.CC_POLICY_NUMBER),
];
const RESERVE = { ...data.reserve, costCategory: process.env.CC_RESERVE_CATEGORY || data.reserve.costCategory } as
  { exposureType: string; exposure: string; costType: string; costCategory: string; amount: number };

// Presentation mode (headed demos): banners at the main steps and a short delay before every action
const PRESENTATION = { ...data.presentation, enabled: data.presentation.enabled && process.env.PRESENTATION !== "off" } as
  { enabled: boolean; slowMoMs: number; pauseAfterBannerMs: number };
test.use({ launchOptions: { slowMo: PRESENTATION.enabled ? PRESENTATION.slowMoMs : 0 } });

const toDate = (mmddyyyy: string) => { const [m, d, y] = mmddyyyy.split('/').map(Number); return new Date(y, m - 1, d); };
const money = (cents: number) => `$${(cents / 100).toLocaleString("en-US", { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`;
const amount = (cents: number) => (cents / 100).toFixed(2); // what is typed in ClaimCenter

test.describe("TC00009 - Claim creation on an existing policy up to payments", () => {
  test("TC00009_ClaimCreation: existing policy > new claim > reserve > payment", async ({ page, logger }) => {
    test.setTimeout(15 * 60_000);
    const cc = new ClaimcenterPage(page);
    cc.setPresentation({ enabled: PRESENTATION.enabled, pauseAfterBannerMs: PRESENTATION.pauseAfterBannerMs });
    const lossDate = ClaimcenterPage.formatDate(0);
    const reserveLine = `${RESERVE.costCategory} USD`;   // as shown on Financials: Summary
    const checkReserveLine = RESERVE.costCategory;         // as shown in the Check wizard's Reserve Line ("…/Vehicle inspection")
    const payment = Math.round(data.payment.amount * 100);
    let step = 0;

    logger.step(++step, `Open ClaimCenter (${CLAIMCENTER_URL}) and log in`);
    await cc.goto(CLAIMCENTER_URL);
    await cc.login(CREDENTIALS.username, CREDENTIALS.password);

    // ---------- 1. Pick an existing policy and start the claim on it ----------
    let chosen: { policyNumber: string; vehicle: string; insured: string; term: string } | undefined;
    const skipped: string[] = [];
    for (const candidate of CANDIDATES) {
      const skip = async (reason: string, cancel: () => Promise<void>) => {
        skipped.push(`${candidate.policyNumber}: ${reason}`);
        logger.warn(`Policy ${candidate.policyNumber} skipped: ${reason}`);
        await cancel();
      };

      logger.step(++step, `Claim dropdown > New Claim; Step 1 of 5: search for existing policy ${candidate.policyNumber}`);
      await cc.openNewClaim();
      const policy = await cc.findPolicyByNumber(candidate.policyNumber);
      if (!policy) { await skip('not found in ClaimCenter', () => cc.cancelNewClaimWizard()); continue; }
      logger.step(++step, `Policy found: ${policy.text}`);
      if (!policy.text.includes(data.policy.insured)) { await skip(`insured is not ${data.policy.insured}`, () => cc.cancelNewClaimWizard()); continue; }
      const inForce = toDate(policy.effectiveDate) <= toDate(lossDate) && toDate(lossDate) < toDate(policy.expirationDate);
      if (!inForce) {
        await skip(`not in force on ${lossDate} (term ${policy.effectiveDate} - ${policy.expirationDate})`, () => cc.cancelNewClaimWizard());
        continue;
      }
      logger.step(++step, `Policy term ${policy.effectiveDate} - ${policy.expirationDate} covers the loss date ${lossDate}: select it`);
      await cc.selectPolicy(candidate.policyNumber, policy.effectiveDate);

      logger.step(++step, `Set Loss Date ${lossDate} and click Next`);
      await cc.setLossDateAndNext(lossDate);
      await cc.expectInfoBar(candidate.policyNumber, lossDate);

      logger.step(++step, `Step 2 of 5: Basic information (reported by ${data.claim.howReported}, reporter ${data.claim.reporter}) and Next`);
      await cc.fillBasicInfoAndNext(data.claim.howReported, data.claim.reporter, data.claim.relationToInsured);

      logger.step(++step, `Step 3 of 5: Loss Cause "${data.claim.lossCause}", Location, Fault Rating "${data.claim.faultRating}", Add Vehicle`);
      await cc.fillLossDetails(data.claim.lossCause, data.claim.faultRating);
      const vehicles = await cc.listPolicyVehicles();
      logger.step(++step, `Vehicles on policy ${candidate.policyNumber}: ${vehicles.join(', ') || 'none'}`);
      if (!vehicles.length) {
        await skip('no vehicle listed on the policy', async () => { await cc.cancelVehicleDetails(); await cc.cancelNewClaimWizard(); });
        continue;
      }
      const vehicle = candidate.vehicle && vehicles.includes(candidate.vehicle) ? candidate.vehicle : vehicles[0];
      logger.step(++step, `Add vehicle "${vehicle}"`);
      await cc.chooseVehicle(vehicle);
      chosen = { policyNumber: candidate.policyNumber, vehicle, insured: data.policy.insured, term: `${policy.effectiveDate} - ${policy.expirationDate}` };
      break;
    }
    expect(chosen, `No suitable existing policy among ${CANDIDATES.map(c => c.policyNumber).join(', ')}:\n${skipped.join('\n')}`).toBeTruthy();
    const { policyNumber } = chosen!;
    await cc.showBanner("1. Existing policy selected", [
      `Policy #: ${policyNumber} (${chosen!.insured})`,
      `Term ${chosen!.term} covers the loss date ${lossDate}`,
      `Vehicle: ${chosen!.vehicle}`,
      ...skipped.map(s => `Skipped ${s}`),
    ]);

    // ---------- 2. Finish the claim ----------
    logger.step(++step, 'Step 3 of 5: Next; Step 4 of 5: Services, Next');
    await cc.nextFromClaimInfo();
    await cc.goNextFromServices();

    logger.step(++step, 'Step 5 of 5: Finish (a second Finish accepts any warning)');
    await cc.finishClaimAcceptingWarnings();

    logger.step(++step, 'New Claim Saved confirmation message is displayed, with no validation or save error');
    await cc.expectNewClaimSaved();
    await cc.expectNoSaveErrors();

    logger.step(++step, 'Click "View <claim #>, the newly saved claim"');
    await cc.viewNewlySavedClaim();
    const claimNumber = await cc.readOpenClaimNumber();
    logger.step(++step, `Claim created: ${claimNumber} on policy ${policyNumber}`);
    await cc.showBanner("2. Claim created", [
      `Claim #: ${claimNumber}`,
      `Policy #: ${policyNumber}, loss date ${lossDate}`,
      `Loss cause: ${data.claim.lossCause}, vehicle ${chosen!.vehicle}`,
      'New Claim Saved, no validation or save error',
    ]);

    // ---------- 3. Reserve: use the one ClaimCenter created, or create it ----------
    logger.step(++step, `Claim left menu > Financials > Summary: look for the "${reserveLine}" reserve`);
    await cc.openFinancialsSummary();
    let reserve = await cc.readReserveLine(reserveLine);
    let reserveSource = 'created by ClaimCenter with the Vehicle exposure';
    logger.step(++step, reserve
      ? `${reserveLine}: remaining reserve ${money(reserve.remaining)}, paid ${money(reserve.paid)}`
      : `${reserveLine}: no such reserve line on the claim`);
    if (!reserve || reserve.remaining < payment) {
      const target = Math.round(RESERVE.amount * 100);
      logger.step(++step, `Not enough reserve to pay ${money(payment)}: Exposures > ${RESERVE.exposureType} > Create Reserve, ` +
        `${RESERVE.costType} / ${RESERVE.costCategory}, New Available Reserves ${money(target)}, Save`);
      reserveSource = reserve ? `topped up by the test from ${money(reserve.remaining)}` : 'missing, so created by the test (Exposures > Create Reserve)';
      await cc.setReserve({ exposureType: RESERVE.exposureType, exposure: RESERVE.exposure, costType: RESERVE.costType, costCategory: RESERVE.costCategory, amount: amount(target) });
      await cc.openFinancialsSummary();
      reserve = await cc.readReserveLine(reserveLine);
      logger.step(++step, `${reserveLine} after creating it: remaining reserve ${money(reserve?.remaining ?? 0)}`);
    }
    expect(reserve, `The claim should have a "${reserveLine}" reserve line`).toBeTruthy();
    expect(reserve!.remaining, `"${reserveLine}" should cover the payment ${money(payment)}`).toBeGreaterThanOrEqual(payment);
    const reserveAmount = reserve!.remaining;
    await cc.showBanner("3. Reserve available for payment", [
      `${reserveLine}: ${money(reserveAmount)} remaining`,
      `Reserve ${reserveSource}`,
      `Payment planned: ${money(payment)}`,
    ]);

    // ---------- 4. Vehicle incident on the exposure ----------
    logger.step(++step, 'Claim left menu > Exposures > Vehicle exposure > Edit');
    await cc.openExposures();
    await cc.openExposure("Vehicle");
    await cc.clickEditExposure();

    logger.step(++step, `Incident Overview > Vehicle dropdown > Edit Incident Details: driver ${data.incident.driver}, damage description "${data.incident.damageDescription}", loss occurred "${data.incident.lossOccurred}", OK, Update`);
    await cc.editVehicleIncidentDetails(data.incident.driver, data.incident.damageDescription, data.incident.lossOccurred, data.incident.relationToOwner);
    await cc.updateExposure();

    logger.step(++step, 'Financials > Transactions: the reserve is Submitting or Awaiting submission');
    await cc.openTransactions();
    const reserveStatus = await cc.expectTransactionStatus("Reserve", /^(Submitting|Awaiting submission)$/);
    logger.step(++step, `Reserve status: ${reserveStatus}`);
    await cc.showBanner("4. Vehicle incident updated", [
      `Driver: ${data.incident.driver}`,
      `Damage description: "${data.incident.damageDescription}", loss occurred: ${data.incident.lossOccurred}`,
      `Reserve status on Transactions: ${reserveStatus}`,
    ]);

    // ---------- 5. Payment ----------
    logger.step(++step, `Financials > Summary: "${reserveLine}" dropdown > Create Check`);
    await cc.openFinancialsSummary();
    await cc.createCheckFromSummary(reserveLine);

    logger.step(++step, `Check step 1 of 3: payee ${data.payment.payee}, Next`);
    await cc.selectCheckPayeeAndNext(data.payment.payee);

    logger.step(++step, `Check step 2 of 3: reserve line ${checkReserveLine}, payment type ${data.payment.type}, amount ${money(payment)}, Next`);
    await cc.enterCheckPaymentAndNext(data.payment.type, amount(payment), { reserveLineName: checkReserveLine, applyDeductible: false });

    logger.step(++step, 'Check step 3 of 3: Finish (a second Finish accepts any warning)');
    await cc.finishCheck();

    logger.step(++step, 'Financials > Transactions: the payment is Awaiting submission');
    await cc.openTransactions();
    await cc.expectTransactionStatus("Payment", "Awaiting submission");

    logger.step(++step, 'Alt+Shift+T > Batch Process Info: run Financials Escalation, Refresh until it is Completed');
    await cc.openBatchProcessInfo();
    await cc.runBatchProcess("Financials Escalation");

    logger.step(++step, `Actions > Return to ClaimCenter, reopen claim ${claimNumber}`);
    await cc.returnToClaimCenter();
    await cc.openClaimByNumber(claimNumber);

    logger.step(++step, 'Financials > Transactions > Payments: the payment is Submitting');
    await cc.openTransactions();
    await cc.filterTransactions("Payments");
    await cc.expectPaymentsStatus("Submitting", 1);
    await cc.showBanner("5. Payment made", [
      `Check to ${data.payment.payee}: ${money(payment)} (${data.payment.type}) from ${reserveLine}`,
      'Awaiting submission > Financials Escalation batch > Submitting',
    ]);

    // ---------- 6. Reserve after the payment ----------
    const expectedRemaining = reserveAmount - payment;
    logger.step(++step, `Financials > Summary: the payment is recorded against "${reserveLine}"`);
    await cc.openFinancialsSummary();
    const after = await cc.readReserveLine(reserveLine);
    logger.step(++step, `${reserveLine}: remaining reserve ${money(after?.remaining ?? 0)}, paid ${money(after?.paid ?? 0)} (expected ${money(expectedRemaining)} remaining, ${money(payment)} paid)`);
    expect(after?.paid, `${reserveLine}: total paid should equal the payment`).toBe(payment);
    expect(after?.remaining, `${reserveLine}: the reserve should go down by the payment`).toBe(expectedRemaining);
    await cc.showBanner("6. Payment recorded against the reserve", [
      `Claim #: ${claimNumber}`,
      `${reserveLine}: ${money(after!.paid)} paid, ${money(after!.remaining)} remaining`,
      `${money(reserveAmount)} - ${money(payment)} = ${money(expectedRemaining)}`,
    ]);

    logger.success(`Claim ${claimNumber} created on existing policy ${policyNumber} and ${money(payment)} paid from its ${reserveLine} reserve`);
  });
});
