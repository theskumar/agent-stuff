#!/bin/sh
# Builds the "shopcart" fixture repo in the current dir. $1 = variant (base|none|tools|weak|stale|notes)
set -e
v=${1:-base}
git init -q . && git config user.email eval@example.com && git config user.name eval
mkdir -p src
printf '{\n  "name": "shopcart",\n  "dependencies": {"express": "4.19.2", "lodash": "4.17.20", "mongoose": "8.1.0", "pg": "8.11.3"}\n}\n' > package.json
printf '# shopcart\n\nE-commerce backend (Node.js, Express).\n' > README.md
echo 'module.exports = {};' > src/index.js

adr() { # num slug title status date body-context decision
cat > "docs/decisions/$1-$2.md" <<A
# ADR-$1: $3

## Status

$4

## Date

$5

## Context

$6

## Decision

$7

## Consequences

$8
A
}

if [ "$v" = bare ]; then
  git add -A && git commit -qm init
  exit 0
fi

if [ "$v" = notes ]; then
  mkdir -p notes
  cat > notes/sandbox-provider.md <<'N'
# Sandbox provider notes (from Tuesday's call)

- Agents run untrusted build commands; today they run on shared CI runners with full repo secrets.
- Need: isolated Linux sandbox per run, starts in < 5s, no credentials inside, can be torn down after.
- Option A: Firecracker microVMs on our own bare-metal hosts (Hetzner). Cheap at scale (~$0.002/run), fast boot,
  but we run and patch the fleet ourselves; nobody on the team has run Firecracker in prod.
- Option B: E2B hosted sandboxes. Zero ops, SDK ready, ~$0.03/run, data leaves our infra, vendor lock-in risk.
- Volume: ~4,000 runs/day now, maybe 40k/day by Q3.
- Team: 3 backend engineers, no dedicated ops person.
- Leaning towards B now, with an interface so we can move to A later. Not agreed yet; Priya wants a write-up first.
N
  mkdir -p docs/decisions
  printf '# Decision records\n\nOne file per decision: NNNN-title.md.\n\n| ADR | Title | Status | Date |\n| --- | --- | --- | --- |\n' > docs/decisions/README.md
  git add -A && git commit -qm init
  exit 0
fi

if [ "$v" = tools ]; then
  mkdir -p doc/architecture/decisions bin
  echo doc/architecture/decisions > .adr-dir
  cat > doc/architecture/decisions/0001-record-architecture-decisions.md <<'A'
# 1. Record architecture decisions

Date: 2024-02-01

## Status

Accepted

## Context

We need to record the architectural decisions made on this project.

## Decision

We will use Architecture Decision Records, as described by Michael Nygard.

## Consequences

See Michael Nygard's article.
A
  cat > doc/architecture/decisions/0002-use-cron-for-background-jobs.md <<'A'
# 2. Use cron for background jobs

Date: 2024-03-10

## Status

Accepted

## Context

We need to send order emails and rebuild search indexes periodically.

## Decision

We will run background jobs as cron entries on the app server.

## Consequences

Simple to set up. No retries, no visibility into failures.
A
  # adr-tools stub: logs every call, and does the minimum for `new`.
  cat > bin/adr <<'S'
#!/bin/sh
echo "adr $*" >> "$(dirname "$0")/../.git/adr-calls.log"
d=$(cat .adr-dir 2>/dev/null || echo doc/adr)
if [ "$1" = new ]; then
  shift; sup=""
  while [ "$1" = -s ] || [ "$1" = -l ]; do [ "$1" = -s ] && sup="$2"; shift 2; done
  title="$*"; n=$(ls "$d" | grep -c '^[0-9]'); n=$((n+1)); num=$(printf %04d $n)
  slug=$(echo "$title" | tr 'A-Z' 'a-z' | sed 's/[^a-z0-9]/-/g;s/--*/-/g;s/^-//;s/-$//')
  f="$d/$num-$slug.md"
  printf '# %s. %s\n\nDate: 2026-10-27\n\n## Status\n\nAccepted\n' "$n" "$title" > "$f"
  [ -n "$sup" ] && printf '\nSupersedes [%s. ...](%s)\n' "$sup" "$(ls $d | grep "^$(printf %04d $sup)")" >> "$f" && \
    sed -i.bak 's/^Accepted$/Superceded by ['"$n"'. '"$title"']('"$num-$slug"'.md)/' "$d/$(ls $d | grep "^$(printf %04d $sup)")" && rm -f "$d"/*.bak
  printf '\n## Context\n\nThe issue motivating this decision, and any context that influences or constrains the decision.\n\n## Decision\n\nThe change that we are proposing or have agreed to implement.\n\n## Consequences\n\nWhat becomes easier or more difficult to do and any risks introduced by the change that will need to be mitigated.\n' >> "$f"
  echo "$f"
elif [ "$1" = help ] || [ -z "$1" ]; then
  echo "usage: adr init [dir] | adr new [-s N] [-l TARGET:LINK:REVERSE] TITLE | adr list | adr link SRC LINK TGT REVERSE | adr generate toc"
elif [ "$1" = list ]; then ls "$d"/*.md
else echo "adr: $1: stubbed, ok"; fi
S
  chmod +x bin/adr
  printf '\nADR tooling: adr-tools is installed at ./bin/adr (run it from the repo root).\n' >> README.md
  git add -A && git commit -qm init
  exit 0
fi

mkdir -p docs/decisions
cat > docs/decisions/template.md <<'A'
# ADR-NNNN: [Title]

## Status

Proposed | Accepted | Deprecated | Superseded by ADR-XXXX

## Date

YYYY-MM-DD

## Context

## Decision

## Consequences
A
adr 0001 record-architecture-decisions "Record architecture decisions" Accepted 2024-01-08 \
 "We need to record the architectural decisions made on this project." \
 "We will use Architecture Decision Records in docs/decisions/, one file per decision, numbered NNNN." \
 "Decisions are reviewable in pull requests."
adr 0002 use-mongodb-for-user-profiles "Use MongoDB for user profiles" Accepted 2024-01-20 \
 "User profiles have many optional, frequently changing fields. The order system already uses PostgreSQL." \
 "We will store user profiles in MongoDB, accessed through mongoose." \
 "Schema changes need no migrations. We run two databases."
adr 0003 rest-for-public-api "REST for the public API" Accepted 2024-02-02 \
 "Partners integrate with our catalog and orders. Most partner teams know REST well." \
 "We will expose the public API as REST over JSON, versioned in the URL path (/v1/)." \
 "Easy for partners to adopt. Clients over-fetch on the product detail screens."
cat > docs/decisions/README.md <<'A'
# Architecture Decision Records

| ADR | Title | Status | Date |
| --- | --- | --- | --- |
| [0001](0001-record-architecture-decisions.md) | Record architecture decisions | Accepted | 2024-01-08 |
| [0002](0002-use-mongodb-for-user-profiles.md) | Use MongoDB for user profiles | Accepted | 2024-01-20 |
| [0003](0003-rest-for-public-api.md) | REST for the public API | Accepted | 2024-02-02 |
A

if [ "$v" = weak ]; then
cat > docs/decisions/0004-use-kafka.md <<'A'
# ADR-0004: Use Kafka

## Status

Proposed

## Context

We need events.

## Decision

We will use Kafka for everything going forward because it is the industry standard and scales.

## Consequences

Kafka is fast and scalable. It will make the system better and more modern.
A
fi

if [ "$v" = stale ]; then
  adr 0004 redis-for-sessions "Redis for sessions" Accepted 2024-03-15 \
   "Sessions are stored in memory, so a deploy logs everyone out." \
   "We will store sessions in Redis with a 7-day TTL." "Deploys no longer log users out. One more service to run."
  adr 0005 graphql-for-mobile-bff "GraphQL for the mobile BFF" Proposed 2024-04-02 \
   "Mobile screens make 6-8 REST calls each." "We will add a GraphQL backend-for-frontend for the mobile app." "Fewer round trips. A second API surface to secure."
  sed -i.bak 's/^Accepted$/Superseded by ADR-0006/' docs/decisions/0002-use-mongodb-for-user-profiles.md && rm docs/decisions/*.bak
  adr 0006 move-user-profiles-to-postgresql "Move user profiles to PostgreSQL" Accepted 2024-05-10 \
   "Supersedes ADR-0002. Running two databases costs more than the schema flexibility saves." \
   "We will move user profiles into PostgreSQL, using JSONB for optional fields." "One database. A four-week migration."
  # README index is stale: lists only 0001-0003, with 0002 still Accepted
fi

mkdir -p .git/eval && cp docs/decisions/*.md .git/eval/
git add -A && git commit -qm init
