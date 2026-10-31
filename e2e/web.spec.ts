import { readFileSync } from "node:fs";
import { expect, test, type Page } from "@playwright/test";

/**
 * Browser tests for the public page, against the stub GitHub/OSV started by
 * e2e/start-web.mjs with the stub sign-in (GATESEEKER_AUTH_STUB=1) and a
 * quota of 3 analyses per hour. The Home is marketing only; the analyze view
 * (/app, full screen) lives behind sign-in and opens the saved report at
 * /r/<id> when an analysis finishes. Covers: the sign-in
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
  await expect(page.getByRole("heading", { level: 1 })).toHaveText("Find what to fix before you ship");
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
    // Signed in, the public site is gone: its pages forward to the Dashboard.
    for (const path of ["/", "/about", "/get-started"]) {
      await page.goto(path);
      await expect(page).toHaveURL(/\/app\/dashboard$/);
      await expect(page.getByRole("heading", { level: 1 })).toHaveText("How your repositories are doing");
    }
    // Resources has a workspace counterpart, linked from the sidebar.
    await page.goto("/resources");
    await expect(page).toHaveURL(/\/app\/resources$/);
    await expect(page.getByRole("heading", { level: 1 })).toHaveText("Rules, limits and documentation");
    await expect(page.getByRole("navigation", { name: "Workspace", exact: true }).getByRole("link", { name: "Resources" })).toHaveAttribute("aria-current", "page");
    await expect(page.getByText("GSK-SUPABASE-001")).toBeVisible();
    await page.getByRole("button", { name: "@e2e-user" }).click();
    await page.getByRole("menuitem", { name: "Sign out" }).click();
    await expect(page).toHaveURL(/\/$/);
    await expect(page.getByRole("banner").getByRole("link", { name: "Log in" })).toBeVisible();
    await page.goto("/app");
    await expect(page.getByRole("heading", { level: 1 })).toHaveText("Log in");
  });

  test("analyzes a public repository, saves the report and reuses it for the same commit", async ({ page }) => {
    await signIn(page);
    await analyze(page, "https://github.com/acme/vibe");
    await expect(page.getByRole("status")).toContainText("Analyzing");
    // A finished analysis opens its saved report.
    await expect(page).toHaveURL(/\/r\/mem-/, { timeout: 30_000 });
    const report = page.getByRole("region", { name: "Report" });
    await expect(report).toBeVisible({ timeout: 30_000 });
    await expect(report).toContainText("acme/vibe@0123456");
    // Hardcoded credentials in the fixture: the headline says what to fix; the gate line explains why CI would still pass.
    await expect(page.getByTestId("headline")).toContainText("to fix now");
    await expect(page.getByTestId("headline")).not.toContainText("PASS");
    await expect(page.getByTestId("gate-line")).toContainText("warning mode");
    await expect(report).toContainText("GSK-SECRET-001");
    await expect(report).toContainText("code pattern");
    // Snippets are redacted before they reach the page.
    await expect(report).not.toContainText("sk_live_HoHDwEcLksdRWvioeGponKHY");
    await expect(report.getByText("Limitations")).toBeVisible();

    await expect(page.getByTestId("saved-note")).toContainText("1 of 3 analyses used this hour");
    await expect(page.getByText(/in your Scans until/)).toBeVisible();
    await expect(page.locator("#ci")).toContainText("Add this workflow to acme/vibe");

    // The saved report opens again by its id; the note was for the first visit only.
    await page.reload();
    await expect(page.getByRole("region", { name: "Report" })).toBeVisible();
    await expect(page.getByTestId("saved-note")).toHaveCount(0);

    // Same commit again: served from the cache, quota untouched.
    await page.goto("/app");
    await analyze(page, "https://github.com/acme/vibe/tree/main");
    await expect(page.getByTestId("saved-note")).toContainText("Reused a report of this commit", { timeout: 30_000 });
    await expect(page.getByTestId("saved-note")).not.toContainText("analyses used");
  });

  test("downloads the report as a PDF file without opening the print dialog", async ({ page }) => {
    await signIn(page);
    await analyze(page, "https://github.com/acme/vibe");
    await expect(page.getByRole("region", { name: "Report" })).toBeVisible({ timeout: 30_000 });
    await page.evaluate("window.__printed = false; window.print = () => { window.__printed = true; }");
    const [download] = await Promise.all([page.waitForEvent("download"), page.getByRole("button", { name: "Download PDF" }).click()]);
    expect(download.suggestedFilename()).toBe("gateseeker-acme-vibe-0123456.pdf");
    const path = await download.path();
    const bytes = readFileSync(path);
    const text = bytes.toString("latin1");
    expect(text.startsWith("%PDF-1.4")).toBe(true);
    expect(text).toContain("acme/vibe@0123456");
    expect(text).toContain("GSK-SECRET-001");
    expect(text).not.toContain("sk_live_HoHDwEcLksdRWvioeGponKHY");
    expect(await page.evaluate("window.__printed")).toBe(false);
  });

  test("prints the whole report: every finding expanded, workspace frame hidden", async ({ page }) => {
    await signIn(page);
    await analyze(page, "https://github.com/acme/vibe");
    const report = page.getByRole("region", { name: "Report" });
    await expect(report).toBeVisible({ timeout: 30_000 });
    await expect(page.getByRole("button", { name: "Print" })).toBeVisible();
    const details = page.locator("[id^=finding-]");
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

  test("records analyses as notifications and on the Dashboard, and honours the settings", async ({ page }) => {
    await signIn(page);
    // The analyze view is full screen; the bell lives in the workspace header.
    await page.goto("/app/dashboard");
    const bell = page.getByRole("button", { name: /^Notifications/ });
    await expect(bell).toHaveAccessibleName("Notifications");
    await page.getByRole("banner").getByRole("link", { name: "Analyze a repository" }).click();
    await analyze(page, "https://github.com/acme/vibe");
    await expect(page.getByRole("region", { name: "Report" })).toBeVisible({ timeout: 30_000 });
    // The header's Analyze button opens the analyze view again.
    await page.getByRole("banner").getByRole("link", { name: "Analyze a repository" }).click();
    await analyze(page, "https://github.com/acme/private");
    await expect(page.getByRole("alert")).toBeVisible();
    // Typing errors are not worth a notification.
    await analyze(page, "https://gitlab.com/acme/vibe");
    await expect(page.getByRole("alert")).toContainText("invalid-url");
    // Esc leaves the analyze view for the page it was opened from.
    await page.keyboard.press("Escape");
    await expect(page).toHaveURL(/\/r\/mem-/);
    await expect(bell).toHaveAccessibleName("Notifications, 2 unread");

    await bell.click();
    const panel = page.getByRole("dialog", { name: "Notifications" });
    await expect(panel.getByRole("listitem")).toHaveCount(2);
    await expect(panel.getByRole("listitem").first()).toContainText("Analysis refused");
    await expect(panel.getByRole("listitem").nth(1)).toContainText("acme/vibe@0123456");
    await page.getByRole("button", { name: "Close notifications" }).click();
    await expect(bell).toHaveAccessibleName("Notifications");

    // The Dashboard lists the repository with its latest verdict.
    await page.getByRole("navigation", { name: "Workspace", exact: true }).getByRole("link", { name: "Dashboard" }).click();
    const repos = page.getByRole("table", { name: "Repositories" });
    await expect(repos.getByRole("row")).toHaveCount(2);
    await expect(repos).toContainText("acme/vibe");
    await expect(repos.getByRole("link", { name: "View scan" })).toHaveAttribute("href", /^\/r\/mem-/);

    // Scans lists every analysis; an opened scan is titled with the repository and leads back to the list.
    await page.getByRole("navigation", { name: "Workspace", exact: true }).getByRole("link", { name: "Scans" }).click();
    await expect(page.getByRole("heading", { level: 1 })).toHaveText("Your scans");
    const scans = page.getByRole("table", { name: "Scans" });
    // The history comes from the account (shared by every test of this run), newest first: at least this test's analysis.
    await expect(scans.getByRole("row").nth(1)).toContainText("acme/vibe");
    await scans.getByRole("link", { name: "View scan" }).first().click();
    await expect(page.getByRole("region", { name: "Report" })).toBeVisible();
    const header = page.getByRole("banner");
    await expect(header).toContainText("acme/vibe");
    await expect(page).toHaveTitle("acme/vibe · Gateseeker");
    await expect(page.getByRole("navigation", { name: "Workspace", exact: true }).getByRole("link", { name: "Scans" })).toHaveClass(/border-primary/);
    await header.getByRole("link", { name: "Back to scans" }).click();
    await expect(page).toHaveURL(/\/app\/scans$/);

    // Turned off in Settings (account menu): the next analysis leaves no notification.
    await page.getByRole("button", { name: "@e2e-user" }).click();
    await page.getByRole("menuitem", { name: "Settings" }).click();
    await expect(page.getByRole("heading", { level: 1 })).toHaveText("Account and preferences");
    await page.getByRole("switch", { name: /Notify me when an analysis ends/ }).uncheck({ force: true });
    await page.getByRole("banner").getByRole("link", { name: "Analyze a repository" }).click();
    await analyze(page, "https://github.com/acme/private");
    await expect(page.getByRole("alert")).toBeVisible();
    await page.keyboard.press("Escape");
    await expect(bell).toHaveAccessibleName("Notifications");
    await bell.click();
    await expect(panel.getByRole("listitem")).toHaveCount(2);
  });

  test("returns to the page that asked for sign-in and counts the login funnel once per tab", async ({ page }) => {
    const events: string[] = [];
    page.on("request", (r) => {
      if (r.url().endsWith("/api/event")) events.push((JSON.parse(r.postData() ?? "{}") as { kind?: string }).kind ?? "?");
    });
    await page.goto("/app/scans");
    await expect(page.getByRole("heading", { level: 1 })).toHaveText("Log in");
    await page.reload();
    await expect(page.getByRole("heading", { level: 1 })).toHaveText("Log in");
    await page.getByRole("button", { name: "Continue with GitHub" }).click();
    await expect(page).toHaveURL(/\/app\/scans$/);
    await expect(page.getByRole("heading", { level: 1 })).toHaveText("Your scans");
    // A signed-in visit to /login forwards without counting a new sign-in.
    await page.goto("/login");
    await expect(page).toHaveURL(/\/app$/);
    await expect.poll(() => events).toEqual(["login_view", "login_start", "signin_complete"]);
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
    await page.getByRole("banner").getByRole("link", { name: "Log in" }).click();
    await expect(page.getByRole("heading", { level: 1 })).toHaveText("Log in");
    await expect(page.getByRole("button", { name: "Continue with GitHub" })).toBeVisible();
    // A saved report needs a session too.
    await page.goto("/r/mem-nothing");
    await expect(page.getByText("Sign in to open this report")).toBeVisible();
  });

  test("shows how to fix a finding, copies the AI prompt and builds the accept-risk comment", async ({ page, context }) => {
    await context.grantPermissions(["clipboard-read", "clipboard-write"]);
    await signIn(page);
    await analyze(page, "https://github.com/acme/vibe");
    await expect(page.getByRole("region", { name: "Report" })).toBeVisible({ timeout: 30_000 });
    const row = page.getByRole("list", { name: "Findings" }).getByRole("listitem").filter({ hasText: "GSK-CORS-001" }).first();
    await row.getByRole("button", { name: "How to fix" }).click();
    const detail = page.locator("[id^=finding-]").filter({ visible: true }).first();
    await expect(detail.getByText("What could happen")).toBeVisible();
    await expect(detail.getByText("How to fix it")).toBeVisible();
    const prompt = detail.getByTestId("ai-prompt");
    await expect(prompt).toContainText("Gateseeker (security check, rule GSK-CORS-001)");
    await expect(prompt).toContainText("Do not weaken or turn off any check");

    await detail.getByRole("button", { name: "Copy prompt" }).click();
    await expect(detail.getByRole("button", { name: "Copied" })).toBeVisible();
    expect(await page.evaluate("navigator.clipboard.readText()")).toContain("rule GSK-CORS-001");

    await detail.getByRole("button", { name: "Accept the risk" }).click();
    const create = detail.getByRole("button", { name: "Create comment" });
    await expect(create).toBeDisabled();
    await detail.getByLabel(/Why is this acceptable/).fill("public read-only API, no cookies */ evil");
    await create.click();
    const comment = detail.getByTestId("suppression-comment");
    await expect(comment).toHaveText(/^(\/\/ |\/\* )gateseeker-ignore GSK-CORS-001 public read-only API, no cookies {2}evil/);
    await expect(detail.getByText(/Paste this on the line above line \d+ of/)).toBeVisible();
  });

  test("opens the analyze view from the header or with /, offers shortcuts, and groups repeated findings", async ({ page }) => {
    await signIn(page);
    const shortcuts = page.getByLabel("Shortcuts");
    await expect(shortcuts.getByRole("button", { name: "Try an example" })).toBeVisible();
    await shortcuts.getByRole("button", { name: "Try an example" }).click();
    await expect(page).toHaveURL(/\/r\/mem-/, { timeout: 30_000 });
    // Hardcoded credentials in several places: one group, marked as the place to start.
    const findings = page.getByRole("list", { name: "Findings" });
    const group = findings.getByRole("listitem").filter({ hasText: /\d+ places/ }).first();
    await expect(group).toContainText("Start here");
    await group.getByRole("button", { name: /Show \d+ places/ }).click();
    await expect(group.getByRole("button", { name: "How to fix" }).first()).toBeVisible();
    // "/" opens the analyze view; the last repository is a shortcut now; Back returns to the report.
    await page.keyboard.press("/");
    await expect(page).toHaveURL(/\/app$/);
    await expect(page.getByLabel("Shortcuts").getByRole("button", { name: "acme/vibe" })).toBeVisible();
    await page.getByRole("button", { name: "Back" }).click();
    await expect(page).toHaveURL(/\/r\/mem-/);
  });

  test("reads as cards on a phone, without horizontal scrolling", async ({ page }) => {
    await page.setViewportSize({ width: 375, height: 812 });
    await signIn(page);
    await analyze(page, "https://github.com/acme/vibe");
    await expect(page.getByRole("region", { name: "Report" })).toBeVisible({ timeout: 30_000 });
    const overflow = await page.evaluate("document.documentElement.scrollWidth - document.documentElement.clientWidth");
    expect(overflow).toBeLessThanOrEqual(0);
  });

  test("compares a scan with the previous one of the same repository, from the account history", async ({ page }) => {
    await signIn(page);
    await analyze(page, "https://github.com/acme/vibe");
    await expect(page).toHaveURL(/\/r\/mem-/, { timeout: 30_000 });
    // A later commit where the problems were fixed.
    await page.getByRole("banner").getByRole("link", { name: "Analyze a repository" }).click();
    await analyze(page, "https://github.com/acme/vibe/tree/fixed");
    await expect(page).toHaveURL(/\/r\/mem-/, { timeout: 30_000 });
    const band = page.getByTestId("comparison");
    await expect(band).toBeVisible();
    await expect(band).toContainText("Since the scan of");
    await expect(band).toContainText("0 new");
    await expect(band).toContainText(/[1-9]\d* fixed/);
    await band.getByText("What was fixed").click();
    await expect(band).toContainText("GSK-SECRET-001");
    // The history now comes from the account, not only this browser.
    await page.getByRole("navigation", { name: "Workspace", exact: true }).getByRole("link", { name: "Scans" }).click();
    await expect(page.getByText(/Kept on your account for 180 days/)).toBeVisible();
  });

  test("follows a repository from its report and lists it in Settings until unfollowed", async ({ page }) => {
    await signIn(page);
    await analyze(page, "https://github.com/acme/vibe");
    await expect(page).toHaveURL(/\/r\/mem-/, { timeout: 30_000 });
    const follow = page.getByRole("button", { name: "Follow" });
    await follow.click();
    await expect(page.getByRole("button", { name: "Following" })).toHaveAttribute("aria-pressed", "true");
    await page.goto("/app/settings");
    const list = page.getByRole("list", { name: "Followed repositories" });
    await expect(list).toContainText("acme/vibe");
    await expect(list).toContainText("Not checked yet");
    await list.getByRole("button", { name: "Unfollow" }).click();
    await expect(page.getByText("You are not following any repository.")).toBeVisible();
  });

  test("emails a confirmation on follow whose link stops following without signing in", async ({ page, context }) => {
    await signIn(page);
    await analyze(page, "https://github.com/acme/vibe");
    await expect(page).toHaveURL(/\/r\/mem-/, { timeout: 30_000 });
    await page.getByRole("button", { name: "Follow" }).click();
    await expect(page.getByRole("button", { name: "Following" })).toBeVisible();
    // The stub server keeps emails in memory instead of sending them.
    const outbox = (await (await page.request.get("/api/dev/outbox")).json()) as { sent: { kind: string; to: string; text: string }[] };
    const confirm = outbox.sent.filter((m) => m.kind === "follow_confirm").at(-1);
    expect(confirm?.to).toBe("e2e-user@example.test");
    const link = new URL(/https?:\/\/\S+\/unsubscribe\?\S+/.exec(confirm?.text ?? "")?.[0] ?? "");
    // Signed out, in a fresh page: the link alone is enough, and opening it changes nothing until the button.
    await context.clearCookies();
    await page.evaluate(() => { localStorage.clear(); });
    await page.goto(`/unsubscribe${link.search}`);
    await expect(page.getByRole("heading", { level: 1 })).toHaveText("Stop following this repository");
    await page.getByRole("button", { name: "Stop following" }).click();
    await expect(page.getByRole("heading", { level: 1 })).toHaveText("You stopped following");
    await expect(page.getByText("no longer checks acme/vibe")).toBeVisible();
    // A forged token is refused.
    await page.goto(`/unsubscribe?f=${link.searchParams.get("f") ?? ""}&t=${"0".repeat(32)}`);
    await page.getByRole("button", { name: "Stop following" }).click();
    await expect(page.getByRole("alert")).toContainText("not valid");
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
