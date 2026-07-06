# Vendor binaries

Windows builds used for packaging:

- `vendor/scrcpy/scrcpy.exe`: scrcpy from [`Genymobile/scrcpy`](https://github.com/Genymobile/scrcpy).
- `vendor/platform-tools/adb.exe`: Android Debug Bridge from Google's official platform-tools package.

Run `npm install` or `npm run install:vendor` to download these files automatically.

During development Scrcpy Studio also checks custom paths from settings and finally falls back to global `scrcpy` and `adb` on PATH.
