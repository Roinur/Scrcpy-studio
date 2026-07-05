import Store from 'electron-store';
import type { AppSettings } from '../shared/types.js';
import { defaultSettings } from '../shared/profiles.js';

const store = new Store<AppSettings>({
  name: 'scrcpy-studio',
  defaults: defaultSettings
});

export function getSettings(): AppSettings {
  const settings = store.store;
  return {
    ...defaultSettings,
    ...settings,
    profiles: settings.profiles?.length ? settings.profiles : defaultSettings.profiles
  };
}

export function saveSettings(settings: AppSettings): AppSettings {
  const cleanSettings = {
    ...settings,
    theme: settings.theme ?? 'dark',
    deviceAliases: settings.deviceAliases ?? {},
    pollIntervalMs: Math.max(1500, Math.min(settings.pollIntervalMs || 5000, 30000))
  };
  store.store = cleanSettings;
  return getSettings();
}
