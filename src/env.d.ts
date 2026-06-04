// SENTRY_DSN is an optional runtime secret (`wrangler secret put SENTRY_DSN`),
// read defensively in src/index.ts to enable Sentry when present. SENTRY_RELEASE
// is injected at deploy time via `--var` (see scripts/sentry-wrangler-args.sh) to
// tag events with the git release. Neither is in the wrangler template —
// declaring them there would render required/empty vars — so they are merged
// into the generated binding types here instead.
declare namespace Cloudflare {
  interface Env {
    readonly SENTRY_DSN?: string;
    readonly SENTRY_RELEASE?: string;
  }
}

interface CloudflareBindings {
  readonly SENTRY_DSN?: string;
  readonly SENTRY_RELEASE?: string;
}
