import type { Guidance } from "./patterns.js";
import { PROMPT_FOOTER, safeLabel, safePackage, safeVersion } from "./safe.js";

/**
 * Fix guidance for dependency findings (OSV) and supply-chain findings
 * (curated advisories and structural lockfile rules). Dependency updates get
 * an AI prompt only when the source names a fixed version; supply-chain
 * findings get manual steps only, because investigating a possibly
 * compromised package is not a task to hand to an agent.
 */

export interface DependencyFacts {
  name: string;
  version: string | null;
  ecosystem: "npm" | "Packagist";
  /** False for a transitive dependency: the fix goes through the package that pulls it in. */
  direct: boolean;
  vulnerabilityId: string;
  /** The version the finding's action recommends, when one exists. */
  target: string | null;
}

export function dependencyGuidance(f: DependencyFacts): Guidance {
  const pkg = safePackage(f.name);
  const installed = safeVersion(f.version ?? "?");
  const id = safeLabel(f.vulnerabilityId, "the advisory");
  const manifest = f.ecosystem === "Packagist" ? "composer.json" : "package.json";
  const impact = `This version of ${pkg} has a publicly known vulnerability (${id}); the details are public, which makes it easier to exploit.`;
  if (f.target === null) {
    return {
      impact,
      manualSteps: [
        "Read the references for a workaround or a mitigation.",
        `If none applies, consider replacing ${pkg} with a maintained alternative.`,
        "Check whether your code actually uses the affected feature, and note the decision.",
      ],
    };
  }
  const target = safeVersion(f.target);
  const override = f.ecosystem === "Packagist" ? "require it directly at that version" : "add an npm override";
  const how = f.direct
    ? `Update ${pkg} to ${target} or later in ${manifest}`
    : `${pkg} is not listed in ${manifest}; another dependency pulls it in. Update that dependency so ${pkg} resolves to ${target} or later, or ${override}`;
  const body = `${how}. Regenerate the lockfile with this project's package manager, fix any breaking changes the update causes, and run the tests afterwards.`;
  return {
    impact,
    manualSteps: [`${how}.`, "Reinstall with your package manager so the lockfile is regenerated.", "Run your tests and check the changelog for breaking changes."],
    aiPrompt: [`Gateseeker (security check) found that the dependency ${pkg}@${installed} has a known vulnerability (${id}).`, body, PROMPT_FOOTER].join("\n\n"),
  };
}

export function supplyChainGuidance(origin: "advisory" | "structural", name: string | null): Guidance {
  const pkg = name === null ? "this package" : safePackage(name);
  if (origin === "advisory") {
    return {
      impact: `A version of ${pkg} in your lockfile matches a known compromise: code from it may have run on every machine that installed it.`,
      manualSteps: [
        "Follow this finding's action to pin a safe version or remove the package.",
        "If the affected version was installed anywhere (laptops, CI, servers), rotate the credentials those machines could reach.",
        "Check the references for indicators of compromise.",
      ],
    };
  }
  return {
    impact: `The lockfile entry for ${pkg} changed in a way often seen in supply-chain attacks. It can be legitimate, but it needs a person to look at it.`,
    manualSteps: [
      `Look at the lockfile diff for ${pkg}.`,
      "Confirm the change against the package's official repository or release notes.",
      "If you cannot explain it, pin the previous version and investigate before deploying.",
    ],
  };
}
