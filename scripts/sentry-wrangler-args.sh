#!/usr/bin/env bash

if [[ -f .sentryclirc || -v SENTRY_AUTH_TOKEN ]]; then
    echo --upload-source-maps --var SENTRY_RELEASE:$(sentry-cli releases propose-version)
fi
