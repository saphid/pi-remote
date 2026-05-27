# pi-remote

![pi-remote banner](assets/readme-banner.png)

`pi-remote` is a small launcher for remote coding-agent sessions. It SSHes to a configured host, lets you pick or create a project under a remote project root, and starts or resumes a `tmux` session running your chosen agent CLI.

It ships with two entry points:

- `pi-remote`: the TypeScript CLI, run with Node.js.
- `pi-remote.sh`: a compatibility wrapper that delegates to the same TypeScript CLI.

There is no slower shell-menu fallback. Both entry points use local OpenSSH plus remote Bash, remote `tmux`, and whichever agent command you want to run (`pi`, `claude`, `codex`, or a custom command).

## Install

Install the TypeScript/Node CLI globally from GitHub:

```bash
npm install -g github:saphid/pi-remote
```

Or install from a local checkout while developing:

```bash
npm install
npm run build
npm link
```

Create a local config for your SSH host:

```bash
pi-remote --init-config --host my-remote
```

Install or update the helper copy on the remote host:

```bash
pi-remote --install-remote
```

The remote helper is installed at `~/projects/pi-remote/pi-remote` and linked to `~/.local/bin/pi-remote`. A `pi-remote.sh` compatibility wrapper is installed too. The remote host must have Node.js; there is no slower shell-menu fallback.

## Usage

```bash
pi-remote
pi-remote.sh
pi-remote --project my-project
pi-remote --new my-project
pi-remote --agent claude --project my-project
pi-remote --agent codex --project my-project
pi-remote --project my-project --session review-agent --no-attach -- "Review this project"
pi-remote --configure-tmux
pi-remote --update
pi-remote --saved-sessions
pi-remote --saved-sessions --agent codex
pi-remote --saved-sessions --saved-agent pi --list
pi-remote --host local --saved-sessions  # saved sessions on this machine
pi-remote --list
pi-remote --sessions my-project
```

With no switches, `pi-remote` opens an interactive project menu. Active `tmux` sessions and saved Pi/Codex sessions whose working directory is under a project are nested under that project's folder row. Use ↑/↓ to move, type to filter by project name, Backspace/Ctrl+U to edit the filter, ←/→ to expand or collapse a project, and Enter to choose a project, active session, or saved session.

`--saved-sessions` opens the same KittyLitter-style picker over persisted Pi/Codex sessions (`~/.pi/agent/sessions` and `~/.codex/sessions`) on the target host without showing projects. Selecting a saved session starts a deterministic tmux session such as `pi-remote-pi-019e...` and re-attaches that tmux session on later launches instead of starting a second agent process for the same saved session. `--kittylitter` is an alias.

Use `--no-attach` from non-interactive automation. It starts the `tmux` session detached and prints an attach command. The same options are available through `pi-remote` and `pi-remote.sh`.

Use `pi-remote --update` to fetch GitHub, report whether a newer version/commit is available, and update the current install. Git checkouts use `git pull --ff-only`; copied installs are refreshed from a fresh GitHub clone and become Git checkouts for future updates.

### Saved-session concurrency

For saved Pi/Codex sessions, `pi-remote` uses a deterministic tmux session name based on the saved session id. Opening the same saved session again re-attaches that tmux session instead of launching another agent process. This avoids two live Pi/Codex processes writing to the same JSONL rollout/session file.

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
