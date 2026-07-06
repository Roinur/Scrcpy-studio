import { createWriteStream } from 'node:fs';
import fs from 'node:fs/promises';
import https from 'node:https';
import path from 'node:path';
import { pipeline } from 'node:stream/promises';
import { fileURLToPath } from 'node:url';
import { spawn } from 'node:child_process';

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const vendorDir = path.join(root, 'vendor');
const tempDir = path.join(root, '.vendor-cache');
const platformToolsDir = path.join(vendorDir, 'platform-tools');
const scrcpyDir = path.join(vendorDir, 'scrcpy');
const platformToolsUrl = 'https://dl.google.com/android/repository/platform-tools-latest-windows.zip';
const scrcpyLatestApi = 'https://api.github.com/repos/Genymobile/scrcpy/releases/latest';

async function exists(filePath) {
  try {
    await fs.access(filePath);
    return true;
  } catch {
    return false;
  }
}

async function download(url, destination) {
  await fs.mkdir(path.dirname(destination), { recursive: true });
  await new Promise((resolve, reject) => {
    const request = https.get(url, { headers: { 'User-Agent': 'Scrcpy-Studio-Installer' } }, (response) => {
      if ([301, 302, 303, 307, 308].includes(response.statusCode ?? 0) && response.headers.location) {
        response.resume();
        download(response.headers.location, destination).then(resolve, reject);
        return;
      }
      if (response.statusCode !== 200) {
        response.resume();
        reject(new Error(`Download failed (${response.statusCode}) for ${url}`));
        return;
      }
      pipeline(response, createWriteStream(destination)).then(resolve, reject);
    });
    request.on('error', reject);
  });
}

async function readJson(url) {
  return new Promise((resolve, reject) => {
    const request = https.get(url, { headers: { 'User-Agent': 'Scrcpy-Studio-Installer' } }, (response) => {
      if (response.statusCode !== 200) {
        response.resume();
        reject(new Error(`Request failed (${response.statusCode}) for ${url}`));
        return;
      }
      let body = '';
      response.setEncoding('utf8');
      response.on('data', (chunk) => {
        body += chunk;
      });
      response.on('end', () => {
        try {
          resolve(JSON.parse(body));
        } catch (error) {
          reject(error);
        }
      });
    });
    request.on('error', reject);
  });
}

async function expandZip(zipPath, destination) {
  await fs.rm(destination, { recursive: true, force: true });
  await fs.mkdir(destination, { recursive: true });
  await new Promise((resolve, reject) => {
    const child = spawn('powershell.exe', [
      '-NoProfile',
      '-ExecutionPolicy',
      'Bypass',
      '-Command',
      'Expand-Archive -LiteralPath $args[0] -DestinationPath $args[1] -Force',
      zipPath,
      destination
    ], { stdio: 'inherit' });
    child.on('error', reject);
    child.on('close', (code) => {
      if (code === 0) resolve();
      else reject(new Error(`Expand-Archive exited with code ${code}`));
    });
  });
}

async function copyExtractedFolder(extractDir, expectedFolderName, destination) {
  const nested = path.join(extractDir, expectedFolderName);
  if (await exists(nested)) {
    await fs.rm(destination, { recursive: true, force: true });
    await fs.cp(nested, destination, { recursive: true });
    return;
  }

  const entries = await fs.readdir(extractDir, { withFileTypes: true });
  const onlyDirectory = entries.filter((entry) => entry.isDirectory())[0];
  if (!onlyDirectory) throw new Error(`Could not find extracted folder in ${extractDir}`);

  await fs.rm(destination, { recursive: true, force: true });
  await fs.cp(path.join(extractDir, onlyDirectory.name), destination, { recursive: true });
}

async function installPlatformTools() {
  if (await exists(path.join(platformToolsDir, 'adb.exe'))) {
    console.log('vendor/platform-tools already installed');
    return;
  }

  console.log('Downloading Android platform-tools...');
  const zipPath = path.join(tempDir, 'platform-tools.zip');
  const extractDir = path.join(tempDir, 'platform-tools-extract');
  await download(platformToolsUrl, zipPath);
  await expandZip(zipPath, extractDir);
  await copyExtractedFolder(extractDir, 'platform-tools', platformToolsDir);
}

async function installScrcpy() {
  if (await exists(path.join(scrcpyDir, 'scrcpy.exe'))) {
    console.log('vendor/scrcpy already installed');
    return;
  }

  console.log('Finding latest scrcpy Windows release...');
  const release = await readJson(scrcpyLatestApi);
  const asset = release.assets?.find((item) => /^scrcpy-win64-v.*\.zip$/i.test(item.name));
  if (!asset?.browser_download_url) {
    throw new Error('Could not find a scrcpy-win64 zip in the latest Genymobile/scrcpy release.');
  }

  console.log(`Downloading ${asset.name}...`);
  const zipPath = path.join(tempDir, asset.name);
  const extractDir = path.join(tempDir, 'scrcpy-extract');
  await download(asset.browser_download_url, zipPath);
  await expandZip(zipPath, extractDir);
  await copyExtractedFolder(extractDir, asset.name.replace(/\.zip$/i, ''), scrcpyDir);
}

async function main() {
  if (process.platform !== 'win32') {
    console.log('Skipping vendor install: Scrcpy Studio packages Windows binaries only.');
    return;
  }

  await fs.mkdir(vendorDir, { recursive: true });
  await fs.mkdir(tempDir, { recursive: true });
  await installPlatformTools();
  await installScrcpy();
  await fs.rm(tempDir, { recursive: true, force: true });
  console.log('Vendor binaries are ready.');
}

main().catch((error) => {
  console.error(error);
  process.exitCode = 1;
});
