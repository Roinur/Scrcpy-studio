import type { CommandPreview, LaunchProfile } from '../shared/types.js';

function quote(part: string) {
  if (/^[A-Za-z0-9_./:=@-]+$/.test(part)) {
    return part;
  }

  return `"${part.replaceAll('"', '\\"')}"`;
}

export function splitExtraArgs(input: string): string[] {
  const args: string[] = [];
  let current = '';
  let quoteChar: '"' | "'" | null = null;
  let escaping = false;

  for (const char of input.trim()) {
    if (escaping) {
      current += char;
      escaping = false;
      continue;
    }

    if (char === '\\') {
      escaping = true;
      continue;
    }

    if ((char === '"' || char === "'") && !quoteChar) {
      quoteChar = char;
      continue;
    }

    if (char === quoteChar) {
      quoteChar = null;
      continue;
    }

    if (/\s/.test(char) && !quoteChar) {
      if (current) {
        args.push(current);
        current = '';
      }
      continue;
    }

    current += char;
  }

  if (current) {
    args.push(current);
  }

  return args;
}

export function buildScrcpyCommand(scrcpyPath: string, deviceSerial: string, profile: LaunchProfile): CommandPreview {
  const args = ['--serial', deviceSerial];

  if (!profile.input.powerOn) args.push('--no-power-on');
  if (profile.input.turnScreenOff) args.push('-S');
  if (profile.input.stayAwake) args.push('--stay-awake');
  if (!profile.input.clipboard) args.push('--no-clipboard-autosync');

  if (profile.video.maxSize) args.push('--max-size', String(profile.video.maxSize));
  if (profile.video.bitRateMbps) args.push('--video-bit-rate', `${profile.video.bitRateMbps}M`);
  if (profile.video.maxFps) args.push('--max-fps', String(profile.video.maxFps));
  if (typeof profile.video.displayId === 'number') args.push('--display-id', String(profile.video.displayId));
  if (profile.video.crop) args.push('--crop', profile.video.crop);
  if (profile.video.orientation === 'portrait') args.push('--orientation', '0');
  if (profile.video.orientation === 'landscape') args.push('--orientation', '90');

  if (!profile.audio.enabled) args.push('--no-audio');
  if (profile.window.title) args.push('--window-title', profile.window.title);
  if (profile.window.alwaysOnTop) args.push('--always-on-top');
  if (profile.window.borderless) args.push('--window-borderless');
  if (profile.window.fullscreen) args.push('--fullscreen');
  if (profile.recording.enabled && profile.recording.path) args.push('--record', profile.recording.path);

  args.push(...splitExtraArgs(profile.extraArgs));

  return {
    executable: scrcpyPath,
    args,
    command: [scrcpyPath, ...args].map(quote).join(' ')
  };
}
