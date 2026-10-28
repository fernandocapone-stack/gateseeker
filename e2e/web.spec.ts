import { expect, test } from "@playwright/test";

/**
 * Browser tests for the public page, against the stub GitHub/OSV started by
 * e2e/start-web.mjs. Covers: a valid URL producing a report with the
 * fixture's findings, an invalid URL, a missing/private repository, a
 * repository over the size limit, and the "use in CI" section.
 */

test.describe("public page", () => {
  test("analyzes a public repository and shows prioritized findings", async ({ page }) => {
    await page.goto("/");
    await expect(page.getByRole("heading", { level: 1 })).toContainText("Security gate for AI-generated code");
    await page.getByLabel("Repository URL").fill("https://github.com/acme/vibe");
    await page.getByRole("button", { name: "Analyze" }).click();
    await expect(page.getByRole("status")).toContainText("Analyzing");
    const report = page.getByRole("region", { name: "Report" });
    await expect(report).toBeVisible({ timeout: 30_000 });
    await expect(report).toContainText("acme/vibe@0123456");
    // The fixture carries hardcoded credentials and a committed .env: pattern findings in warn mode, so the verdict is PASS.
    await expect(report).toContainText("GSK-SECRET-001");
    await expect(report).toContainText("code pattern");
    // Snippets are redacted before they reach the page.
    await expect(report).not.toContainText("sk_live_HoHDwEcLksdRWvioeGponKHY");
    await expect(report.getByText("Limitations")).toBeVisible();
  });

  test("rejects an invalid URL without calling the service", async ({ page }) => {
    await page.goto("/");
    await page.getByLabel("Repository URL").fill("https://gitlab.com/acme/vibe");
    await page.getByRole("button", { name: "Analyze" }).click();
    const alert = page.getByRole("alert");
    await expect(alert).toContainText("Could not analyze this URL");
    await expect(alert).toContainText("invalid-url");
  });

  test("explains a missing or private repository and an oversized one", async ({ page }) => {
    await page.goto("/");
    await page.getByLabel("Repository URL").fill("https://github.com/acme/private");
    await page.getByRole("button", { name: "Analyze" }).click();
    await expect(page.getByRole("alert")).toContainText("not found on GitHub, or it is private");

    await page.getByLabel("Repository URL").fill("https://github.com/acme/huge");
    await page.getByRole("button", { name: "Analyze" }).click();
    await expect(page.getByRole("alert")).toContainText("Run the CLI locally");
  });

  test("offers the GitHub Action workflow with the analyzed repository named", async ({ page }) => {
    await page.goto("/");
    await page.getByLabel("Repository URL").fill("https://github.com/acme/vibe");
    await page.getByRole("button", { name: "Analyze" }).click();
    await expect(page.getByRole("region", { name: "Report" })).toBeVisible({ timeout: 30_000 });
    const ci = page.locator("#ci");
    await expect(ci).toContainText("Add this workflow to acme/vibe");
    await expect(ci).toContainText("uses: gateseeker-dev/gateseeker@v1");
  });
});
