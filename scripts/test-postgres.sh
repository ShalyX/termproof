#!/usr/bin/env bash
set -euo pipefail

if [[ -z "${TERMPROOF_DATABASE_URL:-}" ]]; then
  echo "TERMPROOF_DATABASE_URL is required for the Postgres integration gate." >&2
  exit 2
fi

node --experimental-strip-types --test tests/postgres-persistence.integration.test.ts
