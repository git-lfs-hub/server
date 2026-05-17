import { describe, test, expect } from "vitest";
import { normalize, buildVars, renderTemplate, listVarDefaults } from "./lib";

describe("normalize", () => {
  test("joins array with spaces", () => {
    expect(normalize(["alice", "bob"])).toBe("alice bob");
  });

  test("single-element array produces bare value", () => {
    expect(normalize(["alice"])).toBe("alice");
  });

  test("empty array produces empty string", () => {
    expect(normalize([])).toBe("");
  });

  test("passes string through unchanged", () => {
    expect(normalize("alice bob")).toBe("alice bob");
  });

  test("passes empty string through unchanged", () => {
    expect(normalize("")).toBe("");
  });

  test("passes non-string primitives through", () => {
    expect(normalize(42)).toBe(42);
    expect(normalize(null)).toBe(null);
  });
});

describe("buildVars", () => {
  test("provides empty-string defaults for optional list vars", () => {
    const result = buildVars({ orgName: "Test", cloudflareAccountSlug: "slug", cloudflareAccountId: "id" });
    expect(result.githubOrg).toBe("");
    expect(result.githubUsers).toBe("");
    expect(result.githubOwners).toBe("");
    expect(result.githubOrgs).toBe("");
  });

  test("vars.json values override defaults", () => {
    const result = buildVars({ githubOrg: "myorg" });
    expect(result.githubOrg).toBe("myorg");
  });

  test("normalizes array values to space-separated strings", () => {
    const result = buildVars({ githubUsers: ["alice", "bob"] });
    expect(result.githubUsers).toBe("alice bob");
  });

  test("single-element array becomes bare string", () => {
    const result = buildVars({ githubOwners: ["alice"] });
    expect(result.githubOwners).toBe("alice");
  });

  test("string list values pass through unchanged", () => {
    const result = buildVars({ githubOrgs: "foo bar,baz" });
    expect(result.githubOrgs).toBe("foo bar,baz");
  });

  test("preserves non-list keys from vars.json", () => {
    const result = buildVars({ orgName: "Acme", cloudflareAccountSlug: "acme-123" });
    expect(result.orgName).toBe("Acme");
    expect(result.cloudflareAccountSlug).toBe("acme-123");
  });

  test("all listVarDefaults keys are present even when raw is empty", () => {
    const result = buildVars({});
    for (const key of Object.keys(listVarDefaults)) {
      expect(key in result).toBe(true);
    }
  });
});

describe("renderTemplate", () => {
  test("substitutes a simple placeholder", () => {
    expect(renderTemplate("hello {{name}}", { name: "world" })).toBe("hello world");
  });

  test("substitutes multiple placeholders", () => {
    const out = renderTemplate("{{a}} and {{b}}", { a: "foo", b: "bar" });
    expect(out).toBe("foo and bar");
  });

  test("does not HTML-escape values (noEscape)", () => {
    const out = renderTemplate("{{val}}", { val: "a & b" });
    expect(out).toBe("a & b");
  });

  test("throws in strict mode when a placeholder is missing", () => {
    expect(() => renderTemplate("{{missing}}", {})).toThrow();
  });

  test("renders empty string for an empty-string var", () => {
    expect(renderTemplate('"{{githubOrg}}"', { githubOrg: "" })).toBe('""');
  });

  test("full wrangler-style snippet renders correctly", () => {
    const template = `"GITHUB_ORG": "{{githubOrg}}",\n"GITHUB_USERS": "{{githubUsers}}"`;
    const out = renderTemplate(template, { githubOrg: "myorg", githubUsers: "alice bob" });
    expect(out).toBe(`"GITHUB_ORG": "myorg",\n"GITHUB_USERS": "alice bob"`);
  });
});

describe("end-to-end: buildVars + renderTemplate", () => {
  test("array in vars.json renders as space-separated in template", () => {
    const vars = buildVars({ githubOwners: ["alice", "bob"], orgName: "Test" });
    const out = renderTemplate('"GITHUB_OWNERS": "{{githubOwners}}"', vars);
    expect(out).toBe('"GITHUB_OWNERS": "alice bob"');
  });

  test("missing optional var renders as empty string", () => {
    const vars = buildVars({ orgName: "Test" });
    const out = renderTemplate('"GITHUB_ORGS": "{{githubOrgs}}"', vars);
    expect(out).toBe('"GITHUB_ORGS": ""');
  });

  test("vars.json string value passes through to template", () => {
    const vars = buildVars({ githubOrg: "myorg" });
    const out = renderTemplate('"GITHUB_ORG": "{{githubOrg}}"', vars);
    expect(out).toBe('"GITHUB_ORG": "myorg"');
  });
});
