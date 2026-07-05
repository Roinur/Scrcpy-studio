import { execFile } from 'node:child_process';
import { promisify } from 'node:util';
import type { Device, DeviceState, DeviceTransport } from '../shared/types.js';

const execFileAsync = promisify(execFile);
const wirelessRepairCooldownMs = 30_000;

function delay(ms: number) {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

function parseTransport(serial: string): DeviceTransport {
  if (serial.startsWith('emulator-')) return 'emulator';
  if (/:\d+$/.test(serial)) return 'wireless';
  if (serial) return 'usb';
  return 'unknown';
}

function parseDeviceLine(line: string): Device | null {
  const [serial, state, ...parts] = line.trim().split(/\s+/);
  if (!serial || !state) return null;
  const fields = Object.fromEntries(
    parts
      .map((part) => part.split(':'))
      .filter(([key, value]) => key && value)
      .map(([key, value]) => [key, value])
  );

  return {
    serial,
    state: state as DeviceState,
    transport: parseTransport(serial),
    model: fields.model?.replaceAll('_', ' '),
    product: fields.product
  };
}

export class AdbService {
  constructor(private readonly adbPath: string) {}
  private lastWirelessRepairAt = 0;

  async listDevices(): Promise<Device[]> {
    const { stdout } = await execFileAsync(this.adbPath, ['devices', '-l'], { windowsHide: true });
    return stdout
      .split(/\r?\n/)
      .slice(1)
      .map(parseDeviceLine)
      .filter((device): device is Device => Boolean(device));
  }

  async listDevicesWithWirelessRepair(port = 5555): Promise<Device[]> {
    const devices = await this.listDevices();
    const hasWireless = devices.some((device) => device.transport === 'wireless' && device.state === 'device');
    const usbDevice = devices.find((device) => device.transport === 'usb' && device.state === 'device');
    const now = Date.now();

    if (!hasWireless && usbDevice && now - this.lastWirelessRepairAt > wirelessRepairCooldownMs) {
      this.lastWirelessRepairAt = now;
      await this.enableWireless(usbDevice.serial, port).catch(() => undefined);
      return this.listDevices();
    }

    return devices;
  }

  async restartServer() {
    await execFileAsync(this.adbPath, ['kill-server'], { windowsHide: true });
    const { stdout, stderr } = await execFileAsync(this.adbPath, ['start-server'], { windowsHide: true });
    return [stdout, stderr].filter(Boolean).join('\n').trim() || 'ADB server restarted.';
  }

  async tcpIp(serial: string, port: number) {
    const { stdout, stderr } = await execFileAsync(this.adbPath, ['-s', serial, 'tcpip', String(port)], {
      windowsHide: true
    });
    return [stdout, stderr].filter(Boolean).join('\n').trim();
  }

  async getDeviceWifiIp(serial: string) {
    const routeOutput = await this.shell(serial, ['ip', 'route', 'get', '1.1.1.1']).catch(() => '');
    const routeMatch = routeOutput.match(/\bsrc\s+(\d{1,3}(?:\.\d{1,3}){3})\b/);
    if (routeMatch?.[1]) return routeMatch[1];

    const wlanOutput = await this.shell(serial, ['ip', 'addr', 'show', 'wlan0']).catch(() => '');
    const wlanMatch = wlanOutput.match(/\binet\s+(\d{1,3}(?:\.\d{1,3}){3})\//);
    if (wlanMatch?.[1]) return wlanMatch[1];

    const ifconfigOutput = await this.shell(serial, ['ifconfig', 'wlan0']).catch(() => '');
    const ifconfigMatch = ifconfigOutput.match(/\binet(?: addr:)?\s*(\d{1,3}(?:\.\d{1,3}){3})\b/);
    if (ifconfigMatch?.[1]) return ifconfigMatch[1];

    throw new Error('Could not read the device Wi-Fi IP. Make sure the phone is on the same Wi-Fi as this PC.');
  }

  async enableWireless(serial: string, port: number) {
    const tcp = await this.tcpIp(serial, port);
    await delay(1400);
    const ip = await this.getDeviceWifiIp(serial);
    const host = `${ip}:${port}`;
    const connect = await this.connect(host);
    return [tcp, `Detected Wi-Fi address ${host}.`, connect].filter(Boolean).join('\n').trim();
  }

  async connect(host: string) {
    const { stdout, stderr } = await execFileAsync(this.adbPath, ['connect', host], { windowsHide: true });
    return [stdout, stderr].filter(Boolean).join('\n').trim();
  }

  async disconnect(serial: string) {
    const { stdout, stderr } = await execFileAsync(this.adbPath, ['disconnect', serial], { windowsHide: true });
    return [stdout, stderr].filter(Boolean).join('\n').trim();
  }

  async pair(host: string, port: number, code: string) {
    const { stdout, stderr } = await execFileAsync(this.adbPath, ['pair', `${host}:${port}`, code], {
      windowsHide: true
    });
    return [stdout, stderr].filter(Boolean).join('\n').trim();
  }

  async reverse(serial: string, localPort: number, remotePort = localPort) {
    const { stdout, stderr } = await execFileAsync(
      this.adbPath,
      ['-s', serial, 'reverse', `tcp:${remotePort}`, `tcp:${localPort}`],
      { windowsHide: true }
    );
    return [stdout, stderr].filter(Boolean).join('\n').trim();
  }

  async install(serial: string, apkPath: string) {
    const { stdout, stderr } = await execFileAsync(this.adbPath, ['-s', serial, 'install', '-r', apkPath], {
      windowsHide: true,
      timeout: 120_000
    });
    return [stdout, stderr].filter(Boolean).join('\n').trim();
  }

  async shell(serial: string, args: string[]) {
    const { stdout } = await execFileAsync(this.adbPath, ['-s', serial, 'shell', ...args], { windowsHide: true });
    return stdout.trim();
  }
}
