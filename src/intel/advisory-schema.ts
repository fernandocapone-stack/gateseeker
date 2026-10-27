import { z } from "zod";
import { isStrictSemver } from "../parser/lockfile.js";
import { SECRET_PATTERNS } from "../patterns/rules/secret-hardcoded.js";

/**
 * Gateseeker advisory record: structured facts about a supply-chain incident,
 * curated by a human. Only `approved` records are ever consumed by the scanner.
 * Records hold facts and links, never third-party prose.
 */

export const ADVISORY_STATUSES = ["proposed", "approved", "rejected", "withdrawn"] as const;
export const ADVISORY_TYPES = ["tag-rewrite", "malicious-version", "compromised-maintainer", "typosquat", "install-script-backdoor", "other"] as const;
export const ADVISORY_ECOSYSTEMS = ["npm", "Packagist", "PyPI", "RubyGems", "crates.io", "Go", "other"] as const;

const isoDateTime = z.iso.datetime({ offset: true });
const isoDate = z.string().regex(/^\d{4}-\d{2}-\d{2}$/, "expected YYYY-MM-DD");
const httpsUrl = z.url().refine((u) => u.startsWith("https://"), "sources must use https");
const shortText = (max: number) => z.string().min(1).max(max);

export const advisoryRangeSchema = z.strictObject({
  introduced: z.string().min(1),
  fixed: z.string().min(1).optional(),
});

export const advisoryAffectedSchema = z.strictObject({
  versions: z.array(z.string().min(1)).optional(),
  ranges: z.array(advisoryRangeSchema).optional(),
  tags: z.array(z.string().min(1)).optional(),
  commits_after: isoDateTime.optional(),
  fixed_in: z.string().min(1).nullable().optional(),
});

export const advisoryPackageSchema = z.strictObject({
  name: z.string().min(1).max(214),
  affected: advisoryAffectedSchema,
});

export const advisorySourceSchema = z.strictObject({
  url: httpsUrl,
  publisher: shortText(100),
  title: shortText(200),
  published_at: isoDate,
  /** The package's own repository or registry page counts as a primary source. */
  primary: z.boolean().optional(),
});

export const advisorySchema = z
  .strictObject({
    id: z.string().regex(/^GSK-ADV-\d{4}-\d{4}$/, "expected GSK-ADV-YYYY-NNNN"),
    status: z.enum(ADVISORY_STATUSES),
    type: z.enum(ADVISORY_TYPES),
    severity: z.enum(["CRITICAL", "HIGH", "MODERATE", "LOW"]),
    ecosystem: z.enum(ADVISORY_ECOSYSTEMS),
    packages: z.array(advisoryPackageSchema).min(1),
    window: z.strictObject({ start: isoDateTime.nullable(), end: isoDateTime.nullable() }),
    indicators: z.array(shortText(200)).max(20),
    summary: shortText(300),
    remediation: shortText(500),
    sources: z.array(advisorySourceSchema).min(1).max(20),
    review: z.strictObject({
      proposed_by: shortText(100),
      proposed_at: isoDateTime,
      reviewed_by: shortText(100).nullable(),
      reviewed_at: isoDateTime.nullable(),
      notes: z.string().max(500).nullable(),
    }),
    upstream: z.strictObject({ osv: z.string().nullable(), ghsa: z.string().nullable() }),
  })
  .superRefine((a, ctx) => {
    if (a.status === "approved" || a.status === "rejected" || a.status === "withdrawn") {
      if (!a.review.reviewed_by || !a.review.reviewed_at) {
        ctx.addIssue({ code: "custom", path: ["review"], message: `status "${a.status}" requires reviewed_by and reviewed_at` });
      }
    }
    if (a.status === "approved") {
      const publishers = new Set(a.sources.map((s) => s.publisher.trim().toLowerCase()));
      const hasPrimary = a.sources.some((s) => s.primary === true);
      if (publishers.size < 2 && !hasPrimary) {
        ctx.addIssue({ code: "custom", path: ["sources"], message: "approved records need two sources from distinct publishers, or one primary source" });
      }
    }
    if (a.ecosystem === "npm") {
      a.packages.forEach((p, i) => {
        for (const v of p.affected.versions ?? []) {
          if (!isStrictSemver(v)) ctx.addIssue({ code: "custom", path: ["packages", i, "affected", "versions"], message: `"${v}" is not strict semver` });
        }
        for (const r of p.affected.ranges ?? []) {
          if (!isStrictSemver(r.introduced)) ctx.addIssue({ code: "custom", path: ["packages", i, "affected", "ranges"], message: `introduced "${r.introduced}" is not strict semver` });
          if (r.fixed !== undefined && !isStrictSemver(r.fixed)) ctx.addIssue({ code: "custom", path: ["packages", i, "affected", "ranges"], message: `fixed "${r.fixed}" is not strict semver` });
        }
        if (a.status === "approved" && !p.affected.versions?.length && !p.affected.ranges?.length) {
          ctx.addIssue({ code: "custom", path: ["packages", i, "affected"], message: "approved npm packages need versions or ranges to be matchable" });
        }
      });
    }
    // Records must never carry credentials, even by accident when pasting from a source.
    const text = JSON.stringify(a);
    for (const p of SECRET_PATTERNS) {
      p.regex.lastIndex = 0;
      const m = p.regex.exec(text);
      if (m && (!p.validate || p.validate(m[0]))) {
        ctx.addIssue({ code: "custom", path: [], message: `record contains a token that looks like a ${p.name}` });
        break;
      }
    }
  });

export type Advisory = z.infer<typeof advisorySchema>;

export interface AdvisoryValidation {
  ok: boolean;
  issues: string[];
}

export function validateAdvisory(input: unknown): { ok: true; advisory: Advisory } | { ok: false; issues: string[] } {
  const parsed = advisorySchema.safeParse(input);
  if (parsed.success) return { ok: true, advisory: parsed.data };
  return { ok: false, issues: parsed.error.issues.map((i) => `${i.path.join(".") || "<root>"}: ${i.message}`) };
}
