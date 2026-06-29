# Nexlayer deploy fix guidance (pinned)

PINNED: do not regenerate nexlayer.yaml or any Dockerfile. Image-only deploy of the
prebuilt `ghcr.io/triggerdotdev/trigger.dev:latest` (v3) webapp + postgres + redis.

Root causes of prior 503:
1. Wrong container port. The trigger.dev webapp listens on **3000**, not 3030 — the
   route forwarded to a dead port. Fixed servicePorts to 3000 (+ REMIX_APP_PORT/PORT).
2. Shared-namespace DNS collision. `postgres.pod` / `redis.pod` collide with other apps
   in this namespace. Renamed to `trigger-postgres` / `trigger-redis` and updated the
   connection strings to `trigger-postgres.pod` / `trigger-redis.pod`.
3. Added LOGIN_ORIGIN / API_ORIGIN and `?schema=public&sslmode=disable` on the DB URL.
   Capped Node heap (NODE_MAX_OLD_SPACE_SIZE=2048) to avoid OOM on a constrained pod.

The webapp entrypoint runs prisma migrations automatically against postgres on boot.
Keep this config; do not add ClickHouse/Electric (not required by the v3 :latest image).
