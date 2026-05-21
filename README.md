# pi-remote

A deliberately tiny launcher for running a coding-agent CLI on LXS01.

Default flow:

1. SSH from the MacBook into LXS01 (`LXS01`/`lxs01` alias the existing `lxso1` SSH config).
2. Show folders in `~/projects` as an arrow-key menu, sorted by recent use, then active tmux session count, then name.
3. Show a session count beside every project, e.g. `pi-remote (2)`.
4. Press `←` or `→` on a project to expand/collapse its current tmux sessions inline.
5. Press Enter on a session row to resume it, or Enter on a project row to start a new session.

The default agent is `pi`, but `claude` and `codex` are supported too.

## Install locations

- Source on LXS01: `~/projects/pi-remote/pi-remote`
- Remote convenience symlink: `~/.local/bin/pi-remote`
- MacBook install: `~/.local/bin/pi-remote`
- Local config: `~/.config/pi-remote/config`

## Usage

```bash
pi-remote
pi-remote --project pi-remote
pi-remote --new my-project
pi-remote --agent claude --project my-project
pi-remote --agent codex --project my-project
pi-remote --project pi-remote --session pi-remote-agent --no-attach -- "Review this project"
pi-remote --configure-tmux
pi-remote --list
pi-remote --sessions pi-remote
```

With no switches, `pi-remote` opens an interactive menu: use ↑/↓ (or `j`/`k`) to move, `←`/`→` to expand a project and show its tmux sessions, and Enter to choose a project or session.

On interactive startup, `pi-remote` checks whether the remote `~/.tmux.conf` has the recommended extended-key and bottom-bar help settings. If they are missing, it asks before appending/updating a small managed enhancement block; existing tmux config outside that block is preserved. The bottom-bar hint is generated from the actual tmux prefix and bindings, e.g. `help Ctrl+B?  detach Ctrl+B d  quit Ctrl+B x`. Use `pi-remote --configure-tmux` to force that check/prompt, or `--skip-tmux-config` to skip the startup check.

Use `--no-attach` from non-interactive agents/subagents. It starts the tmux session detached and prints an attach command.

## Config

`~/.config/pi-remote/config` accepts simple `key=value` lines:

```ini
host=LXS01
project_root=~/projects
agent=pi
pi_command=pi
claude_command=claude
codex_command=codex
# launch_command=pi --some-default-flag
```

`launch_command` or `--command` overrides the agent command lookup.

## Prior art checked

Existing GitHub tools overlap with pieces of this:

- `hex/claude-tmux`: Claude Code remote SSH panes in tmux.
- `any-context/lazyclaude`: Claude Code tmux TUI with SSH remote sessions.
- `cv/pi-ssh-remote` / `hjanuschka/pi-ssh`: Pi-local, tools-remote SSH workflows.
- `indigoviolet/pi-tmux`: Pi extension for project tmux sessions.
- `standardagents/dmux`, `0dragosh/cwt`, `smtg-ai/claude-squad`: broader tmux/worktree multi-agent managers.

Those are broader than needed here. This script stays dependency-light: Bash, SSH, tmux, and whichever agent CLI you choose.
