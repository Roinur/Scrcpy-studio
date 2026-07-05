import { contextBridge, ipcRenderer } from 'electron';
import type { AppSettings, BridgeApi, LaunchProfile, ReverseStreamSettings, Session } from '../shared/types.js';

const api: BridgeApi = {
  getSettings: () => ipcRenderer.invoke('settings:get'),
  saveSettings: (settings: AppSettings) => ipcRenderer.invoke('settings:save', settings),
  listDevices: () => ipcRenderer.invoke('devices:list'),
  restartAdb: () => ipcRenderer.invoke('adb:restart'),
  connectWireless: (serial: string, port: number) => ipcRenderer.invoke('adb:wireless', serial, port),
  connectHost: (host: string) => ipcRenderer.invoke('adb:connect', host),
  pairDevice: (host: string, port: number, code: string) => ipcRenderer.invoke('adb:pair', host, port, code),
  disconnectDevice: (serial: string) => ipcRenderer.invoke('adb:disconnect', serial),
  previewCommand: (serial: string, profile: LaunchProfile) => ipcRenderer.invoke('scrcpy:preview', serial, profile),
  startSession: (serial: string, profile: LaunchProfile) => ipcRenderer.invoke('scrcpy:start', serial, profile),
  stopSession: (sessionId: string) => ipcRenderer.invoke('scrcpy:stop', sessionId),
  listSessions: () => ipcRenderer.invoke('scrcpy:sessions'),
  getReverseStatus: () => ipcRenderer.invoke('reverse:status'),
  startReverseServer: (port: number, serial?: string) => ipcRenderer.invoke('reverse:start', port, serial),
  setReverseStreamSettings: (settings: Partial<ReverseStreamSettings>) => ipcRenderer.invoke('reverse:settings', settings),
  setReverseAudioBeta: (enabled: boolean) => ipcRenderer.invoke('reverse:audio-beta', enabled),
  installRemoteApp: (serial: string, port?: number) => ipcRenderer.invoke('remote:install-open', serial, port),
  stopReverseServer: () => ipcRenderer.invoke('reverse:stop'),
  getDiagnostics: () => ipcRenderer.invoke('diagnostics:get'),
  minimizeWindow: () => ipcRenderer.invoke('window:minimize'),
  toggleMaximizeWindow: () => ipcRenderer.invoke('window:toggle-maximize'),
  closeWindow: () => ipcRenderer.invoke('window:close'),
  onSessionChanged: (callback: (session: Session) => void) => {
    const listener = (_: Electron.IpcRendererEvent, session: Session) => callback(session);
    ipcRenderer.on('session:changed', listener);
    return () => ipcRenderer.off('session:changed', listener);
  }
};

contextBridge.exposeInMainWorld('scrcpyStudio', api);
