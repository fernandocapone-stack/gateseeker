import { Badge, Card, CardContent, CardDescription, CardHeader, CardTitle } from "@gateseeker/ui-kit";
import { ArrowUpRight } from "lucide-react";

import { PageIntro } from "../components/PageIntro";
import { Link } from "../router";

const REPO = "https://github.com/gateseeker-dev/gateseeker";

const RULES: { id: string; what: string; severity: string }[] = [
  { id: "GSK-SECRET-001", what: "Credential with a known provider format hardcoded: AWS access key, Stripe live key, GitHub token, OpenAI and Anthropic keys, Slack token, PEM private key, Supabase service_role JWT. Skips tests, .env.example, docs, placeholders and low-entropy tokens.", severity: "CRITICAL" },
  { id: "GSK-SECRET-002", what: "Variable with a client-bundle prefix (NEXT_PUBLIC_, VITE_, REACT_APP_, EXPO_PUBLIC_, NUXT_PUBLIC_, PUBLIC_) named like a secret. Known public names (anon key, publishable key, client id) are skipped.", severity: "HIGH" },
  { id: "GSK-SUPABASE-001", what: "Table created in supabase/ migrations without row level security enabled, or RLS disabled in a later migration. Unexposed schemas (auth, storage) are skipped.", severity: "HIGH" },
  { id: "GSK-SUPABASE-002", what: "Client-side file references a SERVICE_ROLE environment variable.", severity: "CRITICAL" },
  { id: "GSK-FIREBASE-001", what: "Firestore or Storage rule with `if true`, or Realtime Database read/write set to true. MODERATE when read-only.", severity: "HIGH" },
  { id: "GSK-CORS-001", what: "Access-Control-Allow-Origin wildcard in headers or config, cors({ origin: \"*\" }) or default cors(). HIGH when the same file enables credentials; informational otherwise.", severity: "LOW" },
  { id: "GSK-ENV-001", what: "Root .env file with non-public variables not covered by .gitignore.", severity: "MODERATE" },
  { id: "GSK-BUILD-001", what: "next.config with ignoreBuildErrors or ignoreDuringBuilds set to true.", severity: "LOW" },
];

const SC: { id: string; what: string; severity: string }[] = [
  { id: "GSK-SC-001", what: "Production dependency pinned to a branch, commit, git or tarball URL instead of a published version.", severity: "MODERATE" },
  { id: "GSK-SC-002", what: "An existing dependency gained autoload files or install scripts between the baseline and the current lockfile.", severity: "HIGH" },
  { id: "GSK-SC-003", what: "Same version now resolves to a different commit (Composer) or integrity hash (npm): the signature of a rewritten tag or a replaced artifact.", severity: "CRITICAL" },
  { id: "GSK-SC-004", what: "A dependency was released in the last 3 days, configurable.", severity: "LOW" },
  { id: "GSK-SC-005", what: "A dependency's source moved to another host.", severity: "HIGH" },
];

const DOCS: { title: string; text: string; href: string }[] = [
  { title: "README", text: "Installation, CLI usage, the GitHub Action inputs and outputs, exit codes.", href: `${REPO}#readme` },
  { title: "Architecture", text: "How the parser, intelligence, rules and report layers fit, and what each never does.", href: `${REPO}/blob/main/docs/ARCHITECTURE.md` },
  { title: "Threat model", text: "What Gateseeker defends against, what it does not, and the limits that enforce it.", href: `${REPO}/blob/main/docs/THREAT_MODEL.md` },
  { title: "Priority rules", text: "The exact table that turns severity and context into P1 to P4.", href: `${REPO}/blob/main/src/rules/priority.ts` },
  { title: "Curated advisories", text: "The human-approved advisory feed (CC BY 4.0), its format and how records are proposed, reviewed and sent upstream.", href: `${REPO}/tree/main/advisories` },
  { title: "Validation reports", text: "What happened when the rules met real projects: counts, false positives, decisions.", href: `${REPO}/tree/main/docs` },
  { title: "Security policy", text: "How to report a vulnerability in Gateseeker itself.", href: `${REPO}/blob/main/SECURITY.md` },
];

function severityVariant(s: string): "critical" | "high" | "moderate" | "low" {
  return s === "CRITICAL" ? "critical" : s === "HIGH" ? "high" : s === "MODERATE" ? "moderate" : "low";
}

function RuleTable({ rules }: { rules: { id: string; what: string; severity: string }[] }) {
  return (
    <ul className="divide-y rounded-md border text-sm">
      {rules.map((r) => (
        <li key={r.id} className="grid gap-2 p-3 sm:grid-cols-[10.5rem_6rem_1fr] sm:items-start sm:gap-4">
          <span className="font-mono text-xs leading-5 tracking-tight">{r.id}</span>
          <span>
            <Badge variant={severityVariant(r.severity)}>{r.severity}</Badge>
          </span>
          <span className="text-muted-foreground">{r.what}</span>
        </li>
      ))}
    </ul>
  );
}

export function Resources() {
  return (
    <>
      <PageIntro title="Resources" lead="Everything Gateseeker checks is public, and so is how it decides. Start with the rules; the documents below hold the rest." />

      <section className="mb-12 grid gap-6">
        <Card>
          <CardHeader>
            <CardTitle>Code-pattern rules</CardTitle>
            <CardDescription>Lexical and structural checks on text files. They start in warn mode and count towards the gate only when you say so. They do not follow data flow and cannot find injection or missing authorization in general.</CardDescription>
          </CardHeader>
          <CardContent>
            <RuleTable rules={RULES} />
          </CardContent>
        </Card>

        <Card>
          <CardHeader>
            <CardTitle>Structural supply-chain rules</CardTitle>
            <CardDescription>Signals read from the lockfile alone, or from comparing it with the base branch in CI. Curated advisory matches are always gated; these start in warn mode.</CardDescription>
          </CardHeader>
          <CardContent>
            <RuleTable rules={SC} />
          </CardContent>
        </Card>

        <Card>
          <CardHeader>
            <CardTitle>What the hosted analysis does not cover</CardTitle>
          </CardHeader>
          <CardContent>
            <ul className="list-disc space-y-1.5 pl-5 text-sm text-muted-foreground">
              <li>Private repositories, GitLab, Bitbucket, or archives above 50 MB compressed: use the CLI locally.</li>
              <li>Whether vulnerable code is actually reachable; runtime behaviour; infrastructure.</li>
              <li>Dependencies without a lockfile, workspace or linked packages, non-semver versions (declared in the report, not silently skipped).</li>
              <li>An incident absent from both OSV and the curated feed. "No known vulnerabilities" always means "in the sources consulted".</li>
            </ul>
          </CardContent>
        </Card>
      </section>

      <section className="mb-10">
        <h2 className="mb-4 text-xl font-semibold tracking-tight">Documentation</h2>
        <ul className="grid gap-3 sm:grid-cols-2">
          {DOCS.map((d) => (
            <li key={d.title}>
              <Link href={d.href} className="group flex h-full items-start justify-between gap-3 rounded-lg border bg-card p-4 transition-colors hover:border-border-strong hover:bg-accent/40">
                <span>
                  <span className="font-medium">{d.title}</span>
                  <p className="mt-1 text-sm text-muted-foreground">{d.text}</p>
                </span>
                <ArrowUpRight className="mt-0.5 size-4 shrink-0 text-muted-foreground transition-colors group-hover:text-foreground" aria-hidden="true" />
              </Link>
            </li>
          ))}
        </ul>
      </section>
    </>
  );
}
