import { mkdir, writeFile } from 'node:fs/promises';
import path from 'node:path';

const outDir = path.resolve('dist/main/main');
await mkdir(outDir, { recursive: true });

await writeFile(
  path.join(outDir, 'preload.cjs'),
  `const { contextBridge, ipcRenderer } = require('electron');

const api = {
  getSettings: () => ipcRenderer.invoke('settings:get'),
  saveSettings: (settings) => ipcRenderer.invoke('settings:save', settings),
  listDevices: () => ipcRenderer.invoke('devices:list'),
  restartAdb: () => ipcRenderer.invoke('adb:restart'),
  connectWireless: (serial, port) => ipcRenderer.invoke('adb:wireless', serial, port),
  connectHost: (host) => ipcRenderer.invoke('adb:connect', host),
  pairDevice: (host, port, code) => ipcRenderer.invoke('adb:pair', host, port, code),
  disconnectDevice: (serial) => ipcRenderer.invoke('adb:disconnect', serial),
  previewCommand: (serial, profile) => ipcRenderer.invoke('scrcpy:preview', serial, profile),
  startSession: (serial, profile) => ipcRenderer.invoke('scrcpy:start', serial, profile),
  stopSession: (sessionId) => ipcRenderer.invoke('scrcpy:stop', sessionId),
  listSessions: () => ipcRenderer.invoke('scrcpy:sessions'),
  getReverseStatus: () => ipcRenderer.invoke('reverse:status'),
  startReverseServer: (port, serial) => ipcRenderer.invoke('reverse:start', port, serial),
  setReverseStreamSettings: (settings) => ipcRenderer.invoke('reverse:settings', settings),
  setReverseAudioBeta: (enabled) => ipcRenderer.invoke('reverse:audio-beta', enabled),
  installRemoteApp: (serial, port) => ipcRenderer.invoke('remote:install-open', serial, port),
  stopReverseServer: () => ipcRenderer.invoke('reverse:stop'),
  getDiagnostics: () => ipcRenderer.invoke('diagnostics:get'),
  minimizeWindow: () => ipcRenderer.invoke('window:minimize'),
  toggleMaximizeWindow: () => ipcRenderer.invoke('window:toggle-maximize'),
  closeWindow: () => ipcRenderer.invoke('window:close'),
  onSessionChanged: (callback) => {
    const listener = (_, session) => callback(session);
    ipcRenderer.on('session:changed', listener);
    return () => ipcRenderer.off('session:changed', listener);
  }
};

contextBridge.exposeInMainWorld('scrcpyStudio', api);
`,
  'utf8'
);
