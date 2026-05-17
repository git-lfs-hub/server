import Handlebars from "handlebars";

export const listVarDefaults = { githubOrg: "", githubUsers: "", githubOwners: "", githubOrgs: "" };

/** Converts array values to space-separated strings; passes everything else through. */
export function normalize(v: unknown): unknown {
  return Array.isArray(v) ? v.join(" ") : v;
}

/** Merges vars.json contents with defaults and normalizes array values. */
export function buildVars(raw: Record<string, unknown>): Record<string, unknown> {
  return Object.fromEntries(
    Object.entries({ ...listVarDefaults, ...raw }).map(([k, v]) => [k, normalize(v)]),
  );
}

/** Renders a Handlebars template string with the given vars (strict, no HTML escaping). */
export function renderTemplate(source: string, vars: Record<string, unknown>): string {
  return Handlebars.compile(source, { strict: true, noEscape: true })(vars);
}
