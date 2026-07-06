# Third-Party Notices

Scrcpy Studio uses third-party software and projects listed below.

## scrcpy

Scrcpy Studio launches scrcpy as a bundled executable to display and control Android devices.

- Project: https://github.com/Genymobile/scrcpy
- License: Apache-2.0
- Copyright: Genymobile and Romain Vimont

The vendor installer downloads the official Windows scrcpy release from Genymobile's GitHub releases. It also stores the upstream scrcpy license at:

- `vendor/scrcpy/LICENSE`

Packaged Windows releases copy that file into the installed app's `resources/` folder as:

- `SCRCPY-LICENSE.txt`

## Android SDK Platform-Tools / ADB

Scrcpy Studio uses Google's Android SDK Platform-Tools package for ADB commands, device discovery, pairing, wireless connect, and scrcpy transport.

- Project information: https://developer.android.com/tools/releases/platform-tools
- Android SDK terms: https://developer.android.com/studio/terms

The vendor installer downloads Google's Windows Platform-Tools zip from:

- `https://dl.google.com/android/repository/platform-tools-latest-windows.zip`

That package includes Google's full notice file at:

- `vendor/platform-tools/NOTICE.txt`

Packaged Windows releases copy that file into the installed app's `resources/` folder as:

- `ANDROID-PLATFORM-TOOLS-NOTICE.txt`

## Electron and npm dependencies

Scrcpy Studio is built with Electron, React, Vite, and npm packages listed in `package-lock.json`. Their package-level license metadata is preserved in `package-lock.json`.
