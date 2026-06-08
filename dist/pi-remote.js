#!/usr/bin/env node
"use strict";
var __createBinding = (this && this.__createBinding) || (Object.create ? (function(o, m, k, k2) {
    if (k2 === undefined) k2 = k;
    var desc = Object.getOwnPropertyDescriptor(m, k);
    if (!desc || ("get" in desc ? !m.__esModule : desc.writable || desc.configurable)) {
      desc = { enumerable: true, get: function() { return m[k]; } };
    }
    Object.defineProperty(o, k2, desc);
}) : (function(o, m, k, k2) {
    if (k2 === undefined) k2 = k;
    o[k2] = m[k];
}));
var __setModuleDefault = (this && this.__setModuleDefault) || (Object.create ? (function(o, v) {
    Object.defineProperty(o, "default", { enumerable: true, value: v });
}) : function(o, v) {
    o["default"] = v;
});
var __importStar = (this && this.__importStar) || (function () {
    var ownKeys = function(o) {
        ownKeys = Object.getOwnPropertyNames || function (o) {
            var ar = [];
            for (var k in o) if (Object.prototype.hasOwnProperty.call(o, k)) ar[ar.length] = k;
            return ar;
        };
        return ownKeys(o);
    };
    return function (mod) {
        if (mod && mod.__esModule) return mod;
        var result = {};
        if (mod != null) for (var k = ownKeys(mod), i = 0; i < k.length; i++) if (k[i] !== "default") __createBinding(result, mod, k[i]);
        __setModuleDefault(result, mod);
        return result;
    };
})();
Object.defineProperty(exports, "__esModule", { value: true });
const fs = __importStar(require("node:fs"));
const os = __importStar(require("node:os"));
const path = __importStar(require("node:path"));
const readline = __importStar(require("node:readline"));
const node_child_process_1 = require("node:child_process");
const GITHUB_REPO = 'https://github.com/saphid/pi-remote.git';
const GITHUB_DISPLAY_URL = 'https://github.com/saphid/pi-remote';
const AUTHOR = 'Alex Southwell';
const REMOTE_PROJECT_PATH = '"$HOME/projects/pi-remote/pi-remote"';
const REMOTE_LEGACY_PROJECT_PATH = '"$HOME/projects/pi-remote/pi-remote.sh"';
const DEFAULT_CONFIG_PATH = path.join(os.homedir(), '.config/pi-remote/config');
const DEFAULT_HOST = 'pi-remote';
process.stdout.on('error', (error) => {
    if (isBrokenPipeError(error))
        process.exit(0);
    throw error;
});
function packageVersion() {
    const candidates = [
        path.join(__dirname, '..', 'package.json'),
        path.join(__dirname, '..', '..', 'package.json'),
    ];
    for (const file of candidates) {
        try {
            const parsed = JSON.parse(fs.readFileSync(file, 'utf8'));
            if (typeof parsed.version === 'string' && parsed.version)
                return parsed.version;
        }
        catch { }
    }
    return '0.0.0-dev';
}
function color(text, code) {
    return process.stdout.isTTY ? `\x1b[${code}m${text}\x1b[0m` : text;
}
function splashLine() {
    return `${color('pi-remote', '1;36')} ${color(`v${packageVersion()}`, '1;33')} ${color('|', '2')} ${color(GITHUB_DISPLAY_URL, '4;34')} ${color('|', '2')} ${color(AUTHOR, '1;35')}`;
}
function usage() {
    process.stdout.write(`${splashLine()}
pi-remote - tiny SSH/tmux launcher for coding agents on a remote host

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
  pi-remote --saved-sessions --include-archived --list
  pi-remote --install-remote               Install/update the remote helper copy, then exit
  pi-remote --init-config --host HOST       Create a local config file, then exit
  pi-remote --list

Interactive project menus use ↑/↓ to move, type to filter by project name, Enter to open a folder, Backspace to delete filter text or go to the parent folder, → to expand/open, ← to collapse/go parent, s to start a new session for the selected folder, n to create a new folder, q to quit, Ctrl+A to archive the selected session, Ctrl+X to close it, and Ctrl+R to restore archived rows when shown with --include-archived. Saved-session pickers also support j/k.

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
  --include-archived      Include archived tmux and saved sessions in menus/lists
  --archived              Show only archived tmux and saved sessions in menus/lists
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
  PI_REMOTE_ARCHIVE       Archive metadata path (default: ~/.cache/pi-remote/archive.json).

Automation-friendly example:
  pi-remote --project my-project --session review-agent --no-attach -- "Review this project"
`);
}
function fail(message) {
    process.stderr.write(`pi-remote: ${message}\n`);
    process.exit(1);
}
function isBrokenPipeError(error) {
    return error?.code === 'EPIPE' || error?.errno === -32 || /EPIPE|broken pipe/i.test(String(error?.message ?? error));
}
function safeStdoutWrite(value) {
    try {
        process.stdout.write(value);
    }
    catch (error) {
        if (isBrokenPipeError(error))
            process.exit(0);
        throw error;
    }
}
function parsePositiveIntegerOption(name, value) {
    if (!value || !/^\d+$/.test(value))
        fail(`${name} must be a positive integer`);
    const parsed = Number(value);
    if (!Number.isSafeInteger(parsed) || parsed < 1)
        fail(`${name} must be a positive integer`);
    return parsed;
}
function env(name) {
    const value = process.env[name];
    return value === undefined || value === '' ? undefined : value;
}
function configFile() {
    return env('PI_REMOTE_CONFIG') ?? DEFAULT_CONFIG_PATH;
}
function configGet(key, defaultValue = '') {
    const file = configFile();
    if (!fs.existsSync(file))
        return defaultValue;
    const content = fs.readFileSync(file, 'utf8');
    let result = '';
    for (const rawLine of content.split(/\r?\n/)) {
        const line = rawLine.trim();
        if (!line || line.startsWith('#'))
            continue;
        const eq = rawLine.indexOf('=');
        if (eq < 0)
            continue;
        const k = rawLine.slice(0, eq).trim();
        if (k === key)
            result = rawLine.slice(eq + 1).trim();
    }
    return result || defaultValue;
}
function shellQuote(value = '') {
    if (/^[A-Za-z0-9_./:@%+=,-]+$/.test(value))
        return value;
    return `'${value.replace(/'/g, `'\\''`)}'`;
}
function shellJoin(args) {
    return args.map((arg) => shellQuote(arg)).join(' ');
}
function run(command, args, options = {}) {
    return (0, node_child_process_1.spawnSync)(command, args, {
        cwd: options.cwd,
        input: options.input,
        encoding: 'utf8',
        stdio: options.stdio ?? 'pipe',
        env: process.env,
    });
}
function runOk(command, args, options = {}) {
    const result = run(command, args, options);
    return result.status === 0;
}
function restoreTerminal() {
    // If ssh/tmux disappears while an agent TUI is in raw/alternate-screen mode,
    // the local terminal can be left with hidden cursor, no echo, mouse reporting,
    // bracketed paste, or broken line discipline. Best-effort reset before printing
    // pi-remote prompts/errors. Use /dev/tty explicitly: spawnSync's default piped
    // stdin is not the controlling terminal, so plain `stty sane` can be a no-op.
    if (!process.stdin.isTTY && !process.stdout.isTTY && !fs.existsSync('/dev/tty'))
        return;
    try {
        run('bash', ['-lc', 'stty sane </dev/tty'], { stdio: 'ignore' });
    }
    catch { }
    const resetSequences = [
        '\x1b[?1049l', // leave alternate screen
        '\x1b[?47l',
        '\x1b[?25h', // show cursor
        '\x1b[?1l', // normal cursor keys
        '\x1b[?7h', // wraparound on
        '\x1b[?12l', // stop cursor blink mode
        '\x1b[?1000l', // mouse modes off
        '\x1b[?1002l',
        '\x1b[?1003l',
        '\x1b[?1004l', // focus events off
        '\x1b[?1005l',
        '\x1b[?1006l',
        '\x1b[?1015l',
        '\x1b[?2004l', // bracketed paste off
        '\x1b[0m', // attributes reset
        '\r\n',
    ].join('');
    try {
        fs.writeFileSync('/dev/tty', resetSequences);
    }
    catch {
        try {
            process.stdout.write(resetSequences);
        }
        catch { }
    }
}
let terminalCleanupInstalled = false;
function installTerminalCleanup() {
    if (terminalCleanupInstalled)
        return;
    terminalCleanupInstalled = true;
    process.once('exit', () => restoreTerminal());
    for (const signal of ['SIGINT', 'SIGTERM', 'SIGHUP']) {
        process.once(signal, () => {
            restoreTerminal();
            process.exit(signal === 'SIGINT' ? 130 : 129);
        });
    }
}
function askYesNo(prompt, defaultYes = true) {
    return new Promise((resolve) => {
        const rl = readline.createInterface({ input: process.stdin, output: process.stdout });
        const suffix = defaultYes ? ' [Y/n] ' : ' [y/N] ';
        rl.question(`${prompt}${suffix}`, (answer) => {
            rl.close();
            const normalized = answer.trim().toLowerCase();
            if (!normalized)
                resolve(defaultYes);
            else
                resolve(normalized === 'y' || normalized === 'yes');
        });
    });
}
function commandOutput(command, args, fallback = '') {
    const result = run(command, args);
    if (result.status !== 0)
        return fallback;
    return String(result.stdout ?? '').replace(/\n$/, '');
}
function sortWithSystemSort(lines, args = []) {
    if (!lines.length)
        return [];
    const result = run('sort', args, { input: `${lines.join('\n')}\n` });
    if (result.status !== 0)
        return [...lines].sort();
    return String(result.stdout ?? '').split(/\r?\n/).filter(Boolean);
}
function sanitizeName(raw = '') {
    const safe = raw.replace(/[^A-Za-z0-9._-]+/g, '-').replace(/^-+/, '').replace(/-+$/, '').replace(/-+/g, '-');
    if (!safe)
        throw new Error('empty name');
    return safe;
}
function validateExistingName(name = '') {
    return Boolean(name) && name !== '.' && name !== '..' && !name.includes('/');
}
function expandHomePath(value) {
    if (value === '~')
        return os.homedir();
    if (value.startsWith('~/'))
        return path.join(os.homedir(), value.slice(2));
    return value;
}
function listProjects(root) {
    fs.mkdirSync(root, { recursive: true });
    return sortWithSystemSort(fs.readdirSync(root, { withFileTypes: true })
        .filter((entry) => entry.isDirectory())
        .map((entry) => entry.name));
}
function tmuxConfigFile() {
    return env('PI_REMOTE_TMUX_CONFIG') ?? path.join(os.homedir(), '.tmux.conf');
}
function shouldSourceTmuxConfig() {
    const value = env('PI_REMOTE_TMUX_CONFIG_SOURCE') ?? '1';
    return !['0', 'false', 'FALSE', 'no', 'NO'].includes(value);
}
function tmuxConfigHasManagedBlock(file) {
    if (!fs.existsSync(file))
        return false;
    return /^# BEGIN pi-remote tmux (enhancements|defaults)$/m.test(fs.readFileSync(file, 'utf8'));
}
function tmuxConfigHasFeatures(file) {
    if (!fs.existsSync(file))
        return false;
    const content = fs.readFileSync(file, 'utf8');
    return content.includes('set -s extended-keys on') && content.includes('set -g xterm-keys on') && /help .*detach .*quit /.test(content);
}
function formatTmuxKey(key) {
    if (key.startsWith('C-')) {
        const suffix = key.slice(2);
        return `Ctrl+${suffix.length === 1 ? suffix.toUpperCase() : suffix}`;
    }
    if (key.startsWith('M-')) {
        const suffix = key.slice(2);
        return `Alt+${suffix.length === 1 ? suffix.toUpperCase() : suffix}`;
    }
    if (key === 'Space')
        return 'Space';
    return key;
}
function formatTmuxChord(prefix, key) {
    const prefixDisplay = formatTmuxKey(prefix);
    const keyDisplay = formatTmuxKey(key);
    return keyDisplay === '?' ? `${prefixDisplay}?` : `${prefixDisplay} ${keyDisplay}`;
}
function bindingKeyFor(keys, pattern, fallback) {
    for (const line of keys.split(/\r?\n/)) {
        const match = line.match(/^bind-key\s+-T\s+prefix\s+(\S+)\s+(.+)$/);
        if (!match)
            continue;
        const [, key, command] = match;
        if (pattern.test(command))
            return key;
    }
    return fallback;
}
function buildTmuxHelpHint(file) {
    let prefix = 'C-b';
    let keys = '';
    const homeTmux = path.join(os.homedir(), '.tmux.conf');
    if (file === homeTmux && runOk('tmux', ['show', '-gqv', 'prefix'])) {
        prefix = commandOutput('tmux', ['show', '-gqv', 'prefix'], 'C-b') || 'C-b';
        keys = commandOutput('tmux', ['list-keys', '-T', 'prefix'], '');
    }
    else {
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
    if (!quitKey)
        quitKey = bindingKeyFor(keys, /^(kill-window(\s|$)|confirm-before .*kill-window)/, '');
    if (!quitKey)
        quitKey = 'x';
    return `help ${formatTmuxChord(prefix, helpKey)}  detach ${formatTmuxChord(prefix, detachKey)}  quit ${formatTmuxChord(prefix, quitKey)}`;
}
function escapeSingleQuotes(value) {
    return value.replace(/'/g, `'\\''`);
}
function renderTmuxConfigBlock(hint) {
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
function replaceManagedBlock(content, block) {
    const lines = content.split(/\n/);
    const out = [];
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
        if (!inBlock)
            out.push(line);
    }
    let result = out.join('\n');
    if (!replaced) {
        if (result && !result.endsWith('\n'))
            result += '\n';
        result += `\n${block}`;
    }
    else if (!result.endsWith('\n')) {
        result += '\n';
    }
    return result;
}
function writeTTY(message) {
    try {
        fs.writeFileSync('/dev/tty', message);
    }
    catch {
        process.stdout.write(message);
    }
}
function applyRemoteTmuxConfig() {
    const file = tmuxConfigFile();
    fs.mkdirSync(path.dirname(file), { recursive: true });
    const hint = buildTmuxHelpHint(file);
    const block = renderTmuxConfigBlock(hint);
    let backup = '';
    if (fs.existsSync(file)) {
        backup = `${file}.backup-${new Date().toISOString().replace(/[-:]/g, '').replace(/T/, '-').slice(0, 15)}`;
        fs.copyFileSync(file, backup);
    }
    else {
        fs.writeFileSync(file, '');
    }
    const existing = fs.readFileSync(file, 'utf8');
    fs.writeFileSync(file, tmuxConfigHasManagedBlock(file) ? replaceManagedBlock(existing, block) : replaceManagedBlock(existing, block), { mode: 0o644 });
    const socket = `pi-remote-config-test-${process.pid}`;
    const validation = run('tmux', ['-L', socket, '-f', file, 'new-session', '-d', '-s', 'pi-remote-config-smoke', 'sleep 1']);
    if (validation.status !== 0) {
        if (backup && fs.existsSync(backup))
            fs.copyFileSync(backup, file);
        process.stderr.write('pi-remote: tmux config validation failed; restored previous config.\n');
        process.stderr.write(String(validation.stderr ?? ''));
        process.exit(1);
    }
    run('tmux', ['-L', socket, 'kill-server'], { stdio: 'ignore' });
    if (shouldSourceTmuxConfig())
        run('tmux', ['source-file', file], { stdio: 'ignore' });
    writeTTY(`Enhanced remote tmux config: ${file}\n`);
    writeTTY(`Status help hint: ${hint}\n`);
    if (backup)
        writeTTY(`Backup: ${backup}\n`);
}
function askTTY(prompt) {
    const script = `printf %s ${shellQuote(prompt)} >/dev/tty; IFS= read -r answer </dev/tty; printf %s "$answer"`;
    const result = run('bash', ['-lc', script]);
    if (result.status !== 0)
        return null;
    return String(result.stdout ?? '');
}
function promptRemoteTmuxConfig(force = false) {
    const file = tmuxConfigFile();
    if (!force && tmuxConfigHasFeatures(file))
        return;
    if (!fs.existsSync('/dev/tty'))
        return;
    const prompt = tmuxConfigHasFeatures(file)
        ? `Remote tmux config already has the pi-remote features. Recompute/update the managed help hint without changing the rest of ${file}? [y/N]: `
        : `Remote tmux config is missing current pi-remote features (extended keys + explicit shortcut hint). Enhance ${file} now without replacing existing settings? [y/N]: `;
    const answer = askTTY(prompt);
    if (answer && /^(y|Y|yes|YES)$/.test(answer))
        applyRemoteTmuxConfig();
    else
        writeTTY('Skipping remote tmux config update.\n');
}
function recentFile() {
    return env('PI_REMOTE_RECENTS') ?? path.join(os.homedir(), '.cache/pi-remote/recents.tsv');
}
function archiveFile() {
    return env('PI_REMOTE_ARCHIVE') ?? path.join(os.homedir(), '.cache/pi-remote/archive.json');
}
function emptyArchiveStore() {
    return { version: 1, entries: {} };
}
function readArchiveStore() {
    const file = archiveFile();
    if (!fs.existsSync(file))
        return emptyArchiveStore();
    try {
        const parsed = JSON.parse(fs.readFileSync(file, 'utf8'));
        if (!parsed || typeof parsed !== 'object' || !parsed.entries || typeof parsed.entries !== 'object')
            return emptyArchiveStore();
        const entries = {};
        for (const [key, entry] of Object.entries(parsed.entries)) {
            if (!entry || typeof entry !== 'object')
                continue;
            const kind = entry.kind;
            if (kind !== 'saved' && kind !== 'tmux')
                continue;
            entries[key] = { ...entry, kind, archivedAt: String(entry.archivedAt || '') };
        }
        return { version: 1, entries };
    }
    catch {
        return emptyArchiveStore();
    }
}
function writeArchiveStore(store) {
    const file = archiveFile();
    fs.mkdirSync(path.dirname(file), { recursive: true });
    const tmp = `${file}.${process.pid}.tmp`;
    fs.writeFileSync(tmp, `${JSON.stringify({ version: 1, entries: store.entries }, null, 2)}\n`, { mode: 0o600 });
    fs.renameSync(tmp, file);
}
function archiveKey(parts) {
    return JSON.stringify(parts);
}
function normalizedArchiveRoot(root) {
    return withoutTrailingSlashes(path.resolve(expandHomePath(root)));
}
function savedSessionArchiveKey(session) {
    return archiveKey(['saved', session.agent, path.resolve(expandHomePath(session.path))]);
}
function tmuxSessionArchiveKey(root, project, session) {
    return archiveKey(['tmux', normalizedArchiveRoot(root), project, session]);
}
function archiveModeFromOptions(options) {
    if (options.archivedOnly)
        return 'archived';
    return options.includeArchived ? 'include' : 'visible';
}
function shouldShowForArchiveMode(archived, mode) {
    if (mode === 'archived')
        return archived;
    if (mode === 'include')
        return true;
    return !archived;
}
function isSavedSessionArchived(store, session) {
    return Boolean(store.entries[savedSessionArchiveKey(session)]);
}
function isTmuxSessionArchived(store, root, project, session) {
    return Boolean(store.entries[tmuxSessionArchiveKey(root, project, session)]);
}
function archiveSavedSession(session) {
    const store = readArchiveStore();
    store.entries[savedSessionArchiveKey(session)] = {
        kind: 'saved',
        archivedAt: new Date().toISOString(),
        agent: session.agent,
        id: session.id,
        path: session.path,
        cwd: session.cwd,
        title: session.title,
    };
    writeArchiveStore(store);
}
function unarchiveSavedSession(session) {
    const store = readArchiveStore();
    delete store.entries[savedSessionArchiveKey(session)];
    writeArchiveStore(store);
}
function archiveTmuxSession(root, project, session) {
    const store = readArchiveStore();
    store.entries[tmuxSessionArchiveKey(root, project, session)] = {
        kind: 'tmux',
        archivedAt: new Date().toISOString(),
        projectRoot: normalizedArchiveRoot(root),
        project,
        session,
    };
    writeArchiveStore(store);
}
function unarchiveTmuxSession(root, project, session) {
    const store = readArchiveStore();
    delete store.entries[tmuxSessionArchiveKey(root, project, session)];
    writeArchiveStore(store);
}
function withoutTrailingSlashes(value) {
    return value.replace(/\/+$/, '') || '/';
}
function childPathPrefix(value) {
    const normalized = withoutTrailingSlashes(value);
    return normalized === '/' ? '/' : `${normalized}/`;
}
function projectNameFromDir(root, projectDir) {
    const relative = path.relative(path.resolve(root), path.resolve(projectDir));
    if (!relative || relative === '..' || relative.startsWith(`..${path.sep}`) || path.isAbsolute(relative))
        return path.basename(projectDir);
    return relative.split(path.sep)[0] ?? '';
}
function listProjectSessions(projectDir, root = '', project = '', mode = 'visible', archive = readArchiveStore()) {
    if (!runOk('tmux', ['-V']))
        return [];
    const output = commandOutput('tmux', ['list-panes', '-a', '-F', '#{session_name}\t#{pane_current_path}\t#{pane_current_command}'], '');
    const normalizedProjectDir = withoutTrailingSlashes(projectDir);
    const prefix = childPathPrefix(projectDir);
    const archiveRoot = root || path.dirname(projectDir);
    const archiveProject = project || projectNameFromDir(archiveRoot, projectDir);
    const sessions = new Set();
    for (const line of output.split(/\r?\n/)) {
        if (!line)
            continue;
        const [session, panePath] = line.split('\t');
        if (!session)
            continue;
        if (panePath === normalizedProjectDir || panePath?.startsWith(prefix)) {
            const archived = archiveProject ? isTmuxSessionArchived(archive, archiveRoot, archiveProject, session) : false;
            if (shouldShowForArchiveMode(archived, mode))
                sessions.add(session);
        }
    }
    return [...sessions].sort((a, b) => a.localeCompare(b));
}
function projectSessionsByProject(root, mode = 'visible', archive = readArchiveStore()) {
    const sessionsByProject = new Map();
    if (!runOk('tmux', ['-V']))
        return new Map();
    const meta = new Map();
    const sessionOutput = commandOutput('tmux', ['list-sessions', '-F', '#{session_name}\t#{session_created}\t#{session_activity}\t#{session_windows}\t#{session_attached}\t#{session_last_attached}'], '');
    for (const line of sessionOutput.split(/\r?\n/)) {
        if (!line)
            continue;
        const [name, created = '0', activity = '0', windows = '0', attached = '0', lastAttached = '0'] = line.split('\t');
        if (name)
            meta.set(name, { created: Number(created) || 0, activity: Number(activity) || 0, windows: Number(windows) || 0, attached: Number(attached) || 0, lastAttached: Number(lastAttached) || 0 });
    }
    const output = commandOutput('tmux', ['list-panes', '-a', '-F', '#{session_name}\t#{pane_current_path}\t#{pane_current_command}\t#{pane_title}'], '');
    const prefix = childPathPrefix(root);
    for (const line of output.split(/\r?\n/)) {
        const [session, panePath = '', command = '', title = ''] = line.split('\t');
        if (!session || !panePath.startsWith(prefix))
            continue;
        const project = panePath.slice(prefix.length).split('/')[0];
        if (!project)
            continue;
        const archived = isTmuxSessionArchived(archive, root, project, session);
        if (!shouldShowForArchiveMode(archived, mode))
            continue;
        if (!sessionsByProject.has(project))
            sessionsByProject.set(project, new Map());
        const projectSessions = sessionsByProject.get(project);
        const existing = projectSessions.get(session);
        if (existing) {
            existing.panes += 1;
            if (!existing.cwd || existing.cwd.length > panePath.length)
                existing.cwd = panePath;
            continue;
        }
        const sessionMeta = meta.get(session) ?? {};
        projectSessions.set(session, {
            name: session,
            cwd: panePath,
            command,
            title,
            created: sessionMeta.created ?? 0,
            activity: sessionMeta.activity ?? 0,
            windows: sessionMeta.windows ?? 0,
            panes: 1,
            attached: sessionMeta.attached ?? 0,
            lastAttached: sessionMeta.lastAttached ?? 0,
        });
    }
    return new Map([...sessionsByProject.entries()].map(([project, sessions]) => [project, [...sessions.values()].sort((a, b) => (b.activity - a.activity) || a.name.localeCompare(b.name))]));
}
function projectSessionCounts(root, mode = 'visible', archive = readArchiveStore()) {
    return new Map([...projectSessionsByProject(root, mode, archive).entries()].map(([project, sessions]) => [project, sessions.length]));
}
function tmuxSessionAge(session) {
    const timestamp = session.activity || session.created;
    return timestamp > 0 ? savedSessionAge(timestamp * 1000) : '  ?';
}
function tmuxSessionLabel(session, saved, maxWidth = 112) {
    const width = Math.max(40, maxWidth);
    const summary = saved?.title && saved.title !== '(untitled)' ? saved.title : session.title || session.command || session.name;
    const prefix = `tmux  ${tmuxSessionAge(session).padStart(5)}  `;
    const id = saved?.id ? saved.id.slice(0, 8) : '--------';
    const suffixParts = [`${session.windows || 1}w/${session.panes || 1}p`, id];
    if (session.attached > 0)
        suffixParts.push('attached');
    const suffix = `  ${suffixParts.join(' ')}`;
    const available = width - prefix.length - suffix.length - 2;
    return fitLine(`${prefix}${clipEnd(summary, Math.max(8, available))}${suffix}`, width);
}
function formatDateTime(value) {
    const pad = (part) => String(part).padStart(2, '0');
    return `${value.getFullYear()}/${pad(value.getMonth() + 1)}/${pad(value.getDate())} ${pad(value.getHours())}:${pad(value.getMinutes())}`;
}
function formatUnixDateTime(seconds) {
    return seconds > 0 ? formatDateTime(new Date(seconds * 1000)) : 'unknown';
}
function formatMsDateTime(ms) {
    return ms > 0 ? formatDateTime(new Date(ms)) : 'unknown';
}
function tmuxSessionDetails(session, saved, maxWidth = 112) {
    const active = formatUnixDateTime(session.activity);
    const created = formatUnixDateTime(session.created);
    const connected = session.lastAttached ? formatUnixDateTime(session.lastAttached) : (session.attached ? 'currently attached' : 'unknown');
    const summary = saved?.title && saved.title !== '(untitled)' ? saved.title : session.title || '(no summary available)';
    return [
        fitLine(`      summary: ${summary}`, maxWidth),
        fitLine(`      pi session id: ${saved?.id ?? 'unknown'}  agent: ${saved?.agent ?? (session.command || 'unknown')}  command: ${session.command || 'unknown'}`, maxWidth),
        fitLine(`      started: ${created}  last connected: ${connected}  last updated: ${active}`, maxWidth),
        fitLine(`      windows: ${session.windows || 1}  panes: ${session.panes || 1}  attached clients: ${session.attached || 0}`, maxWidth),
    ];
}
function savedSessionDetails(session, maxWidth = 112) {
    const cwdRaw = session.cwd.replace(os.homedir(), '~');
    const modified = formatMsDateTime(session.modified);
    return [
        fitLine(`      title: ${session.title || '(untitled)'}`, maxWidth),
        fitLine(`      cwd: ${cwdRaw}`, maxWidth),
        fitLine(`      id: ${session.id}  model: ${session.model || 'unknown'}  messages: ${session.messageCount}  modified: ${modified}`, maxWidth),
    ];
}
function projectRecentTimes(root) {
    const file = recentFile();
    const recents = new Map();
    if (!fs.existsSync(file))
        return recents;
    for (const line of fs.readFileSync(file, 'utf8').split(/\r?\n/)) {
        const [timestamp, rowRoot, project] = line.split('\t');
        if (rowRoot !== root || !project)
            continue;
        const value = Number(timestamp) || 0;
        if (value > (recents.get(project) ?? 0))
            recents.set(project, value);
    }
    return recents;
}
function projectMenuRows(root, savedByProject = new Map()) {
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
function recordRecentProject(root, project) {
    if (!project)
        return;
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
function newestJsonlFiles(root, limit) {
    if (!fs.existsSync(root))
        return [];
    const files = [];
    const walk = (dir) => {
        let entries;
        try {
            entries = fs.readdirSync(dir, { withFileTypes: true });
        }
        catch {
            return;
        }
        for (const entry of entries) {
            const file = path.join(dir, entry.name);
            if (entry.isDirectory())
                walk(file);
            else if (entry.isFile() && entry.name.endsWith('.jsonl')) {
                try {
                    files.push({ file, mtime: fs.statSync(file).mtimeMs });
                }
                catch {
                    // Ignore files that disappear while scanning.
                }
            }
        }
    };
    walk(root);
    files.sort((a, b) => b.mtime - a.mtime);
    return files.slice(0, limit).map((row) => row.file);
}
function safeJson(line) {
    try {
        return JSON.parse(line);
    }
    catch {
        return null;
    }
}
const SAVED_SESSION_SCAN_BYTES = 256 * 1024;
function readSavedSessionPrefix(file, stat) {
    if (stat.size <= SAVED_SESSION_SCAN_BYTES)
        return fs.readFileSync(file, 'utf8');
    const fd = fs.openSync(file, 'r');
    try {
        const buffer = Buffer.allocUnsafe(SAVED_SESSION_SCAN_BYTES);
        const bytesRead = fs.readSync(fd, buffer, 0, SAVED_SESSION_SCAN_BYTES, 0);
        const text = buffer.subarray(0, bytesRead).toString('utf8');
        const lastNewline = text.lastIndexOf('\n');
        return lastNewline >= 0 ? text.slice(0, lastNewline + 1) : text;
    }
    finally {
        fs.closeSync(fd);
    }
}
function savedSessionScanLines(file, stat) {
    return readSavedSessionPrefix(file, stat).split(/\r?\n/);
}
function contentToText(content) {
    if (typeof content === 'string')
        return content;
    if (!Array.isArray(content))
        return '';
    return content.map((block) => {
        if (typeof block === 'string')
            return block;
        if (!block || typeof block !== 'object')
            return '';
        if (typeof block.text === 'string')
            return block.text;
        if (typeof block.input_text === 'string')
            return block.input_text;
        return '';
    }).filter(Boolean).join('\n');
}
function cleanTitle(text) {
    const normalized = text.replace(/\s+/g, ' ').trim();
    if (!normalized)
        return '(untitled)';
    return normalized.length > 120 ? `${normalized.slice(0, 119).trim()}…` : normalized;
}
function parsePiSavedSession(file) {
    let header = null;
    let name = '';
    let firstUser = '';
    let model = '';
    let messageCount = 0;
    let stat;
    try {
        stat = fs.statSync(file);
        const lines = savedSessionScanLines(file, stat);
        for (let index = 0; index < lines.length; index += 1) {
            const entry = safeJson(lines[index]);
            if (!entry)
                continue;
            if (index === 0 && entry.type === 'session')
                header = entry;
            else if (entry.type === 'session_info' && typeof entry.name === 'string')
                name = entry.name.trim();
            else if (entry.type === 'model_change')
                model = [entry.provider, entry.modelId].filter(Boolean).join('/');
            else if (entry.type === 'message' && entry.message) {
                const role = entry.message.role;
                if (role === 'user' || role === 'assistant')
                    messageCount += 1;
                if (role === 'user' && !firstUser)
                    firstUser = contentToText(entry.message.content);
            }
        }
    }
    catch {
        return null;
    }
    if (!header || typeof header.id !== 'string')
        return null;
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
function looksLikeCodexBootstrapText(text) {
    const trimmed = text.trim();
    return !trimmed || trimmed.startsWith('# AGENTS.md instructions') || trimmed.startsWith('<environment_context>') || trimmed.startsWith('<permissions instructions>');
}
function parseCodexSavedSession(file) {
    let id = '';
    let cwd = os.homedir();
    let created = '';
    let firstUser = '';
    let model = '';
    let messageCount = 0;
    let stat;
    try {
        stat = fs.statSync(file);
        const lines = savedSessionScanLines(file, stat);
        for (const line of lines) {
            const entry = safeJson(line);
            if (!entry)
                continue;
            const payload = entry.payload && typeof entry.payload === 'object' ? entry.payload : {};
            if (entry.type === 'session_meta') {
                if (payload.id)
                    id = String(payload.id);
                cwd = String(payload.cwd || cwd);
                created = String(payload.timestamp || entry.timestamp || created || '');
            }
            else if (entry.type === 'turn_context') {
                cwd = String(payload.cwd || cwd);
                if (payload.model)
                    model = String(payload.model);
            }
            else if (entry.type === 'event_msg') {
                const eventType = payload.type;
                if (eventType === 'user_message') {
                    messageCount += 1;
                    if (!firstUser && typeof payload.message === 'string' && !looksLikeCodexBootstrapText(payload.message))
                        firstUser = payload.message;
                }
                else if (typeof eventType === 'string' && eventType.startsWith('agent_message')) {
                    messageCount += 1;
                }
            }
            else if (entry.type === 'response_item' && payload.type === 'message') {
                if (payload.role === 'user' || payload.role === 'assistant')
                    messageCount += 1;
                if (payload.role === 'user' && !firstUser) {
                    const text = contentToText(payload.content);
                    if (!looksLikeCodexBootstrapText(text))
                        firstUser = text;
                }
            }
        }
    }
    catch {
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
function savedSessionFilter(options) {
    if (options.explicitAgent && (options.agent === 'pi' || options.agent === 'codex'))
        return options.agent;
    return options.savedAgent;
}
function savedAgentMatchesFilter(agent, filter) {
    return filter === 'all' || filter === agent;
}
function maybeAddSavedSession(sessions, seen, session, archive, mode) {
    if (!session)
        return;
    const key = savedSessionArchiveKey(session);
    if (seen.has(key))
        return;
    session.archived = isSavedSessionArchived(archive, session);
    if (!shouldShowForArchiveMode(Boolean(session.archived), mode))
        return;
    seen.add(key);
    sessions.push(session);
}
function parseArchivedSavedSession(entry) {
    if (entry.kind !== 'saved' || !entry.path || (entry.agent !== 'pi' && entry.agent !== 'codex'))
        return null;
    const session = entry.agent === 'pi' ? parsePiSavedSession(entry.path) : parseCodexSavedSession(entry.path);
    if (!session)
        return null;
    session.archived = true;
    return session;
}
function archivedSavedSessionsForFilter(filter, archive) {
    const sessions = [];
    const seen = new Set();
    for (const entry of Object.values(archive.entries)) {
        const session = parseArchivedSavedSession(entry);
        if (!session || !savedAgentMatchesFilter(session.agent, filter))
            continue;
        const key = savedSessionArchiveKey(session);
        if (seen.has(key))
            continue;
        seen.add(key);
        sessions.push(session);
    }
    sessions.sort((a, b) => b.modified - a.modified);
    return sessions;
}
function listSavedSessionsForFilter(filter, limit, mode = 'visible', archive = readArchiveStore()) {
    if (mode === 'archived')
        return archivedSavedSessionsForFilter(filter, archive).slice(0, limit);
    const sessions = [];
    const seen = new Set();
    const scanLimit = mode === 'visible' ? Math.max(limit * 5, limit + 200) : limit;
    if (filter === 'all' || filter === 'pi') {
        for (const file of newestJsonlFiles(path.join(os.homedir(), '.pi/agent/sessions'), scanLimit)) {
            maybeAddSavedSession(sessions, seen, parsePiSavedSession(file), archive, mode);
        }
    }
    if (filter === 'all' || filter === 'codex') {
        for (const file of newestJsonlFiles(path.join(os.homedir(), '.codex/sessions'), scanLimit)) {
            maybeAddSavedSession(sessions, seen, parseCodexSavedSession(file), archive, mode);
        }
    }
    if (mode === 'include') {
        for (const session of archivedSavedSessionsForFilter(filter, archive)) {
            maybeAddSavedSession(sessions, seen, session, archive, mode);
        }
    }
    sessions.sort((a, b) => b.modified - a.modified);
    return sessions.slice(0, limit);
}
function listSavedSessions(options) {
    return listSavedSessionsForFilter(savedSessionFilter(options), options.savedSessionLimit, archiveModeFromOptions(options));
}
function projectNameForCwd(root, cwd) {
    const rootPath = path.resolve(root);
    const cwdPath = path.resolve(expandHomePath(cwd || os.homedir()));
    const relative = path.relative(rootPath, cwdPath);
    if (!relative || relative === '..' || relative.startsWith(`..${path.sep}`) || path.isAbsolute(relative))
        return '';
    const project = relative.split(path.sep)[0] ?? '';
    return validateExistingName(project) ? project : '';
}
function savedSessionsByProject(root, filter, limit, projects = new Set(listProjects(root)), mode = 'visible', archive = readArchiveStore()) {
    const byProject = new Map();
    for (const session of listSavedSessionsForFilter(filter, limit, mode, archive)) {
        const project = projectNameForCwd(root, session.cwd);
        if (!project || !projects.has(project))
            continue;
        if (!byProject.has(project))
            byProject.set(project, []);
        byProject.get(project)?.push(session);
    }
    for (const sessions of byProject.values())
        sessions.sort((a, b) => b.modified - a.modified);
    return byProject;
}
function savedSessionAge(modified) {
    const seconds = Math.max(0, Math.floor((Date.now() - modified) / 1000));
    if (seconds < 3600)
        return `${Math.floor(seconds / 60)}m`;
    if (seconds < 86400)
        return `${Math.floor(seconds / 3600)}h`;
    if (seconds < 86400 * 30)
        return `${Math.floor(seconds / 86400)}d`;
    return `${Math.floor(seconds / (86400 * 30))}mo`;
}
function oneLine(value) {
    return value.replace(/[\t\r\n]/g, ' ');
}
function clipEnd(value, max) {
    const clean = oneLine(value);
    if (max <= 0)
        return '';
    const chars = Array.from(clean);
    if (chars.length <= max)
        return clean;
    if (max === 1)
        return '…';
    return `${chars.slice(0, max - 1).join('')}…`;
}
function clipStart(value, max) {
    const clean = oneLine(value);
    if (max <= 0)
        return '';
    const chars = Array.from(clean);
    if (chars.length <= max)
        return clean;
    if (max === 1)
        return '…';
    return `…${chars.slice(chars.length - max + 1).join('')}`;
}
const ANSI_PATTERN = /\x1b\[[0-?]*[ -/]*[@-~]/g;
const HAS_ANSI_PATTERN = /\x1b\[[0-?]*[ -/]*[@-~]/;
function visibleLength(value) {
    return Array.from(oneLine(value).replace(ANSI_PATTERN, '')).length;
}
function clipEndAnsi(value, max) {
    const clean = oneLine(value);
    if (max <= 0)
        return '';
    if (visibleLength(clean) <= max)
        return clean;
    const target = max === 1 ? 0 : max - 1;
    let visible = 0;
    let out = '';
    let index = 0;
    for (const match of clean.matchAll(ANSI_PATTERN)) {
        const ansiIndex = match.index ?? 0;
        for (const char of Array.from(clean.slice(index, ansiIndex))) {
            if (visible >= target)
                return `${out}${max === 1 ? '…' : '…'}\x1b[0m`;
            out += char;
            visible += 1;
        }
        out += match[0];
        index = ansiIndex + match[0].length;
    }
    for (const char of Array.from(clean.slice(index))) {
        if (visible >= target)
            return `${out}${max === 1 ? '…' : '…'}\x1b[0m`;
        out += char;
        visible += 1;
    }
    return `${out}\x1b[0m`;
}
function fitLine(value, max) {
    return HAS_ANSI_PATTERN.test(value) ? clipEndAnsi(value, max) : clipEnd(value, max);
}
const TERMINAL_TITLE_MAX = 160;
function cleanTerminalTitleText(value) {
    return value.replace(/[\x00-\x1f\x7f-\x9f]/g, ' ').replace(/\s+/g, ' ').trim();
}
function terminalTitle(parts) {
    return clipEnd(parts.map(cleanTerminalTitleText).filter(Boolean).join(' · '), TERMINAL_TITLE_MAX);
}
function setTerminalTitle(title) {
    const safeTitle = terminalTitle([title]);
    if (!safeTitle)
        return;
    const sequence = `\x1b]0;${safeTitle}\x07`;
    try {
        fs.writeFileSync('/dev/tty', sequence);
    }
    catch {
        if (process.stdout.isTTY)
            process.stdout.write(sequence);
    }
}
function projectTerminalTitle(projectName, agent, sessionName, explicitSession) {
    const detail = explicitSession && sessionName ? sessionName : agent;
    return terminalTitle([projectName, detail]);
}
function savedSessionTerminalTitle(session, options) {
    const projectName = projectNameForCwd(options.projectRoot, session.cwd);
    const sessionTitle = cleanTerminalTitleText(session.title);
    if (projectName && sessionTitle && sessionTitle !== '(untitled)')
        return terminalTitle([projectName, `${session.agent}: ${sessionTitle}`]);
    if (projectName)
        return terminalTitle([projectName, session.agent]);
    if (sessionTitle && sessionTitle !== '(untitled)')
        return terminalTitle([session.agent, sessionTitle]);
    return terminalTitle([session.agent, path.basename(session.cwd) || session.id.slice(0, 12)]);
}
function terminalColumns() {
    const columns = process.stdout.columns;
    return columns && Number.isFinite(columns) ? Math.max(20, columns) : 80;
}
function menuLabelWidth() {
    return Math.max(40, terminalColumns() - 4);
}
function savedSessionLabel(session, maxWidth = 112) {
    const width = Math.max(40, maxWidth);
    const cwdRaw = session.cwd.replace(os.homedir(), '~');
    const shortId = session.id.slice(0, 12);
    const prefix = `${session.agent.padEnd(5)} ${savedSessionAge(session.modified).padStart(5)}  `;
    const suffix = session.archived ? `  ${shortId} archived` : `  ${shortId}`;
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
function printSavedSessions(sessions) {
    for (const [index, session] of sessions.entries()) {
        safeStdoutWrite(`${String(index + 1).padStart(3, '0')}  ${savedSessionLabel(session)}\n`);
    }
}
function savedTmuxSessionName(session) {
    return sanitizeName(`pi-remote-${session.agent}-${session.id}`).slice(0, 48);
}
function resolveSavedAgentCommand(agent, explicitCommand) {
    if (explicitCommand)
        return explicitCommand;
    // Saved-session resumes need the selected agent's resume/session subcommand;
    // launch_command is intentionally only used for generic project launches.
    if (agent === 'pi')
        return env('PI_REMOTE_PI_BIN') ?? configGet('pi_command', 'pi');
    return env('PI_REMOTE_CODEX_BIN') ?? configGet('codex_command', 'codex');
}
function savedSessionCommand(session, explicitCommand, agentArgs) {
    const base = resolveSavedAgentCommand(session.agent, explicitCommand);
    checkLaunchCommandExists(base);
    const suffix = agentArgs.length ? ` ${shellJoin(agentArgs)}` : '';
    if (session.agent === 'pi')
        return `${base} --session ${shellQuote(session.path)}${suffix}`;
    return `${base} resume ${shellQuote(session.id)}${suffix}`;
}
async function attachSavedSession(session, options) {
    const sessionName = sanitizeName(options.sessionName || savedTmuxSessionName(session));
    const title = savedSessionTerminalTitle(session, options);
    if (sessionExists(sessionName)) {
        if (options.noAttach || options.dryRun) {
            process.stdout.write(`tmux session already exists: ${sessionName}\n`);
            process.stdout.write(`attach with: ${attachCommand(sessionName)}\n`);
            return;
        }
        setTerminalTitle(title);
        const attach = run('tmux', ['attach', '-t', sessionName], { stdio: 'inherit' });
        if (attach.error)
            fail(`failed to run tmux: ${attach.error.message}`);
        process.exit(attach.status ?? 1);
    }
    const agentCommand = savedSessionCommand(session, options.explicitCommand, options.agentArgs);
    if (options.dryRun) {
        process.stdout.write(`host=${os.hostname()}\nsaved_session=${session.path}\ncwd=${session.cwd}\ntmux_session=${sessionName}\nagent=${session.agent}\nattach=${options.noAttach ? 'no' : 'yes'}\ncommand=${agentCommand}\n`);
        return;
    }
    if (options.noAttach) {
        const created = run('tmux', ['new-session', '-d', '-s', sessionName, '-c', session.cwd, agentCommand]);
        if (created.status !== 0)
            fail(String(created.stderr ?? 'failed to start tmux session'));
        process.stdout.write(`started detached tmux session: ${sessionName}\ncwd: ${session.cwd}\nagent: ${session.agent}\nattach with: ${attachCommand(sessionName)}\n`);
        return;
    }
    setTerminalTitle(title);
    const attached = run('tmux', ['new-session', '-s', sessionName, '-c', session.cwd, agentCommand], { stdio: 'inherit' });
    if (attached.error)
        fail(`failed to run tmux: ${attached.error.message}`);
    process.exit(attached.status ?? 1);
}
async function runSavedSessions(options) {
    const sessions = listSavedSessions(options);
    if (options.doList) {
        printSavedSessions(sessions);
        return;
    }
    if (!sessions.length)
        fail(`no saved sessions found for agent filter '${savedSessionFilter(options)}'`);
    if (!process.stdin.isTTY)
        fail('interactive saved-session menu needs a TTY; pass --list for non-interactive use');
    const labels = sessions.map((session) => savedSessionLabel(session, menuLabelWidth()));
    const choice = await arrowSelect(`${splashLine()} — Saved Pi/Codex sessions on ${os.hostname()} (↑/↓ or j/k, Enter)`, labels);
    if (choice === null)
        return;
    await attachSavedSession(sessions[choice], options);
}
function printLines(lines) {
    if (lines.length > 0)
        safeStdoutWrite(`${lines.join('\n')}\n`);
}
function terminalRows() {
    return process.stdout.rows && Number.isFinite(process.stdout.rows) ? process.stdout.rows : 24;
}
function menuVisibleRows(maxItems) {
    const visible = Math.max(5, Math.min(20, terminalRows() - 4));
    return maxItems === undefined ? visible : Math.min(maxItems, visible);
}
function renderArrowMenu(prompt, selected, offset, visible, items) {
    const columns = terminalColumns();
    const lineWidth = Math.max(1, columns - 1);
    const labelWidth = Math.max(1, columns - 3);
    process.stdout.write(`\r\x1b[K${fitLine(prompt, lineWidth)}\n`);
    for (let row = 0; row < visible; row += 1) {
        const index = offset + row;
        if (index < items.length) {
            const label = fitLine(items[index], labelWidth);
            process.stdout.write(index === selected ? `\x1b[K\x1b[7m› ${label}\x1b[0m\n` : `\x1b[K  ${label}\n`);
        }
        else {
            process.stdout.write('\x1b[K\n');
        }
    }
    process.stdout.write(`\x1b[K${fitLine(`[${selected + 1}/${items.length}] ↑/↓ or j/k, Enter`, lineWidth)}\n`);
}
function keyName(chunk) {
    const value = chunk.toString('utf8');
    if (value === '\u0001')
        return 'ctrl-a';
    if (value === '\u0003')
        return 'ctrl-c';
    if (value === '\u0012')
        return 'ctrl-r';
    if (value === '\u0015')
        return 'ctrl-u';
    if (value === '\u0018')
        return 'ctrl-x';
    if (value === '\u007f' || value === '\b')
        return 'backspace';
    if (value === '\u001b')
        return 'escape';
    if (value === '\r' || value === '\n')
        return 'enter';
    if (value === '\u001b[13;2u' || value === '\u001b[27;2;13~' || value === '\u001b\r' || value === '\u001b\n')
        return 'shift-enter';
    if (value === '\u001b[A' || value === '\u001bOA')
        return 'up';
    if (value === '\u001b[B' || value === '\u001bOB')
        return 'down';
    if (value === '\u001b[C' || value === '\u001bOC')
        return 'right';
    if (value === '\u001b[D' || value === '\u001bOD')
        return 'left';
    if (value === '\u001b[3~')
        return 'delete';
    return value;
}
function readKey() {
    return new Promise((resolve) => {
        process.stdin.once('data', (chunk) => resolve(keyName(chunk)));
    });
}
async function arrowSelect(prompt, items) {
    if (!items.length || !process.stdin.isTTY)
        return null;
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
            if (key === 'ctrl-c')
                process.exit(130);
            if (key === 'up' || key === 'k' || key === 'K') {
                selected -= 1;
                redraw = true;
            }
            else if (key === 'down' || key === 'j' || key === 'J') {
                selected += 1;
                redraw = true;
            }
            else if (key === 'q' || key === 'Q')
                return null;
            else if (key === 'enter')
                return selected;
            if (redraw) {
                if (selected < 0)
                    selected = items.length - 1;
                else if (selected >= items.length)
                    selected = 0;
                if (selected < offset)
                    offset = selected;
                else if (selected >= offset + visible)
                    offset = selected - visible + 1;
                process.stdout.write(`\x1b[${lines}A`);
                renderArrowMenu(prompt, selected, offset, visible, items);
            }
        }
    }
    finally {
        process.stdin.setRawMode(false);
        process.stdin.pause();
        process.stdout.write('\x1b[?25h\n');
    }
}
function expandedContains(expanded, project) {
    return expanded.includes(`|${project}|`);
}
function projectSessionSummary(activeCount, savedCount) {
    const parts = [];
    if (activeCount > 0)
        parts.push(`${activeCount} active`);
    if (savedCount > 0)
        parts.push(`${savedCount} saved`);
    return parts.length ? parts.join(', ') : '0';
}
function projectMatchesFilter(project, filterNeedle) {
    return !filterNeedle || project.toLowerCase().includes(filterNeedle);
}
function removeLastInputCharacter(value) {
    const chars = Array.from(value);
    chars.pop();
    return chars.join('');
}
function isProjectFilterKey(key) {
    return /^[ -~]$/.test(key);
}
function projectTreePrompt(root, filter) {
    const base = `${splashLine()} — Projects on ${os.hostname()} in ${root}`;
    return filter ? `${base} — filter: ${filter}` : base;
}
function buildProjectTreeSnapshot(root, savedFilter = 'all', savedLimit = 120, mode = 'visible') {
    const archive = readArchiveStore();
    const projectNames = listProjects(root);
    const projectSet = new Set(projectNames);
    const activeByProject = projectSessionsByProject(root, mode, archive);
    const savedByProject = savedSessionsByProject(root, savedFilter, savedLimit, projectSet, mode, archive);
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
    return { root, projects, archive };
}
function buildProjectTreeRowsFromSnapshot(snapshot, expanded, filter = '', expandedItems = '|') {
    const rows = [{ type: 'parent', project: '', session: '', label: '..' }];
    const savedLabelWidth = Math.max(36, menuLabelWidth() - 6);
    const filterNeedle = filter.trim().toLowerCase();
    for (const { project, count, savedCount, activeSessions, savedSessions } of snapshot.projects) {
        if (!projectMatchesFilter(project, filterNeedle))
            continue;
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
            const activeSavedKeys = new Set();
            const savedForTmux = (tmux) => {
                const match = savedSessions.find((saved) => savedTmuxSessionName(saved) === tmux.name);
                if (match)
                    activeSavedKeys.add(savedSessionArchiveKey(match));
                return match;
            };
            for (const tmux of activeSessions) {
                const saved = savedForTmux(tmux);
                const archived = isTmuxSessionArchived(snapshot.archive, snapshot.root, project, tmux.name);
                const itemKey = `${project}/tmux/${tmux.name}`;
                const itemExpanded = expandedContains(expandedItems, itemKey);
                rows.push({ type: 'session', project, session: tmux.name, tmux, saved, archived, expandable: true, expanded: itemExpanded, label: `    ${itemExpanded ? '▾' : '▸'} ● ${archived ? '[archived] ' : ''}${tmuxSessionLabel(tmux, saved, savedLabelWidth)}` });
                if (itemExpanded) {
                    for (const detail of tmuxSessionDetails(tmux, saved, savedLabelWidth))
                        rows.push({ type: 'detail', project, session: tmux.name, label: detail });
                    rows.push({ type: 'terminate', project, session: tmux.name, label: '      ⚠ TERMINATE tmux session — destructive action' });
                }
            }
            for (const saved of savedSessions) {
                if (activeSavedKeys.has(savedSessionArchiveKey(saved)))
                    continue;
                const archived = Boolean(saved.archived);
                const itemKey = `${project}/saved/${saved.agent}/${saved.id}`;
                const itemExpanded = expandedContains(expandedItems, itemKey);
                rows.push({ type: 'saved', project, session: '', saved, archived, expandable: true, expanded: itemExpanded, label: `    ${itemExpanded ? '▾' : '▸'} ◷ ${archived ? '[archived] ' : ''}${savedSessionLabel(saved, savedLabelWidth)}` });
                if (itemExpanded)
                    for (const detail of savedSessionDetails(saved, savedLabelWidth))
                        rows.push({ type: 'detail', project, session: '', label: detail });
            }
        }
    }
    rows.push({ type: 'create', project: '', session: '', label: 'Create a new project' });
    rows.push({ type: 'quit', project: '', session: '', label: 'Quit' });
    return rows;
}
function buildProjectTreeRows(root, expanded, savedFilter = 'all', savedLimit = 120, filter = '', mode = 'visible') {
    return buildProjectTreeRowsFromSnapshot(buildProjectTreeSnapshot(root, savedFilter, savedLimit, mode), expanded, filter);
}
function projectTreeRowLabel(row, selected, confirmTerminateSession = '') {
    if (selected && row.type === 'terminate' && confirmTerminateSession === row.session)
        return `${row.label}  Really terminate? y/N`;
    if (selected && row.type === 'parent')
        return `${row.label}  Enter=open parent`;
    if (!selected || (row.type !== 'project' && row.type !== 'session' && row.type !== 'saved'))
        return row.label;
    if (row.type === 'session')
        return `${row.label}  ${row.expanded ? '← details' : '→ details'} · Enter=attach`;
    if (row.type === 'saved')
        return `${row.label}  ${row.expanded ? '← details' : '→ details'} · Enter=resume`;
    if (row.expandable) {
        return `${row.label}  ${row.expanded ? '← collapse' : '→ expand'} · Enter=open · s=new session`;
    }
    return `${row.label}  Enter=open · s=new session`;
}
function projectTreeFilterHint(filter) {
    return filter ? `  filter: ${filter}  Backspace edit Ctrl+U clear` : '  type to filter';
}
function projectTreeFooter(selected, rows, filter = '') {
    const position = `[${selected + 1}/${rows.length}]`;
    const current = rows[selected];
    const hint = projectTreeFilterHint(filter);
    if (!current)
        return `${position} ↑/↓ move  Enter select${hint}`;
    if (current.type === 'parent')
        return `${position} ↑/↓ move  Enter parent  Backspace parent${hint}`;
    if (current.type === 'project') {
        return current.expandable
            ? `${position} ↑/↓ move  Enter open  → expand/open  ← collapse/parent  s new session  n new folder  q quit${hint}`
            : `${position} ↑/↓ move  Enter open  s new session  n new folder  q quit${hint}`;
    }
    if (current.type === 'session' || current.type === 'saved') {
        const archiveHint = current.archived ? 'Ctrl+R restore' : 'Ctrl+A archive';
        const closeHint = current.type === 'session' ? 'terminate in details' : 'Ctrl+X close/archive';
        const detailHint = '  ←/→ details';
        return `${position} ↑/↓ move  Enter resume${detailHint}  ${archiveHint}  ${closeHint}${hint}`;
    }
    if (current.type === 'terminate')
        return `${position} ↑/↓ move  Enter terminate tmux session${hint}`;
    return `${position} ↑/↓ move  Enter select${hint}`;
}
function renderProjectTreeMenu(prompt, selected, offset, visible, rows, filter = '', confirmTerminateSession = '') {
    const columns = terminalColumns();
    const lineWidth = Math.max(1, columns - 1);
    const labelWidth = Math.max(1, columns - 3);
    process.stdout.write(`\r\x1b[K${fitLine(prompt, lineWidth)}\n`);
    for (let row = 0; row < visible; row += 1) {
        const index = offset + row;
        if (index < rows.length) {
            const rowItem = rows[index];
            const label = fitLine(projectTreeRowLabel(rowItem, index === selected, confirmTerminateSession), labelWidth);
            if (index === selected && rowItem.type === 'terminate')
                process.stdout.write(`\x1b[K\x1b[41;97;1m! ${label}\x1b[0m\n`);
            else
                process.stdout.write(index === selected ? `\x1b[K\x1b[7m› ${label}\x1b[0m\n` : `\x1b[K  ${label}\n`);
        }
        else {
            process.stdout.write('\x1b[K\n');
        }
    }
    process.stdout.write(`\x1b[K${fitLine(projectTreeFooter(selected, rows, filter), lineWidth)}\n`);
}
function askLine(prompt) {
    const rl = readline.createInterface({ input: process.stdin, output: process.stdout });
    return new Promise((resolve) => rl.question(prompt, (answer) => { rl.close(); resolve(answer); }));
}
async function pickProjectMenu(root, options) {
    if (!process.stdin.isTTY)
        fail('interactive project menu needs a TTY; pass --project NAME or --new NAME for non-interactive use');
    let currentRoot = root;
    let expanded = '|';
    let expandedItems = '|';
    let selected = 1;
    let offset = 0;
    let filter = '';
    let status = '';
    let confirmTerminateSession = '';
    const savedFilter = savedSessionFilter(options);
    const mode = archiveModeFromOptions(options);
    let snapshot = buildProjectTreeSnapshot(currentRoot, savedFilter, options.savedSessionLimit, mode);
    let rows = buildProjectTreeRowsFromSnapshot(snapshot, expanded, filter, expandedItems);
    const visible = menuVisibleRows();
    const lines = visible + 2;
    const prompt = () => status ? `${projectTreePrompt(currentRoot, filter)} — ${status}` : projectTreePrompt(currentRoot, filter);
    const clampSelection = () => {
        if (selected < 0)
            selected = rows.length - 1;
        else if (selected >= rows.length)
            selected = 0;
        if (selected < offset)
            offset = selected;
        else if (selected >= offset + visible)
            offset = selected - visible + 1;
        if (offset < 0)
            offset = 0;
    };
    const rebuildRowsForFilter = () => {
        rows = buildProjectTreeRowsFromSnapshot(snapshot, expanded, filter, expandedItems);
        selected = rows.length > 1 ? 1 : 0;
        offset = 0;
    };
    const rebuildSnapshot = (preferredProject = '') => {
        snapshot = buildProjectTreeSnapshot(currentRoot, savedFilter, options.savedSessionLimit, mode);
        rows = buildProjectTreeRowsFromSnapshot(snapshot, expanded, filter, expandedItems);
        if (preferredProject) {
            const projectIndex = rows.findIndex((row) => row.type === 'project' && row.project === preferredProject);
            if (projectIndex >= 0)
                selected = projectIndex;
        }
        else if (selected === 0 && rows.length > 1) {
            selected = 1;
        }
        clampSelection();
    };
    const confirmAction = async (message) => {
        if (process.stdin.isRaw)
            process.stdin.setRawMode(false);
        process.stdout.write('\x1b[?25h\n');
        const answer = await askLine(`${message} [y/N]: `);
        process.stdin.setRawMode(true);
        process.stdin.resume();
        process.stdout.write('\x1b[?25l');
        return /^(y|yes)$/i.test(answer.trim());
    };
    const navigateToRoot = (nextRoot) => {
        currentRoot = nextRoot;
        expanded = '|';
        expandedItems = '|';
        filter = '';
        status = `root ${currentRoot}`;
        rebuildSnapshot();
        selected = rows.length > 1 ? 1 : 0;
        offset = 0;
    };
    const createProject = async () => {
        if (process.stdin.isRaw)
            process.stdin.setRawMode(false);
        process.stdout.write('\x1b[?25h\n');
        const newName = await askLine('New project name: ');
        const safeName = sanitizeName(newName);
        fs.mkdirSync(path.join(currentRoot, safeName), { recursive: true });
        return { root: currentRoot, project: safeName, session: '', quit: false };
    };
    process.stdin.setRawMode(true);
    process.stdin.resume();
    process.stdout.write('\x1b[?25l');
    renderProjectTreeMenu(prompt(), selected, offset, visible, rows, filter, confirmTerminateSession);
    try {
        for (;;) {
            const key = await readKey();
            let redraw = false;
            let clearBeforeRedraw = false;
            if (key === 'ctrl-c')
                process.exit(130);
            if (confirmTerminateSession) {
                const current = rows[selected];
                if (key === 'y' || key === 'Y') {
                    if (current?.type === 'terminate' && current.session === confirmTerminateSession) {
                        const closed = closeTmuxSession(current.session);
                        if (closed)
                            unarchiveTmuxSession(currentRoot, current.project, current.session);
                        status = closed ? `terminated ${current.session}` : `could not terminate ${current.session}`;
                        rebuildSnapshot(current.project);
                    }
                    confirmTerminateSession = '';
                    redraw = true;
                }
                else if (key === 'n' || key === 'N' || key === 'escape' || key === 'enter' || key === 'ctrl-x' || key === 'ctrl-t') {
                    confirmTerminateSession = '';
                    redraw = true;
                }
                if (redraw) {
                    clampSelection();
                    process.stdout.write(`\x1b[${lines}A`);
                    renderProjectTreeMenu(prompt(), selected, offset, visible, rows, filter, confirmTerminateSession);
                    status = '';
                    continue;
                }
            }
            if (key === 'up') {
                selected -= 1;
                redraw = true;
            }
            else if (key === 'down') {
                selected += 1;
                redraw = true;
            }
            else if (key === 'backspace' || key === 'delete') {
                if (filter) {
                    filter = removeLastInputCharacter(filter);
                    rebuildRowsForFilter();
                }
                else {
                    navigateToRoot(path.dirname(currentRoot));
                }
                redraw = true;
            }
            else if (key === 'ctrl-u' || key === 'escape') {
                if (filter) {
                    filter = '';
                    rebuildRowsForFilter();
                    redraw = true;
                }
            }
            else if (key === 'left' || key === 'right') {
                const current = rows[selected];
                const shouldExpand = key === 'right';
                if (current?.type === 'session' && current.project && current.session) {
                    const itemKey = `${current.project}/tmux/${current.session}`;
                    const isExpanded = expandedContains(expandedItems, itemKey);
                    if (shouldExpand !== isExpanded) {
                        expandedItems = shouldExpand ? `${expandedItems}${itemKey}|` : expandedItems.replace(`|${itemKey}|`, '|');
                        rows = buildProjectTreeRowsFromSnapshot(snapshot, expanded, filter, expandedItems);
                        selected = Math.max(0, rows.findIndex((row) => row.type === 'session' && row.project === current.project && row.session === current.session));
                        redraw = true;
                    }
                }
                else if (current?.type === 'saved' && current.project && current.saved) {
                    const itemKey = `${current.project}/saved/${current.saved.agent}/${current.saved.id}`;
                    const isExpanded = expandedContains(expandedItems, itemKey);
                    if (shouldExpand !== isExpanded) {
                        expandedItems = shouldExpand ? `${expandedItems}${itemKey}|` : expandedItems.replace(`|${itemKey}|`, '|');
                        rows = buildProjectTreeRowsFromSnapshot(snapshot, expanded, filter, expandedItems);
                        selected = Math.max(0, rows.findIndex((row) => row.type === 'saved' && row.project === current.project && row.saved?.id === current.saved?.id));
                        redraw = true;
                    }
                }
                else if (current && current.type === 'project' && current.project) {
                    const isExpanded = expandedContains(expanded, current.project);
                    if (shouldExpand) {
                        if (current.expandable && !isExpanded) {
                            expanded = `${expanded}${current.project}|`;
                            rows = buildProjectTreeRowsFromSnapshot(snapshot, expanded, filter, expandedItems);
                            selected = Math.max(0, rows.findIndex((row) => row.type === 'project' && row.project === current.project));
                        }
                        else {
                            navigateToRoot(path.join(currentRoot, current.project));
                        }
                        redraw = true;
                    }
                    else {
                        if (current.expandable && isExpanded) {
                            expanded = expanded.replace(`|${current.project}|`, '|');
                            rows = buildProjectTreeRowsFromSnapshot(snapshot, expanded, filter, expandedItems);
                            selected = Math.max(0, rows.findIndex((row) => row.type === 'project' && row.project === current.project));
                        }
                        else {
                            navigateToRoot(path.dirname(currentRoot));
                        }
                        redraw = true;
                    }
                }
                else if (key === 'left') {
                    navigateToRoot(path.dirname(currentRoot));
                    redraw = true;
                }
            }
            else if (key === 'ctrl-a') {
                const current = rows[selected];
                if (current?.type === 'session') {
                    archiveTmuxSession(currentRoot, current.project, current.session);
                    status = `archived ${current.session}`;
                    rebuildSnapshot(current.project);
                    redraw = true;
                }
                else if (current?.type === 'saved' && current.saved) {
                    archiveSavedSession(current.saved);
                    status = `archived ${current.saved.agent} ${current.saved.id.slice(0, 12)}`;
                    rebuildSnapshot(current.project);
                    redraw = true;
                }
            }
            else if (key === 'ctrl-r') {
                const current = rows[selected];
                if (current?.type === 'session') {
                    unarchiveTmuxSession(currentRoot, current.project, current.session);
                    status = `restored ${current.session}`;
                    rebuildSnapshot(current.project);
                    redraw = true;
                }
                else if (current?.type === 'saved' && current.saved) {
                    unarchiveSavedSession(current.saved);
                    status = `restored ${current.saved.agent} ${current.saved.id.slice(0, 12)}`;
                    rebuildSnapshot(current.project);
                    redraw = true;
                }
            }
            else if (key === 'ctrl-x' || key === 'ctrl-t') {
                const current = rows[selected];
                if (current?.type === 'session' || current?.type === 'terminate') {
                    if (current.type === 'session') {
                        const itemKey = `${current.project}/tmux/${current.session}`;
                        if (!expandedContains(expandedItems, itemKey))
                            expandedItems = `${expandedItems}${itemKey}|`;
                        rows = buildProjectTreeRowsFromSnapshot(snapshot, expanded, filter, expandedItems);
                        const terminateIndex = rows.findIndex((row) => row.type === 'terminate' && row.project === current.project && row.session === current.session);
                        if (terminateIndex >= 0)
                            selected = terminateIndex;
                    }
                    confirmTerminateSession = current.session;
                    redraw = true;
                }
                else if (key === 'ctrl-x' && current?.type === 'saved' && current.saved) {
                    clearBeforeRedraw = true;
                    if (await confirmAction(`Close/archive saved ${current.saved.agent} session '${current.saved.id.slice(0, 12)}'? JSONL history is kept.`)) {
                        const tmuxName = savedTmuxSessionName(current.saved);
                        const closed = sessionExists(tmuxName) ? closeTmuxSession(tmuxName) : false;
                        archiveSavedSession(current.saved);
                        status = closed ? `closed ${tmuxName} and archived saved session` : 'archived saved session';
                        rebuildSnapshot(current.project);
                    }
                    redraw = true;
                }
            }
            else if (!filter && (key === 'q' || key === 'Q')) {
                return { root: currentRoot, project: '', session: '', quit: true };
            }
            else if (!filter && (key === 's' || key === 'S')) {
                const current = rows[selected];
                if (current?.type === 'project')
                    return { root: currentRoot, project: current.project, session: '', quit: false };
                filter += key;
                rebuildRowsForFilter();
                redraw = true;
            }
            else if (!filter && (key === 'n' || key === 'N')) {
                return await createProject();
            }
            else if (isProjectFilterKey(key)) {
                filter += key;
                rebuildRowsForFilter();
                redraw = true;
            }
            else if (key === 'enter' || key === 'shift-enter') {
                const current = rows[selected];
                if (current.type === 'parent') {
                    navigateToRoot(path.dirname(currentRoot));
                    redraw = true;
                }
                else if (current.type === 'project') {
                    navigateToRoot(path.join(currentRoot, current.project));
                    redraw = true;
                }
                else if (current.type === 'session')
                    return { root: currentRoot, project: current.project, session: current.session, quit: false };
                else if (current.type === 'saved' && current.saved)
                    return { root: currentRoot, project: '', session: '', quit: false, saved: current.saved };
                else if (current.type === 'quit')
                    return { root: currentRoot, project: '', session: '', quit: true };
                else if (current.type === 'terminate') {
                    confirmTerminateSession = current.session;
                    redraw = true;
                }
                else if (current.type === 'detail') {
                    redraw = true;
                }
                else
                    return await createProject();
            }
            if (redraw) {
                clampSelection();
                if (clearBeforeRedraw)
                    process.stdout.write('\x1b[2J\x1b[H');
                else
                    process.stdout.write(`\x1b[${lines}A`);
                renderProjectTreeMenu(prompt(), selected, offset, visible, rows, filter, confirmTerminateSession);
                status = '';
            }
        }
    }
    finally {
        if (process.stdin.isRaw)
            process.stdin.setRawMode(false);
        process.stdin.pause();
        process.stdout.write('\x1b[?25h\n');
    }
}
async function pickResumeSessionMenu(projectDir, root = '', project = '', mode = 'visible') {
    const sessions = listProjectSessions(projectDir, root, project, mode);
    if (!sessions.length || !process.stdin.isTTY)
        return '';
    const choice = await arrowSelect(`Existing tmux sessions for ${projectDir} (↑/↓ or j/k, Enter)`, ['Start a new session', ...sessions.map((session) => `Resume ${session}`)]);
    if (!choice)
        return '';
    return sessions[choice - 1] ?? '';
}
function sessionExists(session) {
    return runOk('tmux', ['has-session', '-t', session]);
}
function closeTmuxSession(session) {
    if (!sessionExists(session))
        return false;
    const result = run('tmux', ['kill-session', '-t', session]);
    return result.status === 0;
}
function uniqueSessionName(base) {
    let candidate = base;
    let suffix = 2;
    while (sessionExists(candidate)) {
        candidate = `${base}-${suffix}`;
        suffix += 1;
    }
    return candidate;
}
function resolveAgentCommand(agent, explicitCommand) {
    if (explicitCommand)
        return explicitCommand;
    const launchCommand = env('PI_REMOTE_LAUNCH_COMMAND') ?? configGet('launch_command', '');
    if (launchCommand)
        return launchCommand;
    if (agent === 'pi')
        return env('PI_REMOTE_PI_BIN') ?? configGet('pi_command', 'pi');
    if (agent === 'claude')
        return env('PI_REMOTE_CLAUDE_BIN') ?? configGet('claude_command', 'claude');
    if (agent === 'codex')
        return env('PI_REMOTE_CODEX_BIN') ?? configGet('codex_command', 'codex');
    if (agent === 'custom')
        fail('--agent custom requires --command or launch_command in config');
    fail(`unsupported agent '${agent}' (use pi, claude, codex, or custom with --command)`);
}
function checkLaunchCommandExists(commandValue) {
    const commandWord = commandValue.trim().split(/\s+/)[0] ?? '';
    if (!commandWord)
        fail('empty launch command');
    if (!runOk('bash', ['-lc', `command -v ${shellQuote(commandWord)} >/dev/null 2>&1`])) {
        fail(`agent executable not found on ${os.hostname()}: ${commandWord}`);
    }
}
function attachCommand(sessionName) {
    const args = ['tmux', 'attach', '-t', sessionName];
    const host = env('PI_REMOTE_HOST') ?? DEFAULT_HOST;
    if (isLocalHost(host))
        return shellJoin(args);
    return `ssh ${shellQuote(host)} -t ${shellJoin(args)}`;
}
function projectDirFromArg(root, project) {
    return project.startsWith('/') ? project : path.join(root, project);
}
async function runServer(args) {
    const configuredProjectRoot = configGet('project_root', '');
    const configuredAgent = configGet('agent', '');
    const options = {
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
        includeArchived: false,
        archivedOnly: false,
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
            case '--help':
            case '-h':
                usage();
                return;
            case '--version':
                process.stdout.write(`${packageVersion()}\n`);
                return;
            case '--project':
                options.projectName = args[++index] ?? fail('--project requires a name');
                break;
            case '--new':
                options.newName = args[++index] ?? fail('--new requires a name');
                break;
            case '--session':
                options.sessionName = args[++index] ?? fail('--session requires a name');
                options.explicitSession = true;
                break;
            case '--agent':
                options.agent = args[++index] ?? fail('--agent requires a value');
                options.explicitAgent = true;
                break;
            case '--saved-agent':
                options.savedAgent = args[++index] ?? fail('--saved-agent requires all, pi, or codex');
                break;
            case '--saved-session-limit':
                options.savedSessionLimit = parsePositiveIntegerOption('--saved-session-limit', args[++index]);
                break;
            case '--saved-sessions':
            case '--kittylitter':
                options.savedSessions = true;
                break;
            case '--include-archived':
                options.includeArchived = true;
                break;
            case '--archived':
                options.archivedOnly = true;
                options.includeArchived = true;
                break;
            case '--command':
                options.explicitCommand = args[++index] ?? fail('--command requires a shell command');
                break;
            case '--project-root':
                options.projectRoot = args[++index] ?? fail('--project-root requires a path');
                break;
            case '--pi-bin':
                options.explicitCommand = args[++index] ?? fail('--pi-bin requires a path');
                options.agent = 'pi';
                options.explicitAgent = true;
                break;
            case '--no-attach':
                options.noAttach = true;
                break;
            case '--dry-run':
                options.dryRun = true;
                break;
            case '--configure-tmux':
                options.configureTmux = true;
                break;
            case '--skip-tmux-config':
                options.skipTmuxConfig = true;
                break;
            case '--list':
                options.doList = true;
                break;
            case '--sessions':
                options.sessionsProject = args[++index] ?? fail('--sessions requires a project name or path');
                break;
            case '--':
                options.agentArgs.push(...args.slice(index + 1));
                index = args.length;
                break;
            default:
                if (arg.startsWith('--project='))
                    options.projectName = arg.slice('--project='.length);
                else if (arg.startsWith('--new='))
                    options.newName = arg.slice('--new='.length);
                else if (arg.startsWith('--session=')) {
                    options.sessionName = arg.slice('--session='.length);
                    options.explicitSession = true;
                }
                else if (arg.startsWith('--agent=')) {
                    options.agent = arg.slice('--agent='.length);
                    options.explicitAgent = true;
                }
                else if (arg.startsWith('--saved-agent='))
                    options.savedAgent = arg.slice('--saved-agent='.length);
                else if (arg.startsWith('--saved-session-limit='))
                    options.savedSessionLimit = parsePositiveIntegerOption('--saved-session-limit', arg.slice('--saved-session-limit='.length));
                else if (arg === '--include-archived')
                    options.includeArchived = true;
                else if (arg === '--archived') {
                    options.archivedOnly = true;
                    options.includeArchived = true;
                }
                else if (arg.startsWith('--command='))
                    options.explicitCommand = arg.slice('--command='.length);
                else if (arg.startsWith('--project-root='))
                    options.projectRoot = arg.slice('--project-root='.length);
                else if (arg.startsWith('--pi-bin=')) {
                    options.explicitCommand = arg.slice('--pi-bin='.length);
                    options.agent = 'pi';
                    options.explicitAgent = true;
                }
                else if (arg.startsWith('--sessions='))
                    options.sessionsProject = arg.slice('--sessions='.length);
                else if (arg.startsWith('--'))
                    fail(`unknown option for server mode: ${arg}`);
                else
                    options.agentArgs.push(arg);
        }
    }
    const unexpected = !options.projectName && !options.newName && !options.sessionsProject && !options.savedSessions && !options.doList && !options.configureTmux && options.agentArgs.length
        ? options.agentArgs[0]
        : '';
    if (unexpected)
        failUnexpectedPositional(unexpected);
    options.projectRoot = expandHomePath(options.projectRoot);
    process.env.PATH = `${os.homedir()}/.local/npm-global/bin:${os.homedir()}/.npm-global/bin:${os.homedir()}/.local/bin:${process.env.PATH ?? ''}`;
    if (options.savedSessions) {
        if (options.savedAgent !== 'all' && options.savedAgent !== 'pi' && options.savedAgent !== 'codex')
            fail('--saved-agent must be all, pi, or codex');
        if (!options.doList && !runOk('tmux', ['-V']))
            fail(`tmux is not installed on ${os.hostname()}`);
        await runSavedSessions(options);
        return;
    }
    if (options.doList) {
        printLines(listProjects(options.projectRoot));
        return;
    }
    if (!runOk('tmux', ['-V']))
        fail(`tmux is not installed on ${os.hostname()}`);
    if (options.configureTmux) {
        promptRemoteTmuxConfig(true);
        return;
    }
    if (!options.skipTmuxConfig && !options.noAttach && !options.dryRun && !options.sessionsProject) {
        promptRemoteTmuxConfig(false);
    }
    if (options.sessionsProject) {
        const projectDir = projectDirFromArg(options.projectRoot, options.sessionsProject);
        const project = projectNameFromDir(options.projectRoot, projectDir);
        printLines(listProjectSessions(projectDir, options.projectRoot, project, archiveModeFromOptions(options)));
        return;
    }
    if (options.newName) {
        options.projectName = sanitizeName(options.newName);
        fs.mkdirSync(path.join(options.projectRoot, options.projectName), { recursive: true });
    }
    else if (options.projectName) {
        if (!validateExistingName(options.projectName))
            fail(`project names must be simple folder names under ${options.projectRoot}`);
        if (!fs.existsSync(path.join(options.projectRoot, options.projectName)))
            fail(`project does not exist: ${path.join(options.projectRoot, options.projectName)} (use --new ${options.projectName} to create it)`);
    }
    else {
        const selection = await pickProjectMenu(options.projectRoot, options);
        options.projectRoot = selection.root;
        if (selection.quit)
            return;
        if (selection.saved) {
            await attachSavedSession(selection.saved, options);
            return;
        }
        options.projectName = selection.project;
        options.selectedSession = selection.session;
        options.projectWasInteractive = true;
    }
    if (!validateExistingName(options.projectName))
        fail(`project names must be simple folder names under ${options.projectRoot}`);
    const projectDir = path.join(options.projectRoot, options.projectName);
    if (!fs.existsSync(projectDir))
        fail(`project directory was not created: ${projectDir}`);
    if (options.selectedSession) {
        options.sessionName = options.selectedSession;
        options.explicitSession = true;
    }
    else if (!options.projectWasInteractive && !options.explicitSession && !options.noAttach && !options.dryRun) {
        const resumeSession = await pickResumeSessionMenu(projectDir, options.projectRoot, options.projectName, archiveModeFromOptions(options));
        if (resumeSession) {
            options.sessionName = resumeSession;
            options.explicitSession = true;
        }
    }
    if (!options.sessionName)
        options.sessionName = `pi-remote-${sanitizeName(options.projectName)}`;
    options.sessionName = sanitizeName(options.sessionName);
    const launchBase = resolveAgentCommand(options.agent, options.explicitCommand);
    checkLaunchCommandExists(launchBase);
    const agentCommand = options.agentArgs.length ? `${launchBase} ${shellJoin(options.agentArgs)}` : launchBase;
    if (!options.explicitSession && !options.noAttach && !options.dryRun)
        options.sessionName = uniqueSessionName(options.sessionName);
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
        setTerminalTitle(projectTerminalTitle(options.projectName, options.agent, options.sessionName, options.explicitSession));
        const attach = run('tmux', ['attach', '-t', options.sessionName], { stdio: 'inherit' });
        if (attach.error)
            fail(`failed to run tmux: ${attach.error.message}`);
        process.exit(attach.status ?? 1);
    }
    if (options.noAttach) {
        const created = run('tmux', ['new-session', '-d', '-s', options.sessionName, '-c', projectDir, agentCommand]);
        if (created.status !== 0)
            fail(String(created.stderr ?? 'failed to start tmux session'));
        process.stdout.write(`started detached tmux session: ${options.sessionName}\nproject: ${projectDir}\nagent: ${options.agent}\nattach with: ${attachCommand(options.sessionName)}\n`);
        return;
    }
    setTerminalTitle(projectTerminalTitle(options.projectName, options.agent, options.sessionName, options.explicitSession));
    const attached = run('tmux', ['new-session', '-s', options.sessionName, '-c', projectDir, agentCommand], { stdio: 'inherit' });
    if (attached.error)
        fail(`failed to run tmux: ${attached.error.message}`);
    process.exit(attached.status ?? 1);
}
function ensureParent(file) {
    fs.mkdirSync(path.dirname(file), { recursive: true });
}
function currentPackageRoot() {
    const configured = env('PI_REMOTE_PACKAGE_ROOT');
    if (configured)
        return path.resolve(expandHomePath(configured));
    return path.resolve(__dirname, '..');
}
function commandExists(command) {
    return runOk('bash', ['-lc', `command -v ${shellQuote(command)} >/dev/null 2>&1`]);
}
function gitOutput(root, args, fallback = '') {
    return commandOutput('git', ['-C', root, ...args], fallback).trim();
}
function isGitCheckout(root) {
    return runOk('git', ['-C', root, 'rev-parse', '--is-inside-work-tree']);
}
function readPackageVersion(root) {
    try {
        const parsed = JSON.parse(fs.readFileSync(path.join(root, 'package.json'), 'utf8'));
        return typeof parsed.version === 'string' && parsed.version ? parsed.version : packageVersion();
    }
    catch {
        return packageVersion();
    }
}
function gitPackageVersion(root, ref, fallback) {
    try {
        const content = commandOutput('git', ['-C', root, 'show', `${ref}:package.json`], '');
        if (!content)
            return fallback;
        const parsed = JSON.parse(content);
        return typeof parsed.version === 'string' && parsed.version ? parsed.version : fallback;
    }
    catch {
        return fallback;
    }
}
function gitShortCommit(root, ref = 'HEAD') {
    return gitOutput(root, ['rev-parse', '--short', ref], 'unknown') || 'unknown';
}
function resolveGitUpstream(root) {
    const configured = gitOutput(root, ['rev-parse', '--abbrev-ref', '--symbolic-full-name', '@{u}'], '');
    if (configured)
        return configured;
    for (const candidate of ['origin/main', 'origin/master']) {
        if (runOk('git', ['-C', root, 'rev-parse', '--verify', '--quiet', candidate]))
            return candidate;
    }
    const originHead = gitOutput(root, ['symbolic-ref', '--quiet', '--short', 'refs/remotes/origin/HEAD'], '');
    if (originHead)
        return originHead;
    fail('could not determine the GitHub upstream branch for this pi-remote checkout');
}
function gitAheadBehind(root, upstream) {
    const output = gitOutput(root, ['rev-list', '--left-right', '--count', `HEAD...${upstream}`], '0 0');
    const [ahead = '0', behind = '0'] = output.split(/\s+/);
    return { ahead: Number(ahead) || 0, behind: Number(behind) || 0 };
}
function isGitDirty(root) {
    return Boolean(gitOutput(root, ['status', '--porcelain', '--untracked-files=no'], ''));
}
function runGitOrFail(root, args, label) {
    const result = run('git', ['-C', root, ...args], { stdio: 'inherit' });
    if (result.error)
        fail(`${label}: ${result.error.message}`);
    if (result.status !== 0)
        fail(`${label} failed`);
}
function updateGitCheckout(root) {
    if (!commandExists('git'))
        fail('git is required for --update');
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
        }
        else {
            process.stdout.write(`new pi-remote version available: ${currentVersion} (${currentCommit}) -> ${latestVersion} (${latestCommit})\n`);
        }
        if (isGitDirty(root))
            fail(`cannot update ${root}: working tree has uncommitted changes`);
        runGitOrFail(root, ['pull', '--ff-only'], 'git pull');
        process.stdout.write(`updated pi-remote to ${readPackageVersion(root)} (${gitShortCommit(root, 'HEAD')})\n`);
        return;
    }
    if (ahead > 0) {
        process.stdout.write(`no newer GitHub version found; local checkout is ahead by ${ahead} commit${ahead === 1 ? '' : 's'} (${currentVersion} ${currentCommit})\n`);
    }
    else {
        process.stdout.write(`pi-remote is already up to date: ${currentVersion} (${currentCommit})\n`);
    }
}
function removeDirectoryContents(root) {
    const resolved = path.resolve(root);
    if (resolved === path.parse(resolved).root)
        fail(`refusing to update unsafe package root: ${resolved}`);
    fs.mkdirSync(resolved, { recursive: true });
    for (const entry of fs.readdirSync(resolved)) {
        fs.rmSync(path.join(resolved, entry), { recursive: true, force: true });
    }
}
function updateCopiedInstallFromGitHub(root) {
    if (!commandExists('git'))
        fail('git is required for --update');
    const currentVersion = readPackageVersion(root);
    const tempRoot = fs.mkdtempSync(path.join(os.tmpdir(), 'pi-remote-update-'));
    try {
        process.stdout.write(`fetching latest pi-remote from ${GITHUB_REPO}\n`);
        const clone = run('git', ['clone', '--depth', '1', GITHUB_REPO, tempRoot], { stdio: 'inherit' });
        if (clone.error)
            fail(`git clone: ${clone.error.message}`);
        if (clone.status !== 0)
            fail('git clone failed');
        const latestVersion = readPackageVersion(tempRoot);
        const latestCommit = gitShortCommit(tempRoot, 'HEAD');
        if (currentVersion === latestVersion) {
            process.stdout.write(`no newer package version found on GitHub (current ${currentVersion}); refreshing latest GitHub copy (${latestCommit})\n`);
        }
        else {
            process.stdout.write(`new pi-remote version available: ${currentVersion} -> ${latestVersion} (${latestCommit})\n`);
        }
        removeDirectoryContents(root);
        for (const entry of fs.readdirSync(tempRoot)) {
            fs.cpSync(path.join(tempRoot, entry), path.join(root, entry), { recursive: true, force: true, verbatimSymlinks: true });
        }
        process.stdout.write(`updated pi-remote from GitHub: ${latestVersion} (${latestCommit})\n`);
    }
    finally {
        fs.rmSync(tempRoot, { recursive: true, force: true });
    }
}
function updateLocalInstall() {
    const root = currentPackageRoot();
    if (isGitCheckout(root))
        updateGitCheckout(root);
    else
        updateCopiedInstallFromGitHub(root);
}
function installRemote(host) {
    const packageRoot = currentPackageRoot();
    const distCli = path.join(packageRoot, 'dist/pi-remote.js');
    const wrapper = path.join(packageRoot, 'pi-remote');
    const bashCli = path.join(packageRoot, 'pi-remote.sh');
    for (const file of [distCli, wrapper, bashCli]) {
        if (!fs.existsSync(file))
            fail(`missing install file: ${file}`);
    }
    const targetDir = 'projects/pi-remote';
    run('ssh', ['-o', 'BatchMode=yes', host, `mkdir -p "$HOME/${targetDir}/dist" "$HOME/.local/bin" "$HOME/.config/pi-remote"`], { stdio: 'inherit' });
    const copies = [
        [distCli, 'pi-remote.js.tmp'],
        [wrapper, 'pi-remote.wrapper.tmp'],
        [bashCli, 'pi-remote.sh.tmp'],
    ];
    for (const [source, remote] of copies) {
        const transfer = run('scp', ['-q', source, `${host}:${remote}`], { stdio: 'inherit' });
        if (transfer.status !== 0)
            process.exit(transfer.status ?? 1);
    }
    const installScript = `set -e
PATH="$HOME/.local/bin:/opt/homebrew/bin:/usr/local/bin:$PATH"
export PATH
if [ -d "$HOME/${targetDir}/.git" ] && command -v git >/dev/null 2>&1; then
  git -C "$HOME/${targetDir}" fetch --tags --prune origin >/dev/null 2>&1 || true
  git -C "$HOME/${targetDir}" pull --ff-only >/dev/null 2>&1 || true
fi
install -m 0755 "$HOME/pi-remote.js.tmp" "$HOME/${targetDir}/dist/pi-remote.js"
install -m 0755 "$HOME/pi-remote.wrapper.tmp" "$HOME/${targetDir}/pi-remote"
install -m 0755 "$HOME/pi-remote.sh.tmp" "$HOME/${targetDir}/pi-remote.sh"
ln -sf "$HOME/${targetDir}/pi-remote" "$HOME/.local/bin/pi-remote"
ln -sf "$HOME/${targetDir}/pi-remote.sh" "$HOME/.local/bin/pi-remote.sh"
rm -f "$HOME/pi-remote.js.tmp" "$HOME/pi-remote.wrapper.tmp" "$HOME/pi-remote.sh.tmp"
if [ ! -f "$HOME/.config/pi-remote/config" ]; then
  printf '%s\n' 'project_root=~/projects' 'agent=pi' 'pi_command=pi' 'claude_command=claude' 'codex_command=codex' > "$HOME/.config/pi-remote/config"
fi
if ! command -v node >/dev/null 2>&1; then
  printf '%s\n' 'pi-remote: Node.js is required on the remote host; no slow shell fallback is available' >&2
  printf '%s\n' 'Install Node.js, then run pi-remote --install-remote again.' >&2
  exit 127
fi`;
    const installed = run('ssh', ['-o', 'BatchMode=yes', host, installScript], { stdio: 'inherit' });
    if (installed.status !== 0)
        process.exit(installed.status ?? 1);
    process.stdout.write(`installed remote copy on ${host}: ~/${targetDir}/pi-remote\n`);
}
function writeLocalConfig(host) {
    const file = configFile();
    ensureParent(file);
    if (fs.existsSync(file)) {
        process.stdout.write(`config already exists: ${file}\n`);
        return;
    }
    fs.writeFileSync(file, `host=${host}\nproject_root=~/projects\nagent=pi\npi_command=pi\nclaude_command=claude\ncodex_command=codex\n`);
    process.stdout.write(`wrote config: ${file}\n`);
}
function firstUnexpectedPositional(args) {
    for (let index = 0; index < args.length; index += 1) {
        const arg = args[index];
        if (arg === '--')
            return '';
        if (!arg.startsWith('-'))
            return arg;
        if (['--host', '--project', '--new', '--sessions', '--saved-agent', '--saved-session-limit', '--session', '--agent', '--command', '--project-root', '--pi-bin'].includes(arg))
            index += 1;
    }
    return '';
}
function failUnexpectedPositional(arg) {
    const hint = fs.existsSync(arg)
        ? 'looks like a file path; pi-remote expects a project name via --project/--new, and agent prompts/files must come after -- with --project or --new'
        : 'use --project NAME, --new NAME, or put agent arguments after -- with --project or --new';
    fail(`unexpected argument: ${arg}\n${hint}`);
}
function parseLocal(args) {
    const configHost = configGet('host', '');
    const options = {
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
            case '--help':
            case '-h':
                usage();
                process.exit(0);
            case '--version':
                process.stdout.write(`${packageVersion()}\n`);
                process.exit(0);
            case '--host':
                options.host = args[++index] ?? fail('--host requires a value');
                break;
            case '--install-remote':
                options.install = true;
                break;
            case '--update':
                options.update = true;
                break;
            case '--init-config':
                options.initConfig = true;
                break;
            case '--project':
                options.hasProject = true;
                options.serverArgs.push(arg, args[++index] ?? fail('--project requires a name'));
                break;
            case '--new':
                options.hasNew = true;
                options.serverArgs.push(arg, args[++index] ?? fail('--new requires a name'));
                break;
            case '--sessions':
                options.doSessions = true;
                options.serverArgs.push(arg, args[++index] ?? fail('--sessions requires a project name'));
                break;
            case '--saved-sessions':
            case '--kittylitter':
                options.doSavedSessions = true;
                options.serverArgs.push(arg);
                break;
            case '--saved-agent':
                options.serverArgs.push(arg, args[++index] ?? fail('--saved-agent requires all, pi, or codex'));
                break;
            case '--saved-session-limit':
                options.serverArgs.push(arg, args[++index] ?? fail('--saved-session-limit requires a number'));
                break;
            case '--include-archived':
            case '--archived':
                options.serverArgs.push(arg);
                break;
            case '--no-attach':
                options.noAttach = true;
                options.serverArgs.push(arg);
                break;
            case '--list':
                options.doList = true;
                options.serverArgs.push(arg);
                break;
            case '--configure-tmux':
                options.configureTmux = true;
                options.serverArgs.push(arg);
                break;
            case '--skip-tmux-config':
                options.serverArgs.push(arg);
                break;
            case '--dry-run':
                options.dryRun = true;
                options.serverArgs.push(arg);
                break;
            case '--':
                options.serverArgs.push('--', ...args.slice(index + 1));
                index = args.length;
                break;
            default:
                if (arg.startsWith('--host='))
                    options.host = arg.slice('--host='.length);
                else if (arg.startsWith('--project=')) {
                    options.hasProject = true;
                    options.serverArgs.push(arg);
                }
                else if (arg.startsWith('--new=')) {
                    options.hasNew = true;
                    options.serverArgs.push(arg);
                }
                else if (arg.startsWith('--sessions=')) {
                    options.doSessions = true;
                    options.serverArgs.push(arg);
                }
                else if (arg.startsWith('--saved-agent=') || arg.startsWith('--saved-session-limit='))
                    options.serverArgs.push(arg);
                else if (arg === '--include-archived' || arg === '--archived')
                    options.serverArgs.push(arg);
                else
                    options.serverArgs.push(arg);
        }
    }
    if (options.doList || options.doSessions)
        options.needsTty = false;
    else if (options.configureTmux)
        options.needsTty = true;
    else if (options.noAttach && (options.hasProject || options.hasNew))
        options.needsTty = false;
    else if (options.dryRun && (options.hasProject || options.hasNew))
        options.needsTty = false;
    else
        options.needsTty = true;
    return options;
}
function isLocalHost(host) {
    return host === 'local' || host === 'localhost' || host === '127.0.0.1' || host === '.';
}
async function runLocal(args) {
    const options = parseLocal(args);
    const unexpected = !options.hasProject && !options.hasNew && !options.doSessions && !options.doSavedSessions && !options.doList && !options.configureTmux
        ? firstUnexpectedPositional(options.serverArgs)
        : '';
    if (unexpected)
        failUnexpectedPositional(unexpected);
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
    if (options.needsTty && !process.stdin.isTTY)
        fail('this mode needs a TTY for the menu/tmux attach; use --project/--new with --no-attach from automation');
    if (isLocalHost(options.host)) {
        process.env.PI_REMOTE_HOST = options.host;
        await runServer(['--server', ...options.serverArgs]);
        return;
    }
    const quotedArgs = options.serverArgs.length ? ` ${shellJoin(options.serverArgs)}` : '';
    const quotedHost = shellQuote(options.host);
    const remoteCommand = `remote_helper=${REMOTE_PROJECT_PATH}; if [[ ! -x $remote_helper ]]; then remote_helper=${REMOTE_LEGACY_PROJECT_PATH}; fi; if [[ ! -x $remote_helper ]]; then printf 'pi-remote is not installed on the remote host at %s or %s\\n' ${REMOTE_PROJECT_PATH} ${REMOTE_LEGACY_PROJECT_PATH} >&2; exit 127; fi; export PI_REMOTE_HOST=${quotedHost}; exec $remote_helper --server${quotedArgs}`;
    const sshArgs = ['-o', 'BatchMode=yes', options.needsTty ? '-tt' : '-T', options.host, 'bash', '-lc', shellQuote(remoteCommand)];
    installTerminalCleanup();
    for (;;) {
        let result;
        try {
            result = run('ssh', sshArgs, { stdio: 'inherit' });
        }
        finally {
            restoreTerminal();
        }
        if (result.error)
            fail(`failed to run ssh: ${result.error.message}`);
        const status = result.status ?? 1;
        if (status !== 255 || !options.needsTty || !process.stdin.isTTY || !process.stdout.isTTY)
            process.exit(status);
        process.stderr.write('pi-remote: SSH connection dropped; your remote tmux session should still be running.\n');
        const reconnect = await askYesNo('Reconnect to the same pi-remote session?', true);
        if (!reconnect)
            process.exit(status);
    }
}
async function main() {
    const args = process.argv.slice(2);
    if (args[0] === '--server')
        await runServer(args);
    else
        await runLocal(args);
}
main().catch((error) => {
    fail(error instanceof Error ? error.message : String(error));
});
