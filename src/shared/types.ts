export type DeviceState = 'device' | 'offline' | 'unauthorized' | 'unknown';
export type DeviceTransport = 'usb' | 'wireless' | 'emulator' | 'unknown';
export type SessionStatus = 'starting' | 'running' | 'stopped' | 'crashed';

export interface Device {
  serial: string;
  state: DeviceState;
  transport: DeviceTransport;
  model?: string;
  product?: string;
  androidVersion?: string;
  sdk?: string;
}

export interface LaunchProfile {
  id: string;
  name: string;
  description: string;
  video: {
    maxSize?: number;
    bitRateMbps?: number;
    maxFps?: number;
    displayId?: number;
    orientation?: 'unlocked' | 'portrait' | 'landscape';
    crop?: string;
  };
  audio: {
    enabled: boolean;
  };
  input: {
    clipboard: boolean;
    turnScreenOff: boolean;
    stayAwake: boolean;
    powerOn: boolean;
  };
  window: {
    title?: string;
    alwaysOnTop: boolean;
    borderless: boolean;
    fullscreen: boolean;
  };
  recording: {
    enabled: boolean;
    path?: string;
  };
  system?: {
    requiresAdministrator: boolean;
  };
  extraArgs: string;
}

export interface SessionLogLine {
  at: string;
  stream: 'stdout' | 'stderr' | 'system';
  text: string;
}

export interface Session {
  id: string;
  deviceSerial: string;
  command: string;
  status: SessionStatus;
  pid?: number;
  startedAt: string;
  stoppedAt?: string;
  exitCode?: number | null;
  logs: SessionLogLine[];
}

export interface AppSettings {
  adbPath?: string;
  scrcpyPath?: string;
  theme?: 'dark' | 'light';
  pollIntervalMs: number;
  defaultProfileId: string;
  profiles: LaunchProfile[];
  deviceAliases?: Record<string, string>;
  recentSessions?: Session[];
}

export interface CommandPreview {
  executable: string;
  args: string[];
  command: string;
}

export interface WirelessConnectRequest {
  serial: string;
  port: number;
}

export interface PairRequest {
  host: string;
  port: number;
  code: string;
}

export interface Diagnostics {
  platform: NodeJS.Platform;
  packaged: boolean;
  adbPath: string;
  scrcpyPath: string;
  adbAvailable: boolean;
  scrcpyAvailable: boolean;
  appVersion: string;
  localIpv4Addresses?: string[];
  isElevated?: boolean;
  inputBackend?: string;
  gameModeWarnings?: string[];
}

export interface ReverseStreamSettings {
  codec: 'mjpeg' | 'webrtc-h264';
  fps: number;
  quality: number;
  maxWidth: number;
  maxHeight: number;
}

export interface ReverseServerStatus {
  running: boolean;
  port: number;
  url?: string;
  localUrl?: string;
  adbReverseSerial?: string;
  lastInputAt?: string;
  displayId?: string;
  reverseAudioBeta: boolean;
  stream: ReverseStreamSettings;
}

export interface BridgeApi {
  getSettings(): Promise<AppSettings>;
  saveSettings(settings: AppSettings): Promise<AppSettings>;
  listDevices(): Promise<Device[]>;
  restartAdb(): Promise<string>;
  connectWireless(serial: string, port: number): Promise<string>;
  connectHost(host: string): Promise<string>;
  pairDevice(host: string, port: number, code: string): Promise<string>;
  disconnectDevice(serial: string): Promise<string>;
  previewCommand(deviceSerial: string, profile: LaunchProfile): Promise<CommandPreview>;
  startSession(deviceSerial: string, profile: LaunchProfile): Promise<Session>;
  stopSession(sessionId: string): Promise<Session>;
  listSessions(): Promise<Session[]>;
  getReverseStatus(): Promise<ReverseServerStatus>;
  startReverseServer(port: number, adbSerial?: string): Promise<ReverseServerStatus>;
  setReverseStreamSettings(settings: Partial<ReverseStreamSettings>): Promise<ReverseServerStatus>;
  setReverseAudioBeta(enabled: boolean): Promise<ReverseServerStatus>;
  installRemoteApp(deviceSerial: string, port?: number): Promise<string>;
  stopReverseServer(): Promise<ReverseServerStatus>;
  getDiagnostics(): Promise<Diagnostics>;
  minimizeWindow(): Promise<void>;
  toggleMaximizeWindow(): Promise<void>;
  closeWindow(): Promise<void>;
  onSessionChanged(callback: (session: Session) => void): () => void;
}
