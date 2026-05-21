#!/usr/bin/env bun
import * as fs from 'node:fs';
import * as os from 'node:os';
import * as path from 'node:path';
import * as readline from 'node:readline';
import { spawnSync } from 'node:child_process';

const VERSION = '1.0.0';
const REMOTE_PROJECT_PATH = '"$HOME/projects/pi-remote/pi-remote.sh"';
const REMOTE_LEGACY_PROJECT_PATH = '"$HOME/projects/pi-remote/pi-remote"';
const DEFAULT_CONFIG_PATH = path.join(os.homedir(), '.config/pi-remote/config');
const DEFAULT_HOST = 'pi-remote';

type MenuType = 'project' | 'session' | 'create' | 'quit';
type MenuRow = { type: MenuType; project: string; session: string; label: string };
type ProjectRow = { project: string; count: number; recent: number };
type ServerOptions = {
  projectRoot: string;
  projectName: string;
  newName: string;
  sessionName: string;
  explicitSession: boolean;
  noAttach: boolean;
  dryRun: boolean;
  doList: boolean;
  configureTmux: boolean;
  skipTmuxConfig: boolean;
  sessionsProject: string;
  selectedSession: string;
  projectWasInteractive: boolean;
  agent: string;
  explicitCommand: string;
  agentArgs: string[];
};

type LocalOptions = {
  host: string;
  install: boolean;
  initConfig: boolean;
  serverArgs: string[];
  needsTty: boolean;
  noAttach: boolean;
  doList: boolean;
  dryRun: boolean;
  configureTmux: boolean;
  hasProject: boolean;
  hasNew: boolean;
  doSessions: boolean;
};

function usage(): void {
  process.stdout.write(`pi-remote - tiny SSH/tmux launcher for coding agents on a remote host

Usage:
  pi-remote                                SSH to the configured host, pick/create a project, attach in tmux
  pi-remote --project NAME                 Start/attach for an existing ~/projects/NAME
  pi-remote --new NAME                     Create ~/projects/NAME, then start/attach
  pi-remote --agent pi|claude|codex        Choose the remote agent command (default: pi)
  pi-remote --project NAME --no-attach [-- AGENT_ARGS...]
  pi-remote --configure-tmux              Check/update remote tmux defaults, then exit
  pi-remote --install-remote               Install/update the remote helper copy, then exit
  pi-remote --init-config --host HOST       Create a local config file, then exit
  pi-remote --list

Interactive menus use ↑/↓ or j/k, ←/→ to expand project sessions, and Enter.

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
  pi-remote --project my-project --session review-agent --no-attach -- "Review this project"
`);
}

function fail(message: string): never {
  process.stderr.write(`pi-remote: ${message}\n`);
  process.exit(1);
}

function env(name: string): string | undefined {
  const value = process.env[name];
  return value === undefined || value === '' ? undefined : value;
}

function configFile(): string {
  return env('PI_REMOTE_CONFIG') ?? DEFAULT_CONFIG_PATH;
}

function configGet(key: string, defaultValue = ''): string {
  const file = configFile();
  if (!fs.existsSync(file)) return defaultValue;
  const content = fs.readFileSync(file, 'utf8');
  let result = '';
  for (const rawLine of content.split(/\r?\n/)) {
    const line = rawLine.trim();
    if (!line || line.startsWith('#')) continue;
    const eq = rawLine.indexOf('=');
    if (eq < 0) continue;
    const k = rawLine.slice(0, eq).trim();
    if (k === key) result = rawLine.slice(eq + 1).trim();
  }
  return result || defaultValue;
}

function shellQuote(value = ''): string {
  if (/^[A-Za-z0-9_./:@%+=,-]+$/.test(value)) return value;
  return `'${value.replace(/'/g, `'\\''`)}'`;
}

function shellJoin(args: string[]): string {
  return args.map((arg) => shellQuote(arg)).join(' ');
}

function run(command: string, args: string[], options: { cwd?: string; input?: string; stdio?: 'inherit' | 'ignore' } = {}) {
  return spawnSync(command, args, {
    cwd: options.cwd,
    input: options.input,
    encoding: 'utf8',
    stdio: options.stdio ?? 'pipe',
    env: process.env,
  });
}

function runOk(command: string, args: string[], options: { cwd?: string; input?: string; stdio?: 'inherit' | 'ignore' } = {}): boolean {
  const result = run(command, args, options);
  return result.status === 0;
}

function commandOutput(command: string, args: string[], fallback = ''): string {
  const result = run(command, args);
  if (result.status !== 0) return fallback;
  return String(result.stdout ?? '').replace(/\n$/, '');
}


function sortWithSystemSort(lines: string[], args: string[] = []): string[] {
  if (!lines.length) return [];
  const result = run('sort', args, { input: `${lines.join('\n')}\n` });
  if (result.status !== 0) return [...lines].sort();
  return String(result.stdout ?? '').split(/\r?\n/).filter(Boolean);
}

function sanitizeName(raw = ''): string {
  const safe = raw.replace(/[^A-Za-z0-9._-]+/g, '-').replace(/^-+/, '').replace(/-+$/, '').replace(/-+/g, '-');
  if (!safe) throw new Error('empty name');
  return safe;
}

function validateExistingName(name = ''): boolean {
  return Boolean(name) && name !== '.' && name !== '..' && !name.includes('/');
}

function expandHomePath(value: string): string {
  if (value === '~') return os.homedir();
  if (value.startsWith('~/')) return path.join(os.homedir(), value.slice(2));
  return value;
}

function listProjects(root: string): string[] {
  fs.mkdirSync(root, { recursive: true });
  return sortWithSystemSort(fs.readdirSync(root, { withFileTypes: true })
    .filter((entry) => entry.isDirectory())
    .map((entry) => entry.name));
}

function tmuxConfigFile(): string {
  return env('PI_REMOTE_TMUX_CONFIG') ?? path.join(os.homedir(), '.tmux.conf');
}

function shouldSourceTmuxConfig(): boolean {
  const value = env('PI_REMOTE_TMUX_CONFIG_SOURCE') ?? '1';
  return !['0', 'false', 'FALSE', 'no', 'NO'].includes(value);
}

function tmuxConfigHasManagedBlock(file: string): boolean {
  if (!fs.existsSync(file)) return false;
  return /^# BEGIN pi-remote tmux (enhancements|defaults)$/m.test(fs.readFileSync(file, 'utf8'));
}

function tmuxConfigHasFeatures(file: string): boolean {
  if (!fs.existsSync(file)) return false;
  const content = fs.readFileSync(file, 'utf8');
  return content.includes('set -s extended-keys on') && content.includes('set -g xterm-keys on') && /help .*detach .*quit /.test(content);
}

function formatTmuxKey(key: string): string {
  if (key.startsWith('C-')) {
    const suffix = key.slice(2);
    return `Ctrl+${suffix.length === 1 ? suffix.toUpperCase() : suffix}`;
  }
  if (key.startsWith('M-')) {
    const suffix = key.slice(2);
    return `Alt+${suffix.length === 1 ? suffix.toUpperCase() : suffix}`;
  }
  if (key === 'Space') return 'Space';
  return key;
}

function formatTmuxChord(prefix: string, key: string): string {
  const prefixDisplay = formatTmuxKey(prefix);
  const keyDisplay = formatTmuxKey(key);
  return keyDisplay === '?' ? `${prefixDisplay}?` : `${prefixDisplay} ${keyDisplay}`;
}

function bindingKeyFor(keys: string, pattern: RegExp, fallback: string): string {
  for (const line of keys.split(/\r?\n/)) {
    const match = line.match(/^bind-key\s+-T\s+prefix\s+(\S+)\s+(.+)$/);
    if (!match) continue;
    const [, key, command] = match;
    if (pattern.test(command)) return key;
  }
  return fallback;
}

function buildTmuxHelpHint(file: string): string {
  let prefix = 'C-b';
  let keys = '';
  const homeTmux = path.join(os.homedir(), '.tmux.conf');
  if (file === homeTmux && runOk('tmux', ['show', '-gqv', 'prefix'])) {
    prefix = commandOutput('tmux', ['show', '-gqv', 'prefix'], 'C-b') || 'C-b';
    keys = commandOutput('tmux', ['list-keys', '-T', 'prefix'], '');
  } else {
    const socket = `pi-remote-hint-${process.pid}`;
    if (runOk('tmux', ['-L', socket, '-f', file, 'new-session', '-d', '-s', 'pi-remote-hint-smoke', 'sleep 1'])) {
      prefix = commandOutput('tmux', ['-L', socket, 'show', '-gqv', 'prefix'], 'C-b') || 'C-b';
      keys = commandOutput('tmux', ['-L', socket, 'list-keys', '-T', 'prefix'], '');
      run('tmux', ['-L', socket, 'kill-server'], { stdio: 'ignore' });
    }
  }
  const helpKey = bindingKeyFor(keys, /^list-keys(\s|$)/, '?');
  const detachKey = bindingKeyFor(keys, /^detach-client(\s|$)/, 'd');
  let quitKey = bindingKeyFor(keys, /^(kill-pane(\s|$)|confirm-before .*kill-pane)/, '');
  if (!quitKey) quitKey = bindingKeyFor(keys, /^(kill-window(\s|$)|confirm-before .*kill-window)/, '');
  if (!quitKey) quitKey = 'x';
  return `help ${formatTmuxChord(prefix, helpKey)}  detach ${formatTmuxChord(prefix, detachKey)}  quit ${formatTmuxChord(prefix, quitKey)}`;
}

function escapeSingleQuotes(value: string): string {
  return value.replace(/'/g, `'\\''`);
}

function renderTmuxConfigBlock(hint: string): string {
  const escapedHint = escapeSingleQuotes(hint);
  return `# BEGIN pi-remote tmux enhancements
# Managed by pi-remote. This block is appended/updated without changing the rest of your tmux config.
# It enables modern modified-key passthrough for agent TUIs and advertises tmux's help screen.
set -s extended-keys on
set -g xterm-keys on
set -g terminal-features[90] 'xterm*:extkeys'
set -g terminal-features[91] 'screen*:extkeys'
set -g terminal-features[92] 'tmux*:extkeys'
set -g status on
set -g status-format[0] '#[align=left]#{E:status-left}#[align=centre,bold]${escapedHint}#[default]#[align=right]#{E:status-right}'
# END pi-remote tmux enhancements
`;
}

function replaceManagedBlock(content: string, block: string): string {
  const lines = content.split(/\n/);
  const out: string[] = [];
  let inBlock = false;
  let replaced = false;
  for (const line of lines) {
    if (line === '# BEGIN pi-remote tmux enhancements' || line === '# BEGIN pi-remote tmux defaults') {
      out.push(...block.replace(/\n$/, '').split(/\n/));
      inBlock = true;
      replaced = true;
      continue;
    }
    if (line === '# END pi-remote tmux enhancements' || line === '# END pi-remote tmux defaults') {
      inBlock = false;
      continue;
    }
    if (!inBlock) out.push(line);
  }
  let result = out.join('\n');
  if (!replaced) {
    if (result && !result.endsWith('\n')) result += '\n';
    result += `\n${block}`;
  } else if (!result.endsWith('\n')) {
    result += '\n';
  }
  return result;
}

function writeTTY(message: string): void {
  try {
    fs.writeFileSync('/dev/tty', message);
  } catch {
    process.stdout.write(message);
  }
}

function applyRemoteTmuxConfig(): void {
  const file = tmuxConfigFile();
  fs.mkdirSync(path.dirname(file), { recursive: true });
  const hint = buildTmuxHelpHint(file);
  const block = renderTmuxConfigBlock(hint);
  let backup = '';
  if (fs.existsSync(file)) {
    backup = `${file}.backup-${new Date().toISOString().replace(/[-:]/g, '').replace(/T/, '-').slice(0, 15)}`;
    fs.copyFileSync(file, backup);
  } else {
    fs.writeFileSync(file, '');
  }
  const existing = fs.readFileSync(file, 'utf8');
  fs.writeFileSync(file, tmuxConfigHasManagedBlock(file) ? replaceManagedBlock(existing, block) : replaceManagedBlock(existing, block), { mode: 0o644 });

  const socket = `pi-remote-config-test-${process.pid}`;
  const validation = run('tmux', ['-L', socket, '-f', file, 'new-session', '-d', '-s', 'pi-remote-config-smoke', 'sleep 1']);
  if (validation.status !== 0) {
    if (backup && fs.existsSync(backup)) fs.copyFileSync(backup, file);
    process.stderr.write('pi-remote: tmux config validation failed; restored previous config.\n');
    process.stderr.write(String(validation.stderr ?? ''));
    process.exit(1);
  }
  run('tmux', ['-L', socket, 'kill-server'], { stdio: 'ignore' });
  if (shouldSourceTmuxConfig()) run('tmux', ['source-file', file], { stdio: 'ignore' });
  writeTTY(`Enhanced remote tmux config: ${file}\n`);
  writeTTY(`Status help hint: ${hint}\n`);
  if (backup) writeTTY(`Backup: ${backup}\n`);
}

function askTTY(prompt: string): string | null {
  const script = `printf %s ${shellQuote(prompt)} >/dev/tty; IFS= read -r answer </dev/tty; printf %s "$answer"`;
  const result = run('bash', ['-lc', script]);
  if (result.status !== 0) return null;
  return String(result.stdout ?? '');
}

function promptRemoteTmuxConfig(force = false): void {
  const file = tmuxConfigFile();
  if (!force && tmuxConfigHasFeatures(file)) return;
  if (!fs.existsSync('/dev/tty')) return;
  const prompt = tmuxConfigHasFeatures(file)
    ? `Remote tmux config already has the pi-remote features. Recompute/update the managed help hint without changing the rest of ${file}? [y/N]: `
    : `Remote tmux config is missing current pi-remote features (extended keys + explicit shortcut hint). Enhance ${file} now without replacing existing settings? [y/N]: `;
  const answer = askTTY(prompt);
  if (answer && /^(y|Y|yes|YES)$/.test(answer)) applyRemoteTmuxConfig();
  else writeTTY('Skipping remote tmux config update.\n');
}

function recentFile(): string {
  return env('PI_REMOTE_RECENTS') ?? path.join(os.homedir(), '.cache/pi-remote/recents.tsv');
}

function listProjectSessions(projectDir: string): string[] {
  if (!runOk('tmux', ['-V'])) return [];
  const output = commandOutput('tmux', ['list-panes', '-a', '-F', '#{session_name}\t#{pane_current_path}\t#{pane_current_command}'], '');
  const sessions = new Set<string>();
  for (const line of output.split(/\r?\n/)) {
    if (!line) continue;
    const [session, panePath] = line.split('\t');
    if (panePath === projectDir || panePath?.startsWith(`${projectDir}/`)) sessions.add(session);
  }
  return [...sessions].sort((a, b) => a.localeCompare(b));
}

function projectSessionCounts(root: string): Map<string, number> {
  const counts = new Map<string, Set<string>>();
  if (!runOk('tmux', ['-V'])) return new Map();
  const output = commandOutput('tmux', ['list-panes', '-a', '-F', '#{session_name}\t#{pane_current_path}\t#{pane_current_command}'], '');
  const prefix = `${root}/`;
  for (const line of output.split(/\r?\n/)) {
    const [session, panePath] = line.split('\t');
    if (!session || !panePath?.startsWith(prefix)) continue;
    const project = panePath.slice(prefix.length).split('/')[0];
    if (!project) continue;
    if (!counts.has(project)) counts.set(project, new Set());
    counts.get(project)?.add(session);
  }
  return new Map([...counts.entries()].map(([project, sessions]) => [project, sessions.size]));
}

function projectRecentTimes(root: string): Map<string, number> {
  const file = recentFile();
  const recents = new Map<string, number>();
  if (!fs.existsSync(file)) return recents;
  for (const line of fs.readFileSync(file, 'utf8').split(/\r?\n/)) {
    const [timestamp, rowRoot, project] = line.split('\t');
    if (rowRoot !== root || !project) continue;
    const value = Number(timestamp) || 0;
    if (value > (recents.get(project) ?? 0)) recents.set(project, value);
  }
  return recents;
}

function projectMenuRows(root: string): ProjectRow[] {
  const counts = projectSessionCounts(root);
  const recents = projectRecentTimes(root);
  const rows = listProjects(root).map((project) => `${project}\t${counts.get(project) ?? 0}\t${recents.get(project) ?? 0}`);
  return sortWithSystemSort(rows, ['-t', '\t', '-k3,3nr', '-k2,2nr', '-k1,1']).map((line) => {
    const [project, count = '0', recent = '0'] = line.split('\t');
    return { project, count: Number(count) || 0, recent: Number(recent) || 0 };
  });
}

function recordRecentProject(root: string, project: string): void {
  if (!project) return;
  const file = recentFile();
  fs.mkdirSync(path.dirname(file), { recursive: true });
  const rows = fs.existsSync(file)
    ? fs.readFileSync(file, 'utf8').split(/\r?\n/).filter((line) => {
        const [, rowRoot, rowProject] = line.split('\t');
        return line && !(rowRoot === root && rowProject === project);
      })
    : [];
  rows.push(`${Math.floor(Date.now() / 1000)}\t${root}\t${project}`);
  rows.sort((a, b) => (Number(b.split('\t')[0]) || 0) - (Number(a.split('\t')[0]) || 0));
  fs.writeFileSync(file, `${rows.slice(0, 200).join('\n')}\n`);
}


function printLines(lines: string[]): void {
  if (lines.length > 0) process.stdout.write(`${lines.join('\n')}\n`);
}

function terminalRows(): number {
  return process.stdout.rows && Number.isFinite(process.stdout.rows) ? process.stdout.rows : 24;
}

function renderArrowMenu(prompt: string, selected: number, offset: number, visible: number, items: string[]): void {
  process.stdout.write(`\r\x1b[K${prompt}\n`);
  for (let row = 0; row < visible; row += 1) {
    const index = offset + row;
    if (index < items.length) {
      const label = items[index];
      process.stdout.write(index === selected ? `\x1b[K\x1b[7m› ${label}\x1b[0m\n` : `\x1b[K  ${label}\n`);
    } else {
      process.stdout.write('\x1b[K\n');
    }
  }
  process.stdout.write(`\x1b[K[${selected + 1}/${items.length}] ↑/↓ or j/k, Enter\n`);
}

function keyName(chunk: Buffer): string {
  const value = chunk.toString('utf8');
  if (value === '\u0003') return 'ctrl-c';
  if (value === '\r' || value === '\n') return 'enter';
  if (value === '\u001b[A' || value === '\u001bOA') return 'up';
  if (value === '\u001b[B' || value === '\u001bOB') return 'down';
  if (value === '\u001b[C' || value === '\u001bOC') return 'right';
  if (value === '\u001b[D' || value === '\u001bOD') return 'left';
  return value;
}

function readKey(): Promise<string> {
  return new Promise((resolve) => {
    process.stdin.once('data', (chunk: Buffer) => resolve(keyName(chunk)));
  });
}

async function arrowSelect(prompt: string, items: string[]): Promise<number | null> {
  if (!items.length || !process.stdin.isTTY) return null;
  let selected = 0;
  let offset = 0;
  const visible = Math.min(items.length, Math.max(5, Math.min(20, terminalRows() - 4)));
  const lines = visible + 2;
  process.stdin.setRawMode(true);
  process.stdin.resume();
  process.stdout.write('\x1b[?25l');
  renderArrowMenu(prompt, selected, offset, visible, items);
  try {
    for (;;) {
      const key = await readKey();
      let redraw = false;
      if (key === 'ctrl-c') process.exit(130);
      if (key === 'up' || key === 'k' || key === 'K') { selected -= 1; redraw = true; }
      else if (key === 'down' || key === 'j' || key === 'J') { selected += 1; redraw = true; }
      else if (key === 'q' || key === 'Q') return null;
      else if (key === 'enter') return selected;
      if (redraw) {
        if (selected < 0) selected = items.length - 1;
        else if (selected >= items.length) selected = 0;
        if (selected < offset) offset = selected;
        else if (selected >= offset + visible) offset = selected - visible + 1;
        process.stdout.write(`\x1b[${lines}A`);
        renderArrowMenu(prompt, selected, offset, visible, items);
      }
    }
  } finally {
    process.stdin.setRawMode(false);
    process.stdout.write('\x1b[?25h\n');
  }
}

function expandedContains(expanded: string, project: string): boolean {
  return expanded.includes(`|${project}|`);
}

function buildProjectTreeRows(root: string, expanded: string): MenuRow[] {
  const rows: MenuRow[] = [];
  for (const { project, count } of projectMenuRows(root)) {
    rows.push({
      type: 'project',
      project,
      session: '',
      label: count > 0 ? `${expandedContains(expanded, project) ? '▾' : '▸'} ${project} (${count})` : `  ${project} (0)`,
    });
    if (count > 0 && expandedContains(expanded, project)) {
      for (const session of listProjectSessions(path.join(root, project))) {
        rows.push({ type: 'session', project, session, label: `    ↳ ${session}` });
      }
    }
  }
  rows.push({ type: 'create', project: '', session: '', label: 'Create a new project' });
  rows.push({ type: 'quit', project: '', session: '', label: 'Quit' });
  return rows;
}

function renderProjectTreeMenu(prompt: string, selected: number, offset: number, visible: number, rows: MenuRow[]): void {
  process.stdout.write(`\r\x1b[K${prompt}\n`);
  for (let row = 0; row < visible; row += 1) {
    const index = offset + row;
    if (index < rows.length) {
      const label = rows[index].label;
      process.stdout.write(index === selected ? `\x1b[K\x1b[7m› ${label}\x1b[0m\n` : `\x1b[K  ${label}\n`);
    } else {
      process.stdout.write('\x1b[K\n');
    }
  }
  process.stdout.write(`\x1b[K[${selected + 1}/${rows.length}] ↑/↓ move  ←/→ expand sessions  Enter select\n`);
}

function askLine(prompt: string): Promise<string> {
  const rl = readline.createInterface({ input: process.stdin, output: process.stdout });
  return new Promise((resolve) => rl.question(prompt, (answer) => { rl.close(); resolve(answer); }));
}

async function pickProjectMenu(root: string): Promise<{ project: string; session: string; quit: boolean }> {
  if (!process.stdin.isTTY) fail('interactive project menu needs a TTY; pass --project NAME or --new NAME for non-interactive use');
  let expanded = '|';
  let selected = 0;
  let offset = 0;
  let rows = buildProjectTreeRows(root, expanded);
  let visible = Math.min(rows.length, Math.max(5, Math.min(20, terminalRows() - 4)));
  const lines = visible + 2;
  process.stdin.setRawMode(true);
  process.stdin.resume();
  process.stdout.write('\x1b[?25l');
  renderProjectTreeMenu(`Projects on ${os.hostname()} in ${root}`, selected, offset, visible, rows);
  try {
    for (;;) {
      const key = await readKey();
      let redraw = false;
      if (key === 'ctrl-c') process.exit(130);
      if (key === 'up' || key === 'k' || key === 'K') { selected -= 1; redraw = true; }
      else if (key === 'down' || key === 'j' || key === 'J') { selected += 1; redraw = true; }
      else if (key === 'left' || key === 'right') {
        const current = rows[selected];
        if (current && (current.type === 'project' || current.type === 'session') && current.project) {
          expanded = expandedContains(expanded, current.project) ? expanded.replace(`|${current.project}|`, '|') : `${expanded}${current.project}|`;
          rows = buildProjectTreeRows(root, expanded);
          selected = Math.max(0, rows.findIndex((row) => row.type === 'project' && row.project === current.project));
          visible = Math.min(rows.length, Math.max(5, Math.min(20, terminalRows() - 4)));
          redraw = true;
        }
      } else if (key === 'q' || key === 'Q') {
        return { project: '', session: '', quit: true };
      } else if (key === 'enter') {
        const current = rows[selected];
        if (current.type === 'project') return { project: current.project, session: '', quit: false };
        if (current.type === 'session') return { project: current.project, session: current.session, quit: false };
        if (current.type === 'quit') return { project: '', session: '', quit: true };
        process.stdin.setRawMode(false);
        process.stdout.write('\x1b[?25h\n');
        const newName = await askLine('New project name: ');
        const safeName = sanitizeName(newName);
        fs.mkdirSync(path.join(root, safeName), { recursive: true });
        return { project: safeName, session: '', quit: false };
      }
      if (redraw) {
        if (selected < 0) selected = rows.length - 1;
        else if (selected >= rows.length) selected = 0;
        if (selected < offset) offset = selected;
        else if (selected >= offset + visible) offset = selected - visible + 1;
        if (offset < 0) offset = 0;
        process.stdout.write(`\x1b[${lines}A`);
        renderProjectTreeMenu(`Projects on ${os.hostname()} in ${root}`, selected, offset, visible, rows);
      }
    }
  } finally {
    if (process.stdin.isRaw) process.stdin.setRawMode(false);
    process.stdout.write('\x1b[?25h\n');
  }
}

async function pickResumeSessionMenu(projectDir: string): Promise<string> {
  const sessions = listProjectSessions(projectDir);
  if (!sessions.length || !process.stdin.isTTY) return '';
  const choice = await arrowSelect(`Existing tmux sessions for ${projectDir} (↑/↓ or j/k, Enter)`, ['Start a new session', ...sessions.map((session) => `Resume ${session}`)]);
  if (!choice) return '';
  return sessions[choice - 1] ?? '';
}

function sessionExists(session: string): boolean {
  return runOk('tmux', ['has-session', '-t', session]);
}

function uniqueSessionName(base: string): string {
  let candidate = base;
  let suffix = 2;
  while (sessionExists(candidate)) {
    candidate = `${base}-${suffix}`;
    suffix += 1;
  }
  return candidate;
}

function resolveAgentCommand(agent: string, explicitCommand: string): string {
  if (explicitCommand) return explicitCommand;
  const launchCommand = env('PI_REMOTE_LAUNCH_COMMAND') ?? configGet('launch_command', '');
  if (launchCommand) return launchCommand;
  if (agent === 'pi') return env('PI_REMOTE_PI_BIN') ?? configGet('pi_command', 'pi');
  if (agent === 'claude') return env('PI_REMOTE_CLAUDE_BIN') ?? configGet('claude_command', 'claude');
  if (agent === 'codex') return env('PI_REMOTE_CODEX_BIN') ?? configGet('codex_command', 'codex');
  if (agent === 'custom') fail('--agent custom requires --command or launch_command in config');
  fail(`unsupported agent '${agent}' (use pi, claude, codex, or custom with --command)`);
}

function checkLaunchCommandExists(commandValue: string): void {
  const commandWord = commandValue.trim().split(/\s+/)[0] ?? '';
  if (!commandWord) fail('empty launch command');
  if (!runOk('bash', ['-lc', `command -v ${shellQuote(commandWord)} >/dev/null 2>&1`])) {
    fail(`agent executable not found on ${os.hostname()}: ${commandWord}`);
  }
}

function projectDirFromArg(root: string, project: string): string {
  return project.startsWith('/') ? project : path.join(root, project);
}

async function runServer(args: string[]): Promise<void> {
  const configuredProjectRoot = configGet('project_root', '');
  const configuredAgent = configGet('agent', '');
  const options: ServerOptions = {
    projectRoot: env('PI_REMOTE_PROJECT_ROOT') ?? (configuredProjectRoot || path.join(os.homedir(), 'projects')),
    projectName: '',
    newName: '',
    sessionName: '',
    explicitSession: false,
    noAttach: false,
    dryRun: false,
    doList: false,
    configureTmux: false,
    skipTmuxConfig: false,
    sessionsProject: '',
    selectedSession: '',
    projectWasInteractive: false,
    agent: env('PI_REMOTE_AGENT') ?? (configuredAgent || 'pi'),
    explicitCommand: '',
    agentArgs: [],
  };

  for (let index = 0; index < args.length; index += 1) {
    const arg = args[index];
    switch (arg) {
      case '--server': break;
      case '--help': case '-h': usage(); return;
      case '--version': process.stdout.write(`${VERSION}\n`); return;
      case '--project': options.projectName = args[++index] ?? fail('--project requires a name'); break;
      case '--new': options.newName = args[++index] ?? fail('--new requires a name'); break;
      case '--session': options.sessionName = args[++index] ?? fail('--session requires a name'); options.explicitSession = true; break;
      case '--agent': options.agent = args[++index] ?? fail('--agent requires a value'); break;
      case '--command': options.explicitCommand = args[++index] ?? fail('--command requires a shell command'); break;
      case '--project-root': options.projectRoot = args[++index] ?? fail('--project-root requires a path'); break;
      case '--pi-bin': options.explicitCommand = args[++index] ?? fail('--pi-bin requires a path'); options.agent = 'pi'; break;
      case '--no-attach': options.noAttach = true; break;
      case '--dry-run': options.dryRun = true; break;
      case '--configure-tmux': options.configureTmux = true; break;
      case '--skip-tmux-config': options.skipTmuxConfig = true; break;
      case '--list': options.doList = true; break;
      case '--sessions': options.sessionsProject = args[++index] ?? fail('--sessions requires a project name or path'); break;
      case '--': options.agentArgs.push(...args.slice(index + 1)); index = args.length; break;
      default:
        if (arg.startsWith('--project=')) options.projectName = arg.slice('--project='.length);
        else if (arg.startsWith('--new=')) options.newName = arg.slice('--new='.length);
        else if (arg.startsWith('--session=')) { options.sessionName = arg.slice('--session='.length); options.explicitSession = true; }
        else if (arg.startsWith('--agent=')) options.agent = arg.slice('--agent='.length);
        else if (arg.startsWith('--command=')) options.explicitCommand = arg.slice('--command='.length);
        else if (arg.startsWith('--project-root=')) options.projectRoot = arg.slice('--project-root='.length);
        else if (arg.startsWith('--pi-bin=')) { options.explicitCommand = arg.slice('--pi-bin='.length); options.agent = 'pi'; }
        else if (arg.startsWith('--sessions=')) options.sessionsProject = arg.slice('--sessions='.length);
        else if (arg.startsWith('--')) fail(`unknown option for server mode: ${arg}`);
        else options.agentArgs.push(arg);
    }
  }

  options.projectRoot = expandHomePath(options.projectRoot);
  fs.mkdirSync(options.projectRoot, { recursive: true });

  if (options.doList) {
    printLines(listProjects(options.projectRoot));
    return;
  }

  process.env.PATH = `${os.homedir()}/.local/npm-global/bin:${os.homedir()}/.npm-global/bin:${os.homedir()}/.local/bin:${process.env.PATH ?? ''}`;
  if (!runOk('tmux', ['-V'])) fail(`tmux is not installed on ${os.hostname()}`);

  if (options.configureTmux) {
    promptRemoteTmuxConfig(true);
    return;
  }

  if (!options.skipTmuxConfig && !options.noAttach && !options.dryRun && !options.sessionsProject) {
    promptRemoteTmuxConfig(false);
  }

  if (options.sessionsProject) {
    printLines(listProjectSessions(projectDirFromArg(options.projectRoot, options.sessionsProject)));
    return;
  }

  if (options.newName) {
    options.projectName = sanitizeName(options.newName);
    fs.mkdirSync(path.join(options.projectRoot, options.projectName), { recursive: true });
  } else if (options.projectName) {
    if (!validateExistingName(options.projectName)) fail(`project names must be simple folder names under ${options.projectRoot}`);
    if (!fs.existsSync(path.join(options.projectRoot, options.projectName))) fail(`project does not exist: ${path.join(options.projectRoot, options.projectName)} (use --new ${options.projectName} to create it)`);
  } else {
    const selection = await pickProjectMenu(options.projectRoot);
    if (selection.quit) return;
    options.projectName = selection.project;
    options.selectedSession = selection.session;
    options.projectWasInteractive = true;
  }

  if (!validateExistingName(options.projectName)) fail(`project names must be simple folder names under ${options.projectRoot}`);
  const projectDir = path.join(options.projectRoot, options.projectName);
  if (!fs.existsSync(projectDir)) fail(`project directory was not created: ${projectDir}`);

  if (options.selectedSession) {
    options.sessionName = options.selectedSession;
    options.explicitSession = true;
  } else if (!options.projectWasInteractive && !options.explicitSession && !options.noAttach && !options.dryRun) {
    const resumeSession = await pickResumeSessionMenu(projectDir);
    if (resumeSession) {
      options.sessionName = resumeSession;
      options.explicitSession = true;
    }
  }

  if (!options.sessionName) options.sessionName = `pi-remote-${sanitizeName(options.projectName)}`;
  options.sessionName = sanitizeName(options.sessionName);

  const launchBase = resolveAgentCommand(options.agent, options.explicitCommand);
  checkLaunchCommandExists(launchBase);
  const agentCommand = options.agentArgs.length ? `${launchBase} ${shellJoin(options.agentArgs)}` : launchBase;

  if (!options.explicitSession && !options.noAttach && !options.dryRun) options.sessionName = uniqueSessionName(options.sessionName);

  if (options.dryRun) {
    process.stdout.write(`host=${os.hostname()}\nproject_root=${options.projectRoot}\nproject_dir=${projectDir}\ntmux_session=${options.sessionName}\nselected_session=${options.selectedSession}\nagent=${options.agent}\nattach=${options.noAttach ? 'no' : 'yes'}\ncommand=${agentCommand}\n`);
    return;
  }

  recordRecentProject(options.projectRoot, options.projectName);

  if (sessionExists(options.sessionName)) {
    if (options.noAttach) {
      process.stdout.write(`tmux session already exists: ${options.sessionName}\n`);
      process.stdout.write(`attach with: ssh ${env('PI_REMOTE_HOST') ?? DEFAULT_HOST} -t ${shellJoin(['tmux', 'attach', '-t', options.sessionName])}\n`);
      return;
    }
    const attach = run('tmux', ['attach', '-t', options.sessionName], { stdio: 'inherit' });
    if (attach.error) fail(`failed to run tmux: ${attach.error.message}`);
    process.exit(attach.status ?? 1);
  }

  if (options.noAttach) {
    const created = run('tmux', ['new-session', '-d', '-s', options.sessionName, '-c', projectDir, agentCommand]);
    if (created.status !== 0) fail(String(created.stderr ?? 'failed to start tmux session'));
    process.stdout.write(`started detached tmux session: ${options.sessionName}\nproject: ${projectDir}\nagent: ${options.agent}\nattach with: ssh ${env('PI_REMOTE_HOST') ?? DEFAULT_HOST} -t ${shellJoin(['tmux', 'attach', '-t', options.sessionName])}\n`);
    return;
  }

  const attached = run('tmux', ['new-session', '-s', options.sessionName, '-c', projectDir, agentCommand], { stdio: 'inherit' });
  if (attached.error) fail(`failed to run tmux: ${attached.error.message}`);
  process.exit(attached.status ?? 1);
}

function ensureParent(file: string): void {
  fs.mkdirSync(path.dirname(file), { recursive: true });
}

function installRemote(host: string): void {
  const packageRoot = path.resolve(__dirname, '..');
  const distCli = path.join(packageRoot, 'dist/pi-remote.js');
  const wrapper = path.join(packageRoot, 'pi-remote');
  const bashCli = path.join(packageRoot, 'pi-remote.sh');
  for (const file of [distCli, wrapper, bashCli]) {
    if (!fs.existsSync(file)) fail(`missing install file: ${file}`);
  }
  const targetDir = 'projects/pi-remote';
  run('ssh', ['-o', 'BatchMode=yes', host, `mkdir -p "$HOME/${targetDir}/dist" "$HOME/.local/bin" "$HOME/.config/pi-remote"`], { stdio: 'inherit' });
  const copies: Array<[string, string]> = [
    [distCli, 'pi-remote.js.tmp'],
    [wrapper, 'pi-remote.wrapper.tmp'],
    [bashCli, 'pi-remote.sh.tmp'],
  ];
  for (const [source, remote] of copies) {
    const transfer = run('scp', ['-q', source, `${host}:${remote}`], { stdio: 'inherit' });
    if (transfer.status !== 0) process.exit(transfer.status ?? 1);
  }
  const installScript = `set -e; install -m 0755 "$HOME/pi-remote.js.tmp" "$HOME/${targetDir}/dist/pi-remote.js"; install -m 0755 "$HOME/pi-remote.wrapper.tmp" "$HOME/${targetDir}/pi-remote"; install -m 0755 "$HOME/pi-remote.sh.tmp" "$HOME/${targetDir}/pi-remote.sh"; ln -sf "$HOME/${targetDir}/pi-remote" "$HOME/.local/bin/pi-remote"; ln -sf "$HOME/${targetDir}/pi-remote.sh" "$HOME/.local/bin/pi-remote.sh"; rm -f "$HOME/pi-remote.js.tmp" "$HOME/pi-remote.wrapper.tmp" "$HOME/pi-remote.sh.tmp"; if [ ! -f "$HOME/.config/pi-remote/config" ]; then printf '%s\n' 'project_root=~/projects' 'agent=pi' 'pi_command=pi' 'claude_command=claude' 'codex_command=codex' > "$HOME/.config/pi-remote/config"; fi`;
  const installed = run('ssh', ['-o', 'BatchMode=yes', host, installScript], { stdio: 'inherit' });
  if (installed.status !== 0) process.exit(installed.status ?? 1);
  process.stdout.write(`installed remote copy on ${host}: ~/${targetDir}/pi-remote\n`);
}

function writeLocalConfig(host: string): void {
  const file = configFile();
  ensureParent(file);
  if (fs.existsSync(file)) {
    process.stdout.write(`config already exists: ${file}\n`);
    return;
  }
  fs.writeFileSync(file, `host=${host}\nproject_root=~/projects\nagent=pi\npi_command=pi\nclaude_command=claude\ncodex_command=codex\n`);
  process.stdout.write(`wrote config: ${file}\n`);
}

function parseLocal(args: string[]): LocalOptions {
  const configHost = configGet('host', '');
  const options: LocalOptions = {
    host: env('PI_REMOTE_HOST') ?? (configHost || DEFAULT_HOST),
    install: false,
    initConfig: false,
    serverArgs: [],
    needsTty: true,
    noAttach: false,
    doList: false,
    dryRun: false,
    configureTmux: false,
    hasProject: false,
    hasNew: false,
    doSessions: false,
  };
  for (let index = 0; index < args.length; index += 1) {
    const arg = args[index];
    switch (arg) {
      case '--help': case '-h': usage(); process.exit(0);
      case '--version': process.stdout.write(`${VERSION}\n`); process.exit(0);
      case '--host': options.host = args[++index] ?? fail('--host requires a value'); break;
      case '--install-remote': options.install = true; break;
      case '--init-config': options.initConfig = true; break;
      case '--project': options.hasProject = true; options.serverArgs.push(arg, args[++index] ?? fail('--project requires a name')); break;
      case '--new': options.hasNew = true; options.serverArgs.push(arg, args[++index] ?? fail('--new requires a name')); break;
      case '--sessions': options.doSessions = true; options.serverArgs.push(arg, args[++index] ?? fail('--sessions requires a project name')); break;
      case '--no-attach': options.noAttach = true; options.serverArgs.push(arg); break;
      case '--list': options.doList = true; options.serverArgs.push(arg); break;
      case '--configure-tmux': options.configureTmux = true; options.serverArgs.push(arg); break;
      case '--skip-tmux-config': options.serverArgs.push(arg); break;
      case '--dry-run': options.dryRun = true; options.serverArgs.push(arg); break;
      case '--': options.serverArgs.push('--', ...args.slice(index + 1)); index = args.length; break;
      default:
        if (arg.startsWith('--host=')) options.host = arg.slice('--host='.length);
        else if (arg.startsWith('--project=')) { options.hasProject = true; options.serverArgs.push(arg); }
        else if (arg.startsWith('--new=')) { options.hasNew = true; options.serverArgs.push(arg); }
        else if (arg.startsWith('--sessions=')) { options.doSessions = true; options.serverArgs.push(arg); }
        else options.serverArgs.push(arg);
    }
  }
  if (options.doList || options.doSessions) options.needsTty = false;
  else if (options.configureTmux) options.needsTty = true;
  else if (options.noAttach && (options.hasProject || options.hasNew)) options.needsTty = false;
  else if (options.dryRun && (options.hasProject || options.hasNew)) options.needsTty = false;
  else options.needsTty = true;
  return options;
}

function runLocal(args: string[]): void {
  const options = parseLocal(args);
  if (options.initConfig) {
    writeLocalConfig(options.host);
    return;
  }
  if (options.install) {
    installRemote(options.host);
    return;
  }
  if (options.needsTty && !process.stdin.isTTY) fail('this mode needs a TTY for the menu/tmux attach; use --project/--new with --no-attach from automation');
  const quotedArgs = options.serverArgs.length ? ` ${shellJoin(options.serverArgs)}` : '';
  const quotedHost = shellQuote(options.host);
  const remoteCommand = `remote_helper=${REMOTE_PROJECT_PATH}; if [[ ! -x $remote_helper ]]; then remote_helper=${REMOTE_LEGACY_PROJECT_PATH}; fi; if [[ ! -x $remote_helper ]]; then printf 'pi-remote is not installed on the remote host at %s or %s\\n' ${REMOTE_PROJECT_PATH} ${REMOTE_LEGACY_PROJECT_PATH} >&2; exit 127; fi; export PI_REMOTE_HOST=${quotedHost}; exec $remote_helper --server${quotedArgs}`;
  const sshArgs = ['-o', 'BatchMode=yes', options.needsTty ? '-tt' : '-T', options.host, 'bash', '-lc', shellQuote(remoteCommand)];
  const result = run('ssh', sshArgs, { stdio: 'inherit' });
  if (result.error) fail(`failed to run ssh: ${result.error.message}`);
  process.exit(result.status ?? 1);
}

async function main(): Promise<void> {
  const args = process.argv.slice(2);
  if (args[0] === '--server') await runServer(args);
  else runLocal(args);
}

main().catch((error: unknown) => {
  fail(error instanceof Error ? error.message : String(error));
});
