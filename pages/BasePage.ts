export class BasePage {
  readonly page: import("@playwright/test").Page;

  constructor(page: import("@playwright/test").Page) {
    this.page = page;
  }

  async navigate(path = '/') {
    await this.page.goto(path);
  }

  async waitForLoad() {
    await this.page.waitForLoadState('networkidle');
  }

  // On-screen banner at the top right of the page, used in presentation mode to show what was just done or checked.
  // Green with ✔ when passed, red with ✘ otherwise. It stays until removeBanner() or the next drawBanner().
  protected async drawBanner(title: string, lines: string[], passed: boolean): Promise<void> {
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
  }

  protected async removeBanner(): Promise<void> {
    await this.page.evaluate(() => document.getElementById("qa-validation-banner")?.remove()).catch(() => {});
  }
}
