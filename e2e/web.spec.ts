import { expect, test, type Page } from "@playwright/test";

/**
 * Browser tests for the public page, against the stub GitHub/OSV started by
 * e2e/start-web.mjs with the stub sign-in (GATESEEKER_AUTH_STUB=1) and a
 * quota of 3 analyses per hour. The Home is marketing only; the live scanner
 * lives in the demo workspace (/app) behind sign-in. Covers: the sign-in
 * round trip, a valid URL producing a report with the fixture's findings and
 * a saved /r/<id> link, the per-commit reuse, an invalid URL, a
 * missing/private repository, a repository over the size limit, the "use in
 * CI" section and sign-out.
 */

async function signIn(page: Page): Promise<void> {
  await page.goto("/app");
  // Signed out: /app forwards to /login and comes back after the button.
  await expect(page.getByRole("heading", { level: 1 })).toHaveText("Log in");
  await page.getByRole("button", { name: "Continue with GitHub" }).click();
  await expect(page).toHaveURL(/\/app$/);
  await expect(page.getByRole("heading", { level: 1 })).toHaveText("Analyze a repository");
}

async function analyze(page: Page, url: string): Promise<void> {
  await page.getByLabel("Repository URL").fill(url);
  await page.getByRole("button", { name: "Analyze" }).click();
}

test.describe("public page", () => {
  test("keeps the workspace behind sign-in and shows the account afterwards", async ({ page }) => {
    await page.goto("/");
    await expect(page.getByRole("heading", { level: 1 })).toContainText("Your app was built fast");
    await expect(page.getByLabel("Repository URL")).toHaveCount(0);
    await signIn(page);
    // Signed in, the site header names the account; the workspace has its own frame with the account menu.
    await page.getByRole("link", { name: "GateSeeker workspace" }).waitFor();
    await page.goto("/");
    const nav = page.getByRole("navigation", { name: "Main" });
    await expect(nav.getByRole("link", { name: "@e2e-user" })).toBeVisible();
    await nav.getByRole("link", { name: "@e2e-user" }).click();
    await expect(page.getByRole("heading", { level: 1 })).toHaveText("Analyze a repository");
    await page.getByRole("button", { name: "@e2e-user" }).click();
    await page.getByRole("menuitem", { name: "Sign out" }).click();
    await expect(nav.getByRole("link", { name: "Log in" })).toBeVisible();
    await page.goto("/app");
    await expect(page.getByRole("heading", { level: 1 })).toHaveText("Log in");
  });

  test("analyzes a public repository, saves the report and reuses it for the same commit", async ({ page }) => {
    await signIn(page);
    await analyze(page, "https://github.com/acme/vibe");
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

    const note = page.getByTestId("saved-note");
    await expect(note).toContainText("1 of 3 analyses used this hour");
    const href = await note.getByRole("link").getAttribute("href");
    expect(href).toMatch(/^\/r\/mem-/);

    // The saved report opens by its id, for this account.
    await page.goto(href ?? "/r/none");
    await expect(page.getByRole("region", { name: "Report" })).toBeVisible();
    await expect(page.getByText("Saved report")).toBeVisible();
    await expect(page.locator("#ci")).toContainText("Add this workflow to acme/vibe");

    // Same commit again: served from the cache, quota untouched.
    await page.goto("/app");
    await analyze(page, "https://github.com/acme/vibe/tree/main");
    await expect(page.getByTestId("saved-note")).toContainText("Reused a report of this commit", { timeout: 30_000 });
    await expect(page.getByTestId("saved-note")).not.toContainText("analyses used");
  });

  test("exports the whole report for PDF: every finding expanded, workspace frame hidden", async ({ page }) => {
    await signIn(page);
    await analyze(page, "https://github.com/acme/vibe");
    const report = page.getByRole("region", { name: "Report" });
    await expect(report).toBeVisible({ timeout: 30_000 });
    await expect(page.getByRole("button", { name: "Export PDF" })).toBeVisible();
    const details = page.locator("tr[id^=finding-]");
    const total = await details.count();
    expect(total).toBeGreaterThan(0);
    // Collapsed on screen, and a filter with no match must not shorten the export.
    await expect(details.filter({ visible: true })).toHaveCount(0);
    await page.getByRole("radio", { name: "P4 (0)" }).click();
    await expect(details).toHaveCount(0);
    await page.evaluate("window.dispatchEvent(new Event('beforeprint'))");
    await page.emulateMedia({ media: "print" });
    await expect(details.filter({ visible: true })).toHaveCount(total);
    await expect(page.getByRole("navigation", { name: "Workspace" })).toBeHidden();
    await expect(report).toContainText("not that a project is secure");
    await expect(report).not.toContainText("sk_live_HoHDwEcLksdRWvioeGponKHY");
  });

  test("records finished and refused analyses as notifications and honours the settings", async ({ page }) => {
    await signIn(page);
    const bell = page.getByRole("button", { name: /^Notifications/ });
    await expect(bell).toHaveAccessibleName("Notifications");
    await analyze(page, "https://github.com/acme/vibe");
    await expect(page.getByRole("region", { name: "Report" })).toBeVisible({ timeout: 30_000 });
    await analyze(page, "https://github.com/acme/private");
    await expect(page.getByRole("alert")).toBeVisible();
    // Typing errors are not worth a notification.
    await analyze(page, "https://gitlab.com/acme/vibe");
    await expect(bell).toHaveAccessibleName("Notifications, 2 unread");

    await bell.click();
    const panel = page.getByRole("dialog", { name: "Notifications" });
    await expect(panel.getByRole("listitem")).toHaveCount(2);
    await expect(panel.getByRole("listitem").first()).toContainText("Analysis refused");
    await expect(panel.getByRole("listitem").nth(1)).toContainText("acme/vibe@0123456");
    await page.getByRole("button", { name: "Close notifications" }).click();
    await expect(bell).toHaveAccessibleName("Notifications");

    // Turned off in Settings: the next analysis leaves no notification.
    await page.getByRole("navigation", { name: "Workspace", exact: true }).getByRole("link", { name: "Settings" }).click();
    await expect(page.getByRole("heading", { level: 1 })).toHaveText("Settings");
    await page.getByRole("switch", { name: /Notify me when an analysis ends/ }).uncheck({ force: true });
    await page.getByRole("navigation", { name: "Workspace", exact: true }).getByRole("link", { name: "Analyze repository" }).click();
    await analyze(page, "https://github.com/acme/private");
    await expect(page.getByRole("alert")).toBeVisible();
    await expect(bell).toHaveAccessibleName("Notifications");
    await bell.click();
    await expect(panel.getByRole("listitem")).toHaveCount(2);
  });

  test("rejects an invalid URL without calling the service", async ({ page }) => {
    await signIn(page);
    await analyze(page, "https://gitlab.com/acme/vibe");
    const alert = page.getByRole("alert");
    await expect(alert).toContainText("Could not analyze this URL");
    await expect(alert).toContainText("invalid-url");
  });

  test("explains a missing or private repository and an oversized one", async ({ page }) => {
    await signIn(page);
    await analyze(page, "https://github.com/acme/private");
    await expect(page.getByRole("alert")).toContainText("not found on GitHub, or it is private");
    await analyze(page, "https://github.com/acme/huge");
    await expect(page.getByRole("alert")).toContainText("Run the CLI locally");
  });

  test("navigates between the site sections without a full reload and serves deep links", async ({ page }) => {
    await page.goto("/");
    await page.getByRole("navigation", { name: "Main" }).getByRole("link", { name: "How it works" }).click();
    await expect(page).toHaveURL(/\/how-it-works$/);
    await expect(page.getByRole("heading", { level: 1 })).toHaveText("How it works");
    await page.getByRole("navigation", { name: "Main" }).getByRole("link", { name: "Resources" }).click();
    await expect(page.getByRole("heading", { level: 1 })).toHaveText("Resources");
    await expect(page.getByText("GSK-SUPABASE-001")).toBeVisible();
    await page.goto("/get-started");
    await expect(page.getByRole("heading", { level: 1 })).toHaveText("Get started");
    await expect(page.locator("#ci")).toContainText("uses: gateseeker-dev/gateseeker@v1");
    await page.goto("/about");
    await expect(page.getByRole("heading", { level: 1 })).toHaveText("About");
    await page.goto("/nothing-here");
    await expect(page.getByRole("heading", { level: 1 })).toHaveText("Page not found");
    await page.getByRole("navigation", { name: "Main" }).getByRole("link", { name: "Log in" }).click();
    await expect(page.getByRole("heading", { level: 1 })).toHaveText("Log in");
    await expect(page.getByRole("button", { name: "Continue with GitHub" })).toBeVisible();
    // A saved report needs a session too.
    await page.goto("/r/mem-nothing");
    await expect(page.getByText("Sign in to open this report")).toBeVisible();
  });

  test("offers the GitHub Action workflow with the analyzed repository named", async ({ page }) => {
    await signIn(page);
    await analyze(page, "https://github.com/acme/vibe");
    await expect(page.getByRole("region", { name: "Report" })).toBeVisible({ timeout: 30_000 });
    const ci = page.locator("#ci");
    await expect(ci).toContainText("Add this workflow to acme/vibe");
    await expect(ci).toContainText("uses: gateseeker-dev/gateseeker@v1");
  });
});
