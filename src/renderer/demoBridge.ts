import { defaultSettings } from '../shared/profiles';
import type { AppSettings, BridgeApi, CommandPreview, Device, Diagnostics, LaunchProfile, ReverseStreamSettings, Session } from '../shared/types';

const demoDevices: Device[] = [
  {
    serial: '192.168.1.44:5555',
    state: 'device',
    transport: 'wireless',
    model: 'Pixel 8 Pro',
    product: 'husky'
  },
  {
    serial: 'R5CT90AB12K',
    state: 'device',
    transport: 'usb',
    model: 'Galaxy S24',
    product: 'e3q'
  }
];

let settings: AppSettings = { ...defaultSettings };
let sessions: Session[] = [
  {
    id: 'demo-session-fast',
    deviceSerial: '192.168.1.44:5555',
    command: 'scrcpy.exe --serial 192.168.1.44:5555 --max-size 1080 --video-bit-rate 8M --max-fps 60',
    status: 'running',
    pid: 4242,
    startedAt: new Date().toISOString(),
    logs: [
      { at: new Date().toISOString(), stream: 'system', text: 'Demo session started. Real scrcpy runs inside Electron.' }
    ]
  }
];
let reverseRunning = false;
let reversePort = 7420;
let reverseStream: ReverseStreamSettings = { codec: 'webrtc-h264', fps: 60, quality: 68, maxWidth: 1920, maxHeight: 1080 };
let reverseAudioBeta = true;

function quote(part: string) {
  return /^[A-Za-z0-9_./:=@-]+$/.test(part) ? part : `"${part.replaceAll('"', '\\"')}"`;
}

function previewCommand(deviceSerial: string, profile: LaunchProfile): CommandPreview {
  const args = ['--serial', deviceSerial];
  if (!profile.input.powerOn) args.push('--no-power-on');
  if (profile.input.turnScreenOff) args.push('-S');
  if (profile.input.stayAwake) args.push('--stay-awake');
  if (!profile.input.clipboard) args.push('--no-clipboard-autosync');
  if (profile.video.maxSize) args.push('--max-size', String(profile.video.maxSize));
  if (profile.video.bitRateMbps) args.push('--video-bit-rate', `${profile.video.bitRateMbps}M`);
  if (profile.video.maxFps) args.push('--max-fps', String(profile.video.maxFps));
  if (profile.video.crop) args.push('--crop', profile.video.crop);
  if (!profile.audio.enabled) args.push('--no-audio');
  if (profile.window.title) args.push('--window-title', profile.window.title);
  if (profile.window.alwaysOnTop) args.push('--always-on-top');
  if (profile.window.borderless) args.push('--window-borderless');
  if (profile.window.fullscreen) args.push('--fullscreen');
  args.push(...profile.extraArgs.split(/\s+/).filter(Boolean));
  return {
    executable: 'scrcpy.exe',
    args,
    command: ['scrcpy.exe', ...args].map(quote).join(' ')
  };
}

export function createDemoBridge(): BridgeApi {
  const listeners = new Set<(session: Session) => void>();

  return {
    async getSettings() {
      return settings;
    },
    async saveSettings(nextSettings: AppSettings) {
      settings = nextSettings;
      return settings;
    },
    async listDevices() {
      return demoDevices;
    },
    async restartAdb() {
      return 'Demo: ADB server restarted.';
    },
    async connectWireless(serial: string, port: number) {
      return `Demo: ${serial} switched to TCP/IP on port ${port}.`;
    },
    async connectHost(host: string) {
      return `Demo: connected to ${host}.`;
    },
    async pairDevice(host: string, port: number) {
      return `Demo: paired ${host}:${port}.`;
    },
    async disconnectDevice(serial: string) {
      return `Demo: disconnected ${serial}.`;
    },
    async previewCommand(deviceSerial: string, profile: LaunchProfile) {
      return previewCommand(deviceSerial, profile);
    },
    async startSession(deviceSerial: string, profile: LaunchProfile) {
      const command = previewCommand(deviceSerial, profile).command;
      const session: Session = {
        id: crypto.randomUUID(),
        deviceSerial,
        command,
        status: 'running',
        pid: 4242,
        startedAt: new Date().toISOString(),
        logs: [
          { at: new Date().toISOString(), stream: 'system', text: 'Demo session started. Real scrcpy runs inside Electron.' }
        ]
      };
      sessions = [session, ...sessions];
      listeners.forEach((listener) => listener(session));
      return session;
    },
    async stopSession(sessionId: string) {
      const session = sessions.find((item) => item.id === sessionId);
      if (!session) throw new Error(`Demo: unknown session ${sessionId}`);
      session.status = 'stopped';
      session.stoppedAt = new Date().toISOString();
      session.logs.push({ at: new Date().toISOString(), stream: 'system', text: 'Demo session stopped.' });
      listeners.forEach((listener) => listener(session));
      return session;
    },
    async listSessions() {
      return sessions;
    },
    async getReverseStatus() {
      return {
        running: reverseRunning,
        port: reversePort,
        url: reverseRunning ? `http://192.168.1.22:${reversePort}` : undefined,
        reverseAudioBeta,
        stream: reverseStream
      };
    },
    async startReverseServer(port: number, serial?: string) {
      reverseRunning = true;
      reversePort = port;
      return {
        running: true,
        port,
        url: `http://192.168.1.22:${port}`,
        adbReverseSerial: serial,
        reverseAudioBeta,
        stream: reverseStream
      };
    },
    async setReverseStreamSettings(settings: Partial<ReverseStreamSettings>) {
      reverseStream = {
        codec: settings.codec ?? reverseStream.codec,
        fps: Math.max(1, Math.min(60, Math.round(settings.fps ?? reverseStream.fps))),
        quality: Math.max(30, Math.min(95, Math.round(settings.quality ?? reverseStream.quality))),
        maxWidth: Math.max(320, Math.round(settings.maxWidth ?? reverseStream.maxWidth)),
        maxHeight: Math.max(240, Math.round(settings.maxHeight ?? reverseStream.maxHeight))
      };
      return {
        running: reverseRunning,
        port: reversePort,
        url: reverseRunning ? `http://192.168.1.22:${reversePort}` : undefined,
        reverseAudioBeta,
        stream: reverseStream
      };
    },
    async setReverseAudioBeta(enabled: boolean) {
      reverseAudioBeta = enabled;
      return {
        running: reverseRunning,
        port: reversePort,
        url: reverseRunning ? `http://192.168.1.22:${reversePort}` : undefined,
        reverseAudioBeta,
        stream: reverseStream
      };
    },
    async installRemoteApp(serial: string, port?: number) {
      return `Demo: installed and opened Android remote app on ${serial} with reverse port ${port ?? reversePort}.`;
    },
    async stopReverseServer() {
      reverseRunning = false;
      return { running: false, port: reversePort, reverseAudioBeta, stream: reverseStream };
    },
    async getDiagnostics(): Promise<Diagnostics> {
      return {
        platform: 'win32',
        packaged: false,
        adbPath: 'vendor/platform-tools/adb.exe (demo)',
        scrcpyPath: 'vendor/scrcpy/scrcpy.exe (demo)',
        adbAvailable: true,
        scrcpyAvailable: true,
        appVersion: 'browser-preview',
        localIpv4Addresses: ['192.168.1.22'],
        isElevated: false,
        inputBackend: 'Windows SendInput',
        gameModeWarnings: [
          'Some fullscreen games ignore SendInput.',
          'Run as administrator and prefer borderless/windowed fullscreen for game input.',
          'Virtual HID support is the likely long-term game mode.'
        ]
      };
    },
    async minimizeWindow() {},
    async toggleMaximizeWindow() {},
    async closeWindow() {},
    onSessionChanged(callback: (session: Session) => void) {
      listeners.add(callback);
      return () => listeners.delete(callback);
    }
  };
}
