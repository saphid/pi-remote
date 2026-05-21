# pi-remote

A deliberately tiny launcher for running a coding-agent CLI on LXS01.

Default flow:

1. SSH from the MacBook into LXS01 (`LXS01`/`lxs01` alias the existing `lxso1` SSH config).
2. Show folders in `~/projects` as a menu, or create a new folder there.
3. After a project is selected, show existing tmux sessions whose panes are already in that project so one can be resumed.
4. Otherwise create a tmux session named `pi-remote-<project>` and start the selected agent.

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
pi-remote --list
pi-remote --sessions pi-remote
```

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
