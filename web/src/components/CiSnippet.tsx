import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@gateseeker/ui-kit";
import { GitBranch, Terminal } from "lucide-react";

export const WORKFLOW_YAML = `# .github/workflows/gateseeker.yml
name: Gateseeker
on: [pull_request]
permissions:
  contents: read
  pull-requests: write
  security-events: write
jobs:
  gate:
    runs-on: ubuntu-latest
    steps:
      - uses: actions/checkout@v7
      - uses: gateseeker-dev/gateseeker@v1
        with:
          fail-on: P2`;

export function CiSnippet({ repository }: { repository?: { owner: string; repo: string } | null }) {
  return (
    <section id="ci" className="scroll-mt-6">
      <Card>
        <CardHeader>
          <CardTitle className="flex items-center gap-2">
            <GitBranch className="size-5 text-primary" aria-hidden="true" />
            Make it a gate: run this on every pull request
          </CardTitle>
          <CardDescription>
            {repository ? `Add this workflow to ${repository.owner}/${repository.repo} and ` : "Add this workflow to your repository and "}
            every pull request gets a summary comment, SARIF results in the Security tab, and a failing check when a P1 or P2 finding appears. No account, no token: it uses the GitHub token the workflow already has.
          </CardDescription>
        </CardHeader>
        <CardContent>
          <pre className="overflow-x-auto rounded-md border bg-input p-4 font-mono text-xs leading-relaxed inset-shadow-solid"><code>{WORKFLOW_YAML}</code></pre>
          <p className="mt-3 flex items-center gap-2 text-sm text-muted-foreground">
            <Terminal className="size-4" aria-hidden="true" />
            Or locally: <code className="rounded bg-muted px-1.5 py-0.5">npx gateseeker@beta scan .</code>
          </p>
        </CardContent>
      </Card>
    </section>
  );
}
