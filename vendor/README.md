# Bundled binaries

Bundled Windows builds included for packaging:

- `vendor/scrcpy/scrcpy.exe`: scrcpy from [`Genymobile/scrcpy`](https://github.com/Genymobile/scrcpy).
- `vendor/platform-tools/adb.exe`: Android Debug Bridge from Google's official platform-tools package.

During development Scrcpy Studio also checks custom paths from settings and finally falls back to global `scrcpy` and `adb` on PATH.
