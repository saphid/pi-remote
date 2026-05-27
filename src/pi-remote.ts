#!/usr/bin/env bun
import * as fs from 'node:fs';
import * as os from 'node:os';
import * as path from 'node:path';
import * as readline from 'node:readline';
import { spawnSync } from 'node:child_process';

const VERSION = '1.1.1';
const GITHUB_REPO = 'https://github.com/saphid/pi-remote.git';
const REMOTE_PROJECT_PATH = '"$HOME/projects/pi-remote/pi-remote"';
const REMOTE_LEGACY_PROJECT_PATH = '"$HOME/projects/pi-remote/pi-remote.sh"';
const DEFAULT_CONFIG_PATH = path.join(os.homedir(), '.config/pi-remote/config');
const DEFAULT_HOST = 'pi-remote';

process.stdout.on('error', (error: any) => {
  if (isBrokenPipeError(error)) process.exit(0);
  throw error;
});

type MenuType = 'project' | 'session' | 'saved' | 'create' | 'quit';
type MenuRow = {
  type: MenuType;
  project: string;
  session: string;
  label: string;
  saved?: SavedSession;
  expandable?: boolean;
  expanded?: boolean;
};
type ProjectRow = { project: string; count: number; savedCount: number; recent: number };
type ProjectTreeProject = ProjectRow & { activeSessions: string[]; savedSessions: SavedSession[] };
type ProjectTreeSnapshot = { root: string; projects: ProjectTreeProject[] };
type SavedAgent = 'pi' | 'codex';
type SavedSession = {
  agent: SavedAgent;
  id: string;
  path: string;
  cwd: string;
  title: string;
  model: string;
  created: string;
  modified: number;
  messageCount: number;
};
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
  savedSessions: boolean;
  savedSessionLimit: number;
  savedAgent: string;
  selectedSession: string;
  projectWasInteractive: boolean;
  agent: string;
  explicitAgent: boolean;
  explicitCommand: string;
  agentArgs: string[];
};

type LocalOptions = {
  host: string;
  install: boolean;
  update: boolean;
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
  doSavedSessions: boolean;
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
  pi-remote --update                       Pull/update this pi-remote install from GitHub, then exit
  pi-remote --saved-sessions               Pick a saved Pi/Codex session and attach in tmux
  pi-remote --saved-sessions --agent codex --list
  pi-remote --install-remote               Install/update the remote helper copy, then exit
  pi-remote --init-config --host HOST       Create a local config file, then exit
  pi-remote --list

Interactive project menus use ↑/↓ to move, type to filter by project name, Backspace/Ctrl+U to edit the filter, ←/→ to expand projects, and Enter. Saved-session pickers also support j/k.

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
  --update               Pull/update this pi-remote install from GitHub and report if newer
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
  pi-remote --project my-project --session review-agent --no-attach -- "Review this project"
`);
}

function fail(message: string): never {
  process.stderr.write(`pi-remote: ${message}\n`);
  process.exit(1);
}

function isBrokenPipeError(error: any): boolean {
  return error?.code === 'EPIPE' || error?.errno === -32 || /EPIPE|broken pipe/i.test(String(error?.message ?? error));
}

function safeStdoutWrite(value: string): void {
  try {
    process.stdout.write(value);
  } catch (error: any) {
    if (isBrokenPipeError(error)) process.exit(0);
    throw error;
  }
}

function parsePositiveIntegerOption(name: string, value: string | undefined): number {
  if (!value || !/^\d+$/.test(value)) fail(`${name} must be a positive integer`);
  const parsed = Number(value);
  if (!Number.isSafeInteger(parsed) || parsed < 1) fail(`${name} must be a positive integer`);
  return parsed;
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

function withoutTrailingSlashes(value: string): string {
  return value.replace(/\/+$/, '') || '/';
}

function childPathPrefix(value: string): string {
  const normalized = withoutTrailingSlashes(value);
  return normalized === '/' ? '/' : `${normalized}/`;
}

function listProjectSessions(projectDir: string): string[] {
  if (!runOk('tmux', ['-V'])) return [];
  const output = commandOutput('tmux', ['list-panes', '-a', '-F', '#{session_name}\t#{pane_current_path}\t#{pane_current_command}'], '');
  const normalizedProjectDir = withoutTrailingSlashes(projectDir);
  const prefix = childPathPrefix(projectDir);
  const sessions = new Set<string>();
  for (const line of output.split(/\r?\n/)) {
    if (!line) continue;
    const [session, panePath] = line.split('\t');
    if (panePath === normalizedProjectDir || panePath?.startsWith(prefix)) sessions.add(session);
  }
  return [...sessions].sort((a, b) => a.localeCompare(b));
}

function projectSessionsByProject(root: string): Map<string, string[]> {
  const sessionsByProject = new Map<string, Set<string>>();
  if (!runOk('tmux', ['-V'])) return new Map();
  const output = commandOutput('tmux', ['list-panes', '-a', '-F', '#{session_name}\t#{pane_current_path}\t#{pane_current_command}'], '');
  const prefix = childPathPrefix(root);
  for (const line of output.split(/\r?\n/)) {
    const [session, panePath] = line.split('\t');
    if (!session || !panePath?.startsWith(prefix)) continue;
    const project = panePath.slice(prefix.length).split('/')[0];
    if (!project) continue;
    if (!sessionsByProject.has(project)) sessionsByProject.set(project, new Set());
    sessionsByProject.get(project)?.add(session);
  }
  return new Map([...sessionsByProject.entries()].map(([project, sessions]) => [project, [...sessions].sort((a, b) => a.localeCompare(b))]));
}

function projectSessionCounts(root: string): Map<string, number> {
  return new Map([...projectSessionsByProject(root).entries()].map(([project, sessions]) => [project, sessions.length]));
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

function projectMenuRows(root: string, savedByProject: Map<string, SavedSession[]> = new Map()): ProjectRow[] {
  const counts = projectSessionCounts(root);
  const recents = projectRecentTimes(root);
  const rows = listProjects(root).map((project) => {
    const saved = savedByProject.get(project) ?? [];
    const savedRecent = Math.max(0, ...saved.map((session) => Math.floor(session.modified / 1000)));
    return `${project}\t${counts.get(project) ?? 0}\t${saved.length}\t${Math.max(recents.get(project) ?? 0, savedRecent)}`;
  });
  return sortWithSystemSort(rows, ['-t', '\t', '-k4,4nr', '-k2,2nr', '-k3,3nr', '-k1,1']).map((line) => {
    const [project, count = '0', savedCount = '0', recent = '0'] = line.split('\t');
    return { project, count: Number(count) || 0, savedCount: Number(savedCount) || 0, recent: Number(recent) || 0 };
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

function newestJsonlFiles(root: string, limit: number): string[] {
  if (!fs.existsSync(root)) return [];
  const files: Array<{ file: string; mtime: number }> = [];
  const walk = (dir: string) => {
    let entries: fs.Dirent[];
    try {
      entries = fs.readdirSync(dir, { withFileTypes: true });
    } catch {
      return;
    }
    for (const entry of entries) {
      const file = path.join(dir, entry.name);
      if (entry.isDirectory()) walk(file);
      else if (entry.isFile() && entry.name.endsWith('.jsonl')) {
        try {
          files.push({ file, mtime: fs.statSync(file).mtimeMs });
        } catch {
          // Ignore files that disappear while scanning.
        }
      }
    }
  };
  walk(root);
  files.sort((a, b) => b.mtime - a.mtime);
  return files.slice(0, limit).map((row) => row.file);
}

function safeJson(line: string): any | null {
  try {
    return JSON.parse(line);
  } catch {
    return null;
  }
}

const SAVED_SESSION_SCAN_BYTES = 256 * 1024;

function readSavedSessionPrefix(file: string, stat: fs.Stats): string {
  if (stat.size <= SAVED_SESSION_SCAN_BYTES) return fs.readFileSync(file, 'utf8');
  const fd = fs.openSync(file, 'r');
  try {
    const buffer = Buffer.allocUnsafe(SAVED_SESSION_SCAN_BYTES);
    const bytesRead = fs.readSync(fd, buffer, 0, SAVED_SESSION_SCAN_BYTES, 0);
    const text = buffer.subarray(0, bytesRead).toString('utf8');
    const lastNewline = text.lastIndexOf('\n');
    return lastNewline >= 0 ? text.slice(0, lastNewline + 1) : text;
  } finally {
    fs.closeSync(fd);
  }
}

function savedSessionScanLines(file: string, stat: fs.Stats): string[] {
  return readSavedSessionPrefix(file, stat).split(/\r?\n/);
}

function contentToText(content: any): string {
  if (typeof content === 'string') return content;
  if (!Array.isArray(content)) return '';
  return content.map((block) => {
    if (typeof block === 'string') return block;
    if (!block || typeof block !== 'object') return '';
    if (typeof block.text === 'string') return block.text;
    if (typeof block.input_text === 'string') return block.input_text;
    return '';
  }).filter(Boolean).join('\n');
}

function cleanTitle(text: string): string {
  const normalized = text.replace(/\s+/g, ' ').trim();
  if (!normalized) return '(untitled)';
  return normalized.length > 120 ? `${normalized.slice(0, 119).trim()}…` : normalized;
}

function parsePiSavedSession(file: string): SavedSession | null {
  let header: any | null = null;
  let name = '';
  let firstUser = '';
  let model = '';
  let messageCount = 0;
  let stat: fs.Stats;
  try {
    stat = fs.statSync(file);
    const lines = savedSessionScanLines(file, stat);
    for (let index = 0; index < lines.length; index += 1) {
      const entry = safeJson(lines[index]);
      if (!entry) continue;
      if (index === 0 && entry.type === 'session') header = entry;
      else if (entry.type === 'session_info' && typeof entry.name === 'string') name = entry.name.trim();
      else if (entry.type === 'model_change') model = [entry.provider, entry.modelId].filter(Boolean).join('/');
      else if (entry.type === 'message' && entry.message) {
        const role = entry.message.role;
        if (role === 'user' || role === 'assistant') messageCount += 1;
        if (role === 'user' && !firstUser) firstUser = contentToText(entry.message.content);
      }
    }
  } catch {
    return null;
  }
  if (!header || typeof header.id !== 'string') return null;
  return {
    agent: 'pi',
    id: header.id,
    path: file,
    cwd: typeof header.cwd === 'string' ? header.cwd : os.homedir(),
    title: cleanTitle(name || firstUser),
    model,
    created: typeof header.timestamp === 'string' ? header.timestamp : '',
    modified: stat.mtimeMs,
    messageCount,
  };
}

function looksLikeCodexBootstrapText(text: string): boolean {
  const trimmed = text.trim();
  return !trimmed || trimmed.startsWith('# AGENTS.md instructions') || trimmed.startsWith('<environment_context>') || trimmed.startsWith('<permissions instructions>');
}

function parseCodexSavedSession(file: string): SavedSession | null {
  let id = '';
  let cwd = os.homedir();
  let created = '';
  let firstUser = '';
  let model = '';
  let messageCount = 0;
  let stat: fs.Stats;
  try {
    stat = fs.statSync(file);
    const lines = savedSessionScanLines(file, stat);
    for (const line of lines) {
      const entry = safeJson(line);
      if (!entry) continue;
      const payload = entry.payload && typeof entry.payload === 'object' ? entry.payload : {};
      if (entry.type === 'session_meta') {
        if (payload.id) id = String(payload.id);
        cwd = String(payload.cwd || cwd);
        created = String(payload.timestamp || entry.timestamp || created || '');
      } else if (entry.type === 'turn_context') {
        cwd = String(payload.cwd || cwd);
        if (payload.model) model = String(payload.model);
      } else if (entry.type === 'event_msg') {
        const eventType = payload.type;
        if (eventType === 'user_message') {
          messageCount += 1;
          if (!firstUser && typeof payload.message === 'string' && !looksLikeCodexBootstrapText(payload.message)) firstUser = payload.message;
        } else if (typeof eventType === 'string' && eventType.startsWith('agent_message')) {
          messageCount += 1;
        }
      } else if (entry.type === 'response_item' && payload.type === 'message') {
        if (payload.role === 'user' || payload.role === 'assistant') messageCount += 1;
        if (payload.role === 'user' && !firstUser) {
          const text = contentToText(payload.content);
          if (!looksLikeCodexBootstrapText(text)) firstUser = text;
        }
      }
    }
  } catch {
    return null;
  }
  if (!id) {
    const match = path.basename(file, '.jsonl').match(/([0-9a-f]{8}-[0-9a-f-]{27,})/);
    id = match?.[1] ?? path.basename(file, '.jsonl');
  }
  return {
    agent: 'codex',
    id,
    path: file,
    cwd,
    title: cleanTitle(firstUser),
    model,
    created,
    modified: stat.mtimeMs,
    messageCount,
  };
}

function savedSessionFilter(options: ServerOptions): string {
  if (options.explicitAgent && (options.agent === 'pi' || options.agent === 'codex')) return options.agent;
  return options.savedAgent;
}

function listSavedSessionsForFilter(filter: string, limit: number): SavedSession[] {
  const sessions: SavedSession[] = [];
  if (filter === 'all' || filter === 'pi') {
    for (const file of newestJsonlFiles(path.join(os.homedir(), '.pi/agent/sessions'), limit)) {
      const session = parsePiSavedSession(file);
      if (session) sessions.push(session);
    }
  }
  if (filter === 'all' || filter === 'codex') {
    for (const file of newestJsonlFiles(path.join(os.homedir(), '.codex/sessions'), limit)) {
      const session = parseCodexSavedSession(file);
      if (session) sessions.push(session);
    }
  }
  sessions.sort((a, b) => b.modified - a.modified);
  return sessions.slice(0, limit);
}

function listSavedSessions(options: ServerOptions): SavedSession[] {
  return listSavedSessionsForFilter(savedSessionFilter(options), options.savedSessionLimit);
}

function projectNameForCwd(root: string, cwd: string): string {
  const rootPath = path.resolve(root);
  const cwdPath = path.resolve(expandHomePath(cwd || os.homedir()));
  const relative = path.relative(rootPath, cwdPath);
  if (!relative || relative === '..' || relative.startsWith(`..${path.sep}`) || path.isAbsolute(relative)) return '';
  const project = relative.split(path.sep)[0] ?? '';
  return validateExistingName(project) ? project : '';
}

function savedSessionsByProject(root: string, filter: string, limit: number, projects = new Set(listProjects(root))): Map<string, SavedSession[]> {
  const byProject = new Map<string, SavedSession[]>();
  for (const session of listSavedSessionsForFilter(filter, limit)) {
    const project = projectNameForCwd(root, session.cwd);
    if (!project || !projects.has(project)) continue;
    if (!byProject.has(project)) byProject.set(project, []);
    byProject.get(project)?.push(session);
  }
  for (const sessions of byProject.values()) sessions.sort((a, b) => b.modified - a.modified);
  return byProject;
}

function savedSessionAge(modified: number): string {
  const seconds = Math.max(0, Math.floor((Date.now() - modified) / 1000));
  if (seconds < 3600) return `${Math.floor(seconds / 60)}m`;
  if (seconds < 86400) return `${Math.floor(seconds / 3600)}h`;
  if (seconds < 86400 * 30) return `${Math.floor(seconds / 86400)}d`;
  return `${Math.floor(seconds / (86400 * 30))}mo`;
}

function oneLine(value: string): string {
  return value.replace(/[\t\r\n]/g, ' ');
}

function clipEnd(value: string, max: number): string {
  const clean = oneLine(value);
  if (max <= 0) return '';
  const chars = Array.from(clean);
  if (chars.length <= max) return clean;
  if (max === 1) return '…';
  return `${chars.slice(0, max - 1).join('')}…`;
}

function clipStart(value: string, max: number): string {
  const clean = oneLine(value);
  if (max <= 0) return '';
  const chars = Array.from(clean);
  if (chars.length <= max) return clean;
  if (max === 1) return '…';
  return `…${chars.slice(chars.length - max + 1).join('')}`;
}

function fitLine(value: string, max: number): string {
  return clipEnd(value, max);
}

function terminalColumns(): number {
  const columns = process.stdout.columns;
  return columns && Number.isFinite(columns) ? Math.max(20, columns) : 80;
}

function menuLabelWidth(): number {
  return Math.max(40, terminalColumns() - 4);
}

function savedSessionLabel(session: SavedSession, maxWidth = 112): string {
  const width = Math.max(40, maxWidth);
  const cwdRaw = session.cwd.replace(os.homedir(), '~');
  const shortId = session.id.slice(0, 12);
  const prefix = `${session.agent.padEnd(5)} ${savedSessionAge(session.modified).padStart(5)}  `;
  const suffix = `  ${shortId}`;
  const available = width - prefix.length - suffix.length - 2;

  if (available < 34) {
    const titleWidth = Math.max(8, width - prefix.length - suffix.length);
    return fitLine(`${prefix}${clipEnd(session.title, titleWidth)}${suffix}`, width);
  }

  let cwdWidth = Math.min(34, Math.max(14, Math.floor(available / 3)));
  let titleWidth = available - cwdWidth - 2;
  if (titleWidth < 18) {
    titleWidth = 18;
    cwdWidth = Math.max(8, available - titleWidth - 2);
  }

  const title = clipEnd(session.title, titleWidth).padEnd(titleWidth);
  const cwd = clipStart(cwdRaw, cwdWidth).padEnd(cwdWidth);
  return fitLine(`${prefix}${title}  ${cwd}${suffix}`, width);
}

function printSavedSessions(sessions: SavedSession[]): void {
  for (const [index, session] of sessions.entries()) {
    safeStdoutWrite(`${String(index + 1).padStart(3, '0')}  ${savedSessionLabel(session)}\n`);
  }
}

function savedTmuxSessionName(session: SavedSession): string {
  return sanitizeName(`pi-remote-${session.agent}-${session.id}`).slice(0, 48);
}

function resolveSavedAgentCommand(agent: SavedAgent, explicitCommand: string): string {
  if (explicitCommand) return explicitCommand;
  // Saved-session resumes need the selected agent's resume/session subcommand;
  // launch_command is intentionally only used for generic project launches.
  if (agent === 'pi') return env('PI_REMOTE_PI_BIN') ?? configGet('pi_command', 'pi');
  return env('PI_REMOTE_CODEX_BIN') ?? configGet('codex_command', 'codex');
}

function savedSessionCommand(session: SavedSession, explicitCommand: string, agentArgs: string[]): string {
  const base = resolveSavedAgentCommand(session.agent, explicitCommand);
  checkLaunchCommandExists(base);
  const suffix = agentArgs.length ? ` ${shellJoin(agentArgs)}` : '';
  if (session.agent === 'pi') return `${base} --session ${shellQuote(session.path)}${suffix}`;
  return `${base} resume ${shellQuote(session.id)}${suffix}`;
}

async function attachSavedSession(session: SavedSession, options: ServerOptions): Promise<void> {
  const sessionName = sanitizeName(options.sessionName || savedTmuxSessionName(session));

  if (sessionExists(sessionName)) {
    if (options.noAttach || options.dryRun) {
      process.stdout.write(`tmux session already exists: ${sessionName}\n`);
      process.stdout.write(`attach with: ${attachCommand(sessionName)}\n`);
      return;
    }
    const attach = run('tmux', ['attach', '-t', sessionName], { stdio: 'inherit' });
    if (attach.error) fail(`failed to run tmux: ${attach.error.message}`);
    process.exit(attach.status ?? 1);
  }

  const agentCommand = savedSessionCommand(session, options.explicitCommand, options.agentArgs);

  if (options.dryRun) {
    process.stdout.write(`host=${os.hostname()}\nsaved_session=${session.path}\ncwd=${session.cwd}\ntmux_session=${sessionName}\nagent=${session.agent}\nattach=${options.noAttach ? 'no' : 'yes'}\ncommand=${agentCommand}\n`);
    return;
  }

  if (options.noAttach) {
    const created = run('tmux', ['new-session', '-d', '-s', sessionName, '-c', session.cwd, agentCommand]);
    if (created.status !== 0) fail(String(created.stderr ?? 'failed to start tmux session'));
    process.stdout.write(`started detached tmux session: ${sessionName}\ncwd: ${session.cwd}\nagent: ${session.agent}\nattach with: ${attachCommand(sessionName)}\n`);
    return;
  }

  const attached = run('tmux', ['new-session', '-s', sessionName, '-c', session.cwd, agentCommand], { stdio: 'inherit' });
  if (attached.error) fail(`failed to run tmux: ${attached.error.message}`);
  process.exit(attached.status ?? 1);
}

async function runSavedSessions(options: ServerOptions): Promise<void> {
  const sessions = listSavedSessions(options);
  if (options.doList) {
    printSavedSessions(sessions);
    return;
  }
  if (!sessions.length) fail(`no saved sessions found for agent filter '${savedSessionFilter(options)}'`);
  if (!process.stdin.isTTY) fail('interactive saved-session menu needs a TTY; pass --list for non-interactive use');
  const labels = sessions.map((session) => savedSessionLabel(session, menuLabelWidth()));
  const choice = await arrowSelect(`Saved Pi/Codex sessions on ${os.hostname()} (↑/↓ or j/k, Enter)`, labels);
  if (choice === null) return;
  await attachSavedSession(sessions[choice], options);
}

function printLines(lines: string[]): void {
  if (lines.length > 0) safeStdoutWrite(`${lines.join('\n')}\n`);
}

function terminalRows(): number {
  return process.stdout.rows && Number.isFinite(process.stdout.rows) ? process.stdout.rows : 24;
}

function menuVisibleRows(maxItems?: number): number {
  const visible = Math.max(5, Math.min(20, terminalRows() - 4));
  return maxItems === undefined ? visible : Math.min(maxItems, visible);
}

function renderArrowMenu(prompt: string, selected: number, offset: number, visible: number, items: string[]): void {
  const columns = terminalColumns();
  const lineWidth = Math.max(1, columns - 1);
  const labelWidth = Math.max(1, columns - 3);
  process.stdout.write(`\r\x1b[K${fitLine(prompt, lineWidth)}\n`);
  for (let row = 0; row < visible; row += 1) {
    const index = offset + row;
    if (index < items.length) {
      const label = fitLine(items[index], labelWidth);
      process.stdout.write(index === selected ? `\x1b[K\x1b[7m› ${label}\x1b[0m\n` : `\x1b[K  ${label}\n`);
    } else {
      process.stdout.write('\x1b[K\n');
    }
  }
  process.stdout.write(`\x1b[K${fitLine(`[${selected + 1}/${items.length}] ↑/↓ or j/k, Enter`, lineWidth)}\n`);
}

function keyName(chunk: Buffer): string {
  const value = chunk.toString('utf8');
  if (value === '\u0003') return 'ctrl-c';
  if (value === '\u0015') return 'ctrl-u';
  if (value === '\u007f' || value === '\b') return 'backspace';
  if (value === '\u001b') return 'escape';
  if (value === '\r' || value === '\n') return 'enter';
  if (value === '\u001b[A' || value === '\u001bOA') return 'up';
  if (value === '\u001b[B' || value === '\u001bOB') return 'down';
  if (value === '\u001b[C' || value === '\u001bOC') return 'right';
  if (value === '\u001b[D' || value === '\u001bOD') return 'left';
  if (value === '\u001b[3~') return 'delete';
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
  const visible = menuVisibleRows(items.length);
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
    process.stdin.pause();
    process.stdout.write('\x1b[?25h\n');
  }
}

function expandedContains(expanded: string, project: string): boolean {
  return expanded.includes(`|${project}|`);
}

function projectSessionSummary(activeCount: number, savedCount: number): string {
  const parts: string[] = [];
  if (activeCount > 0) parts.push(`${activeCount} active`);
  if (savedCount > 0) parts.push(`${savedCount} saved`);
  return parts.length ? parts.join(', ') : '0';
}

function projectMatchesFilter(project: string, filterNeedle: string): boolean {
  return !filterNeedle || project.toLowerCase().includes(filterNeedle);
}

function removeLastInputCharacter(value: string): string {
  const chars = Array.from(value);
  chars.pop();
  return chars.join('');
}

function isProjectFilterKey(key: string): boolean {
  return /^[ -~]$/.test(key);
}

function projectTreePrompt(root: string, filter: string): string {
  const base = `Projects on ${os.hostname()} in ${root}`;
  return filter ? `${base} — filter: ${filter}` : base;
}

function buildProjectTreeSnapshot(root: string, savedFilter = 'all', savedLimit = 120): ProjectTreeSnapshot {
  const projectNames = listProjects(root);
  const projectSet = new Set(projectNames);
  const activeByProject = projectSessionsByProject(root);
  const savedByProject = savedSessionsByProject(root, savedFilter, savedLimit, projectSet);
  const recents = projectRecentTimes(root);
  const sortableRows = projectNames.map((project) => {
    const activeSessions = activeByProject.get(project) ?? [];
    const savedSessions = savedByProject.get(project) ?? [];
    const savedRecent = Math.max(0, ...savedSessions.map((session) => Math.floor(session.modified / 1000)));
    return `${project}\t${activeSessions.length}\t${savedSessions.length}\t${Math.max(recents.get(project) ?? 0, savedRecent)}`;
  });
  const projects = sortWithSystemSort(sortableRows, ['-t', '\t', '-k4,4nr', '-k2,2nr', '-k3,3nr', '-k1,1']).map((line) => {
    const [project, count = '0', savedCount = '0', recent = '0'] = line.split('\t');
    return {
      project,
      count: Number(count) || 0,
      savedCount: Number(savedCount) || 0,
      recent: Number(recent) || 0,
      activeSessions: activeByProject.get(project) ?? [],
      savedSessions: savedByProject.get(project) ?? [],
    };
  });
  return { root, projects };
}

function buildProjectTreeRowsFromSnapshot(snapshot: ProjectTreeSnapshot, expanded: string, filter = ''): MenuRow[] {
  const rows: MenuRow[] = [];
  const savedLabelWidth = Math.max(36, menuLabelWidth() - 6);
  const filterNeedle = filter.trim().toLowerCase();
  for (const { project, count, savedCount, activeSessions, savedSessions } of snapshot.projects) {
    if (!projectMatchesFilter(project, filterNeedle)) continue;
    const totalCount = count + savedCount;
    const isExpanded = totalCount > 0 && expandedContains(expanded, project);
    rows.push({
      type: 'project',
      project,
      session: '',
      expandable: totalCount > 0,
      expanded: isExpanded,
      label: totalCount > 0
        ? `${isExpanded ? '▾' : '▸'} ${project} (${projectSessionSummary(count, savedCount)})`
        : `  ${project} (0)`,
    });
    if (isExpanded) {
      for (const session of activeSessions) {
        rows.push({ type: 'session', project, session, label: `    ● ${session}` });
      }
      for (const saved of savedSessions) {
        rows.push({ type: 'saved', project, session: '', saved, label: `    ◷ ${savedSessionLabel(saved, savedLabelWidth)}` });
      }
    }
  }
  rows.push({ type: 'create', project: '', session: '', label: 'Create a new project' });
  rows.push({ type: 'quit', project: '', session: '', label: 'Quit' });
  return rows;
}

function buildProjectTreeRows(root: string, expanded: string, savedFilter = 'all', savedLimit = 120, filter = ''): MenuRow[] {
  return buildProjectTreeRowsFromSnapshot(buildProjectTreeSnapshot(root, savedFilter, savedLimit), expanded, filter);
}

function projectTreeRowLabel(row: MenuRow, selected: boolean): string {
  if (!selected || row.type !== 'project') return row.label;
  if (row.expandable) {
    return `${row.label}  ${row.expanded ? '← collapse' : '→ expand'} · Enter=new`;
  }
  return `${row.label}  Enter=new`;
}

function projectTreeFilterHint(filter: string): string {
  return filter ? `  filter: ${filter}  Backspace edit Ctrl+U clear` : '  type to filter';
}

function projectTreeFooter(selected: number, rows: MenuRow[], filter = ''): string {
  const position = `[${selected + 1}/${rows.length}]`;
  const current = rows[selected];
  const hint = projectTreeFilterHint(filter);
  if (!current) return `${position} ↑/↓ move  Enter select${hint}`;
  if (current.type === 'project') {
    return current.expandable
      ? `${position} ↑/↓ move  ←/→ expand/collapse  Enter new session${hint}`
      : `${position} ↑/↓ move  Enter new session${hint}`;
  }
  if (current.type === 'session' || current.type === 'saved') return `${position} ↑/↓ move  Enter resume  ←/→ collapse project${hint}`;
  return `${position} ↑/↓ move  Enter select${hint}`;
}

function renderProjectTreeMenu(prompt: string, selected: number, offset: number, visible: number, rows: MenuRow[], filter = ''): void {
  const columns = terminalColumns();
  const lineWidth = Math.max(1, columns - 1);
  const labelWidth = Math.max(1, columns - 3);
  process.stdout.write(`\r\x1b[K${fitLine(prompt, lineWidth)}\n`);
  for (let row = 0; row < visible; row += 1) {
    const index = offset + row;
    if (index < rows.length) {
      const label = fitLine(projectTreeRowLabel(rows[index], index === selected), labelWidth);
      process.stdout.write(index === selected ? `\x1b[K\x1b[7m› ${label}\x1b[0m\n` : `\x1b[K  ${label}\n`);
    } else {
      process.stdout.write('\x1b[K\n');
    }
  }
  process.stdout.write(`\x1b[K${fitLine(projectTreeFooter(selected, rows, filter), lineWidth)}\n`);
}

function askLine(prompt: string): Promise<string> {
  const rl = readline.createInterface({ input: process.stdin, output: process.stdout });
  return new Promise((resolve) => rl.question(prompt, (answer) => { rl.close(); resolve(answer); }));
}

async function pickProjectMenu(root: string, options: ServerOptions): Promise<{ project: string; session: string; quit: boolean; saved?: SavedSession }> {
  if (!process.stdin.isTTY) fail('interactive project menu needs a TTY; pass --project NAME or --new NAME for non-interactive use');
  let expanded = '|';
  let selected = 0;
  let offset = 0;
  let filter = '';
  const savedFilter = savedSessionFilter(options);
  const snapshot = buildProjectTreeSnapshot(root, savedFilter, options.savedSessionLimit);
  let rows = buildProjectTreeRowsFromSnapshot(snapshot, expanded, filter);
  const visible = menuVisibleRows();
  const lines = visible + 2;
  const rebuildRowsForFilter = () => {
    rows = buildProjectTreeRowsFromSnapshot(snapshot, expanded, filter);
    selected = 0;
    offset = 0;
  };
  process.stdin.setRawMode(true);
  process.stdin.resume();
  process.stdout.write('\x1b[?25l');
  renderProjectTreeMenu(projectTreePrompt(root, filter), selected, offset, visible, rows, filter);
  try {
    for (;;) {
      const key = await readKey();
      let redraw = false;
      if (key === 'ctrl-c') process.exit(130);
      if (key === 'up') { selected -= 1; redraw = true; }
      else if (key === 'down') { selected += 1; redraw = true; }
      else if (key === 'backspace' || key === 'delete') {
        if (filter) {
          filter = removeLastInputCharacter(filter);
          rebuildRowsForFilter();
          redraw = true;
        }
      } else if (key === 'ctrl-u' || key === 'escape') {
        if (filter) {
          filter = '';
          rebuildRowsForFilter();
          redraw = true;
        }
      } else if (key === 'left' || key === 'right') {
        const current = rows[selected];
        if (current && (current.type === 'project' || current.type === 'session' || current.type === 'saved') && current.project && (current.type !== 'project' || current.expandable)) {
          expanded = expandedContains(expanded, current.project) ? expanded.replace(`|${current.project}|`, '|') : `${expanded}${current.project}|`;
          rows = buildProjectTreeRowsFromSnapshot(snapshot, expanded, filter);
          selected = Math.max(0, rows.findIndex((row) => row.type === 'project' && row.project === current.project));
          redraw = true;
        }
      } else if (isProjectFilterKey(key)) {
        filter += key;
        rebuildRowsForFilter();
        redraw = true;
      } else if (key === 'enter') {
        const current = rows[selected];
        if (current.type === 'project') return { project: current.project, session: '', quit: false };
        if (current.type === 'session') return { project: current.project, session: current.session, quit: false };
        if (current.type === 'saved' && current.saved) return { project: '', session: '', quit: false, saved: current.saved };
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
        renderProjectTreeMenu(projectTreePrompt(root, filter), selected, offset, visible, rows, filter);
      }
    }
  } finally {
    if (process.stdin.isRaw) process.stdin.setRawMode(false);
    process.stdin.pause();
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

function attachCommand(sessionName: string): string {
  const args = ['tmux', 'attach', '-t', sessionName];
  const host = env('PI_REMOTE_HOST') ?? DEFAULT_HOST;
  if (isLocalHost(host)) return shellJoin(args);
  return `ssh ${shellQuote(host)} -t ${shellJoin(args)}`;
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
    savedSessions: false,
    savedSessionLimit: 120,
    savedAgent: 'all',
    selectedSession: '',
    projectWasInteractive: false,
    agent: env('PI_REMOTE_AGENT') ?? (configuredAgent || 'pi'),
    explicitAgent: false,
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
      case '--agent': options.agent = args[++index] ?? fail('--agent requires a value'); options.explicitAgent = true; break;
      case '--saved-agent': options.savedAgent = args[++index] ?? fail('--saved-agent requires all, pi, or codex'); break;
      case '--saved-session-limit': options.savedSessionLimit = parsePositiveIntegerOption('--saved-session-limit', args[++index]); break;
      case '--saved-sessions': case '--kittylitter': options.savedSessions = true; break;
      case '--command': options.explicitCommand = args[++index] ?? fail('--command requires a shell command'); break;
      case '--project-root': options.projectRoot = args[++index] ?? fail('--project-root requires a path'); break;
      case '--pi-bin': options.explicitCommand = args[++index] ?? fail('--pi-bin requires a path'); options.agent = 'pi'; options.explicitAgent = true; break;
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
        else if (arg.startsWith('--agent=')) { options.agent = arg.slice('--agent='.length); options.explicitAgent = true; }
        else if (arg.startsWith('--saved-agent=')) options.savedAgent = arg.slice('--saved-agent='.length);
        else if (arg.startsWith('--saved-session-limit=')) options.savedSessionLimit = parsePositiveIntegerOption('--saved-session-limit', arg.slice('--saved-session-limit='.length));
        else if (arg.startsWith('--command=')) options.explicitCommand = arg.slice('--command='.length);
        else if (arg.startsWith('--project-root=')) options.projectRoot = arg.slice('--project-root='.length);
        else if (arg.startsWith('--pi-bin=')) { options.explicitCommand = arg.slice('--pi-bin='.length); options.agent = 'pi'; options.explicitAgent = true; }
        else if (arg.startsWith('--sessions=')) options.sessionsProject = arg.slice('--sessions='.length);
        else if (arg.startsWith('--')) fail(`unknown option for server mode: ${arg}`);
        else options.agentArgs.push(arg);
    }
  }

  options.projectRoot = expandHomePath(options.projectRoot);
  process.env.PATH = `${os.homedir()}/.local/npm-global/bin:${os.homedir()}/.npm-global/bin:${os.homedir()}/.local/bin:${process.env.PATH ?? ''}`;

  if (options.savedSessions) {
    if (options.savedAgent !== 'all' && options.savedAgent !== 'pi' && options.savedAgent !== 'codex') fail('--saved-agent must be all, pi, or codex');
    if (!options.doList && !runOk('tmux', ['-V'])) fail(`tmux is not installed on ${os.hostname()}`);
    await runSavedSessions(options);
    return;
  }

  if (options.doList) {
    printLines(listProjects(options.projectRoot));
    return;
  }

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
    const selection = await pickProjectMenu(options.projectRoot, options);
    if (selection.quit) return;
    if (selection.saved) {
      await attachSavedSession(selection.saved, options);
      return;
    }
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
      process.stdout.write(`attach with: ${attachCommand(options.sessionName)}\n`);
      return;
    }
    const attach = run('tmux', ['attach', '-t', options.sessionName], { stdio: 'inherit' });
    if (attach.error) fail(`failed to run tmux: ${attach.error.message}`);
    process.exit(attach.status ?? 1);
  }

  if (options.noAttach) {
    const created = run('tmux', ['new-session', '-d', '-s', options.sessionName, '-c', projectDir, agentCommand]);
    if (created.status !== 0) fail(String(created.stderr ?? 'failed to start tmux session'));
    process.stdout.write(`started detached tmux session: ${options.sessionName}\nproject: ${projectDir}\nagent: ${options.agent}\nattach with: ${attachCommand(options.sessionName)}\n`);
    return;
  }

  const attached = run('tmux', ['new-session', '-s', options.sessionName, '-c', projectDir, agentCommand], { stdio: 'inherit' });
  if (attached.error) fail(`failed to run tmux: ${attached.error.message}`);
  process.exit(attached.status ?? 1);
}

function ensureParent(file: string): void {
  fs.mkdirSync(path.dirname(file), { recursive: true });
}

function currentPackageRoot(): string {
  const configured = env('PI_REMOTE_PACKAGE_ROOT');
  if (configured) return path.resolve(expandHomePath(configured));
  return path.resolve(__dirname, '..');
}

function commandExists(command: string): boolean {
  return runOk('bash', ['-lc', `command -v ${shellQuote(command)} >/dev/null 2>&1`]);
}

function gitOutput(root: string, args: string[], fallback = ''): string {
  return commandOutput('git', ['-C', root, ...args], fallback).trim();
}

function isGitCheckout(root: string): boolean {
  return runOk('git', ['-C', root, 'rev-parse', '--is-inside-work-tree']);
}

function readPackageVersion(root: string): string {
  try {
    const parsed = JSON.parse(fs.readFileSync(path.join(root, 'package.json'), 'utf8')) as { version?: unknown };
    return typeof parsed.version === 'string' && parsed.version ? parsed.version : VERSION;
  } catch {
    return VERSION;
  }
}

function gitPackageVersion(root: string, ref: string, fallback: string): string {
  try {
    const content = commandOutput('git', ['-C', root, 'show', `${ref}:package.json`], '');
    if (!content) return fallback;
    const parsed = JSON.parse(content) as { version?: unknown };
    return typeof parsed.version === 'string' && parsed.version ? parsed.version : fallback;
  } catch {
    return fallback;
  }
}

function gitShortCommit(root: string, ref = 'HEAD'): string {
  return gitOutput(root, ['rev-parse', '--short', ref], 'unknown') || 'unknown';
}

function resolveGitUpstream(root: string): string {
  const configured = gitOutput(root, ['rev-parse', '--abbrev-ref', '--symbolic-full-name', '@{u}'], '');
  if (configured) return configured;
  for (const candidate of ['origin/main', 'origin/master']) {
    if (runOk('git', ['-C', root, 'rev-parse', '--verify', '--quiet', candidate])) return candidate;
  }
  const originHead = gitOutput(root, ['symbolic-ref', '--quiet', '--short', 'refs/remotes/origin/HEAD'], '');
  if (originHead) return originHead;
  fail('could not determine the GitHub upstream branch for this pi-remote checkout');
}

function gitAheadBehind(root: string, upstream: string): { ahead: number; behind: number } {
  const output = gitOutput(root, ['rev-list', '--left-right', '--count', `HEAD...${upstream}`], '0 0');
  const [ahead = '0', behind = '0'] = output.split(/\s+/);
  return { ahead: Number(ahead) || 0, behind: Number(behind) || 0 };
}

function isGitDirty(root: string): boolean {
  return Boolean(gitOutput(root, ['status', '--porcelain', '--untracked-files=no'], ''));
}

function runGitOrFail(root: string, args: string[], label: string): void {
  const result = run('git', ['-C', root, ...args], { stdio: 'inherit' });
  if (result.error) fail(`${label}: ${result.error.message}`);
  if (result.status !== 0) fail(`${label} failed`);
}

function updateGitCheckout(root: string): void {
  if (!commandExists('git')) fail('git is required for --update');
  process.stdout.write(`fetching updates from ${GITHUB_REPO}\n`);
  runGitOrFail(root, ['fetch', '--tags', '--prune', 'origin'], 'git fetch');

  const upstream = resolveGitUpstream(root);
  const currentVersion = readPackageVersion(root);
  const currentCommit = gitShortCommit(root, 'HEAD');
  const latestVersion = gitPackageVersion(root, upstream, currentVersion);
  const latestCommit = gitShortCommit(root, upstream);
  const { ahead, behind } = gitAheadBehind(root, upstream);

  if (behind > 0) {
    if (currentVersion === latestVersion) {
      process.stdout.write(`new GitHub update available for pi-remote ${currentVersion}: ${currentCommit} -> ${latestCommit}\n`);
    } else {
      process.stdout.write(`new pi-remote version available: ${currentVersion} (${currentCommit}) -> ${latestVersion} (${latestCommit})\n`);
    }
    if (isGitDirty(root)) fail(`cannot update ${root}: working tree has uncommitted changes`);
    runGitOrFail(root, ['pull', '--ff-only'], 'git pull');
    process.stdout.write(`updated pi-remote to ${readPackageVersion(root)} (${gitShortCommit(root, 'HEAD')})\n`);
    return;
  }

  if (ahead > 0) {
    process.stdout.write(`no newer GitHub version found; local checkout is ahead by ${ahead} commit${ahead === 1 ? '' : 's'} (${currentVersion} ${currentCommit})\n`);
  } else {
    process.stdout.write(`pi-remote is already up to date: ${currentVersion} (${currentCommit})\n`);
  }
}

function removeDirectoryContents(root: string): void {
  const resolved = path.resolve(root);
  if (resolved === path.parse(resolved).root) fail(`refusing to update unsafe package root: ${resolved}`);
  fs.mkdirSync(resolved, { recursive: true });
  for (const entry of fs.readdirSync(resolved)) {
    fs.rmSync(path.join(resolved, entry), { recursive: true, force: true });
  }
}

function updateCopiedInstallFromGitHub(root: string): void {
  if (!commandExists('git')) fail('git is required for --update');
  const currentVersion = readPackageVersion(root);
  const tempRoot = fs.mkdtempSync(path.join(os.tmpdir(), 'pi-remote-update-'));
  try {
    process.stdout.write(`fetching latest pi-remote from ${GITHUB_REPO}\n`);
    const clone = run('git', ['clone', '--depth', '1', GITHUB_REPO, tempRoot], { stdio: 'inherit' });
    if (clone.error) fail(`git clone: ${clone.error.message}`);
    if (clone.status !== 0) fail('git clone failed');

    const latestVersion = readPackageVersion(tempRoot);
    const latestCommit = gitShortCommit(tempRoot, 'HEAD');
    if (currentVersion === latestVersion) {
      process.stdout.write(`no newer package version found on GitHub (current ${currentVersion}); refreshing latest GitHub copy (${latestCommit})\n`);
    } else {
      process.stdout.write(`new pi-remote version available: ${currentVersion} -> ${latestVersion} (${latestCommit})\n`);
    }

    removeDirectoryContents(root);
    for (const entry of fs.readdirSync(tempRoot)) {
      fs.cpSync(path.join(tempRoot, entry), path.join(root, entry), { recursive: true, force: true, verbatimSymlinks: true });
    }
    process.stdout.write(`updated pi-remote from GitHub: ${latestVersion} (${latestCommit})\n`);
  } finally {
    fs.rmSync(tempRoot, { recursive: true, force: true });
  }
}

function updateLocalInstall(): void {
  const root = currentPackageRoot();
  if (isGitCheckout(root)) updateGitCheckout(root);
  else updateCopiedInstallFromGitHub(root);
}

function installRemote(host: string): void {
  const packageRoot = currentPackageRoot();
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
  const installScript = `set -e
PATH="$HOME/.bun/bin:$HOME/.local/bin:/opt/homebrew/bin:/usr/local/bin:$PATH"
export PATH
install -m 0755 "$HOME/pi-remote.js.tmp" "$HOME/${targetDir}/dist/pi-remote.js"
install -m 0755 "$HOME/pi-remote.wrapper.tmp" "$HOME/${targetDir}/pi-remote"
install -m 0755 "$HOME/pi-remote.sh.tmp" "$HOME/${targetDir}/pi-remote.sh"
ln -sf "$HOME/${targetDir}/pi-remote" "$HOME/.local/bin/pi-remote"
ln -sf "$HOME/${targetDir}/pi-remote.sh" "$HOME/.local/bin/pi-remote.sh"
rm -f "$HOME/pi-remote.js.tmp" "$HOME/pi-remote.wrapper.tmp" "$HOME/pi-remote.sh.tmp"
if [ ! -f "$HOME/.config/pi-remote/config" ]; then
  printf '%s\n' 'project_root=~/projects' 'agent=pi' 'pi_command=pi' 'claude_command=claude' 'codex_command=codex' > "$HOME/.config/pi-remote/config"
fi
if ! command -v bun >/dev/null 2>&1 && ! command -v node >/dev/null 2>&1; then
  if command -v curl >/dev/null 2>&1; then
    printf '%s\n' 'pi-remote: installing Bun runtime (no slow shell fallback)'
    curl -fsSL https://bun.sh/install | bash
  else
    printf '%s\n' 'pi-remote: install Bun or Node on the remote host; no slow shell fallback is available' >&2
    exit 127
  fi
fi`;
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
    update: false,
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
    doSavedSessions: false,
  };
  for (let index = 0; index < args.length; index += 1) {
    const arg = args[index];
    switch (arg) {
      case '--help': case '-h': usage(); process.exit(0);
      case '--version': process.stdout.write(`${VERSION}\n`); process.exit(0);
      case '--host': options.host = args[++index] ?? fail('--host requires a value'); break;
      case '--install-remote': options.install = true; break;
      case '--update': options.update = true; break;
      case '--init-config': options.initConfig = true; break;
      case '--project': options.hasProject = true; options.serverArgs.push(arg, args[++index] ?? fail('--project requires a name')); break;
      case '--new': options.hasNew = true; options.serverArgs.push(arg, args[++index] ?? fail('--new requires a name')); break;
      case '--sessions': options.doSessions = true; options.serverArgs.push(arg, args[++index] ?? fail('--sessions requires a project name')); break;
      case '--saved-sessions': case '--kittylitter': options.doSavedSessions = true; options.serverArgs.push(arg); break;
      case '--saved-agent': options.serverArgs.push(arg, args[++index] ?? fail('--saved-agent requires all, pi, or codex')); break;
      case '--saved-session-limit': options.serverArgs.push(arg, args[++index] ?? fail('--saved-session-limit requires a number')); break;
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
        else if (arg.startsWith('--saved-agent=') || arg.startsWith('--saved-session-limit=')) options.serverArgs.push(arg);
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

function isLocalHost(host: string): boolean {
  return host === 'local' || host === 'localhost' || host === '127.0.0.1' || host === '.';
}

async function runLocal(args: string[]): Promise<void> {
  const options = parseLocal(args);
  if (options.initConfig) {
    writeLocalConfig(options.host);
    return;
  }
  if (options.install) {
    installRemote(options.host);
    return;
  }
  if (options.update) {
    updateLocalInstall();
    return;
  }
  if (options.needsTty && !process.stdin.isTTY) fail('this mode needs a TTY for the menu/tmux attach; use --project/--new with --no-attach from automation');
  if (isLocalHost(options.host)) {
    process.env.PI_REMOTE_HOST = options.host;
    await runServer(['--server', ...options.serverArgs]);
    return;
  }
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
  else await runLocal(args);
}

main().catch((error: unknown) => {
  fail(error instanceof Error ? error.message : String(error));
});
