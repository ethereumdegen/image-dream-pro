# Image Dream Pro

An Electron desktop app for running [fal.ai](https://fal.ai) image models and managing a local media library.

## Features

- **Models page** – pick a fal.ai model from a curated list (or enter any model id), fill in its parameters, and run it against your API key.
- **Local-first file picking** – browse to select input images straight from your computer. No drag-drop-only workflow.
- **Automatic saving** – every image returned by fal.ai is downloaded and saved into your local media library automatically.
- **Media Library** – browse folders and thumbnails of everything you've generated or imported. Folders in the UI are real folders on disk.
- **Import by browse** – click "Add images" in the library to copy files from anywhere on your computer into the current library folder.
- **Settings** – configure your fal.ai API key and the location of your media library.
- **Cross-platform** – builds for Linux (AppImage, deb), macOS (dmg, x64 + arm64), and Windows (nsis installer).

## Where are my files stored?

By default the media library lives in the OS-standard per-user app data folder:

- **Linux:** `~/.config/Image Dream Pro/library`
- **macOS:** `~/Library/Application Support/Image Dream Pro/library`
- **Windows:** `%APPDATA%\Image Dream Pro\library`

You can change this location from the Settings page.

Settings (including your API key) are stored in `settings.json` in the same per-user app data directory.

## Development

```bash
npm install
npm start
```

## Building installers

```bash
# Current platform
npm run build

# Specific platform
npm run build:linux
npm run build:mac
npm run build:win
```

You'll need icons at `build/icon.png` (Linux, 512x512), `build/icon.icns` (macOS), and `build/icon.ico` (Windows) before distributing production builds. electron-builder will still produce unbranded builds without them.

## Getting a fal.ai API key

1. Sign up at https://fal.ai
2. Create an API key in your dashboard
3. Paste it into **Settings → fal.ai API Key** inside the app
