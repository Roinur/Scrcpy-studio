import { app, BrowserWindow, ipcMain, Menu, Tray } from 'electron';
import path from 'node:path';
import fs from 'node:fs';
import os from 'node:os';
import { execFileSync } from 'node:child_process';
import { getSettings, saveSettings } from './settingsStore.js';
import { resolveBundledBinary } from './pathResolver.js';
import { AdbService } from './adbService.js';
import { ReverseService } from './reverseService.js';
import { ScrcpyService } from './scrcpyService.js';

let mainWindow: BrowserWindow | null = null;
let adbService: AdbService | null = null;
let scrcpyService: ScrcpyService | null = null;
let tray: Tray | null = null;
let isQuitting = false;
const reverseService = new ReverseService();

function iconPath() {
  return path.join(app.getAppPath(), 'assets', 'icon.ico');
}

function remoteApkPath() {
  return path.join(app.getAppPath(), 'assets', 'scrcpy-remote.apk');
}

function isElevated() {
  if (process.platform !== 'win32') return undefined;
  try {
    execFileSync('fltmc.exe', [], { stdio: 'ignore', windowsHide: true });
    return true;
  } catch {
    return false;
  }
}

function createWindow() {
  mainWindow = new BrowserWindow({
    width: 1320,
    height: 860,
    minWidth: 1120,
    minHeight: 720,
    title: 'Scrcpy Studio',
    frame: false,
    icon: iconPath(),
    backgroundColor: '#0d0d0d',
    autoHideMenuBar: true,
    webPreferences: {
      preload: path.join(app.getAppPath(), 'dist', 'main', 'main', 'preload.cjs'),
      contextIsolation: true,
      nodeIntegration: false
    }
  });
  mainWindow.setMenuBarVisibility(false);
  mainWindow.on('close', () => {
    isQuitting = true;
  });

  if (!app.isPackaged && process.env.VITE_DEV_SERVER_URL) {
    void mainWindow.loadURL(process.env.VITE_DEV_SERVER_URL);
  } else if (!app.isPackaged) {
    void mainWindow.loadURL('http://127.0.0.1:5173');
  } else {
    void mainWindow.loadFile(path.join(app.getAppPath(), 'dist', 'renderer', 'index.html'));
  }
}

function createTray() {
  if (tray) return;
  tray = new Tray(iconPath());
  tray.setToolTip('Scrcpy Studio');
  tray.setContextMenu(
    Menu.buildFromTemplate([
      { label: 'Show Scrcpy Studio', click: () => mainWindow?.show() },
      { label: 'Start reverse remote', click: () => void reverseService.start(7420) },
      { label: 'Stop reverse remote', click: () => void reverseService.stop() },
      { type: 'separator' },
      {
        label: 'Quit',
        click: () => {
          isQuitting = true;
          app.quit();
        }
      }
    ])
  );
  tray.on('click', () => mainWindow?.show());
}

function getAdb() {
  const settings = getSettings();
  const adbPath = resolveBundledBinary('adb', settings.adbPath);
  if (!adbService || (adbService as unknown as { adbPath?: string }).adbPath !== adbPath) {
    adbService = new AdbService(adbPath);
  }
  return adbService;
}

function getScrcpy() {
  const settings = getSettings();
  const scrcpyPath = resolveBundledBinary('scrcpy', settings.scrcpyPath);
  if (!scrcpyService || (scrcpyService as unknown as { scrcpyPath?: string }).scrcpyPath !== scrcpyPath) {
    scrcpyService = new ScrcpyService(scrcpyPath, settings.recentSessions);
    scrcpyService.on('session-changed', (session) => {
      const recentSessions = [session, ...getScrcpy().listSessions().filter((item) => item.id !== session.id)]
        .slice(0, 20)
        .map((item) => ({ ...item, logs: item.logs.slice(-500) }));
      saveSettings({ ...getSettings(), recentSessions });
      mainWindow?.webContents.send('session:changed', session);
    });
  }
  return scrcpyService;
}

app.whenReady().then(() => {
  Menu.setApplicationMenu(null);
  ipcMain.handle('settings:get', () => getSettings());
  ipcMain.handle('settings:save', (_, settings) => saveSettings(settings));
  ipcMain.handle('devices:list', () => getAdb().listDevicesWithWirelessRepair());
  ipcMain.handle('adb:restart', () => getAdb().restartServer());
  ipcMain.handle('adb:wireless', async (_, serial: string, port: number) => {
    const adb = getAdb();
    return adb.enableWireless(serial, port);
  });
  ipcMain.handle('adb:connect', (_, host: string) => getAdb().connect(host));
  ipcMain.handle('adb:pair', (_, host: string, port: number, code: string) => getAdb().pair(host, port, code));
  ipcMain.handle('adb:disconnect', (_, serial: string) => getAdb().disconnect(serial));
  ipcMain.handle('scrcpy:preview', (_, serial, profile) => getScrcpy().preview(serial, profile));
  ipcMain.handle('scrcpy:start', (_, serial, profile) => getScrcpy().start(serial, profile));
  ipcMain.handle('scrcpy:stop', (_, sessionId) => getScrcpy().stop(sessionId));
  ipcMain.handle('scrcpy:sessions', () => getScrcpy().listSessions());
  ipcMain.handle('reverse:status', () => reverseService.getStatus());
  ipcMain.handle('reverse:start', async (_, port: number, serial?: string) => {
    const status = await reverseService.start(port);
    if (serial) {
      await getAdb().reverse(serial, port);
      reverseService.setAdbReverseSerial(serial);
    }
    return reverseService.getStatus();
  });
  ipcMain.handle('reverse:settings', (_, settings) => reverseService.setStreamSettings(settings));
  ipcMain.handle('reverse:audio-beta', (_, enabled: boolean) => reverseService.setReverseAudioBeta(enabled));
  ipcMain.handle('remote:install-open', async (_, serial: string, port?: number) => {
    const apkPath = remoteApkPath();
    if (!fs.existsSync(apkPath)) {
      throw new Error(`Remote Android APK is missing: ${apkPath}`);
    }
    const adb = getAdb();
    const remotePort = port || reverseService.getStatus().port || 7420;
    const installResult = await adb.install(serial, apkPath);
    await reverseService.start(remotePort);
    await adb.reverse(serial, remotePort);
    reverseService.setAdbReverseSerial(serial);
    await adb.shell(serial, ['am', 'start', '-n', 'com.scrcpystudio.remote.debug/com.scrcpystudio.remote.MainActivity']);
    return [installResult, `Remote app opened. USB URL: http://127.0.0.1:${remotePort}`].filter(Boolean).join('\n');
  });
  ipcMain.handle('reverse:stop', () => reverseService.stop());
  reverseService.setActionHandlers({
    startScrcpy: async (serial?: string) => {
      const settings = getSettings();
      const devices = await getAdb().listDevices();
      const deviceSerial = serial || reverseService.getStatus().adbReverseSerial || devices.find((device) => device.state === 'device')?.serial;
      if (!deviceSerial) throw new Error('No authorized ADB device is available for scrcpy.');
      const profile = settings.profiles.find((item) => item.id === settings.defaultProfileId) ?? settings.profiles[0];
      if (!profile) throw new Error('No scrcpy profile is configured.');
      return getScrcpy().start(deviceSerial, profile);
    }
  });
  ipcMain.handle('window:minimize', () => mainWindow?.minimize());
  ipcMain.handle('window:toggle-maximize', () => {
    if (!mainWindow) return;
    if (mainWindow.isMaximized()) {
      mainWindow.unmaximize();
    } else {
      mainWindow.maximize();
    }
  });
  ipcMain.handle('window:close', () => mainWindow?.close());
  ipcMain.handle('diagnostics:get', () => {
    const settings = getSettings();
    const adbPath = resolveBundledBinary('adb', settings.adbPath);
    const scrcpyPath = resolveBundledBinary('scrcpy', settings.scrcpyPath);
    return {
      platform: process.platform,
      packaged: app.isPackaged,
      adbPath,
      scrcpyPath,
      adbAvailable: fs.existsSync(adbPath) || adbPath === 'adb.exe' || adbPath === 'adb',
      scrcpyAvailable: fs.existsSync(scrcpyPath) || scrcpyPath === 'scrcpy.exe' || scrcpyPath === 'scrcpy',
      appVersion: app.getVersion(),
      isElevated: isElevated(),
      inputBackend: process.platform === 'win32' ? 'Windows SendInput' : 'Limited browser input',
      gameModeWarnings: [
        'Some fullscreen games and anti-cheat protected windows ignore SendInput.',
        'For best game input, run Scrcpy Studio as administrator and prefer borderless/windowed fullscreen.',
        'True game-controller quality input likely needs a virtual HID driver in a later build.'
      ],
      localIpv4Addresses: Object.values(os.networkInterfaces())
        .flat()
        .filter((entry): entry is os.NetworkInterfaceInfo => Boolean(entry && entry.family === 'IPv4' && !entry.internal))
        .map((entry) => entry.address)
    };
  });

  createWindow();
  createTray();
});

app.on('window-all-closed', () => {
  if (process.platform !== 'darwin') app.quit();
});

app.on('before-quit', () => {
  isQuitting = true;
});

app.on('activate', () => {
  if (BrowserWindow.getAllWindows().length === 0) createWindow();
});
