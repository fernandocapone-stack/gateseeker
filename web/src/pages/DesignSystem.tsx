import { Avatar, Badge, Button, Card, Drawer, IconInput, Logo, LogoSymbol, MetricCard, Segmented, Table, Td, Th, cn, menuItemClass, navItemClass } from "@gateseeker/ui-kit";
import { ArrowRight, ArrowUpDown, Bell, Download, ListChecks, LogOut, ScanSearch, Search } from "lucide-react";
import { useCallback, useState, type ReactNode } from "react";

/**
 * /app/design-system: every token and component of the ui-kit, built from
 * the PO's Figma file, on one page for review. Items marked "proposal" have
 * no counterpart in the file yet. Sample texts are illustrative, not data.
 */

const PALETTE: { name: string; figma: string; varName: string; use: string; proposal?: boolean }[] = [
  { name: "bg", figma: "Color-bg", varName: "--gs-bg", use: "page, neutral buttons" },
  { name: "sidebar", figma: "Color-sidebar", varName: "--gs-sidebar", use: "header, sidebar, cards, inputs" },
  { name: "stroke", figma: "Color-stroke", varName: "--gs-stroke", use: "every border, solid shadow, chips" },
  { name: "light-blue", figma: "Color-light-blue", varName: "--gs-light-blue", use: "secondary text" },
  { name: "white", figma: "Color-white", varName: "--gs-white", use: "primary text" },
  { name: "body", figma: "Color-body", varName: "--gs-body", use: "primary action, active item, icons" },
  { name: "logo", figma: "Color-logo", varName: "--gs-logo", use: "logo symbol only" },
  { name: "red", figma: "Color-red", varName: "--gs-red", use: "critical, fail" },
  { name: "orange", figma: "Color-orange", varName: "--gs-orange", use: "high, incomplete" },
  { name: "moderate", figma: "—", varName: "--severity-moderate", use: "moderate severity", proposal: true },
  { name: "success", figma: "—", varName: "--success", use: "verdict pass", proposal: true },
  { name: "accent", figma: "—", varName: "--accent", use: "hover surface", proposal: true },
];

const TYPE: { token: string; size: string; sample: string; className: string }[] = [
  { token: "display", size: "32 / Medium", sample: "Analyze a repository", className: "text-display font-medium" },
  { token: "metric", size: "20 / Medium", sample: "12", className: "text-metric font-medium" },
  { token: "title", size: "15 / Medium", sample: "Issues", className: "text-title font-medium" },
  { token: "body", size: "13 / Regular, Medium", sample: "GSK-SECRET-001: Live Stripe secret key hardcoded", className: "text-body font-medium" },
  { token: "label", size: "12 / Light, Regular", sample: "Move the key to a server-side environment variable and rotate it now.", className: "text-label font-light text-muted-foreground" },
  { token: "caption", size: "11 / Regular, Italic", sample: "Public repositories only, up to 50MB compressed.", className: "text-caption text-muted-foreground" },
  { token: "micro", size: "9 / Italic, uppercase", sample: "Critical", className: "text-micro uppercase italic" },
];

function Section({ title, note, children }: { title: string; note?: string; children: ReactNode }) {
  return (
    <section className="grid gap-3">
      <div>
        <h2 className="text-title font-medium">{title}</h2>
        {note && <p className="text-label text-muted-foreground">{note}</p>}
      </div>
      {children}
    </section>
  );
}

function Proposal() {
  return <Badge variant="kind" className="text-primary">proposal</Badge>;
}

export function DesignSystem() {
  const [filter, setFilter] = useState<"all" | "open" | "approved" | "resolved">("all");
  const [drawer, setDrawer] = useState(false);
  const closeDrawer = useCallback(() => { setDrawer(false); }, []);

  return (
    <div className="grid max-w-[1012px] gap-10">
      <div>
        <h1 className="text-display font-medium">Design system</h1>
        <p className="text-label text-muted-foreground">Tokens and components of <code>ui-kit/</code>, taken from the Figma file GateSeeker (page Platform). Marked items are proposals waiting for review.</p>
      </div>

      <Section title="Logo" note="Exported from the Figma component “logotype”: symbol in Color-logo, wordmark in the text colour.">
        <Card className="flex flex-wrap items-center gap-8 p-6">
          <Logo />
          <LogoSymbol className="size-8" />
        </Card>
      </Section>

      <Section title="Colour" note="Raw palette from the Figma variables; components use the semantic tokens in theme.css.">
        <div className="grid grid-cols-2 gap-2 sm:grid-cols-3 lg:grid-cols-4">
          {PALETTE.map((c) => (
            <Card key={c.name} className="overflow-hidden">
              <div className="h-14 border-b" style={{ background: `var(${c.varName})` }} />
              <div className="grid gap-0.5 p-3">
                <p className="flex items-center gap-2 text-body font-medium">{c.name} {c.proposal && <Proposal />}</p>
                <p className="font-mono text-caption text-muted-foreground">{c.varName} · {c.figma}</p>
                <p className="text-caption text-muted-foreground">{c.use}</p>
              </div>
            </Card>
          ))}
        </div>
      </Section>

      <Section title="Type" note="Google Sans Flex, line height 1.4, tracking −2%.">
        <Card className="divide-y">
          {TYPE.map((t) => (
            <div key={t.token} className="grid items-baseline gap-1 p-4 sm:grid-cols-[160px_1fr]">
              <p className="font-mono text-caption text-muted-foreground">text-{t.token} · {t.size}</p>
              <p className={t.className}>{t.sample}</p>
            </div>
          ))}
        </Card>
      </Section>

      <Section title="Shape and elevation" note="Radius 4 (badges), 6 (buttons, inputs), 8 (cards), full (pills). No blurred shadows: a solid 2px drop in the stroke colour on buttons.">
        <div className="flex flex-wrap gap-4">
          {[["rounded-sm", "4px"], ["rounded-md", "6px"], ["rounded-lg", "8px"], ["rounded-full", "pill"]].map(([cls, label]) => (
            <div key={cls} className={cn("flex h-16 w-24 items-center justify-center border bg-sidebar text-caption text-muted-foreground", cls)}>{label}</div>
          ))}
          <div className="flex h-16 w-24 items-center justify-center rounded-md border border-button-stroke bg-button text-caption text-muted-foreground shadow-solid">shadow-solid</div>
        </div>
      </Section>

      <Section title="Buttons" note="Press moves the button down 2px and drops the shadow.">
        <Card className="grid gap-4 p-4">
          <div className="flex flex-wrap items-center gap-3">
            <Button>Analyze <ArrowRight aria-hidden="true" /></Button>
            <Button size="sm">Primary small</Button>
            <Button variant="outline" size="md">View issue</Button>
            <Button variant="outline" size="sm" className="pr-2 text-label">Highest priority <ArrowUpDown className="text-primary" aria-hidden="true" /></Button>
            <Button variant="outline" size="icon" aria-label="Export PDF"><Download className="text-primary" aria-hidden="true" /></Button>
            <Button variant="outline" size="icon" aria-label="Notifications" onClick={() => { setDrawer(true); }}><Bell className="text-primary" aria-hidden="true" /></Button>
            <Button disabled>Disabled</Button>
          </div>
          <Segmented label="Filter (sample)" value={filter} onChange={setFilter} options={[{ value: "all", label: "All" }, { value: "open", label: "Open" }, { value: "approved", label: "Approved" }, { value: "resolved", label: "Resolved" }]} />
        </Card>
      </Section>

      <Section title="Badges" note="Severity outline and kind chip at 9px (review point: small for comfortable reading). Pill for KPI notes.">
        <Card className="flex flex-wrap items-center gap-2 p-4">
          <Badge variant="critical">critical</Badge>
          <Badge variant="high">high</Badge>
          <Badge variant="moderate">moderate</Badge>
          <Badge variant="low">low</Badge>
          <Badge variant="kind">code pattern</Badge>
          <Badge variant="kind">dependency</Badge>
          <Badge variant="pill">2 code patterns · 1 dependency</Badge>
          <span className="flex items-center gap-1 text-caption text-muted-foreground">moderate and low: <Proposal /></span>
        </Card>
      </Section>

      <Section title="Input">
        <Card className="grid gap-3 bg-transparent p-4">
          <div className="flex flex-col gap-2 sm:flex-row">
            <IconInput icon={<Search />} aria-label="Sample field" placeholder="https://github.com/owner/repository" className="sm:flex-1" />
            <Button>Analyze <ArrowRight aria-hidden="true" /></Button>
          </div>
        </Card>
      </Section>

      <Section title="Metric cards">
        <div className="grid grid-cols-2 gap-2 lg:grid-cols-4">
          <MetricCard label="P1 · Fix now" value={2} note="2 code patterns" />
          <MetricCard label="P2 · Fix before release" value={1} note="1 dependency" />
          <MetricCard label="P3 · Plan a fix" value={0} note="nothing here" />
          <MetricCard label="P4 · Keep an eye on it" value={4} note="4 dependencies" />
        </div>
      </Section>

      <Section title="Table">
        <Table>
          <thead>
            <tr>
              <Th>Issue</Th>
              <Th className="w-32">Priority</Th>
              <Th className="w-32">Source</Th>
              <Th className="w-[119px]">Action</Th>
            </tr>
          </thead>
          <tbody>
            {(["critical", "high"] as const).map((sev, i) => (
              <tr key={sev} className="border-b last:border-b-0">
                <Td>
                  <div className="grid gap-2">
                    <div className="flex flex-wrap items-center gap-2">
                      <span className="text-label font-light text-muted-foreground">src/lib/stripe.ts:4</span>
                      <Badge variant={sev}>{sev}</Badge>
                      <Badge variant="kind">code pattern</Badge>
                    </div>
                    <div className="grid gap-0.5">
                      <p className="text-body font-medium">GSK-SECRET-001: Live Stripe secret key hardcoded</p>
                      <p className="text-label font-light text-muted-foreground">Move the key to a server-side environment variable and rotate it now.</p>
                    </div>
                  </div>
                </Td>
                <Td className="text-body"><span className="font-medium">P{i + 1}</span><span className="block text-label text-muted-foreground">{i === 0 ? "Fix now" : "Fix before release"}</span></Td>
                <Td className="text-body text-muted-foreground">gateseeker-patterns</Td>
                <Td><Button variant="outline" size="md">View issue</Button></Td>
              </tr>
            ))}
          </tbody>
        </Table>
      </Section>

      <Section title="Navigation, avatar and menu">
        <div className="flex flex-wrap items-start gap-6">
          <Card className="w-[236px] py-4">
            <span className={navItemClass(true)}><ScanSearch aria-hidden="true" /> Active item</span>
            <span className={navItemClass(false)}><ListChecks aria-hidden="true" /> Item</span>
            <span aria-disabled="true" className={navItemClass(false)}><ListChecks aria-hidden="true" /> Disabled item</span>
          </Card>
          <div className="grid gap-3">
            <div className="flex items-center gap-2.5"><Avatar initials="FT" /><span className="text-body font-medium">@fernando</span></div>
            <div className="w-[204px] overflow-hidden rounded-lg border bg-popover shadow-solid">
              <span className={menuItemClass}><LogOut aria-hidden="true" /> Sign out</span>
            </div>
          </div>
        </div>
      </Section>

      <Section title="Side panel" note="Built for notifications; not used in the workspace until there is a feature behind it.">
        <div><Button variant="outline" size="sm" onClick={() => { setDrawer(true); }}><Bell className="text-primary" aria-hidden="true" /> Open the panel</Button></div>
      </Section>

      <Drawer open={drawer} title="Notifications" onClose={closeDrawer}>
        <div className="overflow-hidden rounded-lg border">
          {["critical", "high"].map((sev) => (
            <div key={sev} className="flex gap-3 border-b p-4 last:border-b-0">
              <span className="size-8 shrink-0 rounded-full bg-chip" aria-hidden="true" />
              <div className="grid gap-2">
                <div className="flex flex-wrap items-center gap-2">
                  <span className="text-label font-light text-muted-foreground">src/lib/stripe.ts:4</span>
                  <Badge variant={sev as "critical" | "high"}>{sev}</Badge>
                  <Badge variant="kind">code pattern</Badge>
                </div>
                <p className="text-body font-medium">GSK-SECRET-001: Live Stripe secret key hardcoded</p>
                <p className="text-body text-muted-foreground">Move the key to a server-side environment variable and rotate it now.</p>
                <p className="text-caption text-muted-foreground">Sample notification</p>
              </div>
            </div>
          ))}
        </div>
      </Drawer>
    </div>
  );
}
