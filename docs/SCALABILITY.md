# Scalability & Rollout Plan

## Stage 0 — one school (today, as shipped)

- One Node process + one SQLite file handles a 2,000-student school with
  double-digit concurrent users comfortably (WAL mode, all queries indexed).
- Runs on a Raspberry Pi / old laptop / $5 VPS.

## Stage 1 — a cluster of schools (1–50), hosted

- The schema is already multi-tenant (`school_id` everywhere; super_admin can
  scope any query with `?school_id=`). Host many schools in **one instance**:
  create one `schools` row + one school_admin per school.
- Isolation-conscious alternative (recommended at this stage): **one container
  + one SQLite volume per school** behind a path/subdomain router
  (`schoolname.suite.lr`). Pros: hard data isolation, per-school backup/restore,
  a school can leave with its file. Docker compose scales this to dozens of
  schools on one 4GB VPS.
- Central needs at this stage: a small admin panel (or spreadsheet) of
  deployments, uptime monitoring, and a shared SMS gateway contract (one
  aggregator account, per-school sender IDs).

## Stage 2 — county level (50–500 schools)

- Move the hosted tier to **PostgreSQL**. The migration is mechanical:
  - `INTEGER PRIMARY KEY` → `BIGSERIAL`; `TEXT` dates → `date/timestamptz`;
    JSON TEXT columns → `jsonb`; same table/column names.
  - The data layer is 5 functions in `server/db/connection.js` (`all/get/run/tx`)
    — swap in `pg` behind the same interface; route SQL is standard.
- Add read replicas only if county-wide analytics get heavy; school traffic
  itself is tiny (a busy school ≈ 2 req/s peak).
- **County Education Officer dashboards**: the `county_officer` role exists;
  point it at cross-school aggregate endpoints (enrollment, attendance rates,
  collection rates by school) — the EMIS service already produces the shapes.
- **Sync for offline schools**: schools with no connectivity keep running the
  local install and export/import: EMIS CSVs upward monthly; a future
  `sync push` command can POST the school's changed rows (every table already
  carries `uuid`, `updated_at`, `deleted` precisely for this).

## Stage 3 — national (Ministry of Education)

- One Postgres cluster, app horizontally scaled behind a load balancer
  (the app is stateless — sessions are signed tokens, files on object storage).
- Data residency: host in-region; Liberia has growing local DCs, or AWS
  af-south-1 with an MoU covering education data.
- National ID spaces: student numbers already embed the school EMIS code, so
  they remain unique nationally.
- EMIS integration graduates from CSV to an API feed into LEMIS; the export
  service (`server/services/emis.js`) is the single place to adapt.
- Governance: per-school data ownership stays contractual — schools can always
  export; the Ministry sees aggregates + census registers.

## Cost / licensing model (suggested)

| Tier | Who | Price idea |
|---|---|---|
| Self-hosted | any school, esp. public | **Free** (MIT) — they run the offline install |
| Hosted basic | small private/community schools | ~$5–10/month per school (covers VPS + backups) |
| Hosted + SMS | schools wanting alerts | pass-through SMS cost + margin (bulk rates via local aggregator) |
| County/Ministry | government | per-county support contract funding the free tier |

## Performance guardrails already in the code

- List endpoints capped (≤2000 rows) with pagination; portal home is a single
  aggregate call; JSON gzipped over 1KB.
- No ORM, no N+1-prone abstractions — hot paths are single SQL statements.
- Frontend is ~60KB JS total, no framework, renders on 1GB-RAM phones.
- Report-card computation is O(scores in class·term) and snapshotted, not
  recomputed per view.

## What to build next (roadmap)

1. In-app UI for academic-year rollover and timetable editing (API exists).
2. `sync push/pull` daemon for offline-school → county aggregation.
3. Local-language string packs (all UI strings are in the view layer; extract
   to a dictionary — the settings key `language` is already reserved).
4. Voice-note attachments on announcements for low-literacy contexts.
5. MoMo API activation once merchant onboarding completes (stub is wired).
