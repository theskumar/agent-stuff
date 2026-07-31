#!/usr/bin/env bash
set -euo pipefail

usage() {
  cat <<'EOF'
Usage: checkout.sh <repo> [options]

Ensure a cached checkout exists at:
  ~/.cache/checkouts/<host>/<org>/<repo>

Examples:
  checkout.sh mitsuhiko/minijinja
  checkout.sh github.com/mitsuhiko/minijinja
  checkout.sh https://github.com/mitsuhiko/minijinja
  checkout.sh git@github.com:mitsuhiko/minijinja.git
  checkout.sh https://gitlab.com/group/subgroup/repo/-/tree/main/src
  checkout.sh https://codeberg.org/forgejo/forgejo/src/branch/main
  checkout.sh https://bitbucket.org/tildeslash/monit/src/master/
  checkout.sh gl:gitlab-org/gitlab-runner
  checkout.sh cb:forgejo/forgejo
  checkout.sh bb:tildeslash/monit

Options:
  --path-only                 Print only the checkout path.
  --force-update              Always fetch from origin and attempt fast-forward.
  --update-interval <secs>    Minimum seconds between updates (default: 300).
  --ssh                       Use an SSH origin URL (git@host:org/repo.git).
  --https                     Use an HTTPS origin URL (default).
  --dry-run                   Print resolved repo/path/url without cloning.

Host shorthands:
  gh: github.com    gl: gitlab.com    cb: codeberg.org    bb: bitbucket.org
  sr: git.sr.ht

Environment:
  LIBRARIAN_CACHE_ROOT        Override cache root (default: ~/.cache/checkouts)
  LIBRARIAN_DEFAULT_HOST      Host for owner/repo shorthand (default: github.com)
  LIBRARIAN_UPDATE_INTERVAL   Default update interval in seconds
  LIBRARIAN_PROTOCOL          https (default) or ssh
EOF
}

if [[ $# -lt 1 ]]; then
  usage
  exit 1
fi

# Fail fast on private/missing repos instead of prompting for credentials.
# Credential helpers still work with prompts disabled.
export GIT_TERMINAL_PROMPT="${GIT_TERMINAL_PROMPT:-0}"

repo_input=""
path_only=0
force_update=0
dry_run=0
protocol="${LIBRARIAN_PROTOCOL:-}"
update_interval="${LIBRARIAN_UPDATE_INTERVAL:-300}"

while [[ $# -gt 0 ]]; do
  case "$1" in
    --path-only)
      path_only=1
      shift
      ;;
    --force-update)
      force_update=1
      shift
      ;;
    --ssh)
      protocol="ssh"
      shift
      ;;
    --https)
      protocol="https"
      shift
      ;;
    --dry-run)
      dry_run=1
      shift
      ;;
    --update-interval)
      if [[ $# -lt 2 ]]; then
        echo "error: --update-interval expects a value" >&2
        exit 2
      fi
      update_interval="$2"
      shift 2
      ;;
    -h|--help)
      usage
      exit 0
      ;;
    *)
      if [[ -z "$repo_input" ]]; then
        repo_input="$1"
      else
        echo "error: unexpected argument: $1" >&2
        exit 2
      fi
      shift
      ;;
  esac
done

if [[ -z "$repo_input" ]]; then
  echo "error: repository is required" >&2
  exit 2
fi

if ! [[ "$update_interval" =~ ^[0-9]+$ ]]; then
  echo "error: update interval must be a non-negative integer" >&2
  exit 2
fi

if [[ -n "$protocol" && "$protocol" != "https" && "$protocol" != "ssh" ]]; then
  echo "error: protocol must be https or ssh: $protocol" >&2
  exit 2
fi

expand_host_alias() {
  case "$1" in
    gh) printf 'github.com' ;;
    gl) printf 'gitlab.com' ;;
    cb|codeberg) printf 'codeberg.org' ;;
    bb|bitbucket) printf 'bitbucket.org' ;;
    sr|sourcehut) printf 'git.sr.ht' ;;
    *) return 1 ;;
  esac
}

trim_repo_input() {
  local s="$1"
  # Trim leading/trailing whitespace.
  s="${s#${s%%[![:space:]]*}}"
  s="${s%${s##*[![:space:]]}}"
  printf '%s' "$s"
}

# Path segments that can only appear after <org>/<repo> in a web deep link.
# Covers GitHub, GitLab (including its `/-/` separator), Codeberg/Gitea/Forgejo,
# Bitbucket, and sourcehut.
is_web_path_segment() {
  case "$1" in
    -|tree|blob|blame|raw|src|commit|commits|compare|tags|branches|branch|log|refs|item \
    |pull|pulls|pull-requests|merge_requests|issues|milestones|wiki|find|search \
    |actions|pipelines|releases|downloads|archive|activity|settings|admin \
    |stars|forks|watchers|graphs|network)
      return 0
      ;;
    *) return 1 ;;
  esac
}

parse_repo() {
  local input host path first rest proto="" port=""
  input="$(trim_repo_input "$1")"

  # Strip query/fragment for URL-like inputs.
  input="${input%%\?*}"
  input="${input%%#*}"

  case "$input" in
    git@*:* )
      proto="ssh"
      host="${input#git@}"
      host="${host%%:*}"
      path="${input#*:}"
      ;;
    ssh://* )
      proto="ssh"
      rest="${input#ssh://}"
      host="${rest%%/*}"
      host="${host#*@}"
      if [[ "$host" == *:* ]]; then
        port="${host##*:}"
      fi
      path="${rest#*/}"
      ;;
    git://* )
      rest="${input#git://}"
      host="${rest%%/*}"
      path="${rest#*/}"
      ;;
    http://*|https://* )
      proto="https"
      rest="${input#*://}"
      host="${rest%%/*}"
      path="${rest#*/}"
      ;;
    *:*/* )
      # Host shorthand, e.g. gl:group/repo
      first="${input%%:*}"
      if ! host="$(expand_host_alias "$first")"; then
        echo "error: unknown host shorthand: $first" >&2
        return 1
      fi
      path="${input#*:}"
      ;;
    */* )
      first="${input%%/*}"
      if [[ "$first" == *.* || "$first" == localhost ]]; then
        host="$first"
        path="${input#*/}"
      elif host="$(expand_host_alias "$first")"; then
        path="${input#*/}"
      else
        host="${LIBRARIAN_DEFAULT_HOST:-github.com}"
        path="$input"
      fi
      ;;
    * )
      echo "error: unsupported repository format: $input" >&2
      return 1
      ;;
  esac

  host="${host#*@}"
  host="${host%%:*}"
  path="${path#/}"
  path="${path%/}"

  # Trim web deep links down to the repository path. Scan from the third segment
  # so GitLab subgroups (group/subgroup/repo/-/tree/main/...) survive.
  IFS='/' read -r -a parts <<< "$path"
  if [[ ${#parts[@]} -ge 3 ]]; then
    local i
    for (( i = 2; i < ${#parts[@]}; i++ )); do
      if is_web_path_segment "${parts[$i]}"; then
        path="$(IFS='/'; echo "${parts[*]:0:$i}")"
        break
      fi
    done
  fi

  # Strip optional .git suffix.
  path="${path%.git}"

  IFS='/' read -r -a parts <<< "$path"
  if [[ ${#parts[@]} -lt 2 ]]; then
    echo "error: repository path must contain at least org/repo: $path" >&2
    return 1
  fi

  local last_index=$(( ${#parts[@]} - 1 ))
  local repo="${parts[$last_index]}"
  local org_parts=("${parts[@]:0:$last_index}")
  local org
  org="$(IFS='/'; echo "${org_parts[*]}")"

  if [[ -z "$host" || -z "$org" || -z "$repo" ]]; then
    echo "error: failed to parse repository: $input" >&2
    return 1
  fi

  printf '%s\n%s\n%s\n%s\n%s\n' "$host" "$org" "$repo" "$proto" "$port"
}

parsed_host=""
parsed_org=""
parsed_repo=""
parsed_proto=""
parsed_port=""
parsed_index=0
while IFS= read -r line; do
  case "$parsed_index" in
    0) parsed_host="$line" ;;
    1) parsed_org="$line" ;;
    2) parsed_repo="$line" ;;
    3) parsed_proto="$line" ;;
    4) parsed_port="$line" ;;
  esac
  parsed_index=$((parsed_index + 1))
done < <(parse_repo "$repo_input")

if (( parsed_index < 3 )); then
  exit 1
fi

host="$parsed_host"
org="$parsed_org"
repo="$parsed_repo"

# Explicit flag/env wins; otherwise keep whichever protocol the input asked for.
explicit_protocol="$protocol"
if [[ -z "$protocol" ]]; then
  protocol="${parsed_proto:-https}"
fi

cache_root="${LIBRARIAN_CACHE_ROOT:-$HOME/.cache/checkouts}"
checkout_path="$cache_root/$host/$org/$repo"
if [[ "$protocol" == "ssh" ]]; then
  if [[ -n "$parsed_port" ]]; then
    origin_url="ssh://git@$host:$parsed_port/$org/$repo.git"
  else
    origin_url="git@$host:$org/$repo.git"
  fi
else
  origin_url="https://$host/$org/$repo.git"
fi

if (( dry_run == 1 )); then
  cat <<EOF
repo: $host/$org/$repo
path: $checkout_path
url: $origin_url
EOF
  exit 0
fi

mkdir -p "$(dirname "$checkout_path")"

if [[ ! -d "$checkout_path/.git" ]]; then
  if [[ -d "$checkout_path" ]] && [[ -n "$(ls -A "$checkout_path")" ]]; then
    echo "error: checkout path exists and is not a git repository: $checkout_path" >&2
    exit 3
  fi
  # Not every host supports partial clone (e.g. Bitbucket Cloud); fall back.
  if git clone --filter=blob:none "$origin_url" "$checkout_path" >/dev/null 2>&1; then
    clone_state="cloned"
  else
    rm -rf "$checkout_path"
    git clone "$origin_url" "$checkout_path" >/dev/null
    clone_state="cloned-full"
  fi
else
  clone_state="existing"
fi

if [[ ! -d "$checkout_path/.git" ]]; then
  echo "error: checkout path is not a git repository: $checkout_path" >&2
  exit 3
fi

if ! git -C "$checkout_path" remote get-url origin >/dev/null 2>&1; then
  git -C "$checkout_path" remote add origin "$origin_url"
fi

# If the remote URL points elsewhere (e.g. host shorthand), normalize it. An
# equivalent URL over the other protocol is left alone unless --ssh/--https asked.
current_origin="$(git -C "$checkout_path" remote get-url origin 2>/dev/null || true)"
if [[ "$current_origin" != "$origin_url" ]]; then
  if [[ -n "$explicit_protocol" \
    || ( "$current_origin" != "https://$host/$org/$repo.git" \
      && "$current_origin" != "git@$host:$org/$repo.git" ) ]]; then
    git -C "$checkout_path" remote set-url origin "$origin_url"
  fi
fi

last_fetch_file="$checkout_path/.git/librarian-last-fetch"
now_epoch="$(date +%s)"
needs_update=1

if [[ -f "$last_fetch_file" && "$force_update" -eq 0 ]]; then
  last_epoch="$(cat "$last_fetch_file" 2>/dev/null || echo 0)"
  if [[ "$last_epoch" =~ ^[0-9]+$ ]]; then
    age=$(( now_epoch - last_epoch ))
    if (( age < update_interval )); then
      needs_update=0
    fi
  fi
fi

update_state="skipped"
ff_state="not-attempted"

if (( needs_update == 1 )); then
  git -C "$checkout_path" fetch --prune --tags origin >/dev/null
  echo "$now_epoch" > "$last_fetch_file"
  update_state="fetched"

  branch="$(git -C "$checkout_path" symbolic-ref --short -q HEAD 2>/dev/null || true)"
  upstream="$(git -C "$checkout_path" rev-parse --abbrev-ref --symbolic-full-name '@{u}' 2>/dev/null || true)"
  dirty="$(git -C "$checkout_path" status --porcelain --untracked-files=no)"

  if [[ -n "$branch" && -n "$upstream" && -z "$dirty" ]]; then
    if git -C "$checkout_path" merge --ff-only "$upstream" >/dev/null 2>&1; then
      ff_state="fast-forwarded"
    else
      ff_state="skipped-non-ff"
    fi
  elif [[ -n "$dirty" ]]; then
    ff_state="skipped-dirty"
  else
    ff_state="skipped-no-upstream"
  fi
fi

if (( path_only == 1 )); then
  printf '%s\n' "$checkout_path"
  exit 0
fi

cat <<EOF
repo: $host/$org/$repo
path: $checkout_path
state: $clone_state
update: $update_state
fast_forward: $ff_state
EOF
