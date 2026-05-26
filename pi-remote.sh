#!/usr/bin/env bash
set -euo pipefail

VERSION="1.0.0"
# Literal remote-shell expression; expanded on the remote host, not on the local machine.
# shellcheck disable=SC2016
REMOTE_PROJECT_PATH='"$HOME/projects/pi-remote/pi-remote.sh"'
# shellcheck disable=SC2016
REMOTE_LEGACY_PROJECT_PATH='"$HOME/projects/pi-remote/pi-remote"'
DEFAULT_CONFIG_PATH="$HOME/.config/pi-remote/config"
DEFAULT_HOST="pi-remote"

usage() {
  cat <<'EOF'
pi-remote.sh - tiny SSH/tmux launcher for coding agents on a remote host

Usage:
  pi-remote.sh                              SSH to the configured host, pick/create a project, attach in tmux
  pi-remote.sh --project NAME               Start/attach for an existing ~/projects/NAME
  pi-remote.sh --new NAME                   Create ~/projects/NAME, then start/attach
  pi-remote.sh --agent pi|claude|codex      Choose the remote agent command (default: pi)
  pi-remote.sh --project NAME --no-attach [-- AGENT_ARGS...]
  pi-remote.sh --configure-tmux            Check/update remote tmux defaults, then exit
  pi-remote.sh --saved-sessions             Pick a saved Pi/Codex session and attach in tmux
  pi-remote.sh --saved-sessions --agent codex --list
  pi-remote.sh --install-remote             Install/update the remote helper copy, then exit
  pi-remote.sh --init-config --host HOST     Create a local config file, then exit
  pi-remote.sh --list

Interactive menus use ↑/↓ or j/k, ←/→ to expand projects, and Enter.

Options:
  --host HOST             SSH host to use (default: config host, PI_REMOTE_HOST, or pi-remote)
  --project NAME          Use an existing project under the remote project root
  --new NAME              Create/use a new project under the remote project root
  --session NAME          tmux session name (default: pi-remote-<project>)
  --agent NAME            Remote agent: pi, claude, codex, or custom (default from config/env: pi)
  --command COMMAND       Custom remote launch command; overrides --agent command lookup
  --no-attach             Create the tmux session detached and print the attach command
  --configure-tmux       Ask to install/update pi-remote tmux defaults and exit
  --install-remote       Install/update the remote helper copy and exit
  --init-config          Create the local config file if missing and exit
  --skip-tmux-config     Do not prompt about remote tmux config during interactive startup
  --list                  List remote projects and exit
  --sessions PROJECT      List tmux sessions whose panes are in PROJECT and exit
  --saved-sessions        Pick/list saved Pi/Codex JSONL sessions instead of projects
  --kittylitter           Alias for --saved-sessions
  --saved-agent NAME      Saved-session filter: all, pi, or codex (default: all)
  --saved-session-limit N Saved-session scan/list cap (default: 120)
  --dry-run               Print what would run without creating/attaching tmux
  --project-root PATH     Remote project root (default: ~/projects)
  --pi-bin PATH           Pi executable on the remote host (default: pi; backwards-compatible alias)
  --help                  Show this help
  --version               Show version
  --                      Everything after this is passed to the selected agent

Config:
  ~/.config/pi-remote/config accepts simple key=value lines:
    host=pi-remote
    project_root=~/projects
    agent=pi
    pi_command=pi
    claude_command=claude
    codex_command=codex
    launch_command=pi

Environment:
  PI_REMOTE_HOST          Default SSH host.
  PI_REMOTE_CONFIG        Local config path.
  PI_REMOTE_PROJECT_ROOT  Default remote project root for server mode.
  PI_REMOTE_AGENT         Default agent for server mode.
  PI_REMOTE_LAUNCH_COMMAND Custom launch command for server mode.
  PI_REMOTE_PI_BIN        Default Pi executable for server mode.
  PI_REMOTE_CLAUDE_BIN    Default Claude executable for server mode.
  PI_REMOTE_CODEX_BIN     Default Codex executable for server mode.
  PI_REMOTE_TMUX_CONFIG   Remote tmux config path (default: ~/.tmux.conf).
  PI_REMOTE_TMUX_CONFIG_SOURCE Set to 0 to write/validate config without sourcing it.

Automation-friendly example:
  pi-remote.sh --project my-project --session review-agent --no-attach -- "Review this project"
EOF
}

fail() {
  printf 'pi-remote: %s\n' "$*" >&2
  exit 1
}

config_file() {
  printf '%s\n' "${PI_REMOTE_CONFIG:-$DEFAULT_CONFIG_PATH}"
}

config_get() {
  local key=$1
  local default=${2-}
  local file result
  file=$(config_file)
  if [[ -r "$file" ]]; then
    result=$(awk -F= -v want="$key" '
      /^[[:space:]]*($|#)/ { next }
      {
        k=$1
        sub(/^[[:space:]]+/, "", k)
        sub(/[[:space:]]+$/, "", k)
        if (k == want) {
          $1=""
          sub(/^=/, "")
          sub(/^[[:space:]]+/, "")
          sub(/[[:space:]]+$/, "")
          print
        }
      }
    ' "$file" | tail -n 1)
    if [[ -n "$result" ]]; then
      printf '%s\n' "$result"
    else
      printf '%s\n' "$default"
    fi
    return 0
  fi
  printf '%s\n' "$default"
}

shell_quote() {
  local value=${1-}
  if [[ "$value" =~ ^[A-Za-z0-9_./:@%+=,-]+$ ]]; then
    printf '%s' "$value"
  else
    value=${value//\'/\'\\\'\'}
    printf "'%s'" "$value"
  fi
}

shell_join() {
  local first=1
  local arg
  for arg in "$@"; do
    if (( first )); then
      first=0
    else
      printf ' '
    fi
    shell_quote "$arg"
  done
}

is_local_host() {
  case "${1-}" in
    local|localhost|127.0.0.1|.) return 0 ;;
    *) return 1 ;;
  esac
}

attach_command() {
  local session_name=$1
  local host=${PI_REMOTE_HOST:-$DEFAULT_HOST}
  if is_local_host "$host"; then
    shell_join tmux attach -t "$session_name"
  else
    printf 'ssh %s -t %s' "$(shell_quote "$host")" "$(shell_join tmux attach -t "$session_name")"
  fi
}

sanitize_name() {
  local raw=${1-}
  local safe
  safe=$(printf '%s' "$raw" | tr -cs 'A-Za-z0-9._-' '-' | sed -E 's/^-+//; s/-+$//; s/-+/-/g')
  [[ -n "$safe" ]] || return 1
  printf '%s' "$safe"
}

validate_existing_name() {
  local name=${1-}
  [[ -n "$name" ]] || return 1
  [[ "$name" != "." && "$name" != ".." ]] || return 1
  [[ "$name" != */* ]] || return 1
}

expand_home_path() {
  local value=$1
  printf '%s\n' "${value/#\~/$HOME}"
}

list_projects() {
  local root=$1
  local path
  mkdir -p "$root"
  find "$root" -mindepth 1 -maxdepth 1 -type d 2>/dev/null |
    while IFS= read -r path; do
      basename "$path"
    done | sort
}

tmux_config_file() {
  printf '%s\n' "${PI_REMOTE_TMUX_CONFIG:-$HOME/.tmux.conf}"
}

should_source_tmux_config() {
  case "${PI_REMOTE_TMUX_CONFIG_SOURCE:-1}" in
    0|false|FALSE|no|NO) return 1 ;;
    *) return 0 ;;
  esac
}

tmux_config_has_managed_block() {
  local file=$1
  [[ -r "$file" ]] || return 1
  grep -Eq '^# BEGIN pi-remote tmux (enhancements|defaults)$' "$file"
}

tmux_config_has_features() {
  local file=$1
  [[ -r "$file" ]] || return 1
  grep -q 'set -s extended-keys on' "$file" || return 1
  grep -q 'set -g xterm-keys on' "$file" || return 1
  grep -Eq 'help .*detach .*quit ' "$file" || return 1
}

format_tmux_key() {
  local key=$1
  local suffix
  case "$key" in
    C-*)
      suffix=${key#C-}
      if [[ ${#suffix} -eq 1 ]]; then
        suffix=$(printf '%s' "$suffix" | tr '[:lower:]' '[:upper:]')
      fi
      printf 'Ctrl+%s' "$suffix"
      ;;
    M-*)
      suffix=${key#M-}
      if [[ ${#suffix} -eq 1 ]]; then
        suffix=$(printf '%s' "$suffix" | tr '[:lower:]' '[:upper:]')
      fi
      printf 'Alt+%s' "$suffix"
      ;;
    Space) printf 'Space' ;;
    *) printf '%s' "$key" ;;
  esac
}

format_tmux_chord() {
  local prefix=$1
  local key=$2
  local prefix_display key_display
  prefix_display=$(format_tmux_key "$prefix")
  key_display=$(format_tmux_key "$key")
  if [[ "$key_display" == "?" ]]; then
    printf '%s?' "$prefix_display"
  else
    printf '%s %s' "$prefix_display" "$key_display"
  fi
}

binding_key_for() {
  local keys=$1
  local pattern=$2
  local fallback=$3
  local key
  key=$(awk -v pattern="$pattern" '
    $1 == "bind-key" && $2 == "-T" && $3 == "prefix" {
      key = $4
      command = $0
      sub(/^[^ ]+[[:space:]]+-T[[:space:]]+prefix[[:space:]]+[^[:space:]]+[[:space:]]+/, "", command)
      if (command ~ pattern) {
        print key
        exit
      }
    }
  ' <<<"$keys")
  printf '%s\n' "${key:-$fallback}"
}

build_tmux_help_hint() {
  local file=$1
  local socket prefix keys help_key detach_key quit_key
  local help_chord detach_chord quit_chord

  if [[ "$file" == "$HOME/.tmux.conf" ]] && tmux show -gqv prefix >/dev/null 2>&1; then
    prefix=$(tmux show -gqv prefix 2>/dev/null || printf 'C-b')
    keys=$(tmux list-keys -T prefix 2>/dev/null || true)
  else
    socket="pi-remote-hint-$$"
    if tmux -L "$socket" -f "$file" new-session -d -s pi-remote-hint-smoke 'sleep 1' 2>/dev/null; then
      prefix=$(tmux -L "$socket" show -gqv prefix 2>/dev/null || printf 'C-b')
      keys=$(tmux -L "$socket" list-keys -T prefix 2>/dev/null || true)
      tmux -L "$socket" kill-server >/dev/null 2>&1 || true
    else
      prefix="C-b"
      keys=""
    fi
  fi

  help_key=$(binding_key_for "$keys" '^list-keys([[:space:]]|$)' '?')
  detach_key=$(binding_key_for "$keys" '^detach-client([[:space:]]|$)' 'd')
  quit_key=$(binding_key_for "$keys" '^(kill-pane([[:space:]]|$)|confirm-before .*kill-pane)' '')
  if [[ -z "$quit_key" ]]; then
    quit_key=$(binding_key_for "$keys" '^(kill-window([[:space:]]|$)|confirm-before .*kill-window)' '')
  fi
  if [[ -z "$quit_key" ]]; then
    quit_key='x'
  fi

  help_chord=$(format_tmux_chord "$prefix" "$help_key")
  detach_chord=$(format_tmux_chord "$prefix" "$detach_key")
  quit_chord=$(format_tmux_chord "$prefix" "$quit_key")
  printf 'help %s  detach %s  quit %s\n' "$help_chord" "$detach_chord" "$quit_chord"
}

escape_single_quotes() {
  local value=$1
  printf '%s' "${value//\'/\'\\\'\'}"
}

render_tmux_config_block() {
  local hint=$1
  local escaped_hint
  escaped_hint=$(escape_single_quotes "$hint")
  cat <<EOF
# BEGIN pi-remote tmux enhancements
# Managed by pi-remote. This block is appended/updated without changing the rest of your tmux config.
# It enables modern modified-key passthrough for agent TUIs and advertises tmux's help screen.
set -s extended-keys on
set -g xterm-keys on
set -g terminal-features[90] 'xterm*:extkeys'
set -g terminal-features[91] 'screen*:extkeys'
set -g terminal-features[92] 'tmux*:extkeys'
set -g status on
set -g status-format[0] '#[align=left]#{E:status-left}#[align=centre,bold]$escaped_hint#[default]#[align=right]#{E:status-right}'
# END pi-remote tmux enhancements
EOF
}

apply_remote_tmux_config() {
  local file tmp block_file backup socket hint
  file=$(tmux_config_file)
  mkdir -p "$(dirname "$file")"
  tmp=$(mktemp)
  block_file=$(mktemp)
  hint=$(build_tmux_help_hint "$file")
  render_tmux_config_block "$hint" >"$block_file"

  if [[ -f "$file" ]]; then
    backup="$file.backup-$(date +%Y%m%d-%H%M%S)"
    cp "$file" "$backup"
  else
    backup=""
    : >"$file"
  fi

  if tmux_config_has_managed_block "$file"; then
    awk -v block="$block_file" '
      $0 == "# BEGIN pi-remote tmux enhancements" || $0 == "# BEGIN pi-remote tmux defaults" {
        while ((getline line < block) > 0) print line
        in_block = 1
        next
      }
      $0 == "# END pi-remote tmux enhancements" || $0 == "# END pi-remote tmux defaults" { in_block = 0; next }
      !in_block { print }
    ' "$file" >"$tmp"
  else
    cat "$file" >"$tmp"
    if [[ -s "$tmp" ]] && [[ $(tail -c 1 "$tmp" | wc -l) -eq 0 ]]; then
      printf '\n' >>"$tmp"
    fi
    printf '\n' >>"$tmp"
    cat "$block_file" >>"$tmp"
  fi

  install -m 0644 "$tmp" "$file"
  rm -f "$tmp" "$block_file"

  socket="pi-remote-config-test-$$"
  if ! tmux -L "$socket" -f "$file" new-session -d -s pi-remote-config-smoke 'sleep 1' 2>/tmp/pi-remote-tmux-config-error.$$; then
    if [[ -n "$backup" && -f "$backup" ]]; then
      cp "$backup" "$file"
    fi
    printf 'pi-remote: tmux config validation failed; restored previous config.\n' >&2
    cat /tmp/pi-remote-tmux-config-error.$$ >&2 || true
    rm -f /tmp/pi-remote-tmux-config-error.$$
    return 1
  fi
  tmux -L "$socket" kill-server >/dev/null 2>&1 || true
  rm -f /tmp/pi-remote-tmux-config-error.$$

  if should_source_tmux_config; then
    tmux source-file "$file" >/dev/null 2>&1 || true
  fi
  printf 'Enhanced remote tmux config: %s\n' "$file" >/dev/tty 2>/dev/null || printf 'Enhanced remote tmux config: %s\n' "$file"
  printf 'Status help hint: %s\n' "$hint" >/dev/tty 2>/dev/null || printf 'Status help hint: %s\n' "$hint"
  if [[ -n "$backup" ]]; then
    printf 'Backup: %s\n' "$backup" >/dev/tty 2>/dev/null || printf 'Backup: %s\n' "$backup"
  fi
}

prompt_remote_tmux_config() {
  local force=${1:-0}
  local file answer
  file=$(tmux_config_file)
  if (( force == 0 )) && tmux_config_has_features "$file"; then
    return 0
  fi

  if [[ ! -r /dev/tty ]]; then
    return 0
  fi

  if tmux_config_has_features "$file"; then
    printf 'Remote tmux config already has the pi-remote features. Recompute/update the managed help hint without changing the rest of %s? [y/N]: ' "$file" >/dev/tty
  else
    printf 'Remote tmux config is missing current pi-remote features (extended keys + explicit shortcut hint). Enhance %s now without replacing existing settings? [y/N]: ' "$file" >/dev/tty
  fi
  read -r answer </dev/tty
  case "$answer" in
    y|Y|yes|YES) apply_remote_tmux_config ;;
    *) printf 'Skipping remote tmux config update.\n' >/dev/tty ;;
  esac
}

recent_file() {
  printf '%s\n' "${PI_REMOTE_RECENTS:-$HOME/.cache/pi-remote/recents.tsv}"
}

without_trailing_slashes() {
  local value=$1
  while [[ "$value" != "/" && "$value" == */ ]]; do
    value=${value%/}
  done
  [[ -n "$value" ]] || value="/"
  printf '%s\n' "$value"
}

child_path_prefix() {
  local normalized
  normalized=$(without_trailing_slashes "$1")
  if [[ "$normalized" == "/" ]]; then
    printf '/\n'
  else
    printf '%s/\n' "$normalized"
  fi
}

project_sessions_by_project() {
  local root=$1 prefix
  command -v tmux >/dev/null 2>&1 || return 0
  prefix=$(child_path_prefix "$root")
  { tmux list-panes -a -F '#{session_name}	#{pane_current_path}	#{pane_current_command}' 2>/dev/null || true; } |
    awk -F '\t' -v root="$prefix" '
      index($2, root) == 1 {
        rest = substr($2, length(root) + 1)
        split(rest, parts, "/")
        project = parts[1]
        if (project != "" && !seen[project SUBSEP $1]++) print project "\t" $1
      }
    ' | sort -t $'\t' -k1,1 -k2,2
}

project_session_counts() {
  local root=$1
  project_sessions_by_project "$root" |
    awk -F '\t' '{ counts[$1]++ } END { for (project in counts) print project "\t" counts[project] }'
}

project_recent_times() {
  local root=$1
  local file
  file=$(recent_file)
  [[ -r "$file" ]] || return 0
  awk -F '\t' -v root="$root" '
    $2 == root {
      if (($1 + 0) > (recent[$3] + 0)) recent[$3] = $1 + 0
    }
    END {
      for (project in recent) print project "\t" recent[project]
    }
  ' "$file"
}

project_menu_rows() {
  local root=$1
  local saved_summary_file=${2:-}
  local counts_file=${3:-}
  local projects_tmp counts_tmp recents_tmp empty_saved_tmp=0 empty_counts_tmp=0
  projects_tmp=$(mktemp)
  recents_tmp=$(mktemp)
  if [[ -z "$counts_file" || ! -r "$counts_file" ]]; then
    counts_tmp=$(mktemp)
    empty_counts_tmp=1
    project_session_counts "$root" >"$counts_tmp"
  else
    counts_tmp=$counts_file
  fi
  if [[ -z "$saved_summary_file" || ! -r "$saved_summary_file" ]]; then
    saved_summary_file=$(mktemp)
    empty_saved_tmp=1
  fi
  list_projects "$root" >"$projects_tmp"
  project_recent_times "$root" >"$recents_tmp"
  awk -F '\t' '
    FILENAME == ARGV[1] { projects[$1] = 1; order[++n] = $1; next }
    FILENAME == ARGV[2] { counts[$1] = $2 + 0; next }
    FILENAME == ARGV[3] { recents[$1] = $2 + 0; next }
    FILENAME == ARGV[4] { saved_counts[$1] = $2 + 0; saved_recent[$1] = $3 + 0; next }
    END {
      for (i = 1; i <= n; i++) {
        project = order[i]
        recent = recents[project] + 0
        if ((saved_recent[project] + 0) > recent) recent = saved_recent[project] + 0
        print project "\t" (counts[project] + 0) "\t" (saved_counts[project] + 0) "\t" recent
      }
    }
  ' "$projects_tmp" "$counts_tmp" "$recents_tmp" "$saved_summary_file" | sort -t $'\t' -k4,4nr -k2,2nr -k3,3nr -k1,1
  rm -f "$projects_tmp" "$recents_tmp"
  (( empty_counts_tmp )) && rm -f "$counts_tmp"
  (( empty_saved_tmp )) && rm -f "$saved_summary_file"
}

record_recent_project() {
  local root=$1
  local project=$2
  local file tmp now
  [[ -n "$project" ]] || return 0
  file=$(recent_file)
  mkdir -p "$(dirname "$file")"
  tmp=$(mktemp)
  if [[ -r "$file" ]]; then
    awk -F '\t' -v root="$root" -v project="$project" '$2 != root || $3 != project' "$file" >"$tmp"
  fi
  now=$(date +%s)
  printf '%s\t%s\t%s\n' "$now" "$root" "$project" >>"$tmp"
  sort -t $'\t' -k1,1nr "$tmp" | head -200 >"$file"
  rm -f "$tmp"
}

list_saved_sessions() {
  local filter=$1
  local limit=$2
  python3 - "$filter" "$limit" <<'PY'
import json, os, re, sys
from pathlib import Path

filter_arg = sys.argv[1]
limit = int(sys.argv[2])
home = Path.home()
SCAN_BYTES = 256 * 1024

def scan_lines(path):
    st = path.stat()
    if st.st_size <= SCAN_BYTES:
        return path.read_text(errors='replace').splitlines(), st
    with path.open('rb') as f:
        data = f.read(SCAN_BYTES)
    text = data.decode('utf-8', 'replace')
    last_newline = text.rfind('\n')
    if last_newline >= 0:
        text = text[:last_newline]
    return text.splitlines(), st

def newest(root):
    if not root.exists():
        return []
    files = []
    for path in root.rglob('*.jsonl'):
        try:
            files.append((path.stat().st_mtime, path))
        except OSError:
            pass
    files.sort(reverse=True)
    return [p for _, p in files[:limit]]

def safe(line):
    try:
        v = json.loads(line)
        return v if isinstance(v, dict) else None
    except Exception:
        return None

def content_text(content):
    if isinstance(content, str):
        return content
    if isinstance(content, list):
        parts = []
        for block in content:
            if isinstance(block, str):
                parts.append(block)
            elif isinstance(block, dict):
                if isinstance(block.get('text'), str):
                    parts.append(block['text'])
                elif isinstance(block.get('input_text'), str):
                    parts.append(block['input_text'])
        return '\n'.join(parts)
    return ''

def clean(text):
    text = re.sub(r'\s+', ' ', text or '').strip() or '(untitled)'
    return text[:119].rstrip() + '…' if len(text) > 120 else text

def emit(agent, modified, sid, path, cwd, title, model, created, count):
    fields = [agent, str(int(modified * 1000)), sid, str(path), cwd, clean(title), model or '', created or '', str(count)]
    print('\t'.join(f.replace('\t', ' ').replace('\r', ' ').replace('\n', ' ') for f in fields))

def parse_pi(path):
    header = None
    name = ''
    first_user = ''
    model = ''
    count = 0
    try:
        lines, st = scan_lines(path)
        for i, line in enumerate(lines):
            entry = safe(line)
            if not entry:
                continue
            typ = entry.get('type')
            if i == 0 and typ == 'session':
                header = entry
            elif typ == 'session_info' and isinstance(entry.get('name'), str):
                name = entry['name'].strip()
            elif typ == 'model_change':
                model = '/'.join(str(x) for x in (entry.get('provider'), entry.get('modelId')) if x)
            elif typ == 'message' and isinstance(entry.get('message'), dict):
                msg = entry['message']
                role = msg.get('role')
                if role in ('user', 'assistant'):
                    count += 1
                if role == 'user' and not first_user:
                    first_user = content_text(msg.get('content'))
        if not header or not isinstance(header.get('id'), str):
            return
        emit('pi', st.st_mtime, header['id'], path, str(header.get('cwd') or home), name or first_user, model, str(header.get('timestamp') or ''), count)
    except Exception:
        return

def bootstrap(text):
    t = (text or '').strip()
    return (not t) or t.startswith('# AGENTS.md instructions') or t.startswith('<environment_context>') or t.startswith('<permissions instructions>')

def parse_codex(path):
    sid = ''
    cwd = str(home)
    created = ''
    first_user = ''
    model = ''
    count = 0
    try:
        lines, st = scan_lines(path)
        for line in lines:
            entry = safe(line)
            if not entry:
                continue
            payload = entry.get('payload') if isinstance(entry.get('payload'), dict) else {}
            typ = entry.get('type')
            if typ == 'session_meta':
                if payload.get('id'):
                    sid = str(payload['id'])
                cwd = str(payload.get('cwd') or cwd)
                created = str(payload.get('timestamp') or entry.get('timestamp') or created or '')
            elif typ == 'turn_context':
                cwd = str(payload.get('cwd') or cwd)
                if payload.get('model'):
                    model = str(payload['model'])
            elif typ == 'event_msg':
                et = payload.get('type')
                if et == 'user_message':
                    count += 1
                    msg = payload.get('message')
                    if isinstance(msg, str) and not first_user and not bootstrap(msg):
                        first_user = msg
                elif isinstance(et, str) and et.startswith('agent_message'):
                    count += 1
            elif typ == 'response_item' and payload.get('type') == 'message':
                if payload.get('role') in ('user', 'assistant'):
                    count += 1
                if payload.get('role') == 'user' and not first_user:
                    text = content_text(payload.get('content'))
                    if not bootstrap(text):
                        first_user = text
        if not sid:
            m = re.search(r'([0-9a-f]{8}-[0-9a-f-]{27,})', path.stem)
            sid = m.group(1) if m else path.stem
        emit('codex', st.st_mtime, sid, path, cwd, first_user, model, created, count)
    except Exception:
        return

if filter_arg in ('all', 'pi'):
    for p in newest(home / '.pi' / 'agent' / 'sessions'):
        parse_pi(p)
if filter_arg in ('all', 'codex'):
    for p in newest(home / '.codex' / 'sessions'):
        parse_codex(p)
PY
}

saved_sessions_for_project_menu() {
  local root=$1
  local filter=$2
  local limit=$3
  local sessions_tmp
  sessions_tmp=$(mktemp)
  list_saved_sessions "$filter" "$limit" >"$sessions_tmp"
  python3 - "$root" "$sessions_tmp" <<'PY'
import os, sys

root = os.path.abspath(os.path.expanduser(sys.argv[1]))
sessions_file = sys.argv[2]
home = os.path.expanduser('~')
try:
    projects = {name for name in os.listdir(root) if os.path.isdir(os.path.join(root, name))}
except OSError:
    projects = set()

try:
    with open(sessions_file, encoding='utf-8', errors='replace') as source:
        for raw in source:
            line = raw.rstrip('\n')
            if not line:
                continue
            fields = line.split('\t')
            if len(fields) < 5:
                continue
            cwd = os.path.abspath(os.path.expanduser(fields[4] or home))
            try:
                rel = os.path.relpath(cwd, root)
            except ValueError:
                continue
            if rel in ('', os.curdir) or rel == os.pardir or rel.startswith(os.pardir + os.sep):
                continue
            project = rel.split(os.sep, 1)[0]
            if project not in projects:
                continue
            print(project + '\t' + line)
except OSError:
    pass
PY
  rm -f "$sessions_tmp"
}

saved_session_filter() {
  local agent=$1
  local explicit_agent=$2
  local saved_agent=$3
  if (( explicit_agent )) && [[ "$agent" == "pi" || "$agent" == "codex" ]]; then
    printf '%s\n' "$agent"
  else
    printf '%s\n' "$saved_agent"
  fi
}

saved_session_age() {
  local modified_ms=$1
  local now seconds
  now=$(date +%s)
  seconds=$((now - modified_ms / 1000))
  (( seconds < 0 )) && seconds=0
  if (( seconds < 3600 )); then printf '%sm' "$((seconds / 60))"
  elif (( seconds < 86400 )); then printf '%sh' "$((seconds / 3600))"
  elif (( seconds < 2592000 )); then printf '%sd' "$((seconds / 86400))"
  else printf '%smo' "$((seconds / 2592000))"
  fi
}

one_line() {
  local text=${1-}
  text=${text//$'\t'/ }
  text=${text//$'\r'/ }
  text=${text//$'\n'/ }
  printf '%s' "$text"
}

clip_end() {
  local text max
  text=$(one_line "${1-}")
  max=${2:-80}
  (( max <= 0 )) && return 0
  if (( ${#text} <= max )); then
    printf '%s' "$text"
  elif (( max == 1 )); then
    printf '…'
  else
    printf '%s…' "${text:0:max-1}"
  fi
}

clip_start() {
  local text max
  text=$(one_line "${1-}")
  max=${2:-80}
  (( max <= 0 )) && return 0
  if (( ${#text} <= max )); then
    printf '%s' "$text"
  elif (( max == 1 )); then
    printf '…'
  else
    printf '…%s' "${text: -$((max - 1))}"
  fi
}

terminal_columns() {
  local cols=${COLUMNS:-}
  if [[ ! "$cols" =~ ^[0-9]+$ ]]; then
    cols=$(tput cols 2>/dev/null || printf '80')
  fi
  [[ "$cols" =~ ^[0-9]+$ ]] || cols=80
  (( cols < 20 )) && cols=20
  printf '%s\n' "$cols"
}

menu_label_width() {
  local cols
  cols=$(terminal_columns)
  cols=$((cols - 4))
  (( cols < 40 )) && cols=40
  printf '%s\n' "$cols"
}

fit_line() {
  clip_end "${1-}" "${2:-80}"
}

saved_session_label() {
  local agent=$1 modified=$2 sid=$3 _path=$4 cwd=$5 title=$6 _model=$7 max_width=${8:-112}
  local age short cwd_short prefix suffix available cwd_width title_width title_short cwd_render rendered
  (( max_width < 40 )) && max_width=40
  age=$(saved_session_age "$modified")
  short=${sid:0:12}
  if [[ "$cwd" == "$HOME" ]]; then
    cwd_short='~'
  elif [[ "$cwd" == "$HOME/"* ]]; then
    cwd_short="~/${cwd#"$HOME/"}"
  else
    cwd_short=$cwd
  fi
  prefix=$(printf '%-5s %5s  ' "$agent" "$age")
  suffix="  $short"
  available=$((max_width - ${#prefix} - ${#suffix} - 2))

  if (( available < 34 )); then
    title_width=$((max_width - ${#prefix} - ${#suffix}))
    (( title_width < 8 )) && title_width=8
    title_short=$(clip_end "$title" "$title_width")
    fit_line "${prefix}${title_short}${suffix}" "$max_width"
    return 0
  fi

  cwd_width=$((available / 3))
  (( cwd_width < 14 )) && cwd_width=14
  (( cwd_width > 34 )) && cwd_width=34
  title_width=$((available - cwd_width - 2))
  if (( title_width < 18 )); then
    title_width=18
    cwd_width=$((available - title_width - 2))
    (( cwd_width < 8 )) && cwd_width=8
  fi

  title_short=$(clip_end "$title" "$title_width")
  cwd_render=$(clip_start "$cwd_short" "$cwd_width")
  rendered=$(printf '%s%-*s  %-*s%s' "$prefix" "$title_width" "$title_short" "$cwd_width" "$cwd_render" "$suffix")
  fit_line "$rendered" "$max_width"
}

print_saved_sessions() {
  local index=1 row agent modified sid path_field cwd title model created count
  while IFS=$'\t' read -r agent modified sid path_field cwd title model created count; do
    [[ -n "$agent" ]] || continue
    printf '%03d  ' "$index"
    saved_session_label "$agent" "$modified" "$sid" "$path_field" "$cwd" "$title" "$model"
    printf '\n'
    index=$((index + 1))
  done
}

resolve_saved_agent_command() {
  local agent=$1
  local explicit_command=$2
  if [[ -n "$explicit_command" ]]; then
    printf '%s\n' "$explicit_command"
    return 0
  fi
  # Saved-session resumes need the selected agent's resume/session subcommand;
  # launch_command is intentionally only used for generic project launches.
  case "$agent" in
    pi) printf '%s\n' "${PI_REMOTE_PI_BIN:-$(config_get pi_command "pi")}" ;;
    codex) printf '%s\n' "${PI_REMOTE_CODEX_BIN:-$(config_get codex_command "codex")}" ;;
    *) fail "saved sessions only support pi and codex" ;;
  esac
}

saved_tmux_session_name() {
  local agent=$1
  local sid=$2
  sanitize_name "pi-remote-$agent-$sid" | cut -c1-48
}

attach_saved_session_row() {
  local row=$1
  local explicit_command=$2
  local session_name_override=$3
  local no_attach=$4
  local dry_run=$5
  shift 5
  local agent_args=("$@")
  local agent modified sid path_field cwd title model created count
  IFS=$'\t' read -r agent modified sid path_field cwd title model created count <<<"$row"
  local launch_base agent_command tmux_session
  if [[ -n "$session_name_override" ]]; then
    tmux_session=$(sanitize_name "$session_name_override") || fail "empty tmux session name"
  else
    tmux_session=$(saved_tmux_session_name "$agent" "$sid")
  fi

  if session_exists "$tmux_session"; then
    if (( no_attach || dry_run )); then
      printf 'tmux session already exists: %s\n' "$tmux_session"
      printf 'attach with: %s\n' "$(attach_command "$tmux_session")"
      exit 0
    fi
    exec tmux attach -t "$tmux_session"
  fi

  launch_base=$(resolve_saved_agent_command "$agent" "$explicit_command")
  check_launch_command_exists "$launch_base"
  case "$agent" in
    pi) agent_command="$launch_base --session $(shell_quote "$path_field")" ;;
    codex) agent_command="$launch_base resume $(shell_quote "$sid")" ;;
  esac
  if [[ ${agent_args+x} ]]; then
    agent_command+=" $(shell_join "${agent_args[@]}")"
  fi

  if (( dry_run )); then
    printf 'host=%s\n' "$(hostname)"
    printf 'saved_session=%s\n' "$path_field"
    printf 'cwd=%s\n' "$cwd"
    printf 'tmux_session=%s\n' "$tmux_session"
    printf 'agent=%s\n' "$agent"
    printf 'attach=%s\n' "$([[ $no_attach -eq 1 ]] && printf no || printf yes)"
    printf 'command=%s\n' "$agent_command"
    exit 0
  fi

  if (( no_attach )); then
    tmux new-session -d -s "$tmux_session" -c "$cwd" "$agent_command"
    printf 'started detached tmux session: %s\n' "$tmux_session"
    printf 'cwd: %s\n' "$cwd"
    printf 'agent: %s\n' "$agent"
    printf 'attach with: %s\n' "$(attach_command "$tmux_session")"
    exit 0
  fi

  exec tmux new-session -s "$tmux_session" -c "$cwd" "$agent_command"
}

run_saved_sessions() {
  local filter=$1
  local limit=$2
  local explicit_command=$3
  local session_name_override=$4
  local no_attach=$5
  local dry_run=$6
  local do_list=$7
  shift 7
  local agent_args=("$@")
  local rows=()
  local scan_row
  while IFS= read -r scan_row; do
    [[ -n "$scan_row" ]] || continue
    rows+=("$scan_row")
  done < <(list_saved_sessions "$filter" "$limit" | sort -t $'\t' -k2,2nr | head -n "$limit")
  if (( do_list )); then
    if (( ${#rows[@]} > 0 )); then
      printf '%s\n' "${rows[@]}" | print_saved_sessions
    fi
    exit 0
  fi
  (( ${#rows[@]} > 0 )) || fail "no saved sessions found for agent filter '$filter'"
  [[ -r /dev/tty ]] || fail "interactive saved-session menu needs a TTY; pass --list for non-interactive use"
  local labels=() row agent modified sid path_field cwd title model created count label_width
  label_width=$(menu_label_width)
  for row in "${rows[@]}"; do
    IFS=$'\t' read -r agent modified sid path_field cwd title model created count <<<"$row"
    labels+=("$(saved_session_label "$agent" "$modified" "$sid" "$path_field" "$cwd" "$title" "$model" "$label_width")")
  done
  local choice
  choice=$(arrow_select "Saved Pi/Codex sessions on $(hostname) (↑/↓ or j/k, Enter)" "${labels[@]}") || exit 0
  if [[ ${agent_args+x} ]]; then
    attach_saved_session_row "${rows[$choice]}" "$explicit_command" "$session_name_override" "$no_attach" "$dry_run" "${agent_args[@]}"
  else
    attach_saved_session_row "${rows[$choice]}" "$explicit_command" "$session_name_override" "$no_attach" "$dry_run"
  fi
}

render_arrow_menu() {
  local prompt=$1
  local selected=$2
  local offset=$3
  local visible=$4
  shift 4
  local items=("$@")
  local count=${#items[@]}
  local row index label cols line_width label_width status

  cols=$(terminal_columns)
  line_width=$((cols - 1))
  label_width=$((cols - 3))
  (( line_width < 1 )) && line_width=1
  (( label_width < 1 )) && label_width=1

  printf '\r\033[K%s\n' "$(fit_line "$prompt" "$line_width")" >/dev/tty
  for ((row = 0; row < visible; row += 1)); do
    index=$((offset + row))
    if (( index < count )); then
      label=$(fit_line "${items[$index]}" "$label_width")
      if (( index == selected )); then
        printf '\033[K\033[7m› %s\033[0m\n' "$label" >/dev/tty
      else
        printf '\033[K  %s\n' "$label" >/dev/tty
      fi
    else
      printf '\033[K\n' >/dev/tty
    fi
  done
  status=$(printf '[%d/%d] ↑/↓ or j/k, Enter' "$((selected + 1))" "$count")
  printf '\033[K%s\n' "$(fit_line "$status" "$line_width")" >/dev/tty
}

arrow_select() {
  local prompt=$1
  shift
  local items=("$@")
  local count=${#items[@]}
  local selected=0
  local offset=0
  local terminal_rows visible lines
  local key rest old_stty redraw

  (( count > 0 )) || return 1
  [[ -r /dev/tty ]] || return 1

  terminal_rows=$(tput lines 2>/dev/null || printf '24')
  [[ "$terminal_rows" =~ ^[0-9]+$ ]] || terminal_rows=24
  visible=$((terminal_rows - 4))
  (( visible < 5 )) && visible=5
  (( visible > 20 )) && visible=20
  (( visible > count )) && visible=$count
  lines=$((visible + 2))

  old_stty=$(stty -g < /dev/tty)
  stty -echo -icanon min 1 time 0 < /dev/tty
  printf '\033[?25l' >/dev/tty
  render_arrow_menu "$prompt" "$selected" "$offset" "$visible" "${items[@]}"

  while IFS= read -rsn1 key < /dev/tty; do
    redraw=0
    case "$key" in
      $'\x1b')
        rest=""
        IFS= read -rsn2 rest < /dev/tty || true
        case "$rest" in
          '[A'|'OA') selected=$((selected - 1)); redraw=1 ;;
          '[B'|'OB') selected=$((selected + 1)); redraw=1 ;;
        esac
        ;;
      k|K) selected=$((selected - 1)); redraw=1 ;;
      j|J) selected=$((selected + 1)); redraw=1 ;;
      q|Q)
        stty "$old_stty" < /dev/tty
        printf '\033[?25h\n' >/dev/tty
        return 1
        ;;
      ""|$'\n'|$'\r')
        break
        ;;
    esac

    if (( redraw )); then
      if (( selected < 0 )); then
        selected=$((count - 1))
      elif (( selected >= count )); then
        selected=0
      fi
      if (( selected < offset )); then
        offset=$selected
      elif (( selected >= offset + visible )); then
        offset=$((selected - visible + 1))
      fi
      printf '\033[%dA' "$lines" >/dev/tty
      render_arrow_menu "$prompt" "$selected" "$offset" "$visible" "${items[@]}"
    fi
  done

  stty "$old_stty" < /dev/tty
  printf '\033[?25h\n' >/dev/tty
  printf '%s\n' "$selected"
}

project_dir_from_arg() {
  local root=$1
  local project=$2
  if [[ "$project" == /* ]]; then
    printf '%s\n' "$project"
  else
    printf '%s/%s\n' "$root" "$project"
  fi
}

list_project_sessions() {
  local project_dir=$1 normalized prefix
  command -v tmux >/dev/null 2>&1 || return 0
  normalized=$(without_trailing_slashes "$project_dir")
  prefix=$(child_path_prefix "$project_dir")
  { tmux list-panes -a -F '#{session_name}	#{pane_current_path}	#{pane_current_command}' 2>/dev/null || true; } |
    awk -F '\t' -v project="$normalized" -v prefix="$prefix" '
      $2 == project || index($2, prefix) == 1 { if (!seen[$1]++) print $1 }
    ' | sort
}

MENU_TYPES=()
MENU_PROJECTS=()
MENU_SESSIONS=()
MENU_SAVED_ROWS=()
MENU_LABELS=()
MENU_EXPANDABLE=()
MENU_EXPANDED=()
PROJECT_MENU_ACTIVE_TREE_FILE=""
PROJECT_MENU_ACTIVE_SUMMARY_FILE=""
PROJECT_MENU_SAVED_TREE_FILE=""
PROJECT_MENU_SAVED_SUMMARY_FILE=""
PROJECT_MENU_PROJECT_ROWS_FILE=""

expanded_contains() {
  local expanded=$1
  local project=$2
  [[ "$expanded" == *"|$project|"* ]]
}

project_session_summary() {
  local active_count=$1
  local saved_count=$2
  if (( active_count > 0 && saved_count > 0 )); then
    printf '%s active, %s saved' "$active_count" "$saved_count"
  elif (( active_count > 0 )); then
    printf '%s active' "$active_count"
  elif (( saved_count > 0 )); then
    printf '%s saved' "$saved_count"
  else
    printf '0'
  fi
}

cleanup_project_tree_snapshot() {
  [[ -n "$PROJECT_MENU_ACTIVE_TREE_FILE" ]] && rm -f "$PROJECT_MENU_ACTIVE_TREE_FILE"
  [[ -n "$PROJECT_MENU_ACTIVE_SUMMARY_FILE" ]] && rm -f "$PROJECT_MENU_ACTIVE_SUMMARY_FILE"
  [[ -n "$PROJECT_MENU_SAVED_TREE_FILE" ]] && rm -f "$PROJECT_MENU_SAVED_TREE_FILE"
  [[ -n "$PROJECT_MENU_SAVED_SUMMARY_FILE" ]] && rm -f "$PROJECT_MENU_SAVED_SUMMARY_FILE"
  [[ -n "$PROJECT_MENU_PROJECT_ROWS_FILE" ]] && rm -f "$PROJECT_MENU_PROJECT_ROWS_FILE"
  PROJECT_MENU_ACTIVE_TREE_FILE=""
  PROJECT_MENU_ACTIVE_SUMMARY_FILE=""
  PROJECT_MENU_SAVED_TREE_FILE=""
  PROJECT_MENU_SAVED_SUMMARY_FILE=""
  PROJECT_MENU_PROJECT_ROWS_FILE=""
}

build_project_tree_snapshot() {
  local root=$1
  local saved_filter=${2:-all}
  local saved_limit=${3:-120}
  cleanup_project_tree_snapshot
  PROJECT_MENU_ACTIVE_TREE_FILE=$(mktemp)
  PROJECT_MENU_ACTIVE_SUMMARY_FILE=$(mktemp)
  PROJECT_MENU_SAVED_TREE_FILE=$(mktemp)
  PROJECT_MENU_SAVED_SUMMARY_FILE=$(mktemp)
  PROJECT_MENU_PROJECT_ROWS_FILE=$(mktemp)

  project_sessions_by_project "$root" >"$PROJECT_MENU_ACTIVE_TREE_FILE"
  awk -F '\t' '{ count[$1]++ } END { for (project in count) print project "\t" count[project] }' "$PROJECT_MENU_ACTIVE_TREE_FILE" >"$PROJECT_MENU_ACTIVE_SUMMARY_FILE"

  saved_sessions_for_project_menu "$root" "$saved_filter" "$saved_limit" | sort -t $'\t' -k1,1 -k3,3nr >"$PROJECT_MENU_SAVED_TREE_FILE"
  awk -F '\t' '
    NF >= 3 {
      count[$1]++
      recent = int(($3 + 0) / 1000)
      if (recent > recents[$1]) recents[$1] = recent
    }
    END { for (project in count) print project "\t" count[project] "\t" (recents[project] + 0) }
  ' "$PROJECT_MENU_SAVED_TREE_FILE" >"$PROJECT_MENU_SAVED_SUMMARY_FILE"

  project_menu_rows "$root" "$PROJECT_MENU_SAVED_SUMMARY_FILE" "$PROJECT_MENU_ACTIVE_SUMMARY_FILE" >"$PROJECT_MENU_PROJECT_ROWS_FILE"
}

build_project_tree_rows() {
  local root=$1
  local expanded=$2
  local saved_filter=${3:-all}
  local saved_limit=${4:-120}
  local project count saved_count _recent total_count session saved_row agent modified sid path_field cwd title model created msg_count
  local saved_label_width cleanup_after=0 expandable is_expanded
  MENU_TYPES=()
  MENU_PROJECTS=()
  MENU_SESSIONS=()
  MENU_SAVED_ROWS=()
  MENU_LABELS=()
  MENU_EXPANDABLE=()
  MENU_EXPANDED=()

  if [[ -z "$PROJECT_MENU_PROJECT_ROWS_FILE" || ! -r "$PROJECT_MENU_PROJECT_ROWS_FILE" ]]; then
    build_project_tree_snapshot "$root" "$saved_filter" "$saved_limit"
    cleanup_after=1
  fi

  saved_label_width=$(menu_label_width)
  saved_label_width=$((saved_label_width - 6))
  (( saved_label_width < 36 )) && saved_label_width=36

  while IFS=$'\t' read -r project count saved_count _recent; do
    [[ -n "$project" ]] || continue
    count=${count:-0}
    saved_count=${saved_count:-0}
    total_count=$((count + saved_count))
    expandable=0
    is_expanded=0
    if (( total_count > 0 )); then
      expandable=1
      if expanded_contains "$expanded" "$project"; then
        is_expanded=1
      fi
    fi
    MENU_TYPES+=("project")
    MENU_PROJECTS+=("$project")
    MENU_SESSIONS+=("")
    MENU_SAVED_ROWS+=("")
    MENU_EXPANDABLE+=("$expandable")
    MENU_EXPANDED+=("$is_expanded")
    if (( total_count > 0 )); then
      if (( is_expanded )); then
        MENU_LABELS+=("▾ $project ($(project_session_summary "$count" "$saved_count"))")
      else
        MENU_LABELS+=("▸ $project ($(project_session_summary "$count" "$saved_count"))")
      fi
    else
      MENU_LABELS+=("  $project (0)")
    fi

    if (( is_expanded )); then
      while IFS= read -r session; do
        [[ -n "$session" ]] || continue
        MENU_TYPES+=("session")
        MENU_PROJECTS+=("$project")
        MENU_SESSIONS+=("$session")
        MENU_SAVED_ROWS+=("")
        MENU_EXPANDABLE+=("0")
        MENU_EXPANDED+=("0")
        MENU_LABELS+=("    ● $session")
      done < <(awk -F '\t' -v project="$project" '$1 == project { print $2 }' "$PROJECT_MENU_ACTIVE_TREE_FILE")

      while IFS=$'\t' read -r agent modified sid path_field cwd title model created msg_count; do
        [[ -n "$agent" ]] || continue
        saved_row=$(printf '%s\t%s\t%s\t%s\t%s\t%s\t%s\t%s\t%s' "$agent" "$modified" "$sid" "$path_field" "$cwd" "$title" "$model" "$created" "$msg_count")
        MENU_TYPES+=("saved")
        MENU_PROJECTS+=("$project")
        MENU_SESSIONS+=("")
        MENU_SAVED_ROWS+=("$saved_row")
        MENU_EXPANDABLE+=("0")
        MENU_EXPANDED+=("0")
        MENU_LABELS+=("    ◷ $(saved_session_label "$agent" "$modified" "$sid" "$path_field" "$cwd" "$title" "$model" "$saved_label_width")")
      done < <(awk -v project="$project" 'index($0, project "\t") == 1 { print substr($0, length(project) + 2) }' "$PROJECT_MENU_SAVED_TREE_FILE")
    fi
  done <"$PROJECT_MENU_PROJECT_ROWS_FILE"

  MENU_TYPES+=("create")
  MENU_PROJECTS+=("")
  MENU_SESSIONS+=("")
  MENU_SAVED_ROWS+=("")
  MENU_EXPANDABLE+=("0")
  MENU_EXPANDED+=("0")
  MENU_LABELS+=("Create a new project")
  MENU_TYPES+=("quit")
  MENU_PROJECTS+=("")
  MENU_SESSIONS+=("")
  MENU_SAVED_ROWS+=("")
  MENU_EXPANDABLE+=("0")
  MENU_EXPANDED+=("0")
  MENU_LABELS+=("Quit")

  (( cleanup_after )) && cleanup_project_tree_snapshot
}

find_project_row_index() {
  local project=$1
  local index
  for index in "${!MENU_TYPES[@]}"; do
    if [[ "${MENU_TYPES[$index]}" == "project" && "${MENU_PROJECTS[$index]}" == "$project" ]]; then
      printf '%s\n' "$index"
      return 0
    fi
  done
  printf '0\n'
}

project_tree_row_label() {
  local index=$1
  local selected=$2
  local label=${MENU_LABELS[$index]}
  local project_label trimmed
  if (( ! selected )) || [[ "${MENU_TYPES[$index]}" != "project" ]]; then
    printf '%s' "$label"
    return 0
  fi
  if (( ${MENU_EXPANDABLE[$index]:-0} )); then
    project_label=${label#▸ }
    project_label=${project_label#▾ }
    if (( ${MENU_EXPANDED[$index]:-0} )); then
      printf '▾ ← collapse · Enter=new  %s' "$project_label"
    else
      printf '▸ → expand · Enter=new  %s' "$project_label"
    fi
    return 0
  fi
  trimmed=${label# }
  trimmed=${trimmed# }
  printf 'Enter=new  %s' "$trimmed"
}

project_tree_footer() {
  local selected=$1
  local count=$2
  local position current_type
  position=$(printf '[%d/%d]' "$((selected + 1))" "$count")
  current_type=${MENU_TYPES[$selected]:-}
  if [[ "$current_type" == "project" ]]; then
    if (( ${MENU_EXPANDABLE[$selected]:-0} )); then
      printf '%s ↑/↓ move  ←/→ expand/collapse  Enter new session' "$position"
    else
      printf '%s ↑/↓ move  Enter new session' "$position"
    fi
  elif [[ "$current_type" == "session" || "$current_type" == "saved" ]]; then
    printf '%s ↑/↓ move  Enter resume  ←/→ collapse project' "$position"
  else
    printf '%s ↑/↓ move  Enter select' "$position"
  fi
}

render_project_tree_menu() {
  local prompt=$1
  local selected=$2
  local offset=$3
  local visible=$4
  local count=${#MENU_LABELS[@]}
  local row index label cols line_width label_width status

  cols=$(terminal_columns)
  line_width=$((cols - 1))
  label_width=$((cols - 3))
  (( line_width < 1 )) && line_width=1
  (( label_width < 1 )) && label_width=1

  printf '\r\033[K%s\n' "$(fit_line "$prompt" "$line_width")" >/dev/tty
  for ((row = 0; row < visible; row += 1)); do
    index=$((offset + row))
    if (( index < count )); then
      label=$(fit_line "$(project_tree_row_label "$index" "$((index == selected))")" "$label_width")
      if (( index == selected )); then
        printf '\033[K\033[7m› %s\033[0m\n' "$label" >/dev/tty
      else
        printf '\033[K  %s\n' "$label" >/dev/tty
      fi
    else
      printf '\033[K\n' >/dev/tty
    fi
  done
  status=$(project_tree_footer "$selected" "$count")
  printf '\033[K%s\n' "$(fit_line "$status" "$line_width")" >/dev/tty
}

pick_project_menu() {
  local root=$1
  local saved_filter=${2:-all}
  local saved_limit=${3:-120}
  local expanded="|"
  local selected=0
  local offset=0
  local terminal_rows visible lines count
  local key rest old_stty redraw current_type current_project current_saved new_name safe_name selected_session

  if [[ ! -r /dev/tty ]]; then
    fail "interactive project menu needs a TTY; pass --project NAME or --new NAME for non-interactive use"
  fi

  build_project_tree_snapshot "$root" "$saved_filter" "$saved_limit"
  build_project_tree_rows "$root" "$expanded" "$saved_filter" "$saved_limit"
  count=${#MENU_LABELS[@]}
  terminal_rows=$(tput lines 2>/dev/null || printf '24')
  [[ "$terminal_rows" =~ ^[0-9]+$ ]] || terminal_rows=24
  visible=$((terminal_rows - 4))
  (( visible < 5 )) && visible=5
  (( visible > 20 )) && visible=20
  lines=$((visible + 2))

  old_stty=$(stty -g < /dev/tty)
  stty -echo -icanon min 1 time 0 < /dev/tty
  printf '\033[?25l' >/dev/tty
  render_project_tree_menu "Projects on $(hostname) in $root" "$selected" "$offset" "$visible"

  while IFS= read -rsn1 key < /dev/tty; do
    redraw=0
    case "$key" in
      $'\x1b')
        rest=""
        IFS= read -rsn2 rest < /dev/tty || true
        case "$rest" in
          '[A'|'OA') selected=$((selected - 1)); redraw=1 ;;
          '[B'|'OB') selected=$((selected + 1)); redraw=1 ;;
          '[D'|'OD'|'[C'|'OC')
            current_type=${MENU_TYPES[$selected]}
            current_project=${MENU_PROJECTS[$selected]}
            if [[ "$current_type" == "project" || "$current_type" == "session" || "$current_type" == "saved" ]]; then
              if [[ -n "$current_project" && ( "$current_type" != "project" || ${MENU_EXPANDABLE[$selected]:-0} -eq 1 ) ]]; then
                if expanded_contains "$expanded" "$current_project"; then
                  expanded=${expanded//|$current_project|/|}
                else
                  expanded+="$current_project|"
                fi
                build_project_tree_rows "$root" "$expanded" "$saved_filter" "$saved_limit"
                count=${#MENU_LABELS[@]}
                selected=$(find_project_row_index "$current_project")
                redraw=1
              fi
            fi
            ;;
        esac
        ;;
      k|K) selected=$((selected - 1)); redraw=1 ;;
      j|J) selected=$((selected + 1)); redraw=1 ;;
      q|Q)
        stty "$old_stty" < /dev/tty
        printf '\033[?25h\n' >/dev/tty
        cleanup_project_tree_snapshot
        printf '__PI_REMOTE_QUIT__\t\n'
        return 0
        ;;
      ""|$'\n'|$'\r')
        current_type=${MENU_TYPES[$selected]}
        current_project=${MENU_PROJECTS[$selected]}
        selected_session=${MENU_SESSIONS[$selected]}
        current_saved=${MENU_SAVED_ROWS[$selected]}
        stty "$old_stty" < /dev/tty
        printf '\033[?25h\n' >/dev/tty
        cleanup_project_tree_snapshot
        case "$current_type" in
          project)
            printf '%s\t\n' "$current_project"
            return 0
            ;;
          session)
            printf '%s\t%s\n' "$current_project" "$selected_session"
            return 0
            ;;
          saved)
            printf '__PI_REMOTE_SAVED__\t%s\n' "$current_saved"
            return 0
            ;;
          create)
            printf 'New project name: ' >/dev/tty
            read -r new_name </dev/tty
            safe_name=$(sanitize_name "$new_name") || fail "empty project name"
            mkdir -p "$root/$safe_name"
            printf '%s\t\n' "$safe_name"
            return 0
            ;;
          quit)
            printf '__PI_REMOTE_QUIT__\t\n'
            return 0
            ;;
        esac
        ;;
    esac

    if (( redraw )); then
      if (( selected < 0 )); then
        selected=$((count - 1))
      elif (( selected >= count )); then
        selected=0
      fi
      if (( selected < offset )); then
        offset=$selected
      elif (( selected >= offset + visible )); then
        offset=$((selected - visible + 1))
      fi
      if (( offset < 0 )); then
        offset=0
      fi
      printf '\033[%dA' "$lines" >/dev/tty
      render_project_tree_menu "Projects on $(hostname) in $root" "$selected" "$offset" "$visible"
    fi
  done

  stty "$old_stty" < /dev/tty
  printf '\033[?25h\n' >/dev/tty
  cleanup_project_tree_snapshot
  exit 0
}

pick_resume_session_menu() {
  local project_dir=$1
  local sessions=()
  local items=("Start a new session")
  local session choice_index

  [[ -r /dev/tty ]] || return 1
  while IFS= read -r session; do
    [[ -n "$session" ]] || continue
    sessions+=("$session")
  done < <(list_project_sessions "$project_dir")
  (( ${#sessions[@]} > 0 )) || return 1

  for session in "${sessions[@]}"; do
    items+=("Resume $session")
  done

  choice_index=$(arrow_select "Existing tmux sessions for $project_dir (↑/↓ or j/k, Enter)" "${items[@]}") || return 1
  if (( choice_index == 0 )); then
    return 1
  fi

  printf '%s\n' "${sessions[$((choice_index - 1))]}"
  return 0
}

session_exists() {
  local session=$1
  tmux has-session -t "$session" 2>/dev/null
}

unique_session_name() {
  local base=$1
  local candidate=$base
  local suffix=2
  while session_exists "$candidate"; do
    candidate="$base-$suffix"
    suffix=$((suffix + 1))
  done
  printf '%s\n' "$candidate"
}

resolve_agent_command() {
  local agent=$1
  local explicit_command=$2
  local command_value=""

  if [[ -n "$explicit_command" ]]; then
    printf '%s\n' "$explicit_command"
    return 0
  fi

  command_value=${PI_REMOTE_LAUNCH_COMMAND:-$(config_get launch_command "")}
  if [[ -n "$command_value" ]]; then
    printf '%s\n' "$command_value"
    return 0
  fi

  case "$agent" in
    pi)
      command_value=${PI_REMOTE_PI_BIN:-$(config_get pi_command "pi")}
      ;;
    claude)
      command_value=${PI_REMOTE_CLAUDE_BIN:-$(config_get claude_command "claude")}
      ;;
    codex)
      command_value=${PI_REMOTE_CODEX_BIN:-$(config_get codex_command "codex")}
      ;;
    custom)
      fail "--agent custom requires --command or launch_command in config"
      ;;
    *)
      fail "unsupported agent '$agent' (use pi, claude, codex, or custom with --command)"
      ;;
  esac

  printf '%s\n' "$command_value"
}

check_launch_command_exists() {
  local command_value=$1
  local command_word
  read -r command_word _ <<<"$command_value"
  [[ -n "$command_word" ]] || fail "empty launch command"
  command -v "$command_word" >/dev/null 2>&1 || fail "agent executable not found on $(hostname): $command_word"
}

run_server() {
  local configured_project_root configured_agent
  configured_project_root=$(config_get project_root "")
  configured_agent=$(config_get agent "")

  local project_root=${PI_REMOTE_PROJECT_ROOT:-${configured_project_root:-$HOME/projects}}
  local project_name=""
  local new_name=""
  local session_name=""
  local explicit_session=0
  local no_attach=0
  local dry_run=0
  local do_list=0
  local configure_tmux=0
  local skip_tmux_config=0
  local sessions_project=""
  local saved_sessions=0
  local saved_session_limit=120
  local saved_agent="all"
  local selected_session=""
  local project_was_interactive=0
  local agent=${PI_REMOTE_AGENT:-${configured_agent:-pi}}
  local explicit_agent=0
  local explicit_command=""
  local agent_args=()
  local arg

  while (($#)); do
    arg=$1
    shift
    case "$arg" in
      --server) ;;
      --help|-h) usage; exit 0 ;;
      --version) printf '%s\n' "$VERSION"; exit 0 ;;
      --project)
        (($#)) || fail "--project requires a name"
        project_name=$1
        shift
        ;;
      --project=*) project_name=${arg#--project=} ;;
      --new)
        (($#)) || fail "--new requires a name"
        new_name=$1
        shift
        ;;
      --new=*) new_name=${arg#--new=} ;;
      --session)
        (($#)) || fail "--session requires a name"
        session_name=$1
        explicit_session=1
        shift
        ;;
      --session=*) session_name=${arg#--session=}; explicit_session=1 ;;
      --agent)
        (($#)) || fail "--agent requires a value"
        agent=$1
        explicit_agent=1
        shift
        ;;
      --agent=*) agent=${arg#--agent=}; explicit_agent=1 ;;
      --saved-agent)
        (($#)) || fail "--saved-agent requires all, pi, or codex"
        saved_agent=$1
        shift
        ;;
      --saved-agent=*) saved_agent=${arg#--saved-agent=} ;;
      --saved-session-limit)
        (($#)) || fail "--saved-session-limit requires a number"
        saved_session_limit=$1
        shift
        ;;
      --saved-session-limit=*) saved_session_limit=${arg#--saved-session-limit=} ;;
      --saved-sessions|--kittylitter) saved_sessions=1 ;;
      --command)
        (($#)) || fail "--command requires a shell command"
        explicit_command=$1
        shift
        ;;
      --command=*) explicit_command=${arg#--command=} ;;
      --project-root)
        (($#)) || fail "--project-root requires a path"
        project_root=$1
        shift
        ;;
      --project-root=*) project_root=${arg#--project-root=} ;;
      --pi-bin)
        (($#)) || fail "--pi-bin requires a path"
        explicit_command=$1
        agent=pi
        explicit_agent=1
        shift
        ;;
      --pi-bin=*) explicit_command=${arg#--pi-bin=}; agent=pi; explicit_agent=1 ;;
      --no-attach) no_attach=1 ;;
      --dry-run) dry_run=1 ;;
      --configure-tmux) configure_tmux=1 ;;
      --skip-tmux-config) skip_tmux_config=1 ;;
      --list) do_list=1 ;;
      --sessions)
        (($#)) || fail "--sessions requires a project name or path"
        sessions_project=$1
        shift
        ;;
      --sessions=*) sessions_project=${arg#--sessions=} ;;
      --)
        agent_args+=("$@")
        break
        ;;
      --*) fail "unknown option for server mode: $arg" ;;
      *) agent_args+=("$arg") ;;
    esac
  done

  project_root=$(expand_home_path "$project_root")
  export PATH="$HOME/.local/npm-global/bin:$HOME/.npm-global/bin:$HOME/.local/bin:$PATH"

  if (( saved_sessions )); then
    [[ "$saved_agent" == "all" || "$saved_agent" == "pi" || "$saved_agent" == "codex" ]] || fail "--saved-agent must be all, pi, or codex"
    [[ "$saved_session_limit" =~ ^[0-9]+$ ]] && (( saved_session_limit > 0 )) || fail "--saved-session-limit must be a positive integer"
    local saved_filter
    saved_filter=$(saved_session_filter "$agent" "$explicit_agent" "$saved_agent")
    if (( do_list == 0 )); then
      command -v tmux >/dev/null 2>&1 || fail "tmux is not installed on $(hostname)"
    fi
    if [[ ${agent_args+x} ]]; then
      run_saved_sessions "$saved_filter" "$saved_session_limit" "$explicit_command" "$session_name" "$no_attach" "$dry_run" "$do_list" "${agent_args[@]}"
    else
      run_saved_sessions "$saved_filter" "$saved_session_limit" "$explicit_command" "$session_name" "$no_attach" "$dry_run" "$do_list"
    fi
    exit 0
  fi

  if (( do_list )); then
    list_projects "$project_root"
    exit 0
  fi

  command -v tmux >/dev/null 2>&1 || fail "tmux is not installed on $(hostname)"

  if (( configure_tmux )); then
    prompt_remote_tmux_config 1
    exit 0
  fi

  if (( skip_tmux_config == 0 && do_list == 0 && no_attach == 0 && dry_run == 0 )) && [[ -z "$sessions_project" ]]; then
    prompt_remote_tmux_config 0
  fi

  if [[ -n "$sessions_project" ]]; then
    local sessions_dir
    sessions_dir=$(project_dir_from_arg "$project_root" "$sessions_project")
    list_project_sessions "$sessions_dir"
    exit 0
  fi

  if [[ -n "$new_name" ]]; then
    project_name=$(sanitize_name "$new_name") || fail "empty project name"
    mkdir -p "$project_root/$project_name"
  elif [[ -n "$project_name" ]]; then
    validate_existing_name "$project_name" || fail "project names must be simple folder names under $project_root"
    [[ -d "$project_root/$project_name" ]] || fail "project does not exist: $project_root/$project_name (use --new $project_name to create it)"
  else
    local project_selection menu_saved_filter
    menu_saved_filter=$(saved_session_filter "$agent" "$explicit_agent" "$saved_agent")
    project_selection=$(pick_project_menu "$project_root" "$menu_saved_filter" "$saved_session_limit")
    project_name=${project_selection%%$'	'*}
    selected_session=${project_selection#*$'	'}
    if [[ "$selected_session" == "$project_selection" ]]; then
      selected_session=""
    fi
    if [[ "$project_name" == "__PI_REMOTE_QUIT__" ]]; then
      exit 0
    fi
    if [[ "$project_name" == "__PI_REMOTE_SAVED__" ]]; then
      if [[ ${agent_args+x} ]]; then
        attach_saved_session_row "$selected_session" "$explicit_command" "$session_name" "$no_attach" "$dry_run" "${agent_args[@]}"
      else
        attach_saved_session_row "$selected_session" "$explicit_command" "$session_name" "$no_attach" "$dry_run"
      fi
      exit 0
    fi
    project_was_interactive=1
  fi

  validate_existing_name "$project_name" || fail "project names must be simple folder names under $project_root"
  local project_dir="$project_root/$project_name"
  [[ -d "$project_dir" ]] || fail "project directory was not created: $project_dir"

  if [[ -n "$selected_session" ]]; then
    session_name=$selected_session
    explicit_session=1
  elif (( project_was_interactive == 0 && explicit_session == 0 && no_attach == 0 && dry_run == 0 )); then
    local resume_session=""
    if resume_session=$(pick_resume_session_menu "$project_dir"); then
      session_name=$resume_session
      explicit_session=1
    fi
  fi

  if [[ -z "$session_name" ]]; then
    local safe_session
    safe_session=$(sanitize_name "$project_name") || safe_session=project
    session_name="pi-remote-$safe_session"
  fi
  session_name=$(sanitize_name "$session_name") || fail "empty tmux session name"

  local launch_base
  launch_base=$(resolve_agent_command "$agent" "$explicit_command")
  check_launch_command_exists "$launch_base"

  local agent_command
  agent_command="$launch_base"
  if [[ ${agent_args+x} ]]; then
    agent_command+=" $(shell_join "${agent_args[@]}")"
  fi

  if (( explicit_session == 0 )) && (( no_attach == 0 )) && (( dry_run == 0 )); then
    session_name=$(unique_session_name "$session_name")
  fi

  if (( dry_run )); then
    printf 'host=%s\n' "$(hostname)"
    printf 'project_root=%s\n' "$project_root"
    printf 'project_dir=%s\n' "$project_dir"
    printf 'tmux_session=%s\n' "$session_name"
    printf 'selected_session=%s\n' "$selected_session"
    printf 'agent=%s\n' "$agent"
    printf 'attach=%s\n' "$([[ $no_attach -eq 1 ]] && printf no || printf yes)"
    printf 'command=%s\n' "$agent_command"
    exit 0
  fi

  record_recent_project "$project_root" "$project_name"

  if session_exists "$session_name"; then
    if (( no_attach )); then
      printf 'tmux session already exists: %s\n' "$session_name"
      printf 'attach with: %s\n' "$(attach_command "$session_name")"
      exit 0
    fi
    exec tmux attach -t "$session_name"
  fi

  if (( no_attach )); then
    tmux new-session -d -s "$session_name" -c "$project_dir" "$agent_command"
    printf 'started detached tmux session: %s\n' "$session_name"
    printf 'project: %s\n' "$project_dir"
    printf 'agent: %s\n' "$agent"
    printf 'attach with: %s\n' "$(attach_command "$session_name")"
    exit 0
  fi

  exec tmux new-session -s "$session_name" -c "$project_dir" "$agent_command"
}

install_remote() {
  local host=$1
  local target_dir='projects/pi-remote'
  local tmp_name="pi-remote.sh.$$"
  ssh -o BatchMode=yes "$host" "mkdir -p \"\$HOME/$target_dir\" \"\$HOME/.local/bin\" \"\$HOME/.config/pi-remote\""
  scp -q "$0" "$host:$tmp_name"
  ssh -o BatchMode=yes "$host" bash -s -- "$target_dir" "$tmp_name" <<'REMOTE_PI_REMOTE_INSTALL'
set -e
remote_target_dir=$1
remote_tmp_name=$2
install -m 0755 "$HOME/$remote_tmp_name" "$HOME/$remote_target_dir/pi-remote.sh"
install -m 0755 "$HOME/$remote_tmp_name" "$HOME/$remote_target_dir/pi-remote"
ln -sf "$HOME/$remote_target_dir/pi-remote.sh" "$HOME/.local/bin/pi-remote.sh"
ln -sf "$HOME/$remote_target_dir/pi-remote" "$HOME/.local/bin/pi-remote"
rm -f "$HOME/$remote_tmp_name"
if [ ! -f "$HOME/.config/pi-remote/config" ]; then
  printf '%s\n' 'project_root=~/projects' 'agent=pi' 'pi_command=pi' 'claude_command=claude' 'codex_command=codex' > "$HOME/.config/pi-remote/config"
fi
REMOTE_PI_REMOTE_INSTALL
  printf 'installed remote Bash helper on %s: ~/%s/pi-remote.sh\n' "$host" "$target_dir"
}

write_local_config() {
  local host=$1
  local file
  file=$(config_file)
  mkdir -p "$(dirname "$file")"
  if [[ -f "$file" ]]; then
    printf 'config already exists: %s\n' "$file"
    return 0
  fi
  cat >"$file" <<EOF
host=$host
project_root=~/projects
agent=pi
pi_command=pi
claude_command=claude
codex_command=codex
EOF
  printf 'wrote config: %s\n' "$file"
}

run_local() {
  local config_host
  config_host=$(config_get host "")
  local host=${PI_REMOTE_HOST:-${config_host:-$DEFAULT_HOST}}
  local install=0
  local init_config=0
  local server_args=()
  local needs_tty=1
  local no_attach=0
  local do_list=0
  local dry_run=0
  local configure_tmux=0
  local has_project=0
  local has_new=0
  local do_sessions=0
  local do_saved_sessions=0
  local arg

  while (($#)); do
    arg=$1
    shift
    case "$arg" in
      --help|-h) usage; exit 0 ;;
      --version) printf '%s\n' "$VERSION"; exit 0 ;;
      --host)
        (($#)) || fail "--host requires a value"
        host=$1
        shift
        ;;
      --host=*) host=${arg#--host=} ;;
      --install-remote) install=1 ;;
      --init-config) init_config=1 ;;
      --project|--project=*)
        has_project=1
        server_args+=("$arg")
        if [[ "$arg" == "--project" ]]; then
          (($#)) || fail "--project requires a name"
          server_args+=("$1")
          shift
        fi
        ;;
      --new|--new=*)
        has_new=1
        server_args+=("$arg")
        if [[ "$arg" == "--new" ]]; then
          (($#)) || fail "--new requires a name"
          server_args+=("$1")
          shift
        fi
        ;;
      --sessions)
        do_sessions=1
        server_args+=("$arg")
        (($#)) || fail "--sessions requires a project name"
        server_args+=("$1")
        shift
        ;;
      --sessions=*) do_sessions=1; server_args+=("$arg") ;;
      --saved-sessions|--kittylitter) do_saved_sessions=1; server_args+=("$arg") ;;
      --saved-agent|--saved-session-limit)
        server_args+=("$arg")
        (($#)) || fail "$arg requires a value"
        server_args+=("$1")
        shift
        ;;
      --saved-agent=*|--saved-session-limit=*) server_args+=("$arg") ;;
      --no-attach) no_attach=1; server_args+=("$arg") ;;
      --list) do_list=1; server_args+=("$arg") ;;
      --configure-tmux) configure_tmux=1; server_args+=("$arg") ;;
      --skip-tmux-config) server_args+=("$arg") ;;
      --dry-run) dry_run=1; server_args+=("$arg") ;;
      --)
        server_args+=("--" "$@")
        break
        ;;
      *) server_args+=("$arg") ;;
    esac
  done

  if (( init_config )); then
    write_local_config "$host"
    exit 0
  fi

  if (( install )); then
    install_remote "$host"
    exit 0
  fi

  if (( do_list || do_sessions )); then
    needs_tty=0
  elif (( configure_tmux )); then
    needs_tty=1
  elif (( no_attach )) && (( has_project || has_new )); then
    needs_tty=0
  elif (( dry_run )) && (( has_project || has_new )); then
    needs_tty=0
  else
    needs_tty=1
  fi

  if (( needs_tty )) && [[ ! -t 0 ]]; then
    fail "this mode needs a TTY for the menu/tmux attach; use --project/--new with --no-attach from automation"
  fi

  if is_local_host "$host"; then
    PI_REMOTE_HOST=$host run_server --server "${server_args[@]}"
    exit 0
  fi

  local quoted_args=""
  local item
  if (( ${#server_args[@]} > 0 )); then
    for item in "${server_args[@]}"; do
      quoted_args+=" $(shell_quote "$item")"
    done
  fi

  local quoted_host
  quoted_host=$(shell_quote "$host")
  local remote_cmd
  remote_cmd="remote_helper=$REMOTE_PROJECT_PATH; if [[ ! -x \$remote_helper ]]; then remote_helper=$REMOTE_LEGACY_PROJECT_PATH; fi; if [[ ! -x \$remote_helper ]]; then printf 'pi-remote is not installed on the remote host at %s or %s\\n' $REMOTE_PROJECT_PATH $REMOTE_LEGACY_PROJECT_PATH >&2; exit 127; fi; export PI_REMOTE_HOST=$quoted_host; exec \$remote_helper --server$quoted_args"
  local remote_cmd_quoted
  remote_cmd_quoted=$(shell_quote "$remote_cmd")

  local ssh_opts=(-o BatchMode=yes)
  if (( needs_tty )); then
    ssh_opts+=(-tt)
  else
    ssh_opts+=(-T)
  fi

  exec ssh "${ssh_opts[@]}" "$host" "bash -lc $remote_cmd_quoted"
}

if [[ ${1-} == "--server" ]]; then
  run_server "$@"
else
  run_local "$@"
fi
