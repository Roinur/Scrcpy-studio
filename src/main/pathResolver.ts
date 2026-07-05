import { app } from 'electron';
import path from 'node:path';
import fs from 'node:fs';

const isWindows = process.platform === 'win32';

function executableName(base: string) {
  return isWindows ? `${base}.exe` : base;
}

function firstExisting(paths: string[]) {
  return paths.find((candidate) => fs.existsSync(candidate));
}

export function resolveBundledBinary(name: 'adb' | 'scrcpy', configuredPath?: string) {
  if (configuredPath && fs.existsSync(configuredPath)) {
    return configuredPath;
  }

  const exe = executableName(name);
  const resourceRoot = app.isPackaged ? process.resourcesPath : process.cwd();
  const candidates =
    name === 'adb'
      ? [
          path.join(resourceRoot, 'vendor', 'platform-tools', exe),
          path.join(process.cwd(), 'vendor', 'platform-tools', exe)
        ]
      : [
          path.join(resourceRoot, 'vendor', 'scrcpy', exe),
          path.join(process.cwd(), 'vendor', 'scrcpy', exe)
        ];

  return firstExisting(candidates) ?? exe;
}
