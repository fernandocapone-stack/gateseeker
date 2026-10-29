import { PROMPT_FOOTER, safeIdent, safePath, safeTable } from "./safe.js";

/**
 * Fix guidance for each code-pattern rule: what could happen, short manual
 * steps, and a prompt for an AI coding tool. One entry per rule id, written
 * by hand and covered by tests/remediation.test.ts. Inputs are only the
 * finding's location and the rule's structured details, passed through the
 * allowlists in safe.ts; the matched code is never quoted.
 */

export interface Guidance {
  impact: string;
  manualSteps: string[];
  aiPrompt?: string;
}

export interface PatternFacts {
  file: string;
  line: number;
  details: Record<string, string | number | boolean | null> | null;
}

type Builder = (f: { file: string; line: number; at: string; d: Record<string, string | number | boolean | null> }) => Guidance;

/* Readable names for the credential types GSK-SECRET-001 reports; unknown types fall back to a generic label. */
const SECRET_NAMES: Record<string, string> = {
  "anthropic-api-key": "Anthropic API key",
  "aws-access-key-id": "AWS access key",
  "github-fine-grained-pat": "GitHub token",
  "github-token": "GitHub token",
  "openai-api-key": "OpenAI API key",
  "openai-project-key": "OpenAI API key",
  "private-key-pem": "private key",
  "slack-token": "Slack token",
  "stripe-live-secret-key": "Stripe live secret key",
  "supabase-service-role-jwt": "Supabase service_role key",
};

const FIREBASE_OPS =["read", "write", "get", "list", "create", "update", "delete"];

/** "read,write" -> "read and write"; only known Firebase operation names survive. */
function firebaseOperations(raw: unknown): string {
  const words = typeof raw === "string" ? raw.toLowerCase().split(/[^a-z]+/).filter((w) => FIREBASE_OPS.includes(w)) : [];
  const unique = [...new Set(words)];
  if (unique.length === 0) return "read and write";
  return unique.length === 1 ? (unique[0] ?? "") : `${unique.slice(0, -1).join(", ")} and ${unique[unique.length - 1] ?? ""}`;
}

function prompt(ruleId: string, at: string, body: string): string {
  return `Gateseeker (security check, rule ${ruleId}) found an issue at ${at}.\n\n${body}\n\n${PROMPT_FOOTER}`;
}

const RULES: Record<string, Builder> = {
  "GSK-SECRET-001": ({ at, d }) => {
    const type = (typeof d.secretType === "string" ? SECRET_NAMES[d.secretType] : undefined) ?? "credential";
    return {
      impact: `Anyone who can read this code (the repository, the published bundle or a leaked copy) can use this ${type} as you.`,
      manualSteps: [
        `Revoke or rotate the ${type} at the provider now: assume it is already exposed.`,
        "Replace the literal with an environment variable read only in server code.",
        "If the repository is or was public, remove the value from the git history too.",
      ],
      aiPrompt: prompt(
        "GSK-SECRET-001",
        at,
        `A ${type} is written directly in the code there. Replace it with an environment variable that is read only in server-side code, add the variable name (without any value) to .env.example, and make sure no code that runs in the browser needs it; if some does, move that call behind a server route. I will rotate the credential myself.`,
      ),
    };
  },

  "GSK-SECRET-002": ({ at, d }) => {
    const v = safeIdent(d.variable);
    return {
      impact: `The value of ${v} is copied into the JavaScript every visitor downloads, so anyone can read it in the browser.`,
      manualSteps: [
        `Rename ${v} without the public prefix (NEXT_PUBLIC_, VITE_, EXPO_PUBLIC_ …) and read it only in server code.`,
        "Move the code that uses it to a server route, server action or edge function.",
        "Rotate the value: it has already been shipped to browsers.",
      ],
      aiPrompt: prompt(
        "GSK-SECRET-002",
        at,
        `The environment variable ${v} looks like a secret but is exposed to the browser through a public prefix. Move every use of it to server-only code (an API route, server action or edge function), rename it without the public prefix, and change the client to call that server code instead of using the value. Update .env.example with the new name. I will rotate the value myself.`,
      ),
    };
  },

  "GSK-SUPABASE-001": ({ at, d }) => {
    const table = safeTable(d.table);
    const disabled = d.state === "disabled";
    return {
      impact: `Anyone with your public anon key, which ships inside every Supabase app, can read and change every row of ${table}.`,
      manualSteps: [
        `Add a new migration with \`alter table ${table} enable row level security;\`.`,
        "Write policies for the access the app needs (usually: each user reads and writes only their own rows).",
        "Check with the anon key that other users' rows no longer come back.",
      ],
      aiPrompt: prompt(
        "GSK-SUPABASE-001",
        at,
        `The Supabase table ${table} has no Row Level Security${disabled ? " because a later migration turns it off" : ""}. Create a new migration (do not edit old ones) that enables Row Level Security on it and adds policies for the access the app actually needs, typically comparing auth.uid() with the column that stores the row's owner. If the table is meant to be public, make it read-only for anonymous users. List the policies you wrote so I can confirm them.`,
      ),
    };
  },

  "GSK-SUPABASE-002": ({ at, d }) => {
    const v = safeIdent(d.variable, "the service_role key");
    return {
      impact: "The service_role key bypasses every access rule in your database; in browser code anyone can copy it and read or delete everything.",
      manualSteps: [
        "Remove the service_role key from all client code and use the anon key there.",
        "Move operations that need elevated access to a server route or edge function that checks the signed-in user.",
        "Rotate the service_role key in the Supabase dashboard.",
      ],
      aiPrompt: prompt(
        "GSK-SUPABASE-002",
        at,
        `Code that runs in the browser references ${v}, the Supabase service_role key. Remove it from every client-side file and use the anon key with Row Level Security instead. Move any operation that really needs service_role into a server route or Supabase edge function that verifies the signed-in user first. I will rotate the key myself.`,
      ),
    };
  },

  "GSK-CORS-001": ({ at, d }) => {
    const creds = d.withCredentials === true;
    return {
      impact: creds
        ? "Any website can send requests to this API with your users' cookies and read the answers."
        : "Any website can call this API from a visitor's browser and read the responses.",
      manualSteps: [
        "List the exact origins that need access (your own front-end domains).",
        "Configure CORS with that list instead of *.",
        ...(creds ? ["Allow credentials only for those origins."] : []),
      ],
      aiPrompt: prompt(
        "GSK-CORS-001",
        at,
        `CORS there allows any origin${creds ? " together with credentials" : ""}. Replace it with an explicit allowlist of the origins this app uses, read from configuration (for example an ALLOWED_ORIGINS environment variable), and reject every other origin. Keep local development working.`,
      ),
    };
  },

  "GSK-ENV-001": ({ file, d }) => {
    const n = typeof d.nonPublicVariables === "number" ? d.nonPublicVariables : null;
    return {
      impact: `The ${n === null ? "" : `${String(n)} `}secret value${n === 1 ? "" : "s"} in ${file} are probably in your git repository, where anyone with access to it, or to a leak of it, can read them.`,
      manualSteps: [
        `Add ${file} to .gitignore.`,
        `Stop tracking it with \`git rm --cached ${file}\` (your local copy stays), and remove it from the history if the repository is or was public.`,
        "Rotate every value it contained.",
      ],
      aiPrompt: prompt(
        "GSK-ENV-001",
        file,
        `The file ${file} contains secrets and is not covered by .gitignore. Add it to .gitignore, create ${file}.example with the same variable names and empty values, and tell me the git commands to stop tracking the file without deleting my local copy. Do not open or print the values. I will rotate them myself.`,
      ),
    };
  },

  "GSK-FIREBASE-001": ({ at, d }) => {
    const ops = firebaseOperations(d.operations ?? d.operation);
    return {
      impact: `Any visitor can ${ops} this data without signing in.`,
      manualSteps: [
        "Replace the unconditional rule with conditions on request.auth.",
        "Limit each user to their own documents (compare request.auth.uid with the owner field).",
        "Test the new rules in the Firebase emulator or the Rules Playground.",
      ],
      aiPrompt: prompt(
        "GSK-FIREBASE-001",
        at,
        `A Firebase security rule there allows ${ops} access without any condition. Rewrite it so only signed-in users can access their own data (check request.auth != null and compare request.auth.uid with the document's owner field). Keep data that is meant to be public read-only, and explain each rule you write.`,
      ),
    };
  },

  "GSK-BUILD-001": ({ at }) => ({
    impact: "Type and lint errors no longer stop a deploy, so mistakes around authentication and data access can ship unnoticed.",
    manualSteps: [
      "Remove typescript.ignoreBuildErrors and eslint.ignoreDuringBuilds from the Next.js config.",
      "Run the build and fix the errors it reports.",
    ],
    aiPrompt: prompt(
      "GSK-BUILD-001",
      at,
      "The Next.js config tells the build to ignore TypeScript or ESLint errors. Remove that setting, run the build, and fix the reported errors in the code itself rather than silencing them with comments or a looser tsconfig.",
    ),
  }),
};

/** Guidance for a pattern finding, or null for rules without an entry (for example GSK-ENGINE-000). */
export function patternGuidance(ruleId: string, facts: PatternFacts): Guidance | null {
  const build = RULES[ruleId];
  if (!build) return null;
  const file = safePath(facts.file);
  return build({ file, line: facts.line, at: `${file} line ${String(facts.line)}`, d: facts.details ?? {} });
}

/** Rule ids with guidance; tests assert every shipped rule is listed. */
export const RULES_WITH_GUIDANCE = Object.keys(RULES);
