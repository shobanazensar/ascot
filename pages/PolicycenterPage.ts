import { Page, Locator, expect } from '@playwright/test';
import { BasePage } from './BasePage';
import { healLocator } from '../utils/selfHealing';

// Presentation mode: values are typed key by key, each field is highlighted while it is filled and validations are shown in an
// on-screen banner, so a live demo can follow what is entered and checked. Off by default (the other tests run at full speed).
export type PresentationOptions = {
  enabled: boolean;
  typingDelayMs: number;
  pauseAfterInputMs: number;
  pauseAfterValidationMs: number;
  // false: values are filled in one go (still highlighted) instead of typed key by key
  typeKeyByKey: boolean;
};

// Per-vehicle coverage rows on PA Coverages, in screen order
const VEHICLE_COVERAGE_INDEX: Record<string, number> = {
  "Comprehensive": 0,
  "Collision": 1,
  "Towing and Labor": 2,
  "Rental Reimbursement": 3,
};

export class PolicycenterPage extends BasePage {
  readonly url = "https://pc-dev-gwcpdev.zensar.zeta1-andromeda.guidewire.net/PolicyCenter.do";
  private presentation: PresentationOptions = { enabled: false, typingDelayMs: 0, pauseAfterInputMs: 0, pauseAfterValidationMs: 0, typeKeyByKey: true };

  constructor(page: Page) {
    super(page);
  }

  setPresentation(options: Partial<PresentationOptions>): void {
    this.presentation = { ...this.presentation, ...options };
  }

  get presentationEnabled(): boolean { return this.presentation.enabled; }

  // --- Presentation helpers ---
  private async spotlight(target: Locator, on: boolean): Promise<void> {
    if (!this.presentation.enabled) return;
    if (on) await target.scrollIntoViewIfNeeded({ timeout: 3000 }).catch(() => {});
    // PolicyCenter re-renders fields after a change, so the element may already be gone: ignore that
    await target.evaluate((el, show) => {
      (el as HTMLElement).style.outline = show ? "3px solid #f59e0b" : "";
      (el as HTMLElement).style.outlineOffset = show ? "2px" : "";
      (el as HTMLElement).style.boxShadow = show ? "0 0 0 6px rgba(245, 158, 11, 0.25)" : "";
    }, on, { timeout: 2000 }).catch(() => {});
  }

  // Types a value; in presentation mode key by key with a delay and the field highlighted
  async typeValue(target: Locator, value: string): Promise<void> {
    if (!this.presentation.enabled) {
      await target.fill(value);
      return;
    }
    await this.spotlight(target, true);
    if (this.presentation.typeKeyByKey) {
      await target.fill("");
      await target.pressSequentially(value, { delay: this.presentation.typingDelayMs });
    } else {
      await target.fill(value);
    }
    await this.page.waitForTimeout(this.presentation.pauseAfterInputMs);
    await this.spotlight(target, false);
  }

  // Picks a dropdown option by its label; in presentation mode the dropdown is highlighted and the choice held on screen
  async chooseOption(target: Locator, label: string): Promise<void> {
    await this.spotlight(target, true);
    await target.selectOption({ label });
    if (this.presentation.enabled) await this.page.waitForTimeout(this.presentation.pauseAfterInputMs);
    await this.spotlight(target, false);
  }

  // Shows the result of a validation in a banner at the top right of the page (presentation mode only)
  async showValidation(title: string, lines: string[], passed: boolean): Promise<void> {
    if (!this.presentation.enabled) return;
    await this.page.evaluate(({ title, lines, passed }) => {
      let banner = document.getElementById("qa-validation-banner");
      if (!banner) {
        banner = document.createElement("div");
        banner.id = "qa-validation-banner";
        document.body.appendChild(banner);
      }
      Object.assign(banner.style, {
        position: "fixed", top: "12px", right: "12px", zIndex: "2147483647", maxWidth: "560px",
        padding: "14px 18px", borderRadius: "8px", font: "14px/1.5 -apple-system, Segoe UI, Arial, sans-serif",
        whiteSpace: "pre-wrap", boxShadow: "0 6px 24px rgba(0,0,0,0.25)",
        background: passed ? "#ecfdf3" : "#fef2f2", color: passed ? "#065f46" : "#991b1b",
        border: `2px solid ${passed ? "#10b981" : "#ef4444"}`,
      });
      banner.textContent = `${passed ? "✔" : "✘"} ${title}\n${lines.join("\n")}`;
    }, { title, lines, passed });
    await this.page.waitForTimeout(this.presentation.pauseAfterValidationMs);
  }

  async hideValidation(): Promise<void> {
    if (!this.presentation.enabled) return;
    await this.page.evaluate(() => document.getElementById("qa-validation-banner")?.remove());
  }

  // Highlights the Total Premium / Taxes / Total Cost block on the Quote screen while it is validated
  async highlightQuoteTotals(on: boolean): Promise<void> {
    await this.spotlight(this.page.getByText("Total Cost", { exact: true }).first().locator(".."), on);
  }

  // Highlights the list on the Forms screen while it is validated
  async highlightFormsList(on: boolean): Promise<void> {
    await this.spotlight(this.page.locator('[id$="FormsScreen-FormsDV-FormsLV"]').first(), on);
  }

  // Highlights the JSON on the Message Payload screen while it is validated
  async highlightMessagePayload(on: boolean): Promise<void> {
    await this.spotlight(this.page.getByText(/^\s*\[?\{"id"/).last(), on);
  }

  async goto(url?: string): Promise<void> {
    await this.page.goto(url || this.url);
  }

  // --- Self-healing lookups (see utils/selfHealing.ts) ---
  // The first candidate is the primary locator; the others are fallbacks that use a different strategy. If the primary stops
  // matching (the UI changed), the first visible fallback is used and the heal is logged and written to healing-report.json.
  private el(key: string, ...candidates: Locator[]): Promise<Locator> {
    return healLocator(`policycenter.${key}`, candidates);
  }

  private button(name: string): Promise<Locator> {
    const p = this.page;
    return this.el(`button.${name}`,
      p.getByRole("button", { name, exact: true }),
      p.getByText(name, { exact: true }),
      p.getByRole("link", { name, exact: true }),
      p.getByRole("menuitem", { name, exact: true }));
  }

  // A form field found by its label
  private field(label: string): Promise<Locator> {
    const p = this.page;
    return this.el(`field.${label}`,
      p.getByLabel(label, { exact: true }),
      p.getByRole("textbox", { name: label, exact: true }),
      p.getByRole("combobox", { name: label, exact: true }),
      p.locator(`[aria-label="${label}" i]`),
      p.getByLabel(label));
  }

  get headingHeading(): Locator { return this.page.getByText("Error", { exact: true }); }

  async expectHeadingVisible(): Promise<void> { await this.headingHeading.waitFor({ state: 'visible' }); }

  async enterTestUserField(value: string): Promise<void> { await this.page.getByLabel("Test User. field", { exact: false }).or(this.page.getByPlaceholder("Test User. field", { exact: false })).fill(value); }

  async clickAccount(): Promise<void> { await this.page.locator('button, a, [role="button"]', { hasText: /Account/i }).click(); }

  async enterAccountSearchFieldField(value: string): Promise<void> { await this.page.getByLabel("account search field. field", { exact: false }).or(this.page.getByPlaceholder("account search field. field", { exact: false })).fill(value); }

  async clickSearch(): Promise<void> { await this.page.locator('button, a, [role="button"]', { hasText: /search result row for Test Account One\./i }).click(); }

  async clickActionsMenu(): Promise<void> { await this.page.locator('button, a, [role="button"]', { hasText: /Actions menu\./i }).click(); }

  async enterActionsMenu(value: string): Promise<void> { await this.page.getByLabel("Actions menu.", { exact: false }).or(this.page.getByPlaceholder("Actions menu.", { exact: false })).selectOption(value); }

  async clickSelectForThePersonalAutoProduct(): Promise<void> { await this.page.locator('button, a, [role="button"]', { hasText: /Select for the Personal Auto product\./i }).click(); }

  async clickNextOnTheProductPage(): Promise<void> { await this.page.locator('button, a, [role="button"]', { hasText: /Next on the product page\./i }).click(); }

  async clickNextOnTheOfferingsPage(): Promise<void> { await this.page.locator('button, a, [role="button"]', { hasText: /Next on the Offerings page\./i }).click(); }

  async clickNextOnThePolicyInfoPage(): Promise<void> { await this.page.locator('button, a, [role="button"]', { hasText: /Next on the Policy Info page\./i }).click(); }

  async expectDriversPageWillBeDisplayedVisible(): Promise<void> { await this.page.getByText("Drivers page will be displayed", { exact: false }).waitFor({ state: 'visible' }); }

  async clickNewSubmission(): Promise<void> { await this.page.locator('button, a, [role="button"]', { hasText: /New Submission/i }).click(); }

  async clickAddOnTheDriversPage(): Promise<void> { await this.page.locator('button, a, [role="button"]', { hasText: /Add on the Drivers page\./i }).click(); }

  async clickExistingDriver(): Promise<void> { await this.page.locator('button, a, [role="button"]', { hasText: /Existing Driver/i }).click(); }

  async enterUsername(value: string): Promise<void> {
    await this.typeValue(await this.el("login.username", this.page.getByRole("textbox", { name: "Username" }), this.page.getByLabel("Username"), this.page.locator('input[name*="Username" i]')), value);
  }

  async enterPassword(value: string): Promise<void> {
    await this.typeValue(await this.el("login.password", this.page.getByRole("textbox", { name: "Password" }), this.page.getByLabel("Password"), this.page.locator('input[type="password"]')), value);
  }

  async clickLogin(): Promise<void> {
    await (await this.el("login.submit", this.page.getByRole("button", { name: "Log In" }), this.page.getByRole("button", { name: /log ?in/i }), this.page.getByText("Log In", { exact: true }))).click();
  }

  async enterBrowserField(value: string): Promise<void> { await this.page.getByLabel("browser. field", { exact: false }).or(this.page.getByPlaceholder("browser. field", { exact: false })).fill(value); }

  async clickCreateVehicle(): Promise<void> { await this.page.locator('button, a, [role="button"]', { hasText: /Create Vehicle\./i }).click(); }

  async enterVinField(value: string): Promise<void> { await this.page.getByLabel("VIN field", { exact: false }).or(this.page.getByPlaceholder("VIN field", { exact: false })).fill(value); }

  async enterLicenseStateField(value: string): Promise<void> { await this.page.getByLabel("License State field", { exact: false }).or(this.page.getByPlaceholder("License State field", { exact: false })).fill(value); }

  async enterCodeField(value: string): Promise<void> { await this.page.getByLabel("Code field", { exact: false }).or(this.page.getByPlaceholder("Code field", { exact: false })).fill(value); }

  async clickDetails(): Promise<void> { await this.page.locator('button, a, [role="button"]', { hasText: /Details/i }).click(); }

  async clickSpecialApproveAction(): Promise<void> { await this.page.locator('button, a, [role="button"]', { hasText: /Special Approve action\./i }).click(); }

  async clickForms(): Promise<void> { await this.page.locator('button, a, [role="button"]', { hasText: /Forms/i }).click(); }

  async clickCoverageA(): Promise<void> { await this.page.locator('button, a, [role="button"]', { hasText: /Coverage A/i }).click(); }

  async clickCoverageB(): Promise<void> { await this.page.locator('button, a, [role="button"]', { hasText: /Coverage B/i }).click(); }

  async clickCoverageC(): Promise<void> { await this.page.locator('button, a, [role="button"]', { hasText: /Coverage C/i }).click(); }

  async clickQuote(): Promise<void> { await this.page.locator('button, a, [role="button"]', { hasText: /Quote/i }).click(); }

  async clickQuote2(): Promise<void> { await this.page.locator('button, a, [role="button"]', { hasText: /Quote/i }).click(); }

  // --- Real PolicyCenter navigation (flow: login > Account > first account > Actions > New Submission > Personal Auto > Next x3) ---
  async openAccountMenu(): Promise<void> {
    const tab = await this.el("accountTab",
      this.page.locator('#TabBar-AccountTab').getByRole('menuitem').first(),
      this.page.getByRole('menuitem', { name: 'Account', exact: true }),
      this.page.locator('[id^="TabBar-AccountTab"]').first());
    await tab.click();
    const firstAccount = this.page.locator('#TabBar-AccountTab-0-accountItem');
    // If clicking the tab label did not open the list, use the dropdown arrow next to it
    if (!(await firstAccount.isVisible())) {
      await (await this.el("accountTab.expand",
        this.page.locator('#TabBar-AccountTab .gw-action--expand-button'),
        this.page.locator('[id^="TabBar-AccountTab"] [class*="expand"]').first())).click();
    }
  }

  async selectFirstRecentAccount(): Promise<void> {
    await (await this.el("firstRecentAccount",
      this.page.locator('#TabBar-AccountTab-0-accountItem'),
      this.page.locator('[id^="TabBar-AccountTab-"][id$="-accountItem"]').first())).click();
  }

  // Account tab > "Account #" search box: opens the account's summary page
  async openAccountByNumber(accountNumber: string): Promise<void> {
    await (await this.el("accountTab.expand",
      this.page.locator('#TabBar-AccountTab .gw-action--expand-button'),
      this.page.locator('[id^="TabBar-AccountTab"] [class*="expand"]').first())).click();
    const box = await this.el("accountTab.accountSearch",
      this.page.locator('#TabBar-AccountTab-AccountTab_AccountNumberSearchItem input'),
      this.page.locator('[id^="TabBar-AccountTab"] input').first());
    await box.fill(accountNumber);
    await box.press("Enter");
    await expect(this.page.getByRole("main")).toContainText(new RegExp(`Account No\\s*${accountNumber}`));
  }

  async openActions(): Promise<void> {
    await (await this.el("actionsMenu",
      this.page.locator('#AccountFile-AccountFileMenuActions'),
      this.page.getByRole('menuitem', { name: 'Actions', exact: true }),
      this.page.getByText('Actions', { exact: true }))).click();
  }

  async chooseNewSubmission(): Promise<void> {
    await (await this.el("newSubmission",
      this.page.locator('#AccountFile-AccountFileMenuActions-AccountFileMenuActions_Create-AccountFileMenuActions_NewSubmission'),
      this.page.getByRole('menuitem', { name: 'New Submission', exact: true }),
      this.page.getByText('New Submission', { exact: true }))).click();
  }

  async selectPersonalAuto(): Promise<void> {
    await (await this.el("selectPersonalAuto",
      this.page.getByRole("button", { name: "Select", exact: true }).first(),
      this.page.getByText("Select", { exact: true }))).click();
  }

  async clickNext(): Promise<void> { await (await this.button("Next")).click(); }

  // PolicyCenter shows a "Warnings:" panel (e.g. driver license state does not match the policy state) and stays on the page
  // on the first Next; clicking Next again moves on. Click Next a second time only when that warning appears.
  async clickNextThroughWarning(): Promise<void> {
    await this.clickNext();
    const warnings = this.page.getByText("Warnings:", { exact: true });
    const warned = await warnings.waitFor({ state: "visible", timeout: 3000 }).then(() => true, () => false);
    if (warned) {
      await this.clickNext();
    }
  }

  // --- Drivers page ---
  private addDriverMenu(): Promise<Locator> {
    return this.el("drivers.add",
      this.page.locator('[id$="DriversLV_tb-AddDriver"]'),
      this.page.getByRole("button", { name: "Add", exact: true }),
      this.page.getByText("Add", { exact: true }));
  }

  async addExistingDriver(driverName: string): Promise<void> {
    await (await this.addDriverMenu()).click();
    const existingDriver = await this.el("existingDriver",
      this.page.locator('[id$="AddExistingContact"]'),
      this.page.getByText("Existing Driver", { exact: true }));
    await existingDriver.hover(); // the driver list opens as a submenu on hover
    await (await this.el("existingDriver.name",
      existingDriver.getByRole("button", { name: driverName, exact: true }),
      this.page.getByRole("button", { name: driverName, exact: true }),
      this.page.getByText(driverName, { exact: true }))).click();
    await this.page.locator('[id$="DriversLV-0-Name"]').waitFor({ state: 'visible' });
  }

  // --- Vehicles page ---
  async clickCreateVehicleButton(): Promise<void> {
    await (await this.el("vehicles.add",
      this.page.locator('[id$="VehiclesListDetailPanel_tb-Add"]'),
      this.page.getByRole("button", { name: "Add", exact: true }),
      this.page.getByText("Create Vehicle", { exact: true }))).click();
  }

  async fillVin(value: string): Promise<void> { await (await this.field("VIN")).fill(value); }

  async selectLicenseState(value: string): Promise<void> { await this.chooseOption(await this.field("License State"), value); }

  async fillCostNew(value: string): Promise<void> { await this.typeValue((await this.field("Cost New")).locator("input"), value); }

  async selectPassiveRestraintSystem(value: string): Promise<void> { await this.chooseOption(await this.field("Passive Restraint System"), value); }

  async selectAntiTheftDiscount(value: string): Promise<void> { await this.chooseOption(await this.field("Anti Theft Discount"), value); }

  async selectPrimaryUse(value: string): Promise<void> { await this.chooseOption(await this.field("Primary Use"), value); }

  async assignDriverToVehicle(driverName: string): Promise<void> {
    const addDriver = this.page.locator('[id$="DriverPctLV_tb-AddDriver"]');
    await addDriver.click();
    await addDriver.getByText(driverName, { exact: true }).click();
  }

  async openAdditionalInterestTab(): Promise<void> { await this.page.getByRole("tab", { name: "Additional Interest" }).click(); }

  async openVehicleDetailsTab(): Promise<void> { await this.page.getByRole("tab", { name: "Vehicle Details" }).click(); }

  // --- Coverages ---
  private async setCheckbox(checkbox: Locator, checked: boolean): Promise<void> {
    const current = (await checkbox.getAttribute("aria-checked")) === "true";
    if (current !== checked) {
      await this.spotlight(checkbox, true);
      await checkbox.click();
      if (this.presentation.enabled) await this.page.waitForTimeout(this.presentation.pauseAfterInputMs);
      await this.spotlight(checkbox, false);
    }
  }

  private perVehicleCoverageCheckbox(index: number): Promise<Locator> {
    return this.el(`vehicleCoverage.${index}.checkbox`,
      this.page.locator(`[id*="VehicleCoverageDetailDV-${index}-CoverageInputSet-CovPatternInputGroup-_checkbox_checkboxDiv"]`),
      this.page.locator(`[id*="VehicleCoverageDetailDV-${index}-CoverageInputSet"] [role="checkbox"]`).first());
  }

  private perVehicleCoverageSelect(index: number): Promise<Locator> {
    return this.el(`vehicleCoverage.${index}.select`,
      this.page.locator(`[id*="VehicleCoverageDetailDV-${index}-CoverageInputSet"] select`).first(),
      this.page.locator(`[id*="VehicleCoverageDetailDV-${index}"] select`).first());
  }

  // Per-vehicle coverages: 0 = Comprehensive, 1 = Collision, 2 = Towing and Labor, 3 = Rental Reimbursement
  async setComprehensive(deductible: string): Promise<void> {
    await this.setCheckbox(await this.perVehicleCoverageCheckbox(0), true);
    await this.chooseOption(await this.perVehicleCoverageSelect(0), deductible);
  }

  async setCollision(deductible: string): Promise<void> {
    await this.setCheckbox(await this.perVehicleCoverageCheckbox(1), true);
    await this.chooseOption(await this.perVehicleCoverageSelect(1), deductible);
  }

  async setTowingAndLabor(limit: string): Promise<void> {
    await this.setCheckbox(await this.perVehicleCoverageCheckbox(2), true);
    await this.chooseOption(await this.perVehicleCoverageSelect(2), limit);
  }

  // Selects/unselects Rental Reimbursement; when selecting, optionally picks the Rental Package (e.g. "30 days x 25/day")
  async setRentalReimbursement(selected: boolean, rentalPackage?: string): Promise<void> {
    await this.setCheckbox(await this.perVehicleCoverageCheckbox(3), selected);
    if (selected && rentalPackage) {
      await this.chooseOption(await this.perVehicleCoverageSelect(3), rentalPackage);
    }
  }

  // Data-driven coverage setting: "line" coverages are found by name in the liability list, "vehicle" coverages by their row.
  // value = limit / deductible / package to pick when selected (omit for coverages without a choice, e.g. CA UM PD or Mexico).
  async applyCoverage(c: { coverage: string; level: "line" | "vehicle"; selected: boolean; value?: string }): Promise<void> {
    if (c.level === "vehicle") {
      const index = VEHICLE_COVERAGE_INDEX[c.coverage];
      if (index === undefined) throw new Error(`Unknown vehicle coverage "${c.coverage}"`);
      await this.setCheckbox(await this.perVehicleCoverageCheckbox(index), c.selected);
      if (c.selected && c.value) await this.chooseOption(await this.perVehicleCoverageSelect(index), c.value);
      return;
    }
    if (c.selected && c.value) await this.setLiabilityCoverageLimit(c.coverage, c.value);
    else await this.setLiabilityCoverage(c.coverage, c.selected);
  }

  async setTowingAndLaborSelected(selected: boolean): Promise<void> {
    await this.setCheckbox(await this.perVehicleCoverageCheckbox(2), selected);
  }

  // Reads the coverage checkbox on PA Coverages: "line" coverages by name, "vehicle" coverages by their row
  async isCoverageSelected(coverage: string, level: "line" | "vehicle"): Promise<boolean> {
    let box: Locator;
    if (level === "vehicle") {
      const index = VEHICLE_COVERAGE_INDEX[coverage];
      if (index === undefined) throw new Error(`Unknown vehicle coverage "${coverage}"`);
      box = await this.perVehicleCoverageCheckbox(index);
    } else {
      const index = await this.liabilityRowIndex(coverage);
      box = await this.el(`liability.${coverage}.checkbox`,
        this.liabilityRowLocator(index, "_checkbox_checkboxDiv"),
        this.page.locator(`[id*="PALiabCategoryIterator-${index}-CoverageInputSet"] [role="checkbox"]`).first());
    }
    return (await box.getAttribute("aria-checked")) === "true";
  }

  // All-vehicle coverages (liability iterator). The row order changes with the policy state (NY vs CA),
  // so find each row by its coverage name instead of a fixed index.
  private async liabilityRowIndex(coverageName: string): Promise<number> {
    await this.page.locator('[id*="PALiabCategoryIterator-0-CoverageInputSet"]').first().waitFor({ state: "attached" });
    const index = await this.page.evaluate((name) => {
      for (let i = 0; i < 20; i++) {
        const box = document.querySelector(`[id*="PALiabCategoryIterator-${i}-CoverageInputSet-CovPatternInputGroup-_checkbox_checkboxDiv"]`);
        if (!box) continue;
        let row: HTMLElement | null = box as HTMLElement;
        for (let k = 0; k < 4 && row && row.parentElement; k++) row = row.parentElement;
        if (row && (row.innerText || "").replace(/\s+/g, " ").trim().startsWith(name)) return i;
      }
      return -1;
    }, coverageName);
    if (index < 0) throw new Error(`Coverage "${coverageName}" not found on PA Coverages`);
    return index;
  }

  private liabilityRowLocator(index: number, tail: string): Locator {
    return this.page.locator(`[id*="PALiabCategoryIterator-${index}-CoverageInputSet-CovPatternInputGroup-${tail}"]`);
  }

  async setLiabilityCoverage(coverageName: string, selected: boolean): Promise<void> {
    const index = await this.liabilityRowIndex(coverageName);
    const box = await this.el(`liability.${coverageName}.checkbox`,
      this.liabilityRowLocator(index, "_checkbox_checkboxDiv"),
      this.page.locator(`[id*="PALiabCategoryIterator-${index}-CoverageInputSet"] [role="checkbox"]`).first());
    const current = (await box.getAttribute("aria-checked")) === "true";
    if (current !== selected) {
      await this.spotlight(box, true);
      await box.click();
      await this.page.waitForTimeout(Math.max(1200, this.presentation.enabled ? this.presentation.pauseAfterInputMs : 0)); // the row re-renders after the toggle
    }
  }

  // Selects the coverage and picks a value in its limit dropdown
  async setLiabilityCoverageLimit(coverageName: string, limit: string): Promise<void> {
    await this.setLiabilityCoverage(coverageName, true);
    const index = await this.liabilityRowIndex(coverageName);
    await this.chooseOption(this.liabilityRowLocator(index, "").locator("select").first(), limit);
    await this.page.waitForTimeout(1200);
  }

  async setMexicoCoverage(selected: boolean): Promise<void> {
    await this.setLiabilityCoverage("Mexico Coverage - Limited", selected);
  }

  // --- Policy Info page ---
  async setPolicyInfo(opts: { termType: string; effectiveDate: string; uwCompany: string }): Promise<void> {
    const term = await this.el("policyInfo.termType",
      this.page.locator('[id$="PolicyInfoInputSet-TermType"]').locator("select"),
      this.page.getByLabel("Term Type", { exact: true }));
    await this.chooseOption(term, opts.termType);
    await this.page.waitForTimeout(1500);
    const effective = await this.el("policyInfo.effectiveDate",
      this.page.locator('[id$="PolicyInfoInputSet-EffectiveDate"]').locator("input"),
      this.page.getByLabel("Effective Date", { exact: true }));
    await this.typeValue(effective, opts.effectiveDate);
    await effective.press("Tab");
    await this.page.waitForTimeout(2000);
    const uw = await this.el("policyInfo.uwCompany",
      this.page.locator('[id$="UWCompanyInputSet-UWCompany"]').locator("select"),
      this.page.getByLabel("Underwriting Company", { exact: true }));
    await this.chooseOption(uw, opts.uwCompany);
    await this.page.waitForTimeout(1500);
  }

  // --- Drivers page: new person + roles ---
  // "New Person" opens a popup. If the person already exists in the address book (re-runs), PolicyCenter shows a
  // "Matching Contacts" page: pick the matching contact and confirm again.
  async addNewPersonDriver(d: {
    firstName: string; lastName: string; dateOfBirth: string; licenseNumber: string; licenseState: string;
    yearFirstLicensed: string; addressLine1: string; city: string; state: string; zip: string; addressType: string;
  }, expectedRowIndex: number): Promise<void> {
    await (await this.addDriverMenu()).click();
    await (await this.el("drivers.newPerson",
      this.page.locator('[id$="AddDriver-0-ContactType"]'),
      this.page.getByText("New Person", { exact: true }))).click();
    const popup = this.page.locator('[id$="NewPolicyContactRoleDetailsCV-PolicyContactDetailsDV-LicenseInputSet-LicenseState"]');
    await popup.waitFor({ state: "visible" });
    const f = (id: string) => this.page.locator(`[id$="${id}"]`);
    const details = "NewPolicyContactRoleDetailsCV-PolicyContactDetailsDV-";
    await this.typeValue(f(details + "PolicyContactRoleNameInputSet-GlobalPersonNameInputSet-FirstName").locator("input"), d.firstName);
    await this.typeValue(f(details + "PolicyContactRoleNameInputSet-GlobalPersonNameInputSet-LastName").locator("input"), d.lastName);
    const dob = f(details + "PolicyContactRoleNameInputSet-DateOfBirth").locator("input");
    await this.typeValue(dob, d.dateOfBirth);
    await dob.press("Tab");
    await this.typeValue(f(details + "LicenseInputSet-LicenseNumber").locator("input"), d.licenseNumber);
    await this.chooseOption(f(details + "LicenseInputSet-LicenseState").locator("select"), d.licenseState);
    await this.typeValue(f("PolicyDriverInfoDV-yearlicensed").locator("input"), d.yearFirstLicensed);
    const address = details + "AddressInputSet-globalAddressContainer-GlobalAddressInputSet-";
    await this.typeValue(f(address + "AddressLine1").locator("input"), d.addressLine1);
    await this.typeValue(f(address + "City").locator("input"), d.city);
    await this.chooseOption(f(address + "State").locator("select"), d.state);
    await this.typeValue(f(address + "PostalCode").locator("input"), d.zip);
    await this.chooseOption(f(details + "AddressType").locator("select"), d.addressType);
    await (await this.button("OK")).click();

    const matching = this.page.getByText("Matching Contacts", { exact: true });
    const newRow = this.page.locator(`[id$="DriversLV-${expectedRowIndex}-Name"]`);
    await matching.or(newRow).first().waitFor({ state: "visible", timeout: 60000 });
    if (await matching.isVisible()) {
      await this.page.getByText("Select", { exact: true }).first().click();
      await (await this.button("OK")).click();
    }
    await newRow.waitFor({ state: "visible", timeout: 60000 });
  }

  // Roles tab of a driver row: the sheet gives no accident/violation history, so set 0 at policy and account level
  async setDriverNoAccidentsOrViolations(rowIndex: number): Promise<void> {
    await this.page.locator(`[id$="DriversLV-${rowIndex}-Name"]`).click();
    await (await this.el("drivers.rolesTab",
      this.page.getByRole("tab", { name: "Roles" }),
      this.page.getByText("Roles", { exact: true }))).click();
    for (const field of ["PolicyDriverNumberOfAccidents", "PolicyDriverNumberOfViolations", "DriverNumberOfAccidents", "DriverNumberOfViolations"]) {
      const select = this.page.locator(`select[id$="-${field}"], [id$="-${field}"] select`).first();
      await select.waitFor({ state: "visible" });
      await select.selectOption({ label: "0" });
      await this.page.waitForTimeout(600);
    }
  }

  // --- Vehicles page: VIN decode, garage location and driver usage ---
  // The VIN lookup fills Year/Make/Model/Color from the decoded VIN, so enter the VIN first and the rest afterwards.
  async fillVehicleIdentity(v: { vin: string; year: string; make: string; model: string }): Promise<void> {
    const vin = await this.field("VIN");
    await this.typeValue(vin, v.vin);
    await vin.press("Tab");
    await this.page.waitForTimeout(4000);
    await this.typeValue(await this.field("Model Year"), v.year);
    await this.typeValue(await this.field("Make"), v.make);
    await this.typeValue(await this.field("Model"), v.model);
  }

  async selectGaragedAt(value: string): Promise<void> { await this.chooseOption(await this.field("Garaged At"), value); }

  async assignDriversWithUsage(drivers: { name: string; percent: string }[]): Promise<void> {
    const addDriver = this.page.locator('[id$="DriverPctLV_tb-AddDriver"]');
    await this.page.waitForTimeout(2000); // let the form finish re-rendering after the last vehicle field change
    for (const driver of drivers) {
      const menuItem = this.page.locator('[id*="DriverPctLV_tb-AddDriver-"][id$="-Driver"]:visible').filter({ hasText: driver.name }).first();
      // The Add menu closes if the form re-renders while it is opening, so retry opening it
      for (let attempt = 0; attempt < 3; attempt++) {
        await addDriver.scrollIntoViewIfNeeded();
        await addDriver.click();
        if (await menuItem.waitFor({ state: "visible", timeout: 4000 }).then(() => true, () => false)) break;
      }
      await menuItem.click();
      await this.page.waitForTimeout(1500);
    }
    for (let i = 0; i < drivers.length; i++) {
      const pct = this.page.locator(`input[id$="DriverPctLV-${i}-Percentage"], [id$="DriverPctLV-${i}-Percentage"] input`);
      await this.typeValue(pct, drivers[i].percent);
      await pct.press("Tab");
    }
    await this.page.waitForTimeout(1500);
  }

  // --- Quote / Risk Analysis ---
  async quote(): Promise<void> { await (await this.button("Quote")).click(); }

  // PolicyCenter shows a warnings panel (e.g. driver license state does not match the policy state) and waits for a
  // second click before it actually quotes. Click Quote again only when that warning shows.
  async quoteThroughWarning(): Promise<void> {
    await this.quote();
    const warned = await this.page.getByText(/Warnings (located on another page|:)/).first()
      .waitFor({ state: "visible", timeout: 6000 }).then(() => true, () => false);
    if (warned) await this.quote();
  }

  // Special Approves the underwriting issues only when the quote raised any (this CA quote raised none)
  async approveUnderwritingIssuesIfAny(): Promise<boolean> {
    const details = this.page.getByRole("button", { name: "Details", exact: true });
    const hasIssues = await details.waitFor({ state: "visible", timeout: 8000 }).then(() => true, () => false);
    if (!hasIssues) return false;
    await details.click();
    await this.specialApproveStateOfGaraging();
    return true;
  }

  // One coverage line on the Quote screen, in cents: the term amount (first column) and the written premium (last column).
  // Prorated rows show a pro-rata factor (e.g. 2.0055) between the dates; flat rows (Mexico) leave it blank.
  // Returns null when the coverage is not on the Quote screen.
  async findCoverageAmounts(coverageName: string): Promise<{ termAmount: number; premium: number } | null> {
    const text = await this.page.getByRole("main").innerText();
    const escaped = coverageName.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
    const m = text.match(new RegExp(`${escaped}\\s*\\$([\\d,]+\\.\\d\\d)\\s*\\d\\d/\\d\\d/\\d{4}\\s*\\d\\d/\\d\\d/\\d{4}\\s*(?:[\\d.]+\\s*)?\\$([\\d,]+\\.\\d\\d)`));
    if (!m) return null;
    const cents = (s: string) => Math.round(parseFloat(s.replace(/,/g, "")) * 100);
    return { termAmount: cents(m[1]), premium: cents(m[2]) };
  }

  async getCoverageAmounts(coverageName: string): Promise<{ termAmount: number; premium: number }> {
    const amounts = await this.findCoverageAmounts(coverageName);
    if (!amounts) throw new Error(`Premium for "${coverageName}" not found on the Quote screen`);
    return amounts;
  }

  // Written premium of one coverage line on the Quote screen, in cents
  async getCoveragePremium(coverageName: string): Promise<number> {
    return (await this.getCoverageAmounts(coverageName)).premium;
  }

  async openQuoteIssueDetails(): Promise<void> { await this.page.getByRole("button", { name: "Details", exact: true }).click(); }

  // Selects the "State of garaging" issue, Special Approves it and confirms the Risk Approval Details page.
  // The browser confirm() dialog is accepted by the dialog handler registered in the test.
  // The page can list more than one issue ("State of garaging" plus another, e.g. "Inconsistent..."), so select every issue row.
  async specialApproveStateOfGaraging(): Promise<void> {
    const checkboxes = this.page.locator('[id$="UWIssueRowSet-_Checkbox_checkboxDiv"]');
    await checkboxes.first().waitFor({ state: "visible" });
    const count = await checkboxes.count();
    for (let i = 0; i < count; i++) {
      await checkboxes.nth(i).click();
    }
    await (await this.el("uwIssues.specialApprove",
      this.page.locator('[id$="UWIssueRowSet-SpecialApprove"]').first(),
      this.page.getByRole("button", { name: "Special Approve", exact: true }))).click();
    await (await this.button("OK")).click();
    await this.page.locator('[id$="UWIssueRowSet-Reopen"]').first().waitFor({ state: "visible" }); // issues are now approved
  }

  // --- Quote screen ---
  // Opens the Quote step from the submission wizard menu (the toolbar Quote button would re-quote, so use the left menu item)
  async openQuoteScreen(): Promise<void> {
    await this.page.getByText("Quote", { exact: true }).filter({ hasNot: this.page.getByRole("button") }).first().click();
    await this.page.getByText("Total Cost", { exact: true }).first().waitFor({ state: "visible" });
  }

  // Reads Total Premium, Taxes & Surcharges and Total Cost (in cents) from the Quote screen
  async getQuoteTotals(): Promise<{ totalPremium: number; taxes: number; totalCost: number; raw: string }> {
    const text = await this.page.getByRole("main").innerText();
    const amount = (label: string): number => {
      const m = text.match(new RegExp(`${label}\\s*\\$?\\s*([\\d,]+(?:\\.\\d{1,2})?)`, "i"));
      if (!m) throw new Error(`"${label}" amount not found on the Quote screen`);
      return Math.round(parseFloat(m[1].replace(/,/g, "")) * 100);
    };
    return {
      totalPremium: amount("Total Premium"),
      taxes: amount("Taxes & Surcharges"),
      totalCost: amount("Total Cost"),
      raw: text,
    };
  }

  // --- Administration > Monitoring > Message Queues > AppEvents ---
  async openMessageQueues(): Promise<void> {
    // At 1280px wide PolicyCenter collapses Utility/Administration behind the hamburger menu; widen so the tab bar shows them.
    // Only for this navigation: in headed mode a 1700px page is wider than a laptop window, which cuts off the right side
    // of every later screen (and the validation banner), so the original size is restored once Message Queues is open.
    const originalViewport = this.page.viewportSize();
    await this.page.setViewportSize({ width: 1700, height: 900 });
    await (await this.el("admin.expand",
      this.page.locator('#TabBar-AdminTab > .gw-action--expand-button'),
      this.page.getByRole('menuitem', { name: 'Administration', exact: true }).locator('[class*="expand"]'))).click();
    await (await this.el("admin.monitoring",
      this.page.locator('#TabBar-AdminTab-Admin_Monitoring'),
      this.page.getByText('Monitoring', { exact: true }))).hover();
    await (await this.el("admin.messageQueues",
      this.page.locator('#TabBar-AdminTab-Admin_Monitoring-Monitoring_MessagingDestinationControlList'),
      this.page.getByText('Message Queues', { exact: true }))).click();
    await this.page.getByText("AppEvents", { exact: true }).waitFor({ state: "visible" });
    if (originalViewport) await this.page.setViewportSize(originalViewport);
  }

  async openAppEventsDestination(): Promise<void> {
    await (await this.el("appEvents.destination",
      this.page.getByText("AppEvents", { exact: true }),
      this.page.getByRole("link", { name: "AppEvents", exact: true }))).click();
    await this.page.getByText("Total Statistics", { exact: true }).waitFor({ state: "visible" });
  }

  // Detailed Statistics dropdown: default is "Accounts with failed messages"
  async selectDetailedStatistics(option: string): Promise<void> {
    await (await this.el("appEvents.detailedStatistics",
      this.page.locator("select").filter({ hasText: "Accounts with failed messages" }),
      this.page.getByLabel("Detailed Statistics"))).selectOption({ label: option });
  }

  // Clicks the first account hyperlink in Detailed Statistics and returns its account number
  async openFirstUnfinishedAccount(): Promise<string> {
    const accountLink = this.page.getByText(/^[A-Z]?\d{6,}$/).first();
    await accountLink.waitFor({ state: "visible" });
    const accountNumber = (await accountLink.innerText()).trim();
    await accountLink.click();
    await this.page.getByText(`Account Number: ${accountNumber}`).waitFor({ state: "visible" });
    return accountNumber;
  }

  // Clicks the given account in Detailed Statistics (the list can span several pages)
  async openUnfinishedAccount(accountNumber: string): Promise<void> {
    const link = this.page.getByText(accountNumber, { exact: true });
    const nextPage = this.page.locator('[id$="MessageControlForDestinationListLV-_ListPaging-next"]');
    const pagingToolbar = nextPage.locator('xpath=ancestor::*[@role="toolbar"][1]');
    // The list refreshes after the Detailed Statistics choice: wait for account rows to show
    await this.page.getByText(/^[A-Z]?\d{6,}$/).first().waitFor({ state: "visible" });
    for (;;) {
      if (await link.count()) break;
      if (!(await nextPage.count()) || (await nextPage.getAttribute("aria-disabled")) === "true") {
        throw new Error(`Account ${accountNumber} is not listed under "Accounts with any unfinished messages"`);
      }
      const before = (await pagingToolbar.getAttribute("aria-label")) ?? "";
      await nextPage.click({ force: true });
      await expect(pagingToolbar).not.toHaveAttribute("aria-label", before);
    }
    await link.first().click();
    await this.page.getByText(`Account Number: ${accountNumber}`).waitFor({ state: "visible" });
  }

  // The account's messages are listed in ascending Order, 40 per page, and the list cannot be re-sorted.
  // Opens the message before the last one (second-highest Order) and returns its Order and Event Name.
  async openMessageBeforeLast(): Promise<{ order: string; eventName: string }> {
    const prefix = "MessageControlForSOOList-MessageControlForSOOListScreen-MessageControlForSOOListLV-";
    const names = this.page.locator(`[id^="${prefix}"][id$="-MessageName"]`);
    const orders = this.page.locator(`[id^="${prefix}"][id$="-Order"]`);
    const pagingToolbar = this.page.locator(`[id="${prefix}_ListPaging"]`);
    await names.first().waitFor({ state: "visible" });
    const goTo = async (button: "last" | "prev") => {
      const btn = this.page.locator(`[id="${prefix}_ListPaging-${button}"]`);
      if (!(await btn.count()) || (await btn.getAttribute("aria-disabled")) === "true") return false;
      const before = (await pagingToolbar.getAttribute("aria-label")) ?? "";
      await btn.click({ force: true });
      await expect(pagingToolbar).not.toHaveAttribute("aria-label", before);
      return true;
    };
    await goTo("last");
    let index = (await names.count()) - 2;
    if (index < 0) {
      // Only one message on the last page: the one before it is the last row of the previous page
      if (!(await goTo("prev"))) throw new Error("The account has fewer than two messages");
      index = (await names.count()) - 1;
    }
    const order = (await orders.nth(index).innerText()).trim();
    const eventName = (await names.nth(index).innerText()).trim();
    await names.nth(index).click();
    await this.page.getByRole("heading", { name: "Message Payload" }).waitFor({ state: "visible" });
    return { order, eventName };
  }

  // The account number shown on the Account Summary page ("Account No")
  async readAccountNumber(): Promise<string> {
    const label = this.page.getByText("Account No", { exact: true }).first();
    await label.waitFor({ state: "visible" });
    const text = await this.page.getByRole("main").innerText();
    const m = text.match(/Account No\s+(\d{6,})/);
    if (!m) throw new Error("Account number not found on the Account Summary page");
    return m[1];
  }

  async openMessageEvent(eventName: string): Promise<void> {
    // An account can have several messages with the same event name; open the first one
    await (await this.el(`messageEvent.${eventName}`,
      this.page.getByText(eventName, { exact: true }).first(),
      this.page.getByRole("button", { name: eventName, exact: true }))).click();
    await this.page.getByRole("heading", { name: "Message Payload" }).waitFor({ state: "visible" });
  }

  async getMessagePayload(): Promise<string> {
    // The page title and the field label both read "Message Payload"; the JSON is the text after the last one
    const text = await this.page.getByRole("main").innerText();
    return (text.split("Message Payload").pop() || "").trim();
  }

  // --- Forms / PA Coverages ---
  async openForms(): Promise<void> {
    await (await this.el("menu.forms",
      this.page.getByText("Forms", { exact: true }).first(),
      this.page.getByRole("menuitem", { name: "Forms", exact: true }),
      this.page.getByRole("link", { name: "Forms", exact: true }))).click();
    await this.page.locator('[id$="FormsScreen-FormsDV-FormsLV-0-Description"]').waitFor({ state: "visible" });
  }

  async getFormDescriptions(): Promise<string[]> {
    const rows = this.page.locator('[id*="FormsScreen-FormsDV-FormsLV-"][id$="-Description"]');
    return (await rows.allInnerTexts()).map(t => t.trim()).filter(Boolean);
  }

  async openPACoverages(): Promise<void> {
    await (await this.el("menu.paCoverages",
      this.page.getByText("PA Coverages", { exact: true }).first(),
      this.page.getByRole("menuitem", { name: "PA Coverages", exact: true }),
      this.page.getByRole("link", { name: "PA Coverages", exact: true }))).click();
    await this.page.getByRole("tab", { name: "Exclusions and Conditions" }).waitFor({ state: "visible" });
  }

  async getPACoverageText(): Promise<string> {
    return await this.page.getByRole("main").innerText();
  }

  // --- Submission number, Policy tab search, issue the policy ---
  // The wizard shows the submission number in its left panel and header ("Submission 0004065438 ...")
  async readSubmissionNumber(): Promise<string> {
    const text = await this.page.locator("body").innerText();
    const m = text.match(/Submission\s+(\d{8,})/);
    if (!m) throw new Error("Submission number not found on the page");
    return m[1];
  }

  // Policy tab > "Sub #" search box (the same box shown in the Policy menu): opens the submission
  async searchSubmission(submissionNumber: string): Promise<void> {
    await (await this.el("policyTab.expand",
      this.page.locator('#TabBar-PolicyTab > .gw-action--expand-button'),
      this.page.locator('[id^="TabBar-PolicyTab"] [class*="expand"]').first())).click();
    const box = await this.el("policyTab.submissionSearch",
      this.page.locator('#TabBar-PolicyTab-PolicyTab_SubmissionNumberSearchItem_widget input'),
      this.page.locator('#TabBar-PolicyTab-PolicyTab_SubmissionNumberSearchItem input'),
      this.page.locator('[id^="TabBar-PolicyTab"] input').first());
    await box.fill(submissionNumber);
    await box.press("Enter");
    await this.page.getByText(`Submission ${submissionNumber}`).first().waitFor({ state: "visible" });
  }

  // Bind Options > Issue Policy, then confirm the popup with OK (a browser confirm() is accepted by the test's dialog handler).
  // Like Next and Quote, the first Issue Policy click can only raise a "Warnings located on another page" panel
  // (e.g. the driver license state does not match the policy state); clicking Issue Policy again goes ahead.
  async issuePolicy(): Promise<void> {
    const ok = this.page.getByRole("button", { name: "OK", exact: true });
    const done = this.page.getByText(/View (your )?policy/i).first();
    for (let attempt = 0; attempt < 2; attempt++) {
      await (await this.el("bindOptions",
        this.page.locator('[id$="JobWizardToolbarButtonSet-BindOptions"]'),
        this.page.getByRole("button", { name: /Bind Options/ }))).click();
      await (await this.el("bindOptions.issuePolicy",
        this.page.locator('[id$="JobWizardToolbarButtonSet-BindOptions-BindAndIssue"]'),
        this.page.getByText("Issue Policy", { exact: true }))).click();
      // Either the confirmation popup (OK) appears, the policy is already issued, or only the warnings panel shows
      const popup = await ok.first().or(done).waitFor({ state: "visible", timeout: 8000 }).then(() => true, () => false);
      if (popup) {
        if (await ok.first().isVisible()) await ok.first().click();
        return;
      }
    }
    throw new Error("Issue Policy did not show the confirmation popup or the issued-policy page");
  }

  // After the policy is issued PolicyCenter shows a confirmation page with a "View Policy" link; open it and read the policy number
  async viewIssuedPolicyAndReadNumber(): Promise<string> {
    const link = this.page.getByText(/View (your )?policy/i).first();
    await link.waitFor({ state: "visible", timeout: 60000 });
    await link.click();
    // The policy page title reads "Policy Summary: 6241212008"
    const heading = this.page.getByRole("heading", { name: /Policy Summary:\s*\d+/ });
    await heading.waitFor({ state: "visible", timeout: 60000 });
    const m = (await heading.innerText()).match(/Policy Summary:\s*(\d+)/);
    if (!m) throw new Error("Policy number not found in the Policy Summary heading");
    return m[1];
  }

  // The browser confirm() dialog is accepted by the test's dialog handler; wait for the page to become editable
  async editPolicyTransaction(): Promise<void> {
    await (await this.button("Edit Policy Transaction")).click();
    await this.button("Quote"); // resolves once the page is editable again (the Quote button is back)
  }
}
