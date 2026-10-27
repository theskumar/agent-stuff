import json
F = "/tmp/skill-diet-work/adr/fixtures"
S = lambda v: f"sh {F}/repo.sh {v} >/dev/null"
SAME = f"sh {F}/same-body.sh"
one = lambda n: f'[ $(ls docs/decisions/{n}-*.md 2>/dev/null | wc -l) -eq 1 ] && f=$(ls docs/decisions/{n}-*.md)'
heads = 'grep -qiE "^#+ *status|^status:|\\*\\*status" "$f" && grep -qiE "^#+ .*context" "$f" && grep -qiE "^#+ .*decision" "$f" && grep -qiE "^#+ .*consequences" "$f"'
neg = 'grep -qiE "negative|downside|drawback|\\bcons\\b|trade-?off|cost|risk|overhead|dependency|stale|complexity" "$f"'
unchanged = lambda *ns: " && ".join(f"cmp -s docs/decisions/{n} .git/eval/{n}" for n in ns)
tasks = [
 dict(id="new-adr", prompt="Write an ADR for today's decision: we cache the product catalog in Redis instead of PostgreSQL materialized views.",
      setup=S("base"),
      check=f'{one("0004")} && {heads} && grep -qi redis "$f" && grep -qiE "materiali[sz]ed|postgres" "$f" && {neg} && [ $(wc -w < "$f") -le 1200 ] && grep -q "0004" docs/decisions/README.md && {unchanged("0001-record-architecture-decisions.md","0002-use-mongodb-for-user-profiles.md","0003-rest-for-public-api.md")}'),
 dict(id="supersede", prompt="We decided today to move user profiles out of MongoDB into PostgreSQL JSONB columns. Record it in the ADRs.",
      setup=S("base"),
      check=f'{one("0004")} && {heads} && grep -q "0002" "$f" && {SAME} docs/decisions/0002-use-mongodb-for-user-profiles.md && grep -qiE "supersed|deprecat" docs/decisions/0002-use-mongodb-for-user-profiles.md && grep -q "0004" docs/decisions/README.md && grep "0002-use" docs/decisions/README.md | grep -qiE "supersed|deprecat"'),
 dict(id="edit-accepted", prompt="ADR-0003 is out of date: we're switching the public API from REST to GraphQL. Take care of it.",
      setup=S("base"),
      check=f'{one("0004")} && grep -qi graphql "$f" && grep -q "0003" "$f" && {SAME} docs/decisions/0003-rest-for-public-api.md && grep -qiE "supersed|deprecat" docs/decisions/0003-rest-for-public-api.md'),
 dict(id="skip-trivial", prompt="Do we need an ADR for bumping lodash from 4.17.20 to 4.17.21 to pick up a security patch? Answer briefly.",
      setup=S("base"),
      must=["(^|\\n)\\W*(probably )?not?\\b|not (needed|necessary|warranted)|n.t (need|warrant|require)|skip|no ADR"],
      check='[ $(ls docs/decisions | wc -l) -eq 5 ]'),
 dict(id="rejected", prompt="We spent two weeks evaluating a move from Heroku to Kubernetes and decided not to do it: too much ops work for a 3-person team. Record that.",
      setup=S("base"),
      check=f'{one("0004")} && {heads} && grep -qi kubernetes "$f" && grep -qi heroku "$f" && grep -qiE "ops|operat" "$f" && grep -q "0004" docs/decisions/README.md'),
 dict(id="y-statement", prompt="Give me a Y-statement ADR for choosing Kong as our API gateway over AWS API Gateway; we accept running Kong ourselves. Print it only, write no files.",
      setup=S("base"),
      must=["in the context of", "facing", "kong", "aws api gateway", "accepting"],
      check='[ -z "$(git status --porcelain)" ]'),
 dict(id="adr-tools", prompt="Use adr-tools to record that we are replacing the cron background jobs with a Celery worker queue. It supersedes ADR 2. Fill in the content too.",
      setup=S("tools"),
      check='grep -qE "new .*-s +2|new -s2" .git/adr-calls.log && f=$(ls doc/architecture/decisions/0003-*.md) && grep -qi celery "$f" && ! grep -q "The issue motivating this decision" "$f" && grep -qiE "supersed|superced" doc/architecture/decisions/0002-*.md'),
 dict(id="fix-index", prompt="The ADR index in docs/decisions/README.md is out of date. Fix it.",
      setup=S("stale"),
      check='r=docs/decisions/README.md; for n in 0001 0002 0003 0004 0005 0006; do grep -q "$n-" $r || exit 1; done; grep "0002-" $r | grep -qiE "supersed|deprecat" && grep "0005-" $r | grep -qi proposed && grep "0006-" $r | grep -qi accepted && grep "0004-" $r | grep -qi accepted'),
 dict(id="review", prompt="Review docs/decisions/0004-use-kafka.md before I open the PR. List what's missing. Don't edit the file.",
      setup=S("weak"),
      must=["option|alternative", "negative|downside|drawback|cons\\b|trade-?off", "context"],
      check=unchanged("0004-use-kafka.md")),
 dict(id="draft-notes", prompt="Draft an ADR from notes/sandbox-provider.md. Keep it practical.",
      setup=S("notes"),
      check=f'{one("0001")} && {heads.replace("decision", "(decision|proposal)")} && grep -qi firecracker "$f" && grep -qi e2b "$f" && grep -qi proposed "$f" && {neg} && [ $(wc -w < "$f") -le 1200 ]'),
]
json.dump(tasks, open("/tmp/skill-diet-work/adr/tasks.json", "w"), indent=1)
print(len(tasks))
