# MARLIN.LOG on MX Space Core

MARLIN.LOG extends MX Space Core instead of introducing a second CMS. Core
remains the source of truth for public posts, pages, categories, tags, files,
authentication, AI providers, search, feeds, backups, and realtime events.
Shiro remains the public reader experience and gains a private `/studio`
workspace.

## Version baseline

- Core: `master`, API v3, PostgreSQL 16, Redis 8.
- Shiro: community-maintained fork based on Shiro 6.6.7.
- API compatibility: a v3 response adapter in Shiro unwraps
  `{ data, meta? }`, converts wire `snake_case`, remaps pagination metadata,
  and accepts the v3 error envelope.

The legacy Core 10/MongoDB deployment stays online until the v11-to-v12
migration has passed dry-run, apply, and read-only verification.

## Domain ownership

| Capability | Owner |
| --- | --- |
| Published posts, pages and taxonomy | Existing Core modules |
| OpenList media archive and usage inventory | MARLIN Core module |
| Public SSR, feeds, sitemap, comments | Shiro + existing Core APIs |
| Materials and import evidence | MARLIN Core module |
| Hotspot sources, signals, event candidates | MARLIN Core module |
| Creation projects and immutable revisions | MARLIN Core module |
| Validation reports, review requests and decisions | MARLIN Core module |
| Publication plans and immutable publication records | MARLIN Core module |
| AI providers and low-level completions | Existing Core AI module |
| AI roles and fixed workflow assignments | MARLIN Core module |
| Owner authentication | Existing Core Better Auth session/API key |

## State invariants

1. Imported material content is frozen and deduplicated by normalized SHA-256.
2. Remote images must be archived to OpenList. A failed image makes the
   material `pending` and blocks project attachment until retry succeeds or
   the owner explicitly ignores it.
3. A review request targets one immutable revision and cannot approve another.
4. Editing or AI retry creates a new revision and supersedes pending reviews.
5. Approval and publication are separate transitions.
6. A publication targets one approved revision and records the resulting Core
   post ID.
7. Updating a published article does not change the live Core post until a new
   approved revision is explicitly published.
8. Published articles are withdrawn by unpublishing the Core post; workflow
   history is retained.

## Delivery slices

1. Core v3 + Shiro compatibility and parallel smoke deployment.
2. Materials, sources, hotspot candidates, media inventory, AI roles, and
   health endpoints.
3. Creation projects, revisions, validation, review, and idempotent decisions.
4. Core post publication, scheduling, withdrawal, and revision history.
5. Shiro Studio pages covering every owner workflow, including selected
   Markdown rewriting through the fixed `quick-rewriter` role.
6. MongoDB-to-PostgreSQL migration, end-to-end verification, and cutover.

`docker-compose.marlin.yml` starts a parallel API v3 stack on port `2334` and
PostgreSQL on loopback port `5434`; it does not stop or mutate the legacy
deployment.
