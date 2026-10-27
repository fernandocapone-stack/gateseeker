import { readFileSync } from "node:fs";
import { join } from "node:path";

export const FIXTURES_DIR = join(import.meta.dirname, "..", "fixtures");

export function readFixture(relativePath: string): string {
  return readFileSync(join(FIXTURES_DIR, relativePath), "utf8");
}

export function fixturePath(relativePath: string): string {
  return join(FIXTURES_DIR, relativePath);
}

export function readJsonFixture(relativePath: string): unknown {
  return JSON.parse(readFixture(relativePath));
}
