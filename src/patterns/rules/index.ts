import type { Rule } from "../types.js";
import { corsWildcardRule } from "./cors-wildcard.js";
import { envNotIgnoredRule } from "./env-not-ignored.js";
import { firebaseOpenRulesRule } from "./firebase-open-rules.js";
import { nextIgnoreBuildErrorsRule } from "./next-ignore-build-errors.js";
import { secretHardcodedRule } from "./secret-hardcoded.js";
import { secretPublicEnvRule } from "./secret-public-env.js";
import { supabaseRlsRule } from "./supabase-rls.js";
import { supabaseServiceRoleClientRule } from "./supabase-service-role-client.js";

/** All rules, in the order they run. Ids are stable and documented in README. */
export const RULES: Rule[] = [
  secretHardcodedRule,
  secretPublicEnvRule,
  supabaseRlsRule,
  supabaseServiceRoleClientRule,
  firebaseOpenRulesRule,
  corsWildcardRule,
  envNotIgnoredRule,
  nextIgnoreBuildErrorsRule,
];

export function ruleById(id: string): Rule | undefined {
  return RULES.find((r) => r.id === id);
}
