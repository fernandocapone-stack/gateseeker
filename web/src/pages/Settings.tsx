import { Avatar, Button, Card, Switch } from "@gateseeker/ui-kit";
import { LogOut } from "lucide-react";
import { useEffect, type ReactNode } from "react";

import { useAuth } from "../auth-context";
import { FollowedList } from "../components/FollowedList";
import { PageSkeleton } from "../components/Skeletons";
import { useNotifications } from "../notifications";
import { navigate } from "../router";
import { initialsOf } from "../Workspace";

/**
 * /app/settings: the account, the notification preferences and what the
 * service keeps. Only what exists today: GitHub sign-in, notifications kept
 * in this browser, reports kept for 30 days and opened only by their account.
 */

function Section({ title, description, children }: { title: string; description: string; children: ReactNode }) {
  return (
    <Card className="grid gap-4 p-4 md:grid-cols-[240px_1fr] md:gap-8">
      <div className="grid content-start gap-1">
        <h2 className="text-title font-medium">{title}</h2>
        <p className="text-label text-muted-foreground">{description}</p>
      </div>
      <div className="grid content-start gap-4">{children}</div>
    </Card>
  );
}

function Row({ label, value }: { label: string; value: ReactNode }) {
  return (
    <div className="flex flex-wrap items-baseline justify-between gap-x-4 gap-y-1 border-b pb-3 last:border-b-0 last:pb-0">
      <dt className="text-body text-muted-foreground">{label}</dt>
      <dd className="text-body font-medium">{value}</dd>
    </div>
  );
}

export function SettingsPage() {
  const auth = useAuth();
  const notifications = useNotifications(auth.session?.user.id ?? null);

  useEffect(() => {
    if (auth.status === "signed-out") navigate("/login?next=/app/settings");
  }, [auth.status]);

  if (auth.status !== "signed-in" || !auth.session) return <PageSkeleton label="Checking your session" />;
  const login = auth.session.user.login ?? "";
  const { prefs, setPrefs } = notifications;

  return (
    <div className="grid max-w-[1012px] gap-4">
      <div>
        <h1 className="text-display font-medium">Account and preferences</h1>
        <p className="text-label text-muted-foreground">Your account, notifications and what Gateseeker keeps about your analyses.</p>
      </div>

      <Section title="Account" description="You sign in with GitHub. Gateseeker reads your login and avatar, nothing else.">
        <div className="flex flex-wrap items-center justify-between gap-3">
          <div className="flex items-center gap-2.5">
            <Avatar initials={initialsOf(login)} />
            <div className="grid">
              <span className="text-body font-medium">{login ? `@${login}` : "Account"}</span>
              <span className="text-label text-muted-foreground">{auth.mode === "stub" ? "Local test account" : "Signed in with GitHub"}</span>
            </div>
          </div>
          <Button variant="outline" size="sm" onClick={() => { void auth.signOut().then(() => { navigate("/"); }); }}>
            <LogOut aria-hidden="true" /> Sign out
          </Button>
        </div>
      </Section>

      <Section title="Followed repositories" description="Checked every day. You get an email when a check finds new findings to fix soon (P1 or P2), at most one per repository per day. Up to 10 repositories.">
        <FollowedList token={auth.session.accessToken} />
      </Section>

      <Section title="Notifications" description="Shown in the bell at the top of the workspace. Kept in this browser only, for this account.">
        <Switch label="Notify me when an analysis ends" description="Finished, incomplete or refused analyses, with a link to the saved report." checked={prefs.enabled} onChange={(v) => { setPrefs({ ...prefs, enabled: v }); }} />
        <Switch
          label="Only when there is something to fix soon"
          description="Skip finished analyses without P1 or P2 findings. Incomplete and refused analyses are always shown."
          checked={prefs.onlyUrgent}
          disabled={!prefs.enabled}
          onChange={(v) => { setPrefs({ ...prefs, onlyUrgent: v }); }}
        />
        <div className="flex flex-wrap items-center justify-between gap-3 border-t pt-4">
          <p className="text-label text-muted-foreground">{notifications.items.length === 0 ? "No notifications stored." : `${String(notifications.items.length)} notification(s) stored in this browser.`}</p>
          <Button variant="outline" size="sm" disabled={notifications.items.length === 0} onClick={notifications.clear}>Clear notifications</Button>
        </div>
      </Section>

      <Section title="Reports and limits" description="What the service keeps and how much you can analyze.">
        <dl className="grid gap-3">
          <Row label="Saved reports" value="Kept for 30 days, opened only by your account" />
          <Row label="History" value="One line per analysis, kept for 180 days" />
          <Row label="Repositories" value="Public GitHub repositories, up to 50MB compressed" />
          <Row label="What runs" value="Nothing: files are read as text, never installed or executed" />
          <Row label="Analyses" value="Limited per hour; the count shows after each analysis" />
        </dl>
      </Section>
    </div>
  );
}
