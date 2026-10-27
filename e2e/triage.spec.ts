import { execFileSync } from "node:child_process";
import { existsSync, readFileSync } from "node:fs";
import { resolve } from "node:path";
import { expect, test } from "@playwright/test";

const REPO = resolve(".e2e-tmp", "repo");
const ENTRY = "/?token=e2e-token";

test.describe.configure({ mode: "serial" });

test("the page refuses to work without the session token", async ({ page }) => {
  await page.goto("/");
  await expect(page.getByText(/precisa do endereço completo/)).toBeVisible();
});

test("lists the pending records with the draft badge", async ({ page }) => {
  await page.goto(ENTRY);
  await expect(page.getByTestId("pending-GSK-ADV-2026-9002")).toBeVisible();
  await expect(page.getByTestId("pending-GSK-ADV-2026-9003")).toBeVisible();
  await expect(page.getByTestId("pending-GSK-ADV-2026-9003").getByText("rascunho pré-preenchido")).toBeVisible();
  // The token left the address bar.
  expect(page.url()).not.toContain("token=");
});

test("rejecting requires a reason and records the decision", async ({ page }) => {
  await page.goto(ENTRY);
  await page.getByTestId("pending-GSK-ADV-2026-9002").getByRole("button", { name: "Revisar" }).click();
  await expect(page.getByTestId("reject")).toBeDisabled();
  await page.getByLabel("Motivo da rejeição").fill("já coberto pelo OSV (MAL-2026-0000)");
  await page.getByTestId("reject").click();
  await expect(page.getByText(/GSK-ADV-2026-9002 rejeitado e registrado/)).toBeVisible();
  await page.getByRole("button", { name: /Rejeitados \(1\)/ }).click();
  await expect(page.getByTestId("rejected-GSK-ADV-2026-9002")).toContainText("já coberto pelo OSV");

  const saved = JSON.parse(readFileSync(resolve(REPO, "advisories", "rejected", "one.json"), "utf8")) as { status: string; review: { reviewed_by: string } };
  expect(saved.status).toBe("rejected");
  expect(saved.review.reviewed_by).toBe("E2E Reviewer");
  expect(existsSync(resolve(REPO, "advisories", "proposed", "one.json"))).toBe(false);
});

test("approving needs two publishers or a primary source, uses the draft, and commits", async ({ page }) => {
  await page.goto(ENTRY);
  await page.getByTestId("pending-GSK-ADV-2026-9003").getByRole("button", { name: "Revisar" }).click();

  // One source only: approval is blocked and the badge says why.
  await expect(page.getByTestId("approve")).toBeDisabled();
  await expect(page.getByText("precisa de 2 editores ou 1 fonte primária")).toBeVisible();

  // Take the engineering draft, then complete the record by hand.
  await page.getByRole("button", { name: "Usar rascunho" }).click();
  await expect(page.getByLabel("Gravidade")).toHaveValue("CRITICAL");
  await page.getByLabel("nome do pacote 1").fill("example/fictitious-cli (GitHub release binaries)");
  await page.getByLabel("O que quem instalou deve fazer").fill("Reinstall from a verified release and rotate credentials.");
  await page.getByRole("button", { name: "Adicionar fonte" }).click();
  await page.getByLabel("editor da fonte 2").fill("Example Project (GitHub releases)");
  await page.getByLabel("título da fonte 2").fill("Release notes");
  await page.getByLabel("link da fonte 2").fill("https://example.org/releases/v2");
  await page.getByLabel("fonte primária 2").check();
  await expect(page.getByText("suficientes para aprovar")).toBeVisible();

  await page.getByTestId("approve").click();
  await expect(page.getByText(/GSK-ADV-2026-9003 aprovado e registrado \(commit [0-9a-f]+\)/)).toBeVisible();
  await page.getByRole("button", { name: /Aprovados \(1\)/ }).click();
  await expect(page.getByTestId("approved-GSK-ADV-2026-9003")).toContainText("Draft: release binaries");

  const saved = JSON.parse(readFileSync(resolve(REPO, "advisories", "approved", "two.json"), "utf8")) as { status: string; severity: string; draft?: unknown; sources: unknown[] };
  expect(saved.status).toBe("approved");
  expect(saved.severity).toBe("CRITICAL");
  expect(saved.draft).toBeUndefined();
  expect(saved.sources).toHaveLength(2);

  const log = execFileSync("git", ["log", "--oneline"], { cwd: REPO, encoding: "utf8" });
  expect(log).toContain("intel: approve GSK-ADV-2026-9003");
  expect(log).toContain("intel: reject GSK-ADV-2026-9002");
  // The throwaway repository has no remote, so the "not pushed yet" counter cannot be asserted here;
  // it is covered by the server unit tests with a fake git.
});
