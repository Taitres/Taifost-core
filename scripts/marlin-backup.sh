#!/usr/bin/env bash

set -euo pipefail

backup_root="${1:-./backups}"
timestamp="$(date -u +%Y%m%dT%H%M%SZ)"
target="${backup_root%/}/marlin-${timestamp}"

mkdir -p "$target"

docker exec marlin-postgres pg_dump \
  --username="${PG_USER:-mx}" \
  --dbname="${PG_DATABASE:-mx_core}" \
  --format=custom \
  --file=/tmp/marlin.dump
docker cp marlin-postgres:/tmp/marlin.dump "$target/postgres.dump"
docker exec marlin-postgres rm /tmp/marlin.dump

if [ -d ./data-marlin/mx-space ]; then
  tar -C ./data-marlin -czf "$target/core-assets.tar.gz" mx-space
fi

cp docker-compose.marlin.yml "$target/docker-compose.marlin.yml"
git rev-parse HEAD >"$target/core-commit.txt"
sha256sum "$target"/* >"$target/SHA256SUMS"

echo "Backup written to $target"
