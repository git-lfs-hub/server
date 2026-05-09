# LFS Server Implementation Plan

## Overview

This is a Git LFS server implemented as a **Cloudflare Worker** using the **Hono** framework.
Object storage is offloaded to **Cloudflare R2** via presigned S3-compatible URLs.
File locks are stored in **Cloudflare D1** (SQLite).

Two reference implementations inform this plan:
- `../gitlfs-server-cloudflare` — Cloudflare-native prototype (Durable Objects, KV, S3 presign)
- `../lfs-test-server` — canonical Go test server used by the git-lfs project itself

The Go test server (`server_test.go`) is the authoritative source of truth for correct
HTTP behaviour: status codes, header names, cursor semantics, and edge cases.

---

## API Surface

Git LFS clients discover the server by appending `.git/info/lfs` to the git remote URL:

```
Git remote:  https://host/foo/bar
LFS server:  https://host/foo/bar.git/info/lfs
Batch URL:   https://host/foo/bar.git/info/lfs/objects/batch
```

Since this Worker _is_ the LFS server, routes are relative to the Worker root.
All requests carry `Accept: application/vnd.git-lfs+json`; all responses must
return `Content-Type: application/vnd.git-lfs+json`.

Route prefix: `/:owner/:repo` (`:repo` may end in `.git` — strip it when
computing the R2 key prefix).

### Endpoints

| Method | Path                                       | Description              |
|--------|--------------------------------------------|--------------------------|
| POST   | `/:owner/:repo/objects/batch`              | Batch API                |
| POST   | `/:owner/:repo/objects/verify`             | Verify upload            |
| POST   | `/:owner/:repo/locks`                      | Create lock              |
| GET    | `/:owner/:repo/locks`                      | List locks               |
| POST   | `/:owner/:repo/locks/verify`              | Verify locks (pre-push)  |
| POST   | `/:owner/:repo/locks/:id/unlock`           | Delete lock              |

---

## Cloudflare Bindings

Add to `wrangler.jsonc`:

```jsonc
{
  "r2_buckets": [
    { "binding": "LFS_BUCKET", "bucket_name": "lfs-objects" }
  ],
  "d1_databases": [
    { "binding": "DB", "database_name": "lfs-locks", "database_id": "<id>" }
  ],
  "vars": {
    "ACCOUNT_ID": "",
    "R2_ACCESS_KEY_ID": "",
    "R2_SECRET_ACCESS_KEY": "",
    "BUCKET_NAME": "lfs-objects",
    "AUTH_TOKEN": ""        // shared secret for Basic Auth
  }
}
```

Secrets (`AUTH_TOKEN`, `R2_ACCESS_KEY_ID`, `R2_SECRET_ACCESS_KEY`) should be
set with `wrangler secret put` rather than committed to vars.

Run `bun run cf-typegen` after each binding change.

---

## Packages

```bash
bun add zod @aws-sdk/client-s3 @aws-sdk/s3-request-presigner
```

`zod` — request/response validation  
`@aws-sdk/client-s3` + `s3-request-presigner` — presigned R2 URLs (R2 native
binding cannot generate presigned URLs)

---

## Data Model

### D1 Schema (`schema.sql`)

```sql
CREATE TABLE IF NOT EXISTS locks (
  id         TEXT PRIMARY KEY,  -- 20-byte random hex (40 chars), matches lfs-test-server
  owner      TEXT NOT NULL,
  path       TEXT NOT NULL,
  repo       TEXT NOT NULL,     -- "owner/repo" (repo component with .git stripped)
  locked_at  TEXT NOT NULL,     -- RFC 3339, used for sort order
  UNIQUE (repo, path)
);
```

`UNIQUE (repo, path)` enforces one lock per path per repo at the DB level,
turning a race condition into a DB constraint violation rather than a TOCTOU bug.

**Lock ID generation** (matches `randomLockId()` in test server):
```typescript
const id = Array.from(crypto.getRandomValues(new Uint8Array(20)))
  .map(b => b.toString(16).padStart(2, '0')).join('');
```

---

## File Structure

```
src/
  index.ts        -- Hono app, route wiring
  auth.ts         -- Basic Auth middleware
  batch.ts        -- POST /objects/batch handler
  verify.ts       -- POST /objects/verify handler
  locks.ts        -- all /locks handlers
  schema.ts       -- Zod schemas
  r2.ts           -- S3Client factory + presign helpers
  types.ts        -- CloudflareBindings interface (or use generated file)
```

---

## Implementation Plan

### Phase 1 — Infrastructure

1. **`wrangler.jsonc`** — add R2 and D1 bindings; run `cf-typegen`.
2. **`schema.sql`** — create and apply with `wrangler d1 execute lfs-locks --file schema.sql`.
3. **`src/r2.ts`** — S3Client factory (identical to reference, keyed from env).
4. **`src/schema.ts`** — Zod schemas for all request/response shapes (see below).
5. **`src/auth.ts`** — Hono middleware for Basic Auth.

### Phase 2 — Batch API

**`src/batch.ts`** — `POST /:owner/:repo/objects/batch`

```
Request:
  operation  "upload" | "download"
  transfers  string[]  (optional; assume ["basic"] if absent)
  objects    { oid: string, size: number }[]
  ref        { name: string }  (optional)
  hash_algo  string  (optional, default "sha256")

Response 200:
  transfer   "basic"
  objects    BatchObject[]
  hash_algo  "sha256"
```

**Upload flow:**
- For each object: check existence via R2 native binding (`LFS_BUCKET.head(key)`).
- If object **already exists** → omit `actions` entirely. Per spec: "the client
  will then assume the server already has it." (`BatchHandler` in test server
  returns download-only for existing objects during upload; the spec is stricter —
  omit actions completely.)
- If not present → generate a presigned `PUT` URL (`PutObjectCommand`, 1 h TTL)
  and a `verify` action pointing to `/:owner/:repo/objects/verify`.
  Pass an HMAC token in the verify action's `header.Authorization` so the verify
  endpoint can confirm the OID/size without re-authenticating with the full token.
- Return `actions.upload` + `actions.verify`.

**Download flow:**
- Check existence via R2 native binding (`LFS_BUCKET.head(key)`).
- If missing → per-object `error: { code: 404, message: "Object not found" }`.
- If present: generate presigned `GET` URL (`GetObjectCommand`, 1 h TTL) → `actions.download`.

**R2 key scheme:** `{owner}/{repo}/{oid}` (strip `.git` suffix from repo).

**Error responses:**
- `401` (missing/wrong auth) with `LFS-Authenticate: Basic realm="Git LFS"`
- `403` (upload but read-only user)
- `422` (invalid JSON / validation failure)

### Phase 3 — Verify

**`src/verify.ts`** — `POST /:owner/:repo/objects/verify`

Client posts `{ oid, size }` after a successful PUT. Server:
1. Validates the HMAC token passed in `Authorization` (prevents arbitrary verify calls).
2. `HeadObjectCommand` the R2 key; checks `ContentLength === size`.
3. Returns `200` if matches, `422` otherwise.

If verify is not required by the deployment, this endpoint can return `200` unconditionally
and the `verify` action can be omitted from batch upload responses.

### Phase 4 — File Locking API

**`src/locks.ts`**

#### `POST /:owner/:repo/locks` — Create Lock

1. Parse `{ path, ref? }`.
2. Try `INSERT INTO locks ... ON CONFLICT DO NOTHING`.
3. If 0 rows inserted: query existing lock, return `409 Conflict` with `{ lock, message }`.
4. Return **`201 Created`** with `{ lock: { id, path, locked_at, owner: { name } } }`.

`owner.name` comes from the authenticated user extracted by the auth middleware.

#### `GET /:owner/:repo/locks` — List Locks

Query params: `path`, `id`, `cursor`, `limit`, `refspec`.

Cursor semantics (from `FilteredLocks` in test server): the cursor is the **ID
of the first lock to include** in the result set (inclusive). `next_cursor` is
set to the ID of the first lock that didn't fit — i.e. `locks[limit]` when
there are more results.

`refspec` is accepted but not filtered on (test server also ignores it).

```sql
-- Resolve cursor to a locked_at value for stable ordering
SELECT * FROM locks
WHERE repo = ?
  AND (path = ? OR ? IS NULL)
  AND (id   = ? OR ? IS NULL)
  AND locked_at >= COALESCE(
        (SELECT locked_at FROM locks WHERE id = ?),  -- cursor (inclusive)
        '0'
      )
ORDER BY locked_at, id
LIMIT ? + 1     -- fetch one extra to detect whether a next page exists
```

Return first `limit` rows; if `limit+1` rows were returned set
`next_cursor` to the `id` of the `(limit+1)`th row.

Server-side max limit: 100. If `limit` is absent or 0, default to 100
(matches `LocksVerifyHandler` default in test server).

Return `{ locks: [...], next_cursor? }`.

#### `POST /:owner/:repo/locks/verify` — Verify (Pre-push)

Body: `{ ref?, cursor?, limit? }` — same cursor semantics as list above.

```sql
SELECT * FROM locks
WHERE repo = ?
  AND locked_at >= COALESCE(
        (SELECT locked_at FROM locks WHERE id = ?),
        '0'
      )
ORDER BY locked_at, id
LIMIT ? + 1
```

Partition by `owner = currentUser` → `ours` / `theirs`.
If limit+1 rows returned, set `next_cursor` to the (limit+1)th row's `id`.

Return `{ ours: [...], theirs: [...], next_cursor? }`.

#### `POST /:owner/:repo/locks/:id/unlock` — Delete Lock

Body: `{ force?, ref? }`.

1. Fetch lock by `id` and `repo`.
2. If not found → `404`.
3. If `owner ≠ currentUser` and `force` is not `true` → `403`.
4. `DELETE FROM locks WHERE id = ?`.
5. Return `200` with `{ lock: <deleted lock> }`.

---

## Authentication

The Git LFS spec (see `git-lfs/docs/api/authentication.md`) defines three ways
clients supply credentials. All three arrive at the server as an `Authorization`
header on the Batch API request — the server does not need to distinguish their
origin.

### How clients obtain credentials

**1. SSH (`git-lfs-authenticate`)**

When the git remote is SSH-based, the LFS client runs:

```bash
$ ssh git@host git-lfs-authenticate owner/repo.git download
```

The SSH server returns JSON:

```json
{
  "header": { "Authorization": "RemoteAuth <token>" },
  "expires_in": 86400
}
```

The client forwards those headers verbatim to every Batch API request.
Our Worker must therefore accept any `Authorization` scheme the SSH server
issues — not just `Basic`. The middleware should treat any credential that
validates against `env.AUTH_TOKEN` as authorised, regardless of the scheme
prefix (`Basic`, `RemoteAuth`, `Bearer`, etc.).

**2. Git Credentials (HTTP Basic)**

When the remote is HTTPS, git invokes its credential helper and sends the
result as `Authorization: Basic <base64(user:password)>`.

This is the primary flow for HTTPS remotes and the one the Worker is optimised
for.

**3. URL-embedded credentials**

```
https://user:password@host/foo/bar.git
```

Treated identically to Git Credentials by the time the request reaches the
Worker.

### Server-side middleware (`src/auth.ts`)

```
1. Read the Authorization header.
2. If missing → 401 with LFS-Authenticate: Basic realm="Git LFS"
                         and { message: "Credentials needed" }.
3. Strip the scheme prefix; extract the credential token.
   - "Basic <b64>" → base64-decode → split on first ":" → take password field.
   - Any other scheme → treat the raw token as the credential.
4. Constant-time compare against env.AUTH_TOKEN
   (crypto.subtle.timingSafeEqual on TextEncoder output).
5. On mismatch → 401 (same response as step 2).
6. On success → stash username in c.set("user", username) for lock owner tracking.
```

On a 401, the `LFS-Authenticate` response header is used instead of the
standard `WWW-Authenticate` so browsers do not pop a password prompt.

### Token expiry

The spec supports expiring tokens via `expires_in` (seconds) or `expires_at`
(RFC 3339 string) hints returned alongside Batch API actions. If `env.AUTH_TOKEN`
is a long-lived shared secret, expiry is not needed. If tokens are short-lived
(e.g. issued by a separate auth service), include `expires_in` on every action
object in the Batch response so the client knows to re-authenticate before
the token lapses.

### Scope

For a single-tenant / personal server, one shared `AUTH_TOKEN` secret is
sufficient. Multi-tenant would need a D1 `users` table or an external IdP;
that is out of scope for now.

---

## Zod Schemas (`src/schema.ts`)

```typescript
// Reuse from reference implementation with corrections:
// - transfers optional in batchRequestSchema (z.array(...).optional())
// - lockListResponseSchema locks entries include all fields (not partial)
// - add verifyRequestSchema: z.object({ oid: z.string(), size: z.number() })
// - add lockVerifyRequestSchema: z.object({ ref, cursor, limit })
// - add lockVerifyResponseSchema: z.object({ ours, theirs, next_cursor })
// - add deleteUnlockRequestSchema: z.object({ force, ref })
```

---

## Accept Header Middleware

All LFS API endpoints require `Accept: application/vnd.git-lfs+json`.

**Parsing rule** (from `server_test.go` `MetaMatcher` and `TestMediaTypesParsed`):
strip everything from the first `;` before comparing, so
`application/vnd.git-lfs+json; charset=utf-8` is accepted.

**Wrong Accept → 404**, not 406. The test server registers routes with a
`MatcherFunc` that checks the Accept header; non-matching routes simply aren't
found. Hono achieves the same effect: register a catch-all 404 handler rather
than a 406 middleware, so unrecognised media types fall through naturally.
(The spec lists 406 as *optional*; 404 is what real clients encounter.)

Set `Content-Type: application/vnd.git-lfs+json` on all responses in a global
`app.use` middleware, so handlers don't have to set it individually.

---

## Decisions Derived from `lfs-test-server`

| Observation | Decision |
|-------------|----------|
| Wrong Accept → 404 (route not matched, not 406) | Use route-level Accept matching; 404 on miss |
| `charset=utf-8` stripped before Accept comparison | Strip at first `;` in middleware |
| Lock ID = 20-byte random hex (not UUID) | Use `crypto.getRandomValues(20 bytes)` as hex |
| Locks sorted by `locked_at` (creation time) | `ORDER BY locked_at, id` in all lock queries |
| Cursor = first ID to include (inclusive) | `locked_at >= cursor_locked_at` with `LIMIT n+1` |
| `next_cursor` = ID of first item on next page | Set to `locks[limit].id` when overflow detected |
| Limit 0 / absent → default 100 | Clamp: `Math.min(limit || 100, 100)` |
| `refspec` not filtered (test server ignores it) | Accept param, do not filter on it |
| Batch upload: existing objects → download action only (test server) vs omit actions (spec) | Follow spec: omit `actions` entirely |
| Auth uses `WWW-Authenticate` in test server | Use `LFS-Authenticate` (spec-correct, avoids browser prompt) |
| `/:user/:repo` vs `/:org/:repo` inconsistency in CF prototype | Unified `/:owner/:repo` |
| Lock list returns only `id` in CF prototype | Full lock row from D1 |
| Verify endpoints are stubs in CF prototype | Implemented with R2 head check |
| Create lock returns `200` in CF prototype | `201 Created` (matches test server) |
| `transfers` required in CF prototype | Optional per spec |
| Durable Objects for locks in CF prototype | Replaced with D1 (queryable, paginatable) |
| AWS SDK used for existence check in CF prototype | R2 native `head()` for existence; S3 only for presign |

---

## Implementation Order

```
1. wrangler.jsonc   -- add bindings
2. schema.sql       -- create D1 table
3. src/r2.ts        -- S3 client factory
4. src/schema.ts    -- Zod types
5. src/auth.ts      -- Basic Auth middleware
6. src/batch.ts     -- Batch API (upload + download)
7. src/verify.ts    -- Verify endpoint
8. src/locks.ts     -- All four lock endpoints
9. src/index.ts     -- Wire everything together
```

Each step is independently testable with `bun run dev` + `curl`.

---

## Test Cases (Manual with `curl`)

Test scenarios are derived directly from `lfs-test-server/server_test.go`.

```bash
BASE=http://localhost:8787/alice/repo
LFS="-H 'Accept: application/vnd.git-lfs+json' -H 'Content-Type: application/vnd.git-lfs+json'"

# TestGetUnAuthed / TestLocksListUnAuthed — missing auth → 401 + LFS-Authenticate header
curl -si -X POST $BASE/objects/batch $LFS \
  -d '{"operation":"download","objects":[]}'
# Expect: 401, header LFS-Authenticate: Basic realm="Git LFS"

# TestGetBadAuth — wrong password → 401
curl -si -u alice:wrongpass -X POST $BASE/objects/batch $LFS \
  -d '{"operation":"download","objects":[]}'
# Expect: 401

# TestMediaTypesRequired — wrong Accept → 404
curl -si -u alice:$TOKEN -X POST $BASE/objects/batch \
  -H "Accept: application/json" \
  -d '{"operation":"download","objects":[]}'
# Expect: 404

# TestMediaTypesParsed — charset suffix is tolerated
curl -si -u alice:$TOKEN -X POST $BASE/objects/batch \
  -H "Accept: application/vnd.git-lfs+json; charset=utf-8" \
  -d '{"operation":"download","objects":[]}'
# Expect: 200

# Batch upload — new object → presigned PUT URL + verify action
curl -s -u alice:$TOKEN -X POST $BASE/objects/batch $LFS \
  -d '{"operation":"upload","objects":[{"oid":"<sha256>","size":1024}]}'
# Expect: 200, actions.upload.href set, actions.verify.href set

# Batch upload — existing object → no actions (server already has it)
curl -s -u alice:$TOKEN -X POST $BASE/objects/batch $LFS \
  -d '{"operation":"upload","objects":[{"oid":"<existing-sha256>","size":1024}]}'
# Expect: 200, object present but no "actions" key

# Batch download — missing object → per-object 404 error
curl -s -u alice:$TOKEN -X POST $BASE/objects/batch $LFS \
  -d '{"operation":"download","objects":[{"oid":"<missing-sha256>","size":1024}]}'
# Expect: 200, object has error.code=404

# TestLock — create lock → 201 + lock with owner.name = username
curl -si -u alice:$TOKEN -X POST $BASE/locks $LFS \
  -d '{"path":"assets/large.bin"}'
# Expect: 201, body has lock.id, lock.owner.name="alice"

# TestLockExists — duplicate path → 409
curl -si -u alice:$TOKEN -X POST $BASE/locks $LFS \
  -d '{"path":"assets/large.bin"}'
# Expect: 409

# TestLockUnAuthed — no auth → 401
curl -si -X POST $BASE/locks $LFS -d '{"path":"foo"}'
# Expect: 401

# TestLocksList — list locks
curl -s -u alice:$TOKEN $BASE/locks \
  -H "Accept: application/vnd.git-lfs+json"
# Expect: 200, locks array with id/path/locked_at/owner

# TestLocksListUnAuthed → 401
curl -si $BASE/locks -H "Accept: application/vnd.git-lfs+json"
# Expect: 401

# TestLocksVerify — verify pre-push
curl -s -u alice:$TOKEN -X POST $BASE/locks/verify $LFS \
  -d '{"cursor":"","limit":0}'
# Expect: 200, ours/theirs arrays

# TestUnlock — unlock own lock → 200 + deleted lock in body
curl -si -u alice:$TOKEN -X POST $BASE/locks/$LOCK_ID/unlock $LFS -d '{}'
# Expect: 200, body has lock

# TestUnLockUnAuthed → 401
curl -si -X POST $BASE/locks/$LOCK_ID/unlock $LFS -d '{}'
# Expect: 401

# TestUnlockNotOwner — different user, no force → 403
curl -si -u bob:$BOB_TOKEN -X POST $BASE/locks/$LOCK_ID/unlock $LFS -d '{"force":false}'
# Expect: 403

# TestUnlockNotOwnerForce — different user + force → 200
curl -si -u bob:$BOB_TOKEN -X POST $BASE/locks/$LOCK_ID/unlock $LFS -d '{"force":true}'
# Expect: 200
```
