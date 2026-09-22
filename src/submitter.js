import { chromium } from "playwright";

const SUBMISSION_URL = "https://search.brave.com/submit-url";

function messageFromError(error) {
  return error instanceof Error ? error.message : String(error);
}

export class BraveSubmitter {
  constructor({
    onStage = () => {},
    verificationTimeoutMs = 30_000,
    executablePath = ""
  } = {}) {
    this.onStage = onStage;
    this.verificationTimeoutMs = verificationTimeoutMs;
    this.executablePath = executablePath;
    this.browser = null;
    this.context = null;
    this.page = null;
  }

  async ensurePage() {
    if (!this.browser) {
      this.browser = await chromium.launch({
        headless: false,
        ...(this.executablePath ? { executablePath: this.executablePath } : {})
      });
      this.context = await this.browser.newContext();
      this.page = await this.context.newPage();
    }
    return this.page;
  }

  async submit(url) {
    const page = await this.ensurePage();
    this.onStage("opening");

    try {
      await page.goto(SUBMISSION_URL, { waitUntil: "domcontentloaded", timeout: 30_000 });
      const input = page.getByRole("textbox", { name: /Enter a valid url/i });
      await input.fill(url);
      await page.getByRole("button", { name: "Submit" }).click();
      this.onStage("verifying");

      await page.getByText("Success", { exact: true }).waitFor({
        state: "visible",
        timeout: this.verificationTimeoutMs
      });

      this.onStage("success");
      return { status: "success" };
    } catch (error) {
      const body = await page.locator("body").innerText({ timeout: 3_000 }).catch(() => "");
      const verificationVisible = /verifying you.?re a human|captcha|challenge/i.test(body);
      const message = verificationVisible
        ? "Human verification is still required in the opened browser. Complete it manually, then retry this URL."
        : messageFromError(error);
      this.onStage("failed");
      return { status: "failed", message };
    }
  }

  async close() {
    if (this.browser) await this.browser.close();
    this.browser = null;
    this.context = null;
    this.page = null;
  }
}
