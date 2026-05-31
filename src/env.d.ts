// SENTRY_DSN is an optional runtime secret (`wrangler secret put SENTRY_DSN`),
// read defensively in src/index.ts to enable Sentry when present. It is not in
// the wrangler template — declaring it there would render a required/empty var
// — so it is merged into the generated binding types here instead.
declare namespace Cloudflare {
  interface Env {
    readonly SENTRY_DSN?: string;
  }
}

interface CloudflareBindings {
  readonly SENTRY_DSN?: string;
}
