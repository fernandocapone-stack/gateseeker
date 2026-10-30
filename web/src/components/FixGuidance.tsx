import { Button, Input } from "@gateseeker/ui-kit";
import { MAX_SUPPRESSION_REASON, suppressionComment } from "gateseeker/dist/patterns/suppression.js";
import { Check, Copy, ShieldOff, Sparkles } from "lucide-react";
import { useId, useState, type FormEvent } from "react";

import type { Finding } from "../api";

/**
 * The fix guidance of one finding (docs/SPRINT_5.md 3.2): what could happen,
 * manual steps, a prompt to paste into an AI coding tool, and, for code
 * patterns, "Accept the risk", which builds the gateseeker-ignore comment to
 * paste in the code. Everything is rule text from the report or built
 * locally; nothing is sent to the server, and all of it renders as text.
 * The prompt and the controls stay out of printouts; impact and steps print.
 */

async function copyText(text: string): Promise<boolean> {
  try {
    await navigator.clipboard.writeText(text);
    return true;
  } catch {
    return false; // clipboard blocked: the text stays visible and selectable
  }
}

function CopyButton({ text, label }: { text: string; label: string }) {
  const [state, setState] = useState<"idle" | "copied" | "failed">("idle");
  return (
    <Button
      variant="outline"
      size="sm"
      className="pr-2 text-label"
      onClick={() => {
        void copyText(text).then((ok) => {
          setState(ok ? "copied" : "failed");
          setTimeout(() => { setState("idle"); }, 2000);
        });
      }}
    >
      {state === "copied" ? "Copied" : state === "failed" ? "Select and copy" : label}
      {state === "copied" ? <Check className="text-success" aria-hidden="true" /> : <Copy className="text-primary" aria-hidden="true" />}
    </Button>
  );
}

function AcceptRisk({ file, line, ruleId }: { file: string; line: number; ruleId: string }) {
  const [open, setOpen] = useState(false);
  const [reason, setReason] = useState("");
  const [comment, setComment] = useState<string | null | undefined>(undefined);
  const id = useId();

  function submit(e: FormEvent) {
    e.preventDefault();
    setComment(suppressionComment(file, ruleId, reason));
  }

  if (!open) {
    return (
      <Button variant="outline" size="sm" className="justify-self-start pr-2 text-label" onClick={() => { setOpen(true); }}>
        Accept the risk <ShieldOff className="text-primary" aria-hidden="true" />
      </Button>
    );
  }
  return (
    <div className="grid gap-2 rounded-md border p-3">
      <form className="grid gap-2" onSubmit={submit}>
        <label htmlFor={id} className="text-label font-medium">
          Why is this acceptable? <span className="font-normal text-muted-foreground">The reason goes into the code, where reviewers see it.</span>
        </label>
        <div className="flex flex-wrap gap-2">
          <Input id={id} required maxLength={MAX_SUPPRESSION_REASON} value={reason} placeholder="e.g. public webhook, no cookies" className="min-w-0 flex-1" onChange={(e) => { setReason(e.target.value); setComment(undefined); }} />
          <Button type="submit" size="sm" disabled={reason.trim() === ""}>Create comment</Button>
        </div>
      </form>
      {comment === null && (
        <p role="alert" className="text-label text-warning">
          {reason.trim() === "" ? "Write a reason first." : `${file} has no comment syntax (JSON, for example), so the finding cannot be accepted inline. Fix it, or record the decision in your own notes.`}
        </p>
      )}
      {typeof comment === "string" && (
        <div className="grid gap-2">
          <p className="text-label text-muted-foreground">
            Paste this on the line above line {line} of <span className="font-mono">{file}</span>. The next scan lists the finding as accepted, with your reason.
          </p>
          <pre className="overflow-x-auto rounded-md border bg-input p-3 font-mono text-label whitespace-pre-wrap" data-testid="suppression-comment"><code>{comment}</code></pre>
          <div className="justify-self-start"><CopyButton text={comment} label="Copy comment" /></div>
        </div>
      )}
    </div>
  );
}

export function FixGuidance({ finding: f }: { finding: Finding }) {
  const r = f.remediation;
  const steps = r.manualSteps ?? [];
  const e = f.evidence;
  if (!r.impact && steps.length === 0 && !r.aiPrompt && e.kind !== "insecure-pattern") return null;
  return (
    <div className="grid gap-3">
      {r.impact && (
        <div>
          <p className="text-label font-medium">What could happen</p>
          <p>{r.impact}</p>
        </div>
      )}
      {steps.length > 0 && (
        <div>
          <p className="text-label font-medium">How to fix it</p>
          <ol className="mt-1 list-decimal space-y-1 pl-5">
            {steps.map((s, i) => (
              <li key={i}>{s}</li>
            ))}
          </ol>
        </div>
      )}
      {r.aiPrompt && (
        <div className="grid gap-2 print:hidden">
          <p className="flex items-center gap-1.5 text-label font-medium">
            <Sparkles className="size-3.5 text-primary" aria-hidden="true" /> Fix with your AI tool
            <span className="font-normal text-muted-foreground">· paste into Cursor, Lovable or Claude Code, then review the change</span>
          </p>
          <pre className="max-h-48 overflow-auto rounded-md border bg-input p-3 font-mono text-label whitespace-pre-wrap" data-testid="ai-prompt"><code>{r.aiPrompt}</code></pre>
          <div className="justify-self-start"><CopyButton text={r.aiPrompt} label="Copy prompt" /></div>
        </div>
      )}
      {e.kind === "insecure-pattern" && (
        <div className="grid print:hidden">
          <AcceptRisk file={e.file} line={e.line} ruleId={e.ruleId} />
        </div>
      )}
    </div>
  );
}
