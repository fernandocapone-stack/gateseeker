import type { Advisory } from "../advisory-schema.js";

/** Contract between the local triage server and the browser UI. */

export interface UiRecord {
  id: string;
  /** File name inside its status directory. */
  file: string;
  dir: "proposed" | "approved" | "rejected";
  data: Advisory;
}

export interface UiState {
  gitUser: string | null;
  branch: string | null;
  unpushed: number;
  mergedIntelBranch: string | null;
  pending: UiRecord[];
  approved: UiRecord[];
  rejected: UiRecord[];
  warnings: string[];
}

export type DecideAction = "approve" | "reject" | "save";

export interface DecideRequest {
  id: string;
  action: DecideAction;
  record: Advisory;
  /** Required for reject; appended to review.notes. */
  reason?: string;
}

export type DecideResponse = { ok: true; dir: UiRecord["dir"]; file: string; commit: string | null } | { ok: false; issues: string[] };

export type PushResponse = { ok: true; output: string } | { ok: false; error: string };
