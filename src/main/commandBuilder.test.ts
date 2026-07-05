import { describe, expect, it } from 'vitest';
import { defaultProfiles } from '../shared/profiles.js';
import { buildScrcpyCommand, splitExtraArgs } from './commandBuilder.js';

describe('splitExtraArgs', () => {
  it('preserves quoted values', () => {
    expect(splitExtraArgs('--window-title "My Phone" --shortcut-mod=lctrl')).toEqual([
      '--window-title',
      'My Phone',
      '--shortcut-mod=lctrl'
    ]);
  });
});

describe('buildScrcpyCommand', () => {
  it('maps battery saver profile to screen-off and performance args', () => {
    const command = buildScrcpyCommand('scrcpy.exe', 'ABC123', defaultProfiles[2]);
    expect(command.args).not.toContain('--power-on');
    expect(command.args).toContain('-S');
    expect(command.args).toContain('--max-size');
    expect(command.args).toContain('1024');
    expect(command.args).toContain('--max-fps');
    expect(command.args).toContain('30');
    expect(command.args).toContain('--no-audio');
  });

  it('uses scrcpy 3.3 power defaults correctly', () => {
    const defaultCommand = buildScrcpyCommand('scrcpy.exe', 'ABC123', defaultProfiles[0]);
    expect(defaultCommand.args).not.toContain('--power-on');
    expect(defaultCommand.args).not.toContain('--no-power-on');

    const noPowerOnCommand = buildScrcpyCommand('scrcpy.exe', 'ABC123', {
      ...defaultProfiles[0],
      input: { ...defaultProfiles[0].input, powerOn: false }
    });
    expect(noPowerOnCommand.args).toContain('--no-power-on');
  });

  it('includes window and recording options', () => {
    const profile = {
      ...defaultProfiles[0],
      window: { title: 'Desk Phone', alwaysOnTop: true, borderless: true, fullscreen: true },
      recording: { enabled: true, path: 'C:\\Temp\\phone.mp4' },
      extraArgs: '--render-driver=direct3d'
    };

    const command = buildScrcpyCommand('C:\\Tools\\scrcpy.exe', '192.168.1.2:5555', profile);
    expect(command.args).toEqual(
      expect.arrayContaining([
        '--window-title',
        'Desk Phone',
        '--always-on-top',
        '--window-borderless',
        '--fullscreen',
        '--record',
        'C:\\Temp\\phone.mp4',
        '--render-driver=direct3d'
      ])
    );
    expect(command.command).toContain('"C:\\Tools\\scrcpy.exe"');
  });
});
