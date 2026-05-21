# pi-remote

`pi-remote` is a small Bash launcher for remote coding-agent sessions. It SSHes to a configured host, lets you pick or create a project under a remote project root, and starts or resumes a `tmux` session running your chosen agent CLI.

It is intentionally dependency-light: local OpenSSH, remote Bash, remote `tmux`, and whichever agent command you want to run (`pi`, `claude`, `codex`, or a custom command).

## Install

Put the script on your local `PATH`:

```bash
install -m 0755 pi-remote ~/.local/bin/pi-remote
```

Create a local config for your SSH host:

```bash
pi-remote --init-config --host my-remote
```

Install or update the helper copy on the remote host:

```bash
pi-remote --install-remote
```

The remote helper is installed at `~/projects/pi-remote/pi-remote` and linked to `~/.local/bin/pi-remote` on the remote host.

## Usage

```bash
pi-remote
pi-remote --project my-project
pi-remote --new my-project
pi-remote --agent claude --project my-project
pi-remote --agent codex --project my-project
pi-remote --project my-project --session review-agent --no-attach -- "Review this project"
pi-remote --configure-tmux
pi-remote --list
pi-remote --sessions my-project
```

With no switches, `pi-remote` opens an interactive menu. Use ↑/↓ or `j`/`k` to move, ←/→ to expand or collapse a project's current `tmux` sessions, and Enter to choose a project or session.

Use `--no-attach` from non-interactive automation. It starts the `tmux` session detached and prints an attach command.

## Config

`~/.config/pi-remote/config` accepts simple `key=value` lines:

```ini
host=my-remote
project_root=~/projects
agent=pi
pi_command=pi
claude_command=claude
codex_command=codex
# launch_command=pi --some-default-flag
```

`launch_command` or `--command` overrides the agent command lookup.

Useful environment variables:

```text
PI_REMOTE_HOST             Default SSH host.
PI_REMOTE_CONFIG           Local config path.
PI_REMOTE_PROJECT_ROOT     Remote project root for server mode.
PI_REMOTE_AGENT            Default agent for server mode.
PI_REMOTE_LAUNCH_COMMAND   Custom launch command for server mode.
PI_REMOTE_PI_BIN           Pi executable for server mode.
PI_REMOTE_CLAUDE_BIN       Claude executable for server mode.
PI_REMOTE_CODEX_BIN        Codex executable for server mode.
PI_REMOTE_TMUX_CONFIG      Remote tmux config path (default: ~/.tmux.conf).
PI_REMOTE_TMUX_CONFIG_SOURCE Set to 0 to write/validate tmux config without sourcing it.
```

## Tmux config helper

On interactive startup, `pi-remote` checks whether the remote `~/.tmux.conf` has the recommended extended-key and bottom-bar help settings. If they are missing, it asks before appending or updating a small managed block. Existing tmux config outside that block is preserved.

The bottom-bar hint is generated from the actual tmux prefix and bindings, for example:

```text
help Ctrl+B?  detach Ctrl+B d  quit Ctrl+B x
```

Use `pi-remote --configure-tmux` to force the check, or `--skip-tmux-config` to skip it for a run.
