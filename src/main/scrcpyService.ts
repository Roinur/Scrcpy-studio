import { ChildProcessWithoutNullStreams, execFileSync, spawn } from 'node:child_process';
import { nanoid } from 'nanoid';
import { EventEmitter } from 'node:events';
import type { LaunchProfile, Session, SessionLogLine } from '../shared/types.js';
import { buildScrcpyCommand } from './commandBuilder.js';

export class ScrcpyService extends EventEmitter {
  private sessions = new Map<string, Session>();
  private processes = new Map<string, ChildProcessWithoutNullStreams>();
  private elevatedPids = new Map<string, number>();
  private elevatedWatchers = new Map<string, NodeJS.Timeout>();
  private manualStops = new Set<string>();

  constructor(private readonly scrcpyPath: string, initialSessions: Session[] = []) {
    super();
    for (const session of initialSessions) {
      this.sessions.set(session.id, {
        ...session,
        status: session.status === 'running' || session.status === 'starting' ? 'crashed' : session.status,
        pid: undefined,
        stoppedAt: session.stoppedAt ?? new Date().toISOString(),
        logs: session.logs.slice(-500)
      });
    }
  }

  preview(deviceSerial: string, profile: LaunchProfile) {
    return buildScrcpyCommand(this.scrcpyPath, deviceSerial, profile);
  }

  listSessions() {
    return [...this.sessions.values()].sort((a, b) => b.startedAt.localeCompare(a.startedAt));
  }

  start(deviceSerial: string, profile: LaunchProfile): Session {
    const preview = this.preview(deviceSerial, profile);
    const session: Session = {
      id: nanoid(),
      deviceSerial,
      command: preview.command,
      status: 'starting',
      startedAt: new Date().toISOString(),
      logs: []
    };

    this.sessions.set(session.id, session);
    this.emitChange(session);

    try {
      if (profile.system?.requiresAdministrator && process.platform === 'win32' && !isElevated()) {
        const pid = startElevated(preview.executable, preview.args);
        session.pid = pid;
        session.status = 'running';
        this.elevatedPids.set(session.id, pid);
        this.appendLog(session.id, 'system', 'Started elevated for Administrator / background mode.');
        this.watchElevatedProcess(session.id, pid);
      } else {
        const child = spawn(preview.executable, preview.args, { windowsHide: false });
        session.pid = child.pid;
        session.status = 'running';
        this.processes.set(session.id, child);

        child.stdout.on('data', (data) => this.appendLog(session.id, 'stdout', data.toString()));
        child.stderr.on('data', (data) => this.appendLog(session.id, 'stderr', data.toString()));
        child.on('error', (error) => {
          this.appendLog(session.id, 'system', error.message);
          this.finish(session.id, 'crashed', null);
        });
        child.on('exit', (code) => {
          const manuallyStopped = this.manualStops.has(session.id);
          this.manualStops.delete(session.id);
          this.finish(session.id, code === 0 || manuallyStopped ? 'stopped' : 'crashed', code);
        });
      }
    } catch (error) {
      this.appendLog(session.id, 'system', error instanceof Error ? error.message : String(error));
      session.status = 'crashed';
      session.stoppedAt = new Date().toISOString();
    }

    this.emitChange(session);
    return session;
  }

  stop(sessionId: string): Session {
    const session = this.requireSession(sessionId);
    const child = this.processes.get(sessionId);
    const elevatedPid = this.elevatedPids.get(sessionId);
    if (child && !child.killed) {
      this.manualStops.add(sessionId);
      child.kill();
      this.appendLog(sessionId, 'system', 'Stop requested by user.');
    } else if (elevatedPid) {
      this.manualStops.add(sessionId);
      try {
        execFileSync('taskkill.exe', ['/PID', String(elevatedPid), '/T', '/F'], { stdio: 'ignore', windowsHide: true });
        this.appendLog(sessionId, 'system', 'Stop requested for elevated session.');
        this.finish(sessionId, 'stopped', 0);
      } catch (error) {
        this.appendLog(sessionId, 'system', `Could not stop elevated session automatically: ${error instanceof Error ? error.message : String(error)}`);
      }
    } else {
      this.finish(sessionId, 'stopped', session.exitCode ?? null);
    }
    return this.requireSession(sessionId);
  }

  private appendLog(sessionId: string, stream: SessionLogLine['stream'], text: string) {
    const session = this.requireSession(sessionId);
    for (const line of text.split(/\r?\n/).filter(Boolean)) {
      session.logs.push({ at: new Date().toISOString(), stream, text: line });
    }
    session.logs = session.logs.slice(-500);
    this.emitChange(session);
  }

  private finish(sessionId: string, status: Session['status'], exitCode: number | null) {
    const session = this.requireSession(sessionId);
    this.processes.delete(sessionId);
    this.elevatedPids.delete(sessionId);
    const watcher = this.elevatedWatchers.get(sessionId);
    if (watcher) clearInterval(watcher);
    this.elevatedWatchers.delete(sessionId);
    session.status = status;
    session.exitCode = exitCode;
    session.stoppedAt = new Date().toISOString();
    this.emitChange(session);
  }

  private requireSession(sessionId: string) {
    const session = this.sessions.get(sessionId);
    if (!session) throw new Error(`Unknown session: ${sessionId}`);
    return session;
  }

  private emitChange(session: Session) {
    this.emit('session-changed', { ...session, logs: [...session.logs] });
  }

  private watchElevatedProcess(sessionId: string, pid: number) {
    const watcher = setInterval(() => {
      if (!this.elevatedPids.has(sessionId)) {
        clearInterval(watcher);
        return;
      }
      if (!isProcessRunning(pid)) {
        this.manualStops.delete(sessionId);
        this.finish(sessionId, 'stopped', null);
      }
    }, 2500);
    this.elevatedWatchers.set(sessionId, watcher);
  }
}

function isElevated() {
  try {
    execFileSync('fltmc.exe', [], { stdio: 'ignore', windowsHide: true });
    return true;
  } catch {
    return false;
  }
}

function quoteWindowsArg(value: string) {
  if (/^[A-Za-z0-9_./:=@-]+$/.test(value)) return value;
  return `"${value.replace(/(\\*)"/g, '$1$1\\"').replace(/(\\+)$/g, '$1$1')}"`;
}

function startElevated(executable: string, args: string[]) {
  const argumentList = args.map(quoteWindowsArg).join(' ');
  const script = [
    '$process = Start-Process -FilePath $args[0] -ArgumentList $args[1] -Verb RunAs -PassThru',
    '$process.Id'
  ].join('; ');
  const output = execFileSync('powershell.exe', ['-NoProfile', '-ExecutionPolicy', 'Bypass', '-Command', script, executable, argumentList], {
    encoding: 'utf8',
    windowsHide: true
  }).trim();
  const pid = Number(output.split(/\r?\n/).at(-1));
  if (!Number.isFinite(pid)) throw new Error('Elevated scrcpy process did not return a PID.');
  return pid;
}

function isProcessRunning(pid: number) {
  try {
    execFileSync('powershell.exe', ['-NoProfile', '-Command', `if (Get-Process -Id ${pid} -ErrorAction SilentlyContinue) { exit 0 } else { exit 1 }`], {
      stdio: 'ignore',
      windowsHide: true
    });
    return true;
  } catch {
    return false;
  }
}
