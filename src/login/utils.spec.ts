import { describe, test, expect } from "vitest";
import {
  signState,
  verifyState,
  encryptCode,
  decryptCode,
  type StatePayload,
  type CodePayload,
  parseGithubList,
  ownersFromEnv,
} from "./utils";

// 64 hex chars = 32 bytes, valid for both HS256 and AES-256-GCM
const SECRET = "a".repeat(64);
const OTHER_SECRET = "b".repeat(64);

const STATE: StatePayload = {
  redirect_uri: "http://127.0.0.1:8080/",
  client_state: "abc123",
  scopes: "repo,gist",
};

const CODE: CodePayload = {
  token: "ghu_test_token",
};

describe("signState / verifyState", () => {
  test("round-trip returns original payload", async () => {
    const token = await signState(STATE, SECRET);
    expect(await verifyState(token, SECRET)).toEqual(STATE);
  });

  test("returns null for wrong secret", async () => {
    const token = await signState(STATE, SECRET);
    expect(await verifyState(token, OTHER_SECRET)).toBeNull();
  });

  test("returns null for expired token", async () => {
    const token = await signState(STATE, SECRET, -1);
    expect(await verifyState(token, SECRET)).toBeNull();
  });

  test("returns null when data portion is tampered", async () => {
    const token = await signState(STATE, SECRET);
    const parts = token.split(".");
    parts[1] = parts[1].slice(0, -1) + (parts[1].endsWith("A") ? "B" : "A");
    expect(await verifyState(parts.join("."), SECRET)).toBeNull();
  });

  test("returns null when signature is tampered", async () => {
    const token = await signState(STATE, SECRET);
    const parts = token.split(".");
    const sig = parts[2];
    parts[2] = (sig[0] === "A" ? "B" : "A") + sig.slice(1);
    expect(await verifyState(parts.join("."), SECRET)).toBeNull();
  });

  test("returns null when token has no dot separator", async () => {
    expect(await verifyState("nodothere", SECRET)).toBeNull();
  });

  test("returns null for empty string", async () => {
    expect(await verifyState("", SECRET)).toBeNull();
  });

  test("returns null for malformed base64url", async () => {
    expect(await verifyState("!!!.!!!", SECRET)).toBeNull();
  });
});

describe("encryptCode / decryptCode", () => {
  test("round-trip returns original payload", async () => {
    const token = await encryptCode(CODE, SECRET);
    expect(await decryptCode(token, SECRET)).toEqual(CODE);
  });

  test("each call produces a different ciphertext (random IV)", async () => {
    const a = await encryptCode(CODE, SECRET);
    const b = await encryptCode(CODE, SECRET);
    expect(a).not.toBe(b);
  });

  test("returns null for wrong secret", async () => {
    const token = await encryptCode(CODE, SECRET);
    expect(await decryptCode(token, OTHER_SECRET)).toBeNull();
  });

  test("returns null for expired token", async () => {
    const token = await encryptCode(CODE, SECRET, -1);
    expect(await decryptCode(token, SECRET)).toBeNull();
  });

  test("returns null for tampered ciphertext", async () => {
    const token = await encryptCode(CODE, SECRET);
    // JWE compact: header..iv.ciphertext.tag — parts[3] is the ciphertext
    const parts = token.split(".");
    const c = parts[3];
    parts[3] = (c[0] === "A" ? "B" : "A") + c.slice(1);
    expect(await decryptCode(parts.join("."), SECRET)).toBeNull();
  });

  test("returns null for empty string", async () => {
    expect(await decryptCode("", SECRET)).toBeNull();
  });
});

describe("parseGithubList", () => {
  test("returns empty array for undefined", () => {
    expect(parseGithubList(undefined)).toEqual([]);
  });

  test("returns empty array for empty string", () => {
    expect(parseGithubList("")).toEqual([]);
  });

  test("returns empty array for whitespace-only string", () => {
    expect(parseGithubList("   ")).toEqual([]);
  });

  test("splits on comma", () => {
    expect(parseGithubList("foo,bar")).toEqual(["foo", "bar"]);
  });

  test("splits on semicolon", () => {
    expect(parseGithubList("foo;bar")).toEqual(["foo", "bar"]);
  });

  test("splits on space", () => {
    expect(parseGithubList("foo bar")).toEqual(["foo", "bar"]);
  });

  test("collapses consecutive separators", () => {
    expect(parseGithubList("foo,,; bar")).toEqual(["foo", "bar"]);
  });

  test("trims leading and trailing separators", () => {
    expect(parseGithubList(" foo ")).toEqual(["foo"]);
  });

  test("handles mixed separators", () => {
    expect(parseGithubList("alice,bob; carol")).toEqual([
      "alice",
      "bob",
      "carol",
    ]);
  });
});

describe("ownersFromEnv", () => {
  test("GITHUB_ORGS and GITHUB_ORG are merged", () => {
    const result = ownersFromEnv({ GITHUB_ORGS: "foo bar", GITHUB_ORG: "baz" });
    expect(result).toEqual(new Set(["foo", "bar", "baz"]));
  });

  test("GITHUB_ORG alone", () => {
    const result = ownersFromEnv({ GITHUB_ORG: "MyOrg" });
    expect(result).toEqual(new Set(["MyOrg"]));
  });

  test("GITHUB_ORGS with two entries produces two-entry set", () => {
    const result = ownersFromEnv({ GITHUB_ORGS: "foo bar" });
    expect(result).toEqual(new Set(["foo", "bar"]));
  });

  test("GITHUB_USER fallback when no orgs set", () => {
    const result = ownersFromEnv({ GITHUB_USER: "pasha" });
    expect(result).toEqual(new Set(["pasha"]));
  });

  test("names preserve original case (callers lowercase before comparing)", () => {
    const result = ownersFromEnv({ GITHUB_ORG: "MyOrg" });
    expect(result.has("MyOrg")).toBe(true);
    expect(result.has("myorg")).toBe(false);
  });

  test("throws when nothing configured", () => {
    expect(() => ownersFromEnv({})).toThrow();
  });

  test("throws when GITHUB_ORG is whitespace-only and no user", () => {
    expect(() => ownersFromEnv({ GITHUB_ORG: "   " })).toThrow();
  });

  test("all vars empty still throws", () => {
    expect(() => ownersFromEnv({ GITHUB_ORGS: "", GITHUB_ORG: "", GITHUB_USER: "" })).toThrow();
  });
});
