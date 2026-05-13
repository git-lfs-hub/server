#!/usr/bin/env bash

if [[ -f .sentryclirc || -v SENTRY_AUTH_TOKEN ]]; then
    SENTRY_RELEASE=$(sentry-cli releases propose-version)
    sentry-cli releases new $SENTRY_RELEASE
    sentry-cli sourcemaps upload --release=$SENTRY_RELEASE --strip-prefix 'dist/..' dist
fi
