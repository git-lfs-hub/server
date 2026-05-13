# Web Authentication

Guards the `/` route with GitHub OAuth. Unauthenticated browser requests are redirected to the GitHub OAuth flow; on return, a signed session cookie is set and the user is admitted.

## Flow

1. `GET /` hits `webAuthMiddleware` (src/login/web-auth.ts).
2. If no `gh_session` cookie is present (or it is expired/invalid), redirect to `/login/oauth/authorize?redirect_uri=/`.
3. The existing OAuth proxy flow completes — GitHub redirects back to `/login/oauth/callback`.
4. The callback handler sets an encrypted, `HttpOnly`, 1-day `gh_session` cookie alongside the normal ephemeral-code redirect.
5. The browser lands on `/` again; the middleware decrypts the cookie, verifies the GitHub token via Octokit, sets `c.var.user`, and passes through to the ASSETS binding.

## Files changed

- **`src/login/web-auth.ts`** (new) — `webAuthMiddleware` + exports `SESSION_COOKIE` / `SESSION_TTL` constants.
- **`src/login/oauth.ts`** — sets the session cookie in `/callback` after a successful token exchange.
- **`src/index.ts`** — adds `GET /` with `webAuthMiddleware` proxying to `ASSETS.fetch`, plus a `GET /*` fallback so other static files are served without auth.
- **`wrangler.jsonc`** — `run_worker_first: true` so the Worker intercepts `GET /` before Cloudflare serves `public/index.html` directly from the CDN edge.

## Notes

- CLI users (device flow) are unaffected — they never hit `/login/oauth/callback` through a browser session that targets `/`.
- The session cookie is encrypted with the same `LOGIN_SECRET` used for OAuth state and ephemeral codes (`encryptCode` / `decryptCode` from `src/login/utils.ts`).
- Static assets under `/*` (CSS, images, JS) are served without auth; only `/` is guarded.
