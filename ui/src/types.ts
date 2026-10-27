/** Mirror of the server contract (src/intel/ui/types.ts) and the advisory record. */

export type AdvisoryStatus = "proposed" | "approved" | "rejected" | "withdrawn";
export type AdvisoryType = "tag-rewrite" | "malicious-version" | "compromised-maintainer" | "typosquat" | "install-script-backdoor" | "other";
export type Severity = "CRITICAL" | "HIGH" | "MODERATE" | "LOW";
export type Ecosystem = "npm" | "Packagist" | "PyPI" | "RubyGems" | "crates.io" | "Go" | "other";

export interface AdvisoryRange {
  introduced: string;
  fixed?: string;
}

export interface AdvisoryAffected {
  versions?: string[];
  ranges?: AdvisoryRange[];
  tags?: string[];
  commits_after?: string;
  fixed_in?: string | null;
}

export interface AdvisoryPackage {
  name: string;
  affected: AdvisoryAffected;
}

export interface AdvisorySource {
  url: string;
  publisher: string;
  title: string;
  published_at: string;
  primary?: boolean;
}

export interface Advisory {
  id: string;
  status: AdvisoryStatus;
  type: AdvisoryType;
  severity: Severity;
  ecosystem: Ecosystem;
  packages: AdvisoryPackage[];
  window: { start: string | null; end: string | null };
  indicators: string[];
  summary: string;
  remediation: string;
  sources: AdvisorySource[];
  review: { proposed_by: string; proposed_at: string; reviewed_by: string | null; reviewed_at: string | null; notes: string | null };
  upstream: { osv: string | null; ghsa: string | null };
  draft?: Partial<Advisory> & Record<string, unknown>;
}

export interface UiRecord {
  id: string;
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
export type DecideResponse = { ok: true; dir: UiRecord["dir"]; file: string; commit: string | null } | { ok: false; issues: string[] };
export type PushResponse = { ok: true; output: string } | { ok: false; error: string };

export const TYPE_LABELS: Record<AdvisoryType, string> = {
  "malicious-version": "Versão maliciosa publicada",
  "tag-rewrite": "Tags ou releases reescritas",
  "compromised-maintainer": "Conta de mantenedor comprometida",
  typosquat: "Pacote impostor (typosquat)",
  "install-script-backdoor": "Script de instalação com backdoor",
  other: "Outro",
};

export const SEVERITY_LABELS: Record<Severity, { label: string; help: string }> = {
  CRITICAL: { label: "Crítica", help: "Quem instalou deve considerar a máquina comprometida e rotacionar credenciais." },
  HIGH: { label: "Alta", help: "Exposição séria de dados ou acesso; corrigir imediatamente." },
  MODERATE: { label: "Moderada", help: "Risco real, mas limitado ou dependente de condições." },
  LOW: { label: "Baixa", help: "Informativo; corrigir quando tocar no componente." },
};

export const ECOSYSTEM_LABELS: Record<Ecosystem, string> = {
  npm: "npm (JavaScript)",
  Packagist: "Composer / Packagist (PHP)",
  PyPI: "PyPI (Python)",
  RubyGems: "RubyGems (Ruby)",
  "crates.io": "crates.io (Rust)",
  Go: "Go modules",
  other: "Outro (binários, releases, CLI)",
};
