import { Page, Locator, expect } from '@playwright/test';
import { BasePage } from './BasePage';
import { HealSpec, candidatesFor, heal, healLocator, primaryFor } from '../utils/selfHealing';

export class ClaimcenterPage extends BasePage {
  readonly url = "https://cc-dev-gwcpdev.zensar.zeta1-andromeda.guidewire.net/ClaimCenter.do";

  // Presentation mode (off by default): banners at the main steps, held on screen for pauseAfterBannerMs
  private presentation = { enabled: false, pauseAfterBannerMs: 0 };

  constructor(page: Page) {
    super(page);
  }

  setPresentation(options: Partial<{ enabled: boolean; pauseAfterBannerMs: number }>): void {
    this.presentation = { ...this.presentation, ...options };
  }

  get presentationEnabled(): boolean { return this.presentation.enabled; }

  /** Shows a banner (presentation mode only), holds it on screen, then removes it. */
  async showBanner(title: string, lines: string[], passed = true): Promise<void> {
    if (!this.presentation.enabled) return;
    await this.drawBanner(title, lines, passed);
    await this.page.waitForTimeout(this.presentation.pauseAfterBannerMs);
    await this.removeBanner();
  }

  async goto(url?: string): Promise<void> {
    await this.page.goto(url || this.url);
  }

  /** Opens the "Claim" tab dropdown (the arrow next to Claim) and clicks "New Claim". */
  async openNewClaim(): Promise<void> {
    const expand = await healLocator('claimTab.expandButton', [
      this.page.locator('#TabBar-ClaimTab .gw-action--expand-button'),
      this.page.getByRole('menuitem', { name: 'Claim' }).first().locator('[class*="expand"]'),
      this.page.locator('[id^="TabBar-ClaimTab"] [class*="expand"]'),
    ]);
    await expand.click();
    const newClaim = await healLocator('claimTab.newClaim', [
      this.page.locator('#TabBar-ClaimTab-ClaimTab_FNOLWizard'),
      this.page.getByRole('menuitem', { name: 'New Claim' }),
      this.page.getByText('New Claim', { exact: true }),
    ]);
    await newClaim.click();
    // New Claim Wizard opens on "Step 1: Search or Create Policy"
    await heal('newClaim.step1Heading', this.page, { role: 'heading', name: 'Step 1: Search or Create Policy' });
  }

  /** Submits the login form without waiting for the main screen (for negative login tests). */
  async attemptLogin(username: string, password: string): Promise<void> {
    const usernameBox = await healLocator('login.username', [
      this.page.getByRole('textbox', { name: 'Username' }),
      this.page.getByLabel('Username'),
      this.page.locator('input[name*="Username" i]'),
    ]);
    await usernameBox.fill(username);
    const passwordBox = await healLocator('login.password', [
      this.page.getByRole('textbox', { name: 'Password' }),
      this.page.getByLabel('Password'),
      this.page.locator('input[type="password"], input[name*="Password" i]'),
    ]);
    await passwordBox.fill(password);
    const logIn = await healLocator('login.submit', [
      this.page.getByRole('button', { name: 'Log In' }),
      this.page.getByRole('button', { name: /log\s?in|sign\s?in/i }),
      this.page.getByText(/^(log|sign)\s?in$/i),
    ]);
    await logIn.click();
  }

  /** After a bad login: the error is shown, the login form is still displayed and the user is not logged in. */
  async expectLoginFailed(): Promise<void> {
    await heal('login.errorMessage', this.page, { text: /username or password may be incorrect/i });
    await heal('login.submit', this.page, { role: 'button', name: 'Log In' });
    // Absence checks cannot self-heal (there is nothing to find), so this one stays a plain assertion.
    await expect(this.page.getByRole('menuitem', { name: 'Claim' })).toHaveCount(0);
  }

  async login(username: string, password: string): Promise<void> {
    await this.attemptLogin(username, password);
    // Wait for the post-login main screen (the tab bar's Claim menu)
    await heal('main.claimMenu', this.page, { role: 'menuitem', name: 'Claim' });
  }

  // ---------------------------------------------------------------------------
  // New Claim wizard (5 steps). Locators verified against the live dev app.
  // ---------------------------------------------------------------------------

  private waitStepHeading(n: number): Promise<Locator> {
    return heal(`wizard.step${n}Heading`, this.page, { role: 'heading', name: new RegExp(`^Step ${n}( of 5)?:`) });
  }

  private async clickWizardNext(): Promise<void> {
    const next = await healLocator('wizard.next', [
      this.wizardToolbar.getByRole('button', { name: 'Next', exact: true }),
      this.wizardToolbar.getByRole('button', { name: /^Next/ }),
      this.wizardToolbar.locator('[id$="Next"]'),
      this.page.getByRole('button', { name: 'Next', exact: true }), // last resort if the toolbar region itself changed
    ]);
    await next.click();
  }

  /** Wizard title bar (Cancel / Back / Next / Finish). Scoped so the Duplicate Claims worksheet's paging "Next" can't match. */
  private get wizardToolbar(): Locator {
    return this.page.getByRole('region', { name: 'title and toolbar' });
  }

  /** Date as MM/dd/yyyy, offset by `daysFromToday` (e.g. -1 = yesterday). */
  static formatDate(daysFromToday = 0): string {
    const d = new Date();
    d.setDate(d.getDate() + daysFromToday);
    const mm = String(d.getMonth() + 1).padStart(2, '0');
    const dd = String(d.getDate()).padStart(2, '0');
    return `${mm}/${dd}/${d.getFullYear()}`;
  }

  /** Step 1: search for the policy holder by first/last name. */
  async searchPolicyByName(firstName: string, lastName: string): Promise<void> {
    await (await heal('policySearch.firstName', this.page, { role: 'textbox', name: 'First name' })).fill(firstName);
    await (await heal('policySearch.lastName', this.page, { role: 'textbox', name: 'Last name' })).fill(lastName);
    await (await heal('policySearch.searchButton', this.page, { role: 'button', name: 'Search', exact: true })).click();
    await heal('policySearch.resultRow', this.page, { role: 'row', name: /^Select / });
  }

  /** Step 1: search for a policy by its Policy # (e.g. one just issued in PolicyCenter). */
  async searchPolicyByNumber(policyNumber: string): Promise<void> {
    const policyNumberBox = await healLocator('policySearch.policyNumber', [
      this.page.locator('input[name$="FindPolicyPanelSet-policyNumber"]'),
      this.page.getByRole('textbox', { name: 'Policy #' }),
      this.page.getByLabel('Policy #'),
    ]);
    await policyNumberBox.fill(policyNumber);
    await (await heal('policySearch.searchButton', this.page, { role: 'button', name: 'Search', exact: true })).click();
    // A policy number matches one policy, which ClaimCenter selects by itself (the row then reads "Unselect ...")
    await heal('policySearch.resultRow', this.page, { role: 'row', name: /^(Select|Unselect) / });
  }

  /**
   * Step 1, after searching by Policy #: the insured and the term of the policy in the results list
   * (the row reads "Select <policy #> <insured> <address> <effective> <expiration> <type>").
   */
  async readPolicySearchResult(policyNumber: string): Promise<{ text: string; effectiveDate: string; expirationDate: string }> {
    const row = this.page.getByRole('row', { name: /^(Select|Unselect) / }).filter({ hasText: policyNumber }).first();
    await row.waitFor({ state: 'visible' });
    const text = (await row.innerText()).replace(/\s+/g, ' ').trim();
    const [effectiveDate, expirationDate] = text.match(/\d{2}\/\d{2}\/\d{4}/g) ?? [];
    if (!effectiveDate || !expirationDate) throw new Error(`Could not read the policy term from the search result "${text}"`);
    return { text, effectiveDate, expirationDate };
  }

  /**
   * Step 1: in the results list (which can span several pages) select the policy with the given
   * Policy # and Effective Date (MM/dd/yyyy).
   */
  async selectPolicy(policyNumber: string, effectiveDate: string): Promise<void> {
    const resultRows = this.page.getByRole('row', { name: /^Select / });
    // Already selected (a single search result is selected automatically)
    if (await this.page.getByRole('row', { name: /^Unselect / }).filter({ hasText: policyNumber }).count()) return;
    const nextPage = this.page.locator('[id$="PolicyResultLV-_ListPaging-next"]');
    const pagingToolbar = nextPage.locator('xpath=ancestor::*[@role="toolbar"][1]');
    for (;;) {
      await heal('policySearch.resultRow', this.page, { role: 'row', name: /^Select / });
      const row = resultRows.filter({ hasText: policyNumber }).filter({ hasText: effectiveDate });
      if (await row.count()) {
        await (await heal('policySearch.selectButton', row.first(), { role: 'button', name: 'Select' })).click();
        await heal('policySearch.unselectedRow', this.page, { role: 'row', name: /^Unselect / });
        return;
      }
      if (!(await nextPage.count()) || (await nextPage.getAttribute('aria-disabled')) === 'true') break;
      const pagingInfoBefore = (await pagingToolbar.getAttribute('aria-label')) ?? '';
      // The paging button can sit off-screen inside the scrolling grid and has been seen failing Playwright's
      // "stable" check, so scroll to it and click it with a real mouse click without the actionability wait.
      await nextPage.scrollIntoViewIfNeeded();
      await nextPage.click({ force: true });
      await expect(pagingToolbar).not.toHaveAttribute('aria-label', pagingInfoBefore);
    }
    throw new Error(`Policy ${policyNumber} (effective ${effectiveDate}) not found in the search results`);
  }

  /** The wizard's info bar (Pol / Ins / DoL) reflects the selected policy and Loss Date. */
  async expectInfoBar(policyNumber: string, lossDate: string): Promise<void> {
    const infoBar = await heal('wizard.infoBar', this.page, { role: 'group', name: 'info bar' });
    await expect(infoBar).toContainText(new RegExp(`Pol:\\s*${policyNumber}`));
    await expect(infoBar).toContainText(new RegExp(`DoL:\\s*${lossDate.replace(/\//g, '\\/')}`));
  }

  /** Step 1: set the Loss Date of the claim (the "New Claim" panel shown after a policy is selected), then Next. */
  async setLossDateAndNext(lossDate: string): Promise<void> {
    const lossDateInput = await healLocator('lossDate.input', [
      this.page.getByRole('group', { name: 'Loss Date' }).last().getByRole('textbox', { name: 'date input' }),
      this.page.getByRole('group', { name: 'Loss Date' }).last().getByRole('textbox'),
      this.page.getByRole('textbox', { name: 'date input' }).last(),
      this.page.getByLabel('Loss Date').last(),
    ]);
    await lossDateInput.fill(lossDate);
    await lossDateInput.press('Tab'); // commit the value
    await this.clickWizardNext();
    // A policy that is not in force on the loss date (e.g. issued today with a later effective date) only raises the
    // warning "This policy is not in force for the claim loss date. The claim will be flagged coverage in question."
    // Next again accepts it, as Finish does on the last step.
    const notInForce = this.page.getByText(/policy is not in force for the claim loss date/i).first();
    const step2 = this.page.getByRole('heading', { name: /^Step 2( of 5)?:/ });
    await expect(step2.or(notInForce).first()).toBeVisible();
    if (!(await step2.isVisible())) await this.clickWizardNext();
    await this.waitStepHeading(2);
  }

  /** Step 2: Basic information (reporter details), then Next. */
  async fillBasicInfoAndNext(howReported: string, reporterName: string, relation: string): Promise<void> {
    await (await heal('basicInfo.howReported', this.page, { role: 'combobox', name: 'How Reported', exact: true })).selectOption({ label: howReported });
    await (await heal('basicInfo.name', this.page, { role: 'combobox', name: 'Name', exact: true })).selectOption({ label: reporterName });
    await (await heal('basicInfo.relationToInsured', this.page, { role: 'combobox', name: 'Relation to Insured', exact: true })).selectOption({ label: relation });
    await this.clickWizardNext();
    await this.waitStepHeading(3);
  }

  /**
   * Step 3: Add claim information (Loss Cause, Location), then Next.
   * Optionally also sets the Fault Rating and adds an involved vehicle (which makes a business rule auto-create
   * the claim's Vehicle exposure).
   */
  async fillClaimInfoAndNext(lossCause: string, options: { faultRating?: string; vehicle?: string } = {}): Promise<void> {
    await (await heal('claimInfo.lossCause', this.page, { role: 'combobox', name: 'Loss Cause', exact: true })).selectOption({ label: lossCause });
    // First real entry after "<none>" - the insured's address
    await (await heal('claimInfo.location', this.page, { role: 'combobox', name: 'Location', exact: true })).selectOption({ index: 1 });
    if (options.faultRating) {
      await (await heal('claimInfo.faultRating', this.page, { role: 'combobox', name: 'Fault Rating', exact: true })).selectOption({ label: options.faultRating });
    }
    if (options.vehicle) await this.addVehicle(options.vehicle);
    await this.clickWizardNext();
    await this.waitStepHeading(4);
  }

  /** Step 3: "Add Vehicle" opens the Vehicle Details page; pick the vehicle and click OK to come back to step 3. */
  async addVehicle(vehicle: string): Promise<void> {
    await (await heal('claimInfo.addVehicle', this.page, { role: 'button', name: 'Add Vehicle' })).click();
    await heal('vehicleDetails.heading', this.page, { role: 'heading', name: 'Vehicle Details', level: 1 });
    await (await heal('vehicleDetails.selectVehicle', this.page, { role: 'combobox', name: 'Select vehicle' })).selectOption({ label: vehicle });
    await (await heal('vehicleDetails.ok', this.page, { role: 'button', name: 'OK', exact: true })).click();
    await this.waitStepHeading(3);
  }

  /** Step 3 without Next: Loss Cause, Location (the insured's address) and optionally the Fault Rating. */
  async fillLossDetails(lossCause: string, faultRating?: string): Promise<void> {
    await (await heal('claimInfo.lossCause', this.page, { role: 'combobox', name: 'Loss Cause', exact: true })).selectOption({ label: lossCause });
    await (await heal('claimInfo.location', this.page, { role: 'combobox', name: 'Location', exact: true })).selectOption({ index: 1 });
    if (faultRating) {
      await (await heal('claimInfo.faultRating', this.page, { role: 'combobox', name: 'Fault Rating', exact: true })).selectOption({ label: faultRating });
    }
  }

  /**
   * Step 3: "Add Vehicle" and return the vehicles listed on the policy (the "Select vehicle" options without
   * "(Newly Created)"). Stays on Vehicle Details: follow with chooseVehicle() or cancelVehicleDetails().
   */
  async listPolicyVehicles(): Promise<string[]> {
    await (await heal('claimInfo.addVehicle', this.page, { role: 'button', name: 'Add Vehicle' })).click();
    await heal('vehicleDetails.heading', this.page, { role: 'heading', name: 'Vehicle Details', level: 1 });
    const select = await heal('vehicleDetails.selectVehicle', this.page, { role: 'combobox', name: 'Select vehicle' });
    return (await select.locator('option').allInnerTexts()).map((o) => o.trim()).filter((o) => o && o !== '<none>' && !/Newly Created/i.test(o));
  }

  /** Vehicle Details: pick the vehicle and click OK to come back to step 3. */
  async chooseVehicle(vehicle: string): Promise<void> {
    await (await heal('vehicleDetails.selectVehicle', this.page, { role: 'combobox', name: 'Select vehicle' })).selectOption({ label: vehicle });
    await (await heal('vehicleDetails.ok', this.page, { role: 'button', name: 'OK', exact: true })).click();
    await this.waitStepHeading(3);
  }

  /** Vehicle Details: Cancel, back to step 3 without adding a vehicle. */
  async cancelVehicleDetails(): Promise<void> {
    await this.page.getByRole('button', { name: 'Cancel', exact: true }).first().click();
    await this.waitStepHeading(3);
  }

  /** Step 3: Next (after fillLossDetails / chooseVehicle). */
  async nextFromClaimInfo(): Promise<void> {
    await this.clickWizardNext();
    await this.waitStepHeading(4);
  }

  /**
   * Step 1 by Policy #, without failing when nothing matches: searches and returns the policy's insured and term, or
   * null when the search finds no policy with that number.
   */
  async findPolicyByNumber(policyNumber: string, timeoutMs = 20_000): Promise<{ text: string; effectiveDate: string; expirationDate: string } | null> {
    const policyNumberBox = await healLocator('policySearch.policyNumber', [
      this.page.locator('input[name$="FindPolicyPanelSet-policyNumber"]'),
      this.page.getByRole('textbox', { name: 'Policy #' }),
      this.page.getByLabel('Policy #'),
    ]);
    await policyNumberBox.fill(policyNumber);
    await (await heal('policySearch.searchButton', this.page, { role: 'button', name: 'Search', exact: true })).click();
    const row = this.page.getByRole('row', { name: /^(Select|Unselect) / }).filter({ hasText: policyNumber }).first();
    const found = await row.waitFor({ state: 'visible', timeout: timeoutMs }).then(() => true, () => false);
    return found ? this.readPolicySearchResult(policyNumber) : null;
  }

  /** New Claim wizard: Cancel (and confirm), discarding the draft claim. */
  async cancelNewClaimWizard(): Promise<void> {
    // ClaimCenter asks for confirmation with a browser confirm() dialog
    const accept = (d: import('@playwright/test').Dialog) => d.accept().catch(() => {});
    this.page.once('dialog', accept);
    await this.wizardToolbar.getByRole('button', { name: 'Cancel', exact: true }).click();
    const ok = this.page.getByRole('button', { name: 'OK', exact: true });
    if (await ok.isVisible({ timeout: 2000 }).catch(() => false)) await ok.click();
    await expect(this.page.getByRole('heading', { name: /^Step \d( of 5)?:/ })).toHaveCount(0);
    this.page.off('dialog', accept);
  }

  /** Step 4: Services (nothing required), then Next. */
  async goNextFromServices(): Promise<void> {
    await this.clickWizardNext();
    await this.waitStepHeading(5);
  }

  /** Step 5: Save and Assign Claim - click Finish. */
  async finishClaim(): Promise<void> {
    const finish = await healLocator('wizard.finish', [
      this.wizardToolbar.getByRole('button', { name: 'Finish', exact: true }),
      this.wizardToolbar.getByRole('button', { name: /^Finish/ }),
      this.wizardToolbar.locator('[id$="Finish"]'),
      this.page.getByRole('button', { name: 'Finish', exact: true }), // last resort if the toolbar region itself changed
    ]);
    await finish.click();
  }

  /**
   * Step 5 Finish when ClaimCenter may answer with a warning first (e.g. "This claim's coverage is in question.
   * Are you sure you want to complete this financial transaction?"): the first Finish shows the warning, a second
   * Finish accepts it.
   */
  async finishClaimAcceptingWarnings(): Promise<void> {
    await this.finishClaim();
    const saved = this.page.getByRole('heading', { name: 'New Claim Saved', level: 1 });
    const warnings = this.page.getByRole('heading', { name: 'Warnings:', level: 2 });
    await expect(saved.or(warnings).first()).toBeVisible();
    if (!(await saved.isVisible())) await this.finishClaim();
  }

  async expectNewClaimSaved(): Promise<void> {
    await heal('newClaimSaved.heading', this.page, { role: 'heading', name: 'New Claim Saved', level: 1 });
    await heal('newClaimSaved.message', this.page, { role: 'heading', name: /Claim .+ has been successfully saved\./, level: 3 });
  }

  /** On the "New Claim Saved" page: click "View <claim #>, the newly saved claim". */
  async viewNewlySavedClaim(): Promise<void> {
    const link = await healLocator('newClaimSaved.viewClaimLink', [
      this.page.getByRole('link', { name: /^View .+, the newly saved claim/ }),
      this.page.getByText(/the newly saved claim/i),
      this.page.locator('[id*="ViewClaim"]'),
    ]);
    await link.click();
    // The confirmation page is replaced by the claim once the link is followed
    await expect(this.page.getByRole('heading', { level: 1, name: 'New Claim Saved' })).toBeHidden();
  }

  /** The number of the claim that is open, read from the top menu item "Claim (000-00-000279)". */
  async readOpenClaimNumber(): Promise<string> {
    const claimMenu = await heal('claimMenu.openClaim', this.page, { role: 'menuitem', name: /^Claim \(.+\)$/ });
    const text = (await claimMenu.textContent()) ?? '';
    const claimNumber = text.match(/\(([^)]+)\)/)?.[1];
    if (!claimNumber) throw new Error(`Could not read the claim number from the menu item "${text.trim()}"`);
    return claimNumber;
  }

  private async openClaimTabDropdown(): Promise<void> {
    const expand = await healLocator('claimTab.expandButton', [
      this.page.locator('#TabBar-ClaimTab .gw-action--expand-button'),
      this.page.getByRole('menuitem', { name: 'Claim' }).first().locator('[class*="expand"]'),
      this.page.locator('[id^="TabBar-ClaimTab"] [class*="expand"]'),
    ]);
    await expand.click();
  }

  /** Claim tab dropdown: click the first claim of the recently viewed list (the one worked on last). */
  async openFirstRecentClaim(): Promise<string> {
    await this.openClaimTabDropdown();
    const first = await healLocator('claimTab.firstRecentClaim', [
      this.page.getByRole('menuitem', { name: /^\d{3}-\d{2}-\d{6} / }).first(),
      this.page.locator('[id^="TabBar-ClaimTab"] [role="menuitem"]').filter({ hasText: /^\d{3}-\d{2}-\d{6} / }).first(),
    ]);
    const claimNumber = ((await first.innerText()).match(/^\d{3}-\d{2}-\d{6}/) ?? [''])[0];
    await first.click();
    await heal('claimMenu.openClaim', this.page, { role: 'menuitem', name: `Claim (${claimNumber})` });
    return claimNumber;
  }

  /** Claim tab dropdown > "Find Claim" box: type the claim number and press Enter to open that claim. */
  async openClaimByNumber(claimNumber: string): Promise<void> {
    await this.openClaimTabDropdown();
    const findClaim = await healLocator('claimTab.findClaim', [
      this.page.locator('[name="TabBar-ClaimTab-ClaimTab_FindClaim"]'),
      this.page.getByRole('textbox', { name: /find claim/i }),
      this.page.locator('[name$="ClaimTab_FindClaim"]'),
    ]);
    await findClaim.fill(claimNumber);
    await findClaim.press('Enter');
    await heal('claimMenu.openClaim', this.page, { role: 'menuitem', name: `Claim (${claimNumber})` });
  }

  async expectNoSaveErrors(): Promise<void> {
    // Validation/save failures render in the message area as "Validation Results" / error messages.
    await expect(this.page.getByText(/Validation Results|error occurred|failed to save/i)).toHaveCount(0);
  }

  // ---------------------------------------------------------------------------
  // Exposure: update the vehicle incident of the claim's Vehicle exposure.
  // ---------------------------------------------------------------------------

  /**
   * ClaimCenter's "options" (dropdown arrow) menus only open when the pointer is over them first and the
   * click comes after, so hover, click, and click once more if the menu still did not open.
   */
  private async openOptionsMenu(button: Locator): Promise<void> {
    await button.hover();
    await button.click();
    if ((await button.getAttribute('aria-expanded')) !== 'true') await button.click();
    await expect(button).toHaveAttribute('aria-expanded', 'true');
  }

  /** Claim left menu > Exposures. */
  async openExposures(): Promise<void> {
    await (await heal('claimMenu.exposures', this.page, { role: 'menuitem', name: 'Exposures', exact: true })).click();
    await heal('exposures.heading', this.page, { role: 'heading', name: 'Exposures', level: 1 });
  }

  /** Exposures list: click the exposure's Type hyperlink (e.g. "Vehicle") to open it. */
  async openExposure(type: string): Promise<void> {
    await (await heal('exposures.typeLink', this.page, { role: 'link', name: type, exact: true })).click();
    await heal('exposureDetail.edit', this.page, { role: 'button', name: 'Edit', exact: true });
  }

  async clickEditExposure(): Promise<void> {
    await (await heal('exposureDetail.edit', this.page, { role: 'button', name: 'Edit', exact: true })).click();
    await heal('exposureDetail.update', this.page, { role: 'button', name: 'Update', exact: true });
  }

  /**
   * Exposure (in edit mode) > Incident Overview > Vehicle dropdown > "Edit Incident Details...", then on the
   * Vehicle Incident page set the driver, the damage description and where the loss occurred, and click OK.
   */
  async editVehicleIncidentDetails(driver: string, damageDescription: string, lossOccurred: string, relationToOwner?: string): Promise<void> {
    const options = await healLocator('exposureDetail.vehicleOptions', [
      this.page.locator('[id$="Vehicle_IncidentMenuIcon"]').getByRole('button', { name: 'options' }),
      this.page.getByRole('combobox', { name: 'Vehicle', exact: true }).locator('xpath=following::*[@role="button" and @aria-label="options"][1]'),
    ]);
    await this.openOptionsMenu(options);
    await (await heal('exposureDetail.editIncident', this.page, { role: 'menuitem', name: /Edit Incident Details/ })).click();
    await heal('vehicleIncident.heading', this.page, { role: 'heading', name: 'Vehicle Incident', level: 1 });
    await (await heal('vehicleIncident.driverName', this.page, { role: 'combobox', name: 'Driver Name' })).selectOption({ label: driver });
    // "Relation to Owner" is required; it is only preset for some drivers, so set it when asked and still empty
    if (relationToOwner) {
      const relation = await heal('vehicleIncident.relationToOwner', this.page, { role: 'combobox', name: 'Relation to Owner' });
      if ((await relation.evaluate((el: HTMLSelectElement) => el.selectedOptions[0]?.label ?? '')) === '<none>') {
        await relation.selectOption({ label: relationToOwner });
      }
    }
    await (await heal('vehicleIncident.damageDescription', this.page, { role: 'textbox', name: 'Damage Description' })).fill(damageDescription);
    await (await heal('vehicleIncident.lossOccurred', this.page, { role: 'combobox', name: 'Loss Occurred?' })).selectOption({ label: lossOccurred });
    await (await heal('vehicleIncident.ok', this.page, { role: 'button', name: 'OK', exact: true })).click();
    await heal('exposureDetail.update', this.page, { role: 'button', name: 'Update', exact: true });
  }

  /** Exposure (in edit mode): click Update and wait for the read-only exposure page. */
  async updateExposure(): Promise<void> {
    await (await heal('exposureDetail.update', this.page, { role: 'button', name: 'Update', exact: true })).click();
    await heal('exposureDetail.edit', this.page, { role: 'button', name: 'Edit', exact: true });
  }

  // ---------------------------------------------------------------------------
  // Financials: create a check (3-step Check wizard).
  // ---------------------------------------------------------------------------

  private checkStepHeading(n: number): Promise<Locator> {
    return heal(`check.step${n}Heading`, this.page, { role: 'heading', name: new RegExp(`^Step ${n} of 3:`) });
  }

  /**
   * Claim left menu > Financials > Transactions, showing all transaction types. The page remembers the last filter
   * (e.g. "Reserves" after creating a reserve, "Payments" after filtering), and a filtered list has no Type column.
   */
  async openTransactions(): Promise<void> {
    await (await heal('claimMenu.financials', this.page, { role: 'menuitem', name: 'Financials', exact: true })).click();
    await (await heal('claimMenu.transactions', this.page, { role: 'menuitem', name: 'Transactions', exact: true })).click();
    await heal('transactions.heading', this.page, { role: 'heading', name: /Transactions/, level: 1 });
    await this.selectTransactionsFilter('All transaction types');
  }

  /** The "All transaction types / Reserves / Payments ..." dropdown on Financials: Transactions. */
  private get transactionsFilter(): Locator {
    return this.page.getByRole('combobox').filter({ has: this.page.locator('option', { hasText: 'All transaction types' }) }).first();
  }

  /**
   * Selects a Transactions filter and makes sure it sticks. Each change reloads the list, and a change made while a
   * previous reload is still running is overwritten by it, so re-check after the list has settled and select again.
   */
  private async selectTransactionsFilter(kind: string): Promise<void> {
    await this.transactionsFilter.waitFor({ state: 'visible' });
    const selected = () => this.transactionsFilter.evaluate((el: HTMLSelectElement) => el.selectedOptions[0]?.label ?? '');
    await expect(async () => {
      if ((await selected()) !== kind) {
        await this.transactionsFilter.selectOption({ label: kind });
        await this.page.waitForTimeout(1500); // let the list reload
      }
      expect(await selected()).toBe(kind);
    }).toPass({ timeout: 60_000 });
  }

  /** The Status cell of the first transaction of the given type (Reserve / Payment ...) on Financials: Transactions. */
  async transactionStatus(type: string): Promise<string> {
    const row = await healLocator(`transactions.${type}Row`, [
      this.page.getByRole('row', { name: new RegExp(`^${type} `) }),
      this.page.getByRole('row').filter({ hasText: new RegExp(`^\\s*${type}\\b`) }),
    ]);
    // cells: Type, Date, Amount, View details, Exposure, Coverage, Cost Type, Cost Category, Status, User
    return ((await row.getByRole('cell').nth(8).innerText()) ?? '').trim();
  }

  /** Financials: Transactions: the first transaction of `type` has the expected status. */
  async expectTransactionStatus(type: string, status: string | RegExp): Promise<string> {
    let actual = '';
    await expect(async () => {
      actual = await this.transactionStatus(type);
      if (typeof status === 'string') expect(actual).toBe(status);
      else expect(actual).toMatch(status);
    }).toPass({ timeout: 60_000 });
    return actual;
  }

  /** Left panel "Actions" menu > Check: opens the Check wizard on Step 1 (Enter payee information). */
  async startCheckFromActions(): Promise<void> {
    const actions = await heal('actionsMenu.button', this.page, { role: 'button', name: /Actions/ });
    await actions.hover();
    await actions.click();
    await (await heal('actionsMenu.check', this.page, { role: 'menuitem', name: 'Check', exact: true })).click();
    await this.checkStepHeading(1);
  }

  /** Check wizard step 1: choose the primary payee by name, then Next. */
  async selectCheckPayeeAndNext(payeeName: string): Promise<void> {
    await (await heal('check.payeeName', this.page, { role: 'combobox', name: 'Name', exact: true })).selectOption({ label: payeeName });
    await this.clickWizardNext();
    await this.checkStepHeading(2);
  }

  /**
   * Check wizard step 2: select the reserve line (`reserveLineNumber` 1 = the first one, 2 = the second one ...),
   * the payment type (Partial/Final) and the amount, optionally apply the deductible
   * ("Apply Deductible: $500.00 Remaining"), then Next.
   */
  async enterCheckPaymentAndNext(
    paymentType: string,
    amount: string,
    options: { reserveLineNumber?: number; reserveLineName?: string; applyDeductible?: boolean } = {},
  ): Promise<void> {
    const { reserveLineNumber = 1, reserveLineName, applyDeductible = true } = options;
    // Changing a dropdown makes ClaimCenter refresh the form (re-selecting the same reserve line even clears the
    // payment type and cost type/category that were already filled in), so only change what is not already selected.
    const reserveLine = await heal('check.reserveLine', this.page, { role: 'combobox', name: 'Reserve Line' });
    // The list is "<none>" (only when no line is preselected), the real reserve lines, then "New...". A line reads like
    // "(1) 1st Party Vehicle - TEST ACCOUNT; Expense - A&O/Vehicle inspection". With reserveLineName the line whose label
    // contains it is used (a claim can have several lines, e.g. Auto body and Vehicle inspection), otherwise line number n.
    const wanted = await reserveLine.evaluate(
      (el: HTMLSelectElement, args: { n: number; name?: string }) => {
        const lines = Array.from(el.options).filter((o) => o.label !== '<none>' && o.label !== 'New...');
        const line = args.name ? lines.find((o) => o.label.includes(args.name!)) : lines[args.n - 1];
        return { label: line?.label ?? '', selected: el.selectedOptions[0]?.label ?? '', all: lines.map((o) => o.label) };
      },
      { n: reserveLineNumber, name: reserveLineName },
    );
    if (!wanted.label) {
      throw new Error(`The Reserve Line list has no ${reserveLineName ? `line "${reserveLineName}"` : `reserve line number ${reserveLineNumber}`}: ${wanted.all.join(' | ')}`);
    }
    if (wanted.selected !== wanted.label) await reserveLine.selectOption({ label: wanted.label });
    const paymentTypeSelect = await heal('check.paymentType', this.page, { role: 'combobox', name: 'Payment Type' });
    // Select the payment type and make sure it sticks: the form refreshes after the other fields change and can
    // reset it to "<none>", which then fails validation with 'Missing required field "Payment Type"'.
    const ensurePaymentType = async (): Promise<void> => {
      await expect(async () => {
        const current = await paymentTypeSelect.evaluate((el: HTMLSelectElement) => el.selectedOptions[0]?.label ?? '');
        if (current !== paymentType) await paymentTypeSelect.selectOption({ label: paymentType });
        await this.page.waitForTimeout(500);
        expect(await paymentTypeSelect.evaluate((el: HTMLSelectElement) => el.selectedOptions[0]?.label ?? '')).toBe(paymentType);
      }).toPass({ timeout: 60_000 });
    };
    await ensurePaymentType();
    const amountField = await healLocator('check.lineItemAmount', [
      this.page.getByRole('group', { name: /Line Items Amount/ }).getByRole('textbox').first(),
      this.page.getByRole('textbox', { name: /^\$/ }).first(),
    ]);
    await amountField.fill(amount);
    await amountField.press('Tab'); // commit the value
    await ensurePaymentType(); // entering the amount refreshes the form, so check the payment type again
    if (applyDeductible) await (await heal('check.applyDeductible', this.page, { role: 'button', name: /Apply Deductible/ })).click();
    await this.clickWizardNext();
    await this.checkStepHeading(3);
  }

  /** Financials: Transactions: filter the list with the "All transaction types" dropdown (Payments, Reserves ...). */
  async filterTransactions(kind: string): Promise<void> {
    await this.selectTransactionsFilter(kind);
  }

  /**
   * Financials: Transactions filtered on Payments: every payment has the given status (and there are exactly
   * `expectedCount` payments, when given).
   */
  async expectPaymentsStatus(status: string, expectedCount?: number): Promise<void> {
    const rows = this.page.getByRole('row').filter({ has: this.page.getByRole('cell', { name: /^(Partial|Final)$/ }) });
    await expect(async () => {
      const count = await rows.count();
      expect(count).toBeGreaterThan(0);
      if (expectedCount !== undefined) expect(count).toBe(expectedCount);
      for (let i = 0; i < count; i++) {
        // cells: Scheduled Send Date, Issue Date, Amount, View details, Exposure, Coverage, Cost Type, Cost Category, Status ...
        expect((await rows.nth(i).getByRole('cell').nth(8).innerText()).trim(), `status of payment ${i + 1}`).toBe(status);
      }
    }).toPass({ timeout: 60_000 });
  }

  /** Claim left menu > Financials > Summary. */
  async openFinancialsSummary(): Promise<void> {
    // The Financials submenu (Summary, Transactions ...) only shows once Financials is expanded
    if ((await this.page.getByRole('menuitem', { name: 'Transactions', exact: true }).count()) === 0) {
      await (await heal('claimMenu.financials', this.page, { role: 'menuitem', name: 'Financials', exact: true })).click();
      await this.page.getByRole('menuitem', { name: 'Transactions', exact: true }).first().waitFor({ state: 'visible' });
    }
    const summary = await healLocator('claimMenu.financialsSummary', [
      // the first "Summary" is the claim's own, the second one is under Financials
      this.page.getByRole('menuitem', { name: 'Summary', exact: true }).nth(1),
      this.page.getByRole('menuitem', { name: 'Summary', exact: true }).last(),
    ]);
    await summary.click();
    await heal('financialsSummary.heading', this.page, { role: 'heading', name: 'Financials: Summary', level: 1 });
  }

  /**
   * Financials: Summary: the Remaining Reserves and Total Paid of a reserve line (e.g. "Vehicle inspection USD"), in cents.
   * The summary is a tree of nested rows (claim > exposure > cost type > reserve line), so the last row that contains the
   * line's name is the line itself. Empty cells and "-" read as 0.
   */
  async readReserveLine(reserveLine: string): Promise<{ remaining: number; paid: number } | null> {
    // The table is drawn with the page; once its Claim Total row shows, a missing line really is missing
    await this.page.getByRole('row').filter({ hasText: 'Claim Total' }).first().waitFor({ state: 'visible' }).catch(() => {});
    const row = this.page.getByRole('row').filter({ hasText: reserveLine }).last();
    if ((await row.count()) === 0) return null;
    const cents = async (column: string): Promise<number> => {
      const text = ((await row.locator(`[id$="${column}_Cell"]`).last().innerText()) ?? '').trim();
      const m = text.match(/-?\$?\s*([\d,]+(?:\.\d{1,2})?)/);
      return m ? Math.round(parseFloat(m[1].replace(/,/g, '')) * 100) : 0;
    };
    return { remaining: await cents('RemainingReserves'), paid: await cents('TotalPayments') };
  }

  /**
   * Exposures > select the exposure > Create Reserve, then on Edit Reserves set the New Available Reserves of the
   * exposure's cost type / cost category line to `amount` and Save. An existing line is updated; otherwise the blank
   * new line at the bottom is filled in (Exposure, Cost Type, Cost Category).
   */
  async setReserve(opts: { exposureType: string; exposure: string; costType: string; costCategory: string; amount: string }): Promise<void> {
    // exposureType is the Type shown on the Exposures list ("Vehicle"); exposure is how Edit Reserves names it ("1st Party Vehicle")
    await this.openExposures();
    const exposureRow = this.page.getByRole('row').filter({ has: this.page.getByRole('link', { name: opts.exposureType, exact: true }) }).last();
    const hasExposure = await exposureRow.waitFor({ state: 'visible', timeout: 10_000 }).then(() => true, () => false);
    if (!hasExposure) throw new Error(`The claim has no "${opts.exposureType}" exposure to put a reserve on`);
    await exposureRow.getByRole('checkbox').first().click();
    await (await heal('exposures.createReserve', this.page, { role: 'button', name: 'Create Reserve', exact: true })).click();
    await heal('editReserves.heading', this.page, { role: 'heading', name: 'Edit Reserves', level: 1 });

    // Existing lines show Exposure / Cost Type / Cost Category as text; the blank new line has dropdowns, whose option
    // lists contain every category name, so it (and the table rows around it) must not count as an existing line
    const lineRows = this.page.getByRole('row')
      .filter({ has: this.page.locator('[name$="-NewAmount"]') })
      .filter({ hasNot: this.page.locator('select') });
    const existing = lineRows.filter({ hasText: opts.costCategory }).filter({ hasText: opts.exposure });
    let amountBox: Locator;
    if (await existing.count()) {
      amountBox = existing.last().locator('[name$="-NewAmount"]');
    } else {
      // The blank line: pick each dropdown by (partial) label; every change refreshes the row, so re-find it each time
      const choose = async (suffix: string, wanted: string) => {
        const select = this.page.locator(`select[name*="EditableReservesLV-"][name$="-${suffix}"]`).last();
        const label = await select.evaluate((el: HTMLSelectElement, w: string) =>
          Array.from(el.options).map((o) => o.label).find((l) => l === w) ?? Array.from(el.options).map((o) => o.label).find((l) => l.includes(w)) ?? '', wanted);
        if (!label) throw new Error(`Edit Reserves: no "${wanted}" in the ${suffix} list: ${(await select.locator('option').allInnerTexts()).join(' | ')}`);
        await select.selectOption({ label });
        await expect(this.page.locator(`select[name*="EditableReservesLV-"][name$="-${suffix}"]`).last()).toHaveValue(/.+/);
        await this.page.waitForTimeout(800); // the row re-renders after each change
      };
      await choose('Exposure', opts.exposure);
      await choose('CostType', opts.costType);
      await choose('CostCategory', opts.costCategory);
      amountBox = this.page.locator('input[name*="EditableReservesLV-"][name$="-NewAmount"]').last();
    }
    await amountBox.fill(opts.amount);
    await amountBox.press('Tab');
    const heading = this.page.getByRole('heading', { name: 'Edit Reserves', level: 1 });
    const save = async () => (await heal('editReserves.save', this.page, { role: 'button', name: 'Save', exact: true })).click();
    await save();
    // Either the page closes, or a warning (e.g. coverage in question) keeps it open and Save again accepts it.
    // A validation error (e.g. "Missing required field") also keeps it open: fail with ClaimCenter's message.
    const warnings = this.page.getByRole('heading', { name: 'Warnings:', level: 2 });
    const errors = this.page.getByRole('heading', { name: /^Errors?:/ });
    await expect(async () => {
      expect(!(await heading.isVisible()) || (await warnings.first().isVisible()) || (await errors.first().isVisible())).toBe(true);
    }).toPass({ timeout: 30_000 });
    if (await errors.first().isVisible().catch(() => false)) {
      const message = (await this.page.getByRole('main').innerText()).match(/Errors?:[\s\S]{0,400}/)?.[0] ?? 'unknown error';
      throw new Error(`Edit Reserves could not be saved: ${message.replace(/\s+/g, ' ')}`);
    }
    if (await heading.isVisible()) await save();
    await expect(heading).toBeHidden();
  }

  /** Financials: Summary: open the dropdown of a reserve line (e.g. "Vehicle inspection USD") and click "Create Check". */
  async createCheckFromSummary(reserveLine: string): Promise<void> {
    // The summary is a tree of nested rows, so the outer (claim / exposure) rows also contain the line's name and have
    // options menus of their own: the last matching row is the reserve line itself
    const row = this.page.getByRole('row').filter({ hasText: reserveLine }).last();
    await this.openOptionsMenu(await healLocator('financialsSummary.reserveOptions', [row.getByRole('button', { name: 'options' })]));
    await (await heal('financialsSummary.createCheck', this.page, { role: 'menuitem', name: 'Create Check' })).click();
    await this.checkStepHeading(1);
  }

  // ---------------------------------------------------------------------------
  // Server Tools (Alt+Shift+T): run a batch process, then go back to ClaimCenter.
  // ---------------------------------------------------------------------------

  /** Alt+Shift+T opens Server Tools on the "Batch Process Info" page. */
  async openBatchProcessInfo(): Promise<void> {
    await this.page.keyboard.press('Alt+Shift+T');
    await heal('serverTools.batchHeading', this.page, { role: 'heading', name: 'Batch Process Info', level: 1 });
  }

  /**
   * Batch Process Info: click Run on the named process, wait 2 seconds, then Refresh until its Last Run time has
   * changed and its Last Run Status is "Completed".
   */
  async runBatchProcess(name: string): Promise<void> {
    const row = this.page.getByRole('row').filter({ has: this.page.getByRole('cell', { name, exact: true }) });
    const before = await row.innerText();
    await (await healLocator(`serverTools.run.${name}`, [row.getByRole('button', { name: 'Run' })])).click();
    await this.page.waitForTimeout(2000);
    const refresh = await heal('serverTools.refresh', this.page, { role: 'button', name: 'Refresh', exact: true });
    await expect(async () => {
      await refresh.click();
      const after = await row.innerText();
      expect(after).toContain('Completed');
      expect(after).not.toEqual(before); // the Last Run time moved on, so this run really happened
    }).toPass({ timeout: 60_000 });
  }

  /** Server Tools: Actions menu > Return to ClaimCenter. */
  async returnToClaimCenter(): Promise<void> {
    const actions = await heal('serverTools.actions', this.page, { role: 'button', name: 'Actions', exact: true });
    await actions.hover();
    await actions.click();
    await (await heal('serverTools.returnToClaimCenter', this.page, { role: 'menuitem', name: 'Return to ClaimCenter' })).click();
    await heal('main.claimMenu', this.page, { role: 'menuitem', name: 'Claim' });
  }

  /**
   * Check wizard step 3: Finish. ClaimCenter first answers with the warning "This claim's coverage is in
   * question. Are you sure you want to complete this financial transaction?"; a second Finish accepts it.
   */
  async finishCheck(): Promise<void> {
    await this.finishClaim();
    const step3 = this.page.getByRole('heading', { name: /^Step 3 of 3:/, level: 1 });
    const warnings = this.page.getByRole('heading', { name: 'Warnings:', level: 2 });
    // Wait until the wizard either closed (no warning) or is showing the warning.
    await expect(async () => {
      expect((await warnings.first().isVisible()) || !(await step3.isVisible())).toBe(true);
    }).toPass({ timeout: 60_000 });
    if (await step3.isVisible()) await this.finishClaim();
    await expect(step3).toBeHidden();
  }

  // ---------------------------------------------------------------------------
  // Page elements. Each is described once as a HealSpec; the getter returns the primary locator and every
  // action method resolves the element through `el()`, which self-heals (see utils/selfHealing.ts).
  // ---------------------------------------------------------------------------
  private readonly spec = {
    findclaimInput: { css: "[name=\"TabBar-ClaimTab-ClaimTab_FindClaim\"]" },
    quickjumpInput: { css: "[name=\"QuickJump\"]" },
    desktopactivitiesfilterDropdown: { css: "[name=\"DesktopActivities-DesktopActivitiesScreen-DesktopActivitiesLV-DesktopActivitiesFilter\"]" },
    interactiveElementButton: { text: "Statistics", exact: true },
    interactiveElementButton2: { text: "Preferences", exact: true },
    interactiveElementButton3: { text: "Vacation Status", exact: true },
    activities0Button: { role: "menuitem", name: "Activities (0)" },
    claims0Button: { role: "menuitem", name: "Claims (0)" },
    exposures0Button: { role: "menuitem", name: "Exposures (0)" },
    subrogations0Button: { role: "menuitem", name: "Subrogations (0)" },
    pendingAssignments0Button: { role: "menuitem", name: "Pending Assignments (0)" },
    queues0Button: { role: "menuitem", name: "Queues (0)" },
    interactiveElementButton4: { text: "My Calendar", exact: true },
    interactiveElementButton5: { text: "Supervisor Calendar", exact: true },
    bulkInvoicesButton: { role: "menuitem", name: "Bulk Invoices" },
    interactiveElementButton6: { text: "New Claim", exact: true },
    interactiveElementButton7: { css: "#TabBar-ClaimTab-ClaimTab_FindClaim_Button" },
    _000000000003RayNewtonButton: { role: "menuitem", name: "0000-00-000003 Ray Newton" },
    _000000000006RayNewtonButton: { role: "menuitem", name: "0000-00-000006 Ray Newton" },
    _000000000015RayNewtonButton: { role: "menuitem", name: "0000-00-000015 Ray Newton" },
    _000000000009RayNewtonButton: { role: "menuitem", name: "0000-00-000009 Ray Newton" },
    _000000000018RayNewtonButton: { role: "menuitem", name: "0000-00-000018 Ray Newton" },
    _000000000021RayNewtonButton: { role: "menuitem", name: "0000-00-000021 Ray Newton" },
    _000000000024RayNewtonButton: { role: "menuitem", name: "0000-00-000024 Ray Newton" },
    _000000000030RayNewtonButton: { role: "menuitem", name: "0000-00-000030 Ray Newton" },
    _000000000012RayNewtonButton: { role: "menuitem", name: "0000-00-000012 Ray Newton" },
    searchButton: { role: "menuitem", name: "Search" },
    searchButton2: { css: "#TabBar-SearchTab-Search_ClaimSearchesGroup .gw-action--expand-button" },
    searchButton3: { role: "menuitem", name: "SSimple Search" },
    searchButton4: { text: "Advanced Search", exact: true },
    activitiesButton: { role: "menuitem", name: "Activities" },
    interactiveElementButton8: { text: "Checks", exact: true },
    interactiveElementButton9: { text: "Recoveries", exact: true },
    dashboardButton: { role: "menuitem", name: "Dashboard" },
    teamButton: { role: "menuitem", name: "Team" },
    interactiveElementButton10: { css: "div[aria-label=\"more options\"]" },
    searchButton5: { text: "Claim Search", exact: true },
    interactiveElementButton11: { text: "Claim Overview", exact: true },
    administrationButton: { role: "menuitem", name: "Administration" },
    interactiveElementButton12: { text: "Print User Group Tree", exact: true },
    interactiveElementButton13: { text: "Vacation", exact: true },
    interactiveElementButton14: { css: "div[aria-label=\"Unsaved Work\"]" },
    interactiveElementButton15: { css: "div[aria-label=\"settings\"]" },
    interactiveElementButton16: { text: "International", exact: true },
    interactiveElementButton17: { text: "Edge Policyholder English (US)", exact: true },
    interactiveElementButton18: { text: "EUEnglish (US)", exact: true },
    eedgeEnglishUSButton: { role: "menuitem", name: "EEdge English (US)" },
    interactiveElementButton19: { text: "AEAustralia (English)", exact: true },
    interactiveElementButton20: { text: "CECanada (English)", exact: true },
    interactiveElementButton21: { text: "CFCanada (French)", exact: true },
    ffranceFrenchButton: { role: "menuitem", name: "FFrance (French)" },
    ggermanyGermanButton: { role: "menuitem", name: "GGermany (German)" },
    interactiveElementButton22: { text: "Great Britain (English)", exact: true },
    jjapanJapaneseButton: { role: "menuitem", name: "JJapan (Japanese)" },
    interactiveElementButton23: { text: "United States (English)", exact: true },
    interactiveElementButton24: { text: "About", exact: true },
    interactiveElementButton25: { text: "Settings...", exact: true },
    interactiveElementButton26: { text: "Reload PCFs", exact: true },
    interactiveElementButton27: { text: "Log Out Super User", exact: true },
    assignButton: { role: "button", name: "Assign" },
    skipButton: { role: "button", name: "Skip" },
    completeButton: { role: "button", name: "Complete" },
    approveButton: { role: "button", name: "Approve" },
    rejectButton: { role: "button", name: "Reject" },
    peprintExportButton: { role: "button", name: "PEPrint/Export" },
    resetCustomizedColumnsButton: { role: "button", name: "Reset Customized Columns" },
    interactiveElementButton28: { css: "div[aria-label=\"group by column Due\"]" },
    interactiveElementButton29: { css: "div[aria-label=\"group by column Priority\"]" },
    interactiveElementButton30: { css: "div[aria-label=\"group by column Subject\"]" },
    interactiveElementButton31: { css: "div[aria-label=\"group by column Claim\"]" },
    interactiveElementButton32: { css: "div[aria-label=\"group by column Insured\"]" },
    interactiveElementButton33: { css: "div[aria-label=\"group by column External\"]" },
    interactiveElementButton34: { css: "div[aria-label=\"group by column LOB\"]" },
    interactiveElementButton35: { css: "div[aria-label=\"group by column State\"]" },
    duedateheaderButton: { css: "#DesktopActivities-DesktopActivitiesScreen-DesktopActivitiesLV-DueDateHeader" },
    priorityheaderButton: { css: "#DesktopActivities-DesktopActivitiesScreen-DesktopActivitiesLV-PriorityHeader" },
    subjectheaderButton: { css: "#DesktopActivities-DesktopActivitiesScreen-DesktopActivitiesLV-SubjectHeader" },
    caseidheaderButton: { css: "#DesktopActivities-DesktopActivitiesScreen-DesktopActivitiesLV-CaseIDHeader" },
    insuredheaderButton: { css: "#DesktopActivities-DesktopActivitiesScreen-DesktopActivitiesLV-InsuredHeader" },
    externallyownedheaderButton: { css: "#DesktopActivities-DesktopActivitiesScreen-DesktopActivitiesLV-ExternallyOwnedHeader" },
    lobheaderButton: { css: "#DesktopActivities-DesktopActivitiesScreen-DesktopActivitiesLV-LOBHeader" },
    stateheaderButton: { css: "#DesktopActivities-DesktopActivitiesScreen-DesktopActivitiesLV-StateHeader" },
  } satisfies Record<string, HealSpec>;

  /** Resolve a named element to a visible locator, falling back to alternative strategies if the primary breaks. */
  private el(name: keyof ClaimcenterPage['spec']): Promise<Locator> {
    return heal(name, this.page, this.spec[name]);
  }

  get findclaimInput(): Locator { return primaryFor(this.page, this.spec.findclaimInput); }
  get quickjumpInput(): Locator { return primaryFor(this.page, this.spec.quickjumpInput); }
  get desktopactivitiesfilterDropdown(): Locator { return primaryFor(this.page, this.spec.desktopactivitiesfilterDropdown); }
  get interactiveElementButton(): Locator { return primaryFor(this.page, this.spec.interactiveElementButton); }
  get interactiveElementButton2(): Locator { return primaryFor(this.page, this.spec.interactiveElementButton2); }
  get interactiveElementButton3(): Locator { return primaryFor(this.page, this.spec.interactiveElementButton3); }
  get activities0Button(): Locator { return primaryFor(this.page, this.spec.activities0Button); }
  get claims0Button(): Locator { return primaryFor(this.page, this.spec.claims0Button); }
  get exposures0Button(): Locator { return primaryFor(this.page, this.spec.exposures0Button); }
  get subrogations0Button(): Locator { return primaryFor(this.page, this.spec.subrogations0Button); }
  get pendingAssignments0Button(): Locator { return primaryFor(this.page, this.spec.pendingAssignments0Button); }
  get queues0Button(): Locator { return primaryFor(this.page, this.spec.queues0Button); }
  get interactiveElementButton4(): Locator { return primaryFor(this.page, this.spec.interactiveElementButton4); }
  get interactiveElementButton5(): Locator { return primaryFor(this.page, this.spec.interactiveElementButton5); }
  get bulkInvoicesButton(): Locator { return primaryFor(this.page, this.spec.bulkInvoicesButton); }
  get interactiveElementButton6(): Locator { return primaryFor(this.page, this.spec.interactiveElementButton6); }
  get interactiveElementButton7(): Locator { return primaryFor(this.page, this.spec.interactiveElementButton7); }
  get _000000000003RayNewtonButton(): Locator { return primaryFor(this.page, this.spec._000000000003RayNewtonButton); }
  get _000000000006RayNewtonButton(): Locator { return primaryFor(this.page, this.spec._000000000006RayNewtonButton); }
  get _000000000015RayNewtonButton(): Locator { return primaryFor(this.page, this.spec._000000000015RayNewtonButton); }
  get _000000000009RayNewtonButton(): Locator { return primaryFor(this.page, this.spec._000000000009RayNewtonButton); }
  get _000000000018RayNewtonButton(): Locator { return primaryFor(this.page, this.spec._000000000018RayNewtonButton); }
  get _000000000021RayNewtonButton(): Locator { return primaryFor(this.page, this.spec._000000000021RayNewtonButton); }
  get _000000000024RayNewtonButton(): Locator { return primaryFor(this.page, this.spec._000000000024RayNewtonButton); }
  get _000000000030RayNewtonButton(): Locator { return primaryFor(this.page, this.spec._000000000030RayNewtonButton); }
  get _000000000012RayNewtonButton(): Locator { return primaryFor(this.page, this.spec._000000000012RayNewtonButton); }
  get searchButton(): Locator { return primaryFor(this.page, this.spec.searchButton); }
  get searchButton2(): Locator { return primaryFor(this.page, this.spec.searchButton2); }
  get searchButton3(): Locator { return primaryFor(this.page, this.spec.searchButton3); }
  get searchButton4(): Locator { return primaryFor(this.page, this.spec.searchButton4); }
  get activitiesButton(): Locator { return primaryFor(this.page, this.spec.activitiesButton); }
  get interactiveElementButton8(): Locator { return primaryFor(this.page, this.spec.interactiveElementButton8); }
  get interactiveElementButton9(): Locator { return primaryFor(this.page, this.spec.interactiveElementButton9); }
  get dashboardButton(): Locator { return primaryFor(this.page, this.spec.dashboardButton); }
  get teamButton(): Locator { return primaryFor(this.page, this.spec.teamButton); }
  get interactiveElementButton10(): Locator { return primaryFor(this.page, this.spec.interactiveElementButton10); }
  get searchButton5(): Locator { return primaryFor(this.page, this.spec.searchButton5); }
  get interactiveElementButton11(): Locator { return primaryFor(this.page, this.spec.interactiveElementButton11); }
  get administrationButton(): Locator { return primaryFor(this.page, this.spec.administrationButton); }
  get interactiveElementButton12(): Locator { return primaryFor(this.page, this.spec.interactiveElementButton12); }
  get interactiveElementButton13(): Locator { return primaryFor(this.page, this.spec.interactiveElementButton13); }
  get interactiveElementButton14(): Locator { return primaryFor(this.page, this.spec.interactiveElementButton14); }
  get interactiveElementButton15(): Locator { return primaryFor(this.page, this.spec.interactiveElementButton15); }
  get interactiveElementButton16(): Locator { return primaryFor(this.page, this.spec.interactiveElementButton16); }
  get interactiveElementButton17(): Locator { return primaryFor(this.page, this.spec.interactiveElementButton17); }
  get interactiveElementButton18(): Locator { return primaryFor(this.page, this.spec.interactiveElementButton18); }
  get eedgeEnglishUSButton(): Locator { return primaryFor(this.page, this.spec.eedgeEnglishUSButton); }
  get interactiveElementButton19(): Locator { return primaryFor(this.page, this.spec.interactiveElementButton19); }
  get interactiveElementButton20(): Locator { return primaryFor(this.page, this.spec.interactiveElementButton20); }
  get interactiveElementButton21(): Locator { return primaryFor(this.page, this.spec.interactiveElementButton21); }
  get ffranceFrenchButton(): Locator { return primaryFor(this.page, this.spec.ffranceFrenchButton); }
  get ggermanyGermanButton(): Locator { return primaryFor(this.page, this.spec.ggermanyGermanButton); }
  get interactiveElementButton22(): Locator { return primaryFor(this.page, this.spec.interactiveElementButton22); }
  get jjapanJapaneseButton(): Locator { return primaryFor(this.page, this.spec.jjapanJapaneseButton); }
  get interactiveElementButton23(): Locator { return primaryFor(this.page, this.spec.interactiveElementButton23); }
  get interactiveElementButton24(): Locator { return primaryFor(this.page, this.spec.interactiveElementButton24); }
  get interactiveElementButton25(): Locator { return primaryFor(this.page, this.spec.interactiveElementButton25); }
  get interactiveElementButton26(): Locator { return primaryFor(this.page, this.spec.interactiveElementButton26); }
  get interactiveElementButton27(): Locator { return primaryFor(this.page, this.spec.interactiveElementButton27); }
  get assignButton(): Locator { return primaryFor(this.page, this.spec.assignButton); }
  get skipButton(): Locator { return primaryFor(this.page, this.spec.skipButton); }
  get completeButton(): Locator { return primaryFor(this.page, this.spec.completeButton); }
  get approveButton(): Locator { return primaryFor(this.page, this.spec.approveButton); }
  get rejectButton(): Locator { return primaryFor(this.page, this.spec.rejectButton); }
  get peprintExportButton(): Locator { return primaryFor(this.page, this.spec.peprintExportButton); }
  get resetCustomizedColumnsButton(): Locator { return primaryFor(this.page, this.spec.resetCustomizedColumnsButton); }
  get interactiveElementButton28(): Locator { return primaryFor(this.page, this.spec.interactiveElementButton28); }
  get interactiveElementButton29(): Locator { return primaryFor(this.page, this.spec.interactiveElementButton29); }
  get interactiveElementButton30(): Locator { return primaryFor(this.page, this.spec.interactiveElementButton30); }
  get interactiveElementButton31(): Locator { return primaryFor(this.page, this.spec.interactiveElementButton31); }
  get interactiveElementButton32(): Locator { return primaryFor(this.page, this.spec.interactiveElementButton32); }
  get interactiveElementButton33(): Locator { return primaryFor(this.page, this.spec.interactiveElementButton33); }
  get interactiveElementButton34(): Locator { return primaryFor(this.page, this.spec.interactiveElementButton34); }
  get interactiveElementButton35(): Locator { return primaryFor(this.page, this.spec.interactiveElementButton35); }
  get duedateheaderButton(): Locator { return primaryFor(this.page, this.spec.duedateheaderButton); }
  get priorityheaderButton(): Locator { return primaryFor(this.page, this.spec.priorityheaderButton); }
  get subjectheaderButton(): Locator { return primaryFor(this.page, this.spec.subjectheaderButton); }
  get caseidheaderButton(): Locator { return primaryFor(this.page, this.spec.caseidheaderButton); }
  get insuredheaderButton(): Locator { return primaryFor(this.page, this.spec.insuredheaderButton); }
  get externallyownedheaderButton(): Locator { return primaryFor(this.page, this.spec.externallyownedheaderButton); }
  get lobheaderButton(): Locator { return primaryFor(this.page, this.spec.lobheaderButton); }
  get stateheaderButton(): Locator { return primaryFor(this.page, this.spec.stateheaderButton); }

  async enterFindclaim(value: string): Promise<void> { await (await this.el('findclaimInput')).fill(value); }
  async enterQuickjump(value: string): Promise<void> { await (await this.el('quickjumpInput')).fill(value); }
  async selectDesktopactivitiesfilter(value: string): Promise<void> { await (await this.el('desktopactivitiesfilterDropdown')).selectOption(value); }
  async clickInteractiveElementButton(): Promise<void> { await (await this.el('interactiveElementButton')).click(); }
  async clickInteractiveElementButton2(): Promise<void> { await (await this.el('interactiveElementButton2')).click(); }
  async clickInteractiveElementButton3(): Promise<void> { await (await this.el('interactiveElementButton3')).click(); }
  async clickActivities0Button(): Promise<void> { await (await this.el('activities0Button')).click(); }
  async clickClaims0Button(): Promise<void> { await (await this.el('claims0Button')).click(); }
  async clickExposures0Button(): Promise<void> { await (await this.el('exposures0Button')).click(); }
  async clickSubrogations0Button(): Promise<void> { await (await this.el('subrogations0Button')).click(); }
  async clickPendingAssignments0Button(): Promise<void> { await (await this.el('pendingAssignments0Button')).click(); }
  async clickQueues0Button(): Promise<void> { await (await this.el('queues0Button')).click(); }
  async clickInteractiveElementButton4(): Promise<void> { await (await this.el('interactiveElementButton4')).click(); }
  async clickInteractiveElementButton5(): Promise<void> { await (await this.el('interactiveElementButton5')).click(); }
  async clickBulkInvoicesButton(): Promise<void> { await (await this.el('bulkInvoicesButton')).click(); }
  async clickInteractiveElementButton6(): Promise<void> { await (await this.el('interactiveElementButton6')).click(); }
  async clickInteractiveElementButton7(): Promise<void> { await (await this.el('interactiveElementButton7')).click(); }
  async click_000000000003RayNewtonButton(): Promise<void> { await (await this.el('_000000000003RayNewtonButton')).click(); }
  async click_000000000006RayNewtonButton(): Promise<void> { await (await this.el('_000000000006RayNewtonButton')).click(); }
  async click_000000000015RayNewtonButton(): Promise<void> { await (await this.el('_000000000015RayNewtonButton')).click(); }
  async click_000000000009RayNewtonButton(): Promise<void> { await (await this.el('_000000000009RayNewtonButton')).click(); }
  async click_000000000018RayNewtonButton(): Promise<void> { await (await this.el('_000000000018RayNewtonButton')).click(); }
  async click_000000000021RayNewtonButton(): Promise<void> { await (await this.el('_000000000021RayNewtonButton')).click(); }
  async click_000000000024RayNewtonButton(): Promise<void> { await (await this.el('_000000000024RayNewtonButton')).click(); }
  async click_000000000030RayNewtonButton(): Promise<void> { await (await this.el('_000000000030RayNewtonButton')).click(); }
  async click_000000000012RayNewtonButton(): Promise<void> { await (await this.el('_000000000012RayNewtonButton')).click(); }
  async clickSearchButton(): Promise<void> { await (await this.el('searchButton')).click(); }
  async clickSearchButton2(): Promise<void> { await (await this.el('searchButton2')).click(); }
  async clickSearchButton3(): Promise<void> { await (await this.el('searchButton3')).click(); }
  async clickSearchButton4(): Promise<void> { await (await this.el('searchButton4')).click(); }
  async clickActivitiesButton(): Promise<void> { await (await this.el('activitiesButton')).click(); }
  async clickInteractiveElementButton8(): Promise<void> { await (await this.el('interactiveElementButton8')).click(); }
  async clickInteractiveElementButton9(): Promise<void> { await (await this.el('interactiveElementButton9')).click(); }
  async clickDashboardButton(): Promise<void> { await (await this.el('dashboardButton')).click(); }
  async clickTeamButton(): Promise<void> { await (await this.el('teamButton')).click(); }
  async clickInteractiveElementButton10(): Promise<void> { await (await this.el('interactiveElementButton10')).click(); }
  async clickSearchButton5(): Promise<void> { await (await this.el('searchButton5')).click(); }
  async clickInteractiveElementButton11(): Promise<void> { await (await this.el('interactiveElementButton11')).click(); }
  async clickAdministrationButton(): Promise<void> { await (await this.el('administrationButton')).click(); }
  async clickInteractiveElementButton12(): Promise<void> { await (await this.el('interactiveElementButton12')).click(); }
  async clickInteractiveElementButton13(): Promise<void> { await (await this.el('interactiveElementButton13')).click(); }
  async clickInteractiveElementButton14(): Promise<void> { await (await this.el('interactiveElementButton14')).click(); }
  async clickInteractiveElementButton15(): Promise<void> { await (await this.el('interactiveElementButton15')).click(); }
  async clickInteractiveElementButton16(): Promise<void> { await (await this.el('interactiveElementButton16')).click(); }
  async clickInteractiveElementButton17(): Promise<void> { await (await this.el('interactiveElementButton17')).click(); }
  async clickInteractiveElementButton18(): Promise<void> { await (await this.el('interactiveElementButton18')).click(); }
  async clickEedgeEnglishUSButton(): Promise<void> { await (await this.el('eedgeEnglishUSButton')).click(); }
  async clickInteractiveElementButton19(): Promise<void> { await (await this.el('interactiveElementButton19')).click(); }
  async clickInteractiveElementButton20(): Promise<void> { await (await this.el('interactiveElementButton20')).click(); }
  async clickInteractiveElementButton21(): Promise<void> { await (await this.el('interactiveElementButton21')).click(); }
  async clickFfranceFrenchButton(): Promise<void> { await (await this.el('ffranceFrenchButton')).click(); }
  async clickGgermanyGermanButton(): Promise<void> { await (await this.el('ggermanyGermanButton')).click(); }
  async clickInteractiveElementButton22(): Promise<void> { await (await this.el('interactiveElementButton22')).click(); }
  async clickJjapanJapaneseButton(): Promise<void> { await (await this.el('jjapanJapaneseButton')).click(); }
  async clickInteractiveElementButton23(): Promise<void> { await (await this.el('interactiveElementButton23')).click(); }
  async clickInteractiveElementButton24(): Promise<void> { await (await this.el('interactiveElementButton24')).click(); }
  async clickInteractiveElementButton25(): Promise<void> { await (await this.el('interactiveElementButton25')).click(); }
  async clickInteractiveElementButton26(): Promise<void> { await (await this.el('interactiveElementButton26')).click(); }
  async clickInteractiveElementButton27(): Promise<void> { await (await this.el('interactiveElementButton27')).click(); }
  async clickAssignButton(): Promise<void> { await (await this.el('assignButton')).click(); }
  async clickSkipButton(): Promise<void> { await (await this.el('skipButton')).click(); }
  async clickCompleteButton(): Promise<void> { await (await this.el('completeButton')).click(); }
  async clickApproveButton(): Promise<void> { await (await this.el('approveButton')).click(); }
  async clickRejectButton(): Promise<void> { await (await this.el('rejectButton')).click(); }
  async clickPeprintExportButton(): Promise<void> { await (await this.el('peprintExportButton')).click(); }
  async clickResetCustomizedColumnsButton(): Promise<void> { await (await this.el('resetCustomizedColumnsButton')).click(); }
  async clickInteractiveElementButton28(): Promise<void> { await (await this.el('interactiveElementButton28')).click(); }
  async clickInteractiveElementButton29(): Promise<void> { await (await this.el('interactiveElementButton29')).click(); }
  async clickInteractiveElementButton30(): Promise<void> { await (await this.el('interactiveElementButton30')).click(); }
  async clickInteractiveElementButton31(): Promise<void> { await (await this.el('interactiveElementButton31')).click(); }
  async clickInteractiveElementButton32(): Promise<void> { await (await this.el('interactiveElementButton32')).click(); }
  async clickInteractiveElementButton33(): Promise<void> { await (await this.el('interactiveElementButton33')).click(); }
  async clickInteractiveElementButton34(): Promise<void> { await (await this.el('interactiveElementButton34')).click(); }
  async clickInteractiveElementButton35(): Promise<void> { await (await this.el('interactiveElementButton35')).click(); }
  async clickDuedateheaderButton(): Promise<void> { await (await this.el('duedateheaderButton')).click(); }
  async clickPriorityheaderButton(): Promise<void> { await (await this.el('priorityheaderButton')).click(); }
  async clickSubjectheaderButton(): Promise<void> { await (await this.el('subjectheaderButton')).click(); }
  async clickCaseidheaderButton(): Promise<void> { await (await this.el('caseidheaderButton')).click(); }
  async clickInsuredheaderButton(): Promise<void> { await (await this.el('insuredheaderButton')).click(); }
  async clickExternallyownedheaderButton(): Promise<void> { await (await this.el('externallyownedheaderButton')).click(); }
  async clickLobheaderButton(): Promise<void> { await (await this.el('lobheaderButton')).click(); }
  async clickStateheaderButton(): Promise<void> { await (await this.el('stateheaderButton')).click(); }

  async enterPolicySearchFieldField(value: string): Promise<void> { await (await heal('legacy.policySearchField', this.page, { label: "policy search field. field" })).fill(value); }

  async enterLossDateField(value: string): Promise<void> { await (await heal('legacy.lossDateField', this.page, { label: "Loss Date field" })).fill(value); }

  async clickNext(): Promise<void> { await (await heal('legacy.clickNext', this.page, { clickable: /Next/i })).click(); }

  async clickNext2(): Promise<void> { await (await heal('legacy.clickNext2', this.page, { clickable: /Next/i })).click(); }

  async clickNext3(): Promise<void> { await (await heal('legacy.clickNext3', this.page, { clickable: /Next/i })).click(); }

  async clickNext4(): Promise<void> { await (await heal('legacy.clickNext4', this.page, { clickable: /Next/i })).click(); }

  async clickLossCauseCollisionWithMotorVehicle(): Promise<void> { await (await heal('legacy.lossCauseButton', this.page, { clickable: /Loss Cause: Collision with motor vehicle/i })).click(); }

  async enterLocationDropdown(value: string): Promise<void> { await (await heal('legacy.locationDropdown', this.page, { label: "Location dropdown." })).selectOption(value); }

  async clickFinish(): Promise<void> { await (await heal('legacy.clickFinish', this.page, { clickable: /Finish/i })).click(); }

  async enterPassword(value: string): Promise<void> { await (await heal('legacy.passwordField', this.page, { css: "#gw-event-source" })).fill(value); }

  async expectNewClaimSavedConfirmationMessageWillBeDisplayedVisible(): Promise<void> { await heal('legacy.claimMenu', this.page, { role: 'menuitem', name: "Claim" }); }

  async expectNoValidationErrorOrSaveFailureMessageWillBeDisplayedVisible(): Promise<void> { await heal('legacy.noValidationMessage', this.page, { text: "No validation error or save failure message will be displayed", exact: false }); }
}
