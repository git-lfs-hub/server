#!/usr/bin/env bash

if [[ -f .sentryclirc || -v SENTRY_AUTH_TOKEN ]]; then
    SENTRY_RELEASE=$(sentry-cli releases propose-version)
    # Per-env dist (empty for prod) so staging artifacts can't alias prod's under
    # the shared (git-SHA) release.
    SENTRY_DIST=$(jq -r '.vars.ENV // ""' wrangler.jsonc)
    sentry-cli releases new $SENTRY_RELEASE
    sentry-cli sourcemaps upload --release=$SENTRY_RELEASE ${SENTRY_DIST:+--dist="$SENTRY_DIST"} --strip-prefix 'dist/..' dist
fi
