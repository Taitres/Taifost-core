# MARLIN.LOG deployment and cutover

This repository is a local Core v3 fork. The companion Shiro fork lives in
`../shiro-src`. Both compose files default to parallel smoke ports so the
current Core 10/Shiro deployment remains untouched:

- Core v3: `2334`
- Shiro v3: `2324`
- PostgreSQL: loopback-only `5434`

## Required configuration

Create a private `.env` beside `docker-compose.marlin.yml`:

```dotenv
PG_PASSWORD=replace-with-a-long-password
JWT_SECRET=replace-with-a-long-random-secret
SNOWFLAKE_WORKER_ID=2
ALLOWED_ORIGINS=blog.example.com,api.example.com,localhost:*
MARLIN_REVIEW_PASSCODE=123456

# OpenList image archive
MARLIN_OPENLIST_URL=https://openlist.example.com
MARLIN_OPENLIST_TOKEN=replace-with-openlist-token
MARLIN_OPENLIST_DIRECTORY=marlin/assets
MARLIN_OPENLIST_PUBLIC_URL=https://openlist.example.com
```

`MARLIN_OPENLIST_TOKEN` must be able to upload to the configured directory.
Image archive failures remain visible in each material's analysis and never
silently replace the source URL.

## Parallel startup

```bash
docker-compose -f docker-compose.marlin.yml build
docker-compose -f docker-compose.marlin.yml up -d
curl -fsS http://127.0.0.1:2334/api/v3/ping
curl -fsS http://127.0.0.1:2334/api/v3/health

cd ../shiro-src
CORE_API_URL=http://host.docker.internal:2334/api/v3 \
CORE_CLIENT_API_URL=https://api.example.com/api/v3 \
docker-compose -f docker-compose.marlin.yml up -d --build
curl -fsS http://127.0.0.1:2324/robots.txt
```

## MongoDB to PostgreSQL

Core 10 stays online while the dry-run reads MongoDB. The CLI never writes to
MongoDB.

```bash
pnpm --filter @mx-space/mongo-pg-cli build

MONGO_URI=mongodb://mongo:27017/mx-space \
PG_URL=postgres://mx:password@postgres:5432/mx_core \
SNOWFLAKE_WORKER_ID=900 \
node packages/mongo-pg-cli/dist/cli.mjs --mode dry-run
```

For the final apply window:

1. Export a final `mongodump`.
2. Stop only the old Core writer; keep MongoDB running.
3. Run the same command with `--mode apply`.
4. Start Core v3, verify counts, owner login, public pages, RSS and sitemap.
5. Point the reverse proxy to Core `2334` and Shiro `2324`.
6. Keep the MongoDB snapshot and old containers stopped but recoverable.

If verification fails before v3 accepts writes, route traffic back to the old
ports and restart the old Core/Shiro. If v3 has accepted writes, prefer a
forward fix; rolling back would require reconciling PostgreSQL-only changes.

## Backup and restore

Run from the Core repository:

```bash
./scripts/marlin-backup.sh /srv/backups
```

The bundle contains a custom-format PostgreSQL dump, Core assets, compose
configuration, commit identity and SHA-256 manifest. Restore into an empty
PostgreSQL database with `pg_restore --clean --if-exists`, restore the assets
archive under `data-marlin`, then start the exact recorded image/commit.

OpenList media is external and must be backed up using the OpenList storage
driver's own backup policy.
