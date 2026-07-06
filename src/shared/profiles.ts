import type { LaunchProfile } from './types.js';

export const defaultProfiles: LaunchProfile[] = [
  {
    id: 'fast',
    name: 'Fast',
    description: 'Low-latency daily control with restrained bandwidth.',
    video: { maxSize: 1280, bitRateMbps: 8, maxFps: 60, orientation: 'unlocked' },
    audio: { enabled: false },
    input: { clipboard: true, turnScreenOff: false, stayAwake: true, powerOn: true },
    window: { title: 'Scrcpy Studio - Fast', alwaysOnTop: false, borderless: false, fullscreen: false },
    recording: { enabled: false },
    system: { requiresAdministrator: false },
    extraArgs: ''
  },
  {
    id: 'quality',
    name: 'Quality',
    description: 'Sharper image for reading, design checks, and media.',
    video: { maxSize: 1920, bitRateMbps: 16, maxFps: 120, orientation: 'unlocked' },
    audio: { enabled: true },
    input: { clipboard: true, turnScreenOff: false, stayAwake: true, powerOn: true },
    window: { title: 'Scrcpy Studio - Quality', alwaysOnTop: false, borderless: false, fullscreen: false },
    recording: { enabled: false },
    system: { requiresAdministrator: false },
    extraArgs: ''
  },
  {
    id: 'battery',
    name: 'Battery Saver',
    description: 'Keeps the phone cool and turns its display off.',
    video: { maxSize: 1024, bitRateMbps: 4, maxFps: 30, orientation: 'unlocked' },
    audio: { enabled: false },
    input: { clipboard: true, turnScreenOff: true, stayAwake: false, powerOn: true },
    window: { title: 'Scrcpy Studio - Battery', alwaysOnTop: false, borderless: false, fullscreen: false },
    recording: { enabled: false },
    system: { requiresAdministrator: false },
    extraArgs: ''
  },
  {
    id: 'work',
    name: 'Work Mode',
    description: 'Stable workstation defaults for longer desktop sessions.',
    video: { maxSize: 1600, bitRateMbps: 10, maxFps: 60, orientation: 'unlocked' },
    audio: { enabled: false },
    input: { clipboard: true, turnScreenOff: true, stayAwake: true, powerOn: true },
    window: { title: 'Scrcpy Studio - Work', alwaysOnTop: true, borderless: false, fullscreen: false },
    recording: { enabled: false },
    system: { requiresAdministrator: true },
    extraArgs: ''
  }
];

export const defaultSettings = {
  theme: 'dark' as const,
  pollIntervalMs: 5000,
  defaultProfileId: 'fast',
  profiles: defaultProfiles
};
