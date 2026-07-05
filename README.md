# Scrcpy Studio

Scrcpy Studio is a Windows-first desktop control surface for scrcpy and ADB. It wraps the bundled scrcpy and Android platform-tools binaries with a polished queue-free UI, device list, profiles, session logs, wireless ADB helpers, and reverse remote controls.

## Features

- Detect USB, wireless, emulator, unauthorized, and offline ADB devices.
- Start scrcpy sessions from named launch profiles.
- Configure video size, bitrate, FPS, display, audio, input, window, recording, and extra scrcpy args.
- Rename devices locally.
- Pair, connect, disconnect, and restart ADB from the UI.
- Automatically repairs wireless ADB when a USB device is available by enabling `adb tcpip`, reading the phone Wi-Fi IP from Android, and reconnecting to `IP:5555`.
- Includes a reverse remote server for controlling the Windows desktop from an Android browser/app.

## Development

```powershell
npm install
npm run dev
```

## Build

```powershell
npm run build
npm run package
```

The Windows installer is written to `release/`.

## Required Vendor Files

The packaged app expects these folders in `vendor/`:

- `platform-tools/` with `adb.exe`
- `scrcpy/` with `scrcpy.exe`

## Credits

Scrcpy Studio is built around [`Genymobile/scrcpy`](https://github.com/Genymobile/scrcpy), the official open-source project for displaying and controlling Android devices from a computer. scrcpy is licensed under Apache-2.0.

Android Debug Bridge comes from Google's Android platform-tools.
