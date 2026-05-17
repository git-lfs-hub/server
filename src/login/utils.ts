import { SignJWT, jwtVerify, EncryptJWT, jwtDecrypt } from "jose";

export interface StatePayload {
  redirect_uri: string;
  client_state: string;
  scopes: string;
}

export interface CodePayload {
  token: string;
  refresh_token?: string;
}

function keyBytes(secret: string): Uint8Array {
  if (!secret)
    throw new Error(
      "LOGIN_SECRET is not set — add it to .dev.vars (local) or wrangler secret put LOGIN_SECRET (production)",
    );
  const bytes = new Uint8Array(secret.length / 2);
  for (let i = 0; i < bytes.length; i++) {
    bytes[i] = parseInt(secret.slice(i * 2, i * 2 + 2), 16);
  }
  return bytes;
}

export async function signState(
  payload: StatePayload,
  secret: string,
  ttlSeconds = 600,
): Promise<string> {
  return new SignJWT({ ...payload })
    .setProtectedHeader({ alg: "HS256" })
    .setExpirationTime(Math.floor(Date.now() / 1000) + ttlSeconds)
    .sign(keyBytes(secret));
}

export async function verifyState(
  token: string,
  secret: string,
): Promise<StatePayload | null> {
  try {
    const { payload } = await jwtVerify(token, keyBytes(secret));
    return {
      redirect_uri: payload.redirect_uri as string,
      client_state: payload.client_state as string,
      scopes: payload.scopes as string,
    };
  } catch {
    return null;
  }
}

export async function encryptCode(
  payload: CodePayload,
  secret: string,
  ttlSeconds = 300,
): Promise<string> {
  return new EncryptJWT({ ...payload })
    .setProtectedHeader({ alg: "dir", enc: "A256GCM" })
    .setExpirationTime(Math.floor(Date.now() / 1000) + ttlSeconds)
    .encrypt(keyBytes(secret));
}

export async function decryptCode(
  token: string,
  secret: string,
): Promise<CodePayload | null> {
  try {
    const { payload } = await jwtDecrypt(token, keyBytes(secret));
    const result: CodePayload = { token: payload.token as string };
    if (typeof payload.refresh_token === "string")
      result.refresh_token = payload.refresh_token;
    return result;
  } catch {
    return null;
  }
}

export function orgsFromEnv(env: {
  GITHUB_ORGS?: string;
  GITHUB_ORG?: string;
}): string[] {
  return [
    ...parseGithubList(env.GITHUB_ORGS),
    ...(env.GITHUB_ORG?.trim() ? [env.GITHUB_ORG.trim()] : []),
  ];
}

export function ownersFromEnv(env: {
  GITHUB_OWNERS?: string;
  GITHUB_ORGS?: string;
  GITHUB_ORG?: string;
}): Set<string> {
  const owners = parseGithubList(env.GITHUB_OWNERS);
  if (owners.length) return new Set(owners);

  const groups = orgsFromEnv(env);
  if (groups.length) return new Set(groups);

  throw new Error("Set GITHUB_OWNERS and/or GITHUB_ORG[S]");
}

export function usersFromEnv(env: { GITHUB_USERS?: string }): string[] {
  return parseGithubList(env.GITHUB_USERS);
}

export function parseGithubList(s: string | undefined): string[] {
  if (!s) return [];
  return s.split(/[,;\s]+/).filter(Boolean);
}

export function pickHeaders(
  src: Headers,
  filter: string[],
): Record<string, string> {
  const out: Record<string, string> = {};
  for (const name of filter) {
    const value = src.get(name);
    if (value !== null) out[name] = value;
  }
  return out;
}
