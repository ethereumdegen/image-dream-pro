#!/usr/bin/env bash
#
# build-releases.sh
#
# Builds Image Dream Pro installers for Linux, Windows, and macOS using the
# existing `npm run build:*` scripts, then publishes them to GitHub Releases
# via the `gh` CLI so they appear on the repository's Releases page — the
# same flow most professional projects use for distributing binaries.
#
# Usage:
#   ./scripts/build-releases.sh                # build + publish
#   ./scripts/build-releases.sh --no-publish   # build only, skip publishing
#   ./scripts/build-releases.sh --skip-build   # publish existing releases/*
#
# Notes:
#   - Windows builds from Linux override the target to `zip` (portable
#     bundle) because NSIS installers need `makensis`, which ships only as
#     a Windows binary (so wine would otherwise be required). Users on
#     Windows unzip the bundle and run Image Dream Pro.exe. On Windows
#     itself the normal nsis installer is produced.
#   - macOS builds from Linux override the target to `zip` and disable
#     code-signing so dmg-license/hdiutil/codesign are not required.
#   - releases/ is a local staging directory and is gitignored. Binaries
#     are published as release assets, not committed to the repo.
#
set -euo pipefail

cd "$(dirname "$0")/.."
ROOT="$(pwd)"
RELEASES_DIR="$ROOT/releases"
DIST_DIR="$ROOT/dist"

VERSION=$(node -p "require('./package.json').version")
REPO_SLUG="ethereumdegen/image-dream-pro"
REPO_URL="https://github.com/$REPO_SLUG"
TAG="v$VERSION"

DO_BUILD=1
DO_PUBLISH=1
for arg in "$@"; do
  case "$arg" in
    --no-publish) DO_PUBLISH=0 ;;
    --skip-build) DO_BUILD=0 ;;
    -h|--help)
      sed -n '2,30p' "$0"
      exit 0
      ;;
    *) echo "Unknown argument: $arg" >&2; exit 2 ;;
  esac
done

HOST_OS="$(uname -s)"

echo "==> Image Dream Pro release builder"
echo "    version: $VERSION"
echo "    tag:     $TAG"
echo "    host:    $HOST_OS"
echo "    publish: $([ $DO_PUBLISH -eq 1 ] && echo yes || echo no)"

if [ ! -d node_modules ]; then
  echo "==> Installing dependencies"
  npm install
fi

mkdir -p "$RELEASES_DIR"

LINUX_APPIMAGE=""
LINUX_DEB=""
WIN_FILE=""
WIN_LABEL=""
MAC_X64=""
MAC_ARM64=""

run_npm_build() {
  # $1 = human-readable platform, $2 = npm script name, rest = extra args
  local name="$1" script="$2"; shift 2
  echo ""
  echo "==> Building $name via 'npm run $script'"
  rm -rf "$DIST_DIR"
  if npm run "$script" -- "$@"; then
    echo "==> $name build: OK"
    return 0
  else
    echo "==> $name build: FAILED (continuing)"
    return 1
  fi
}

copy_first() {
  # $1 = glob dir, $2 = extension, $3 = destination filename
  local dir="$1" ext="$2" target="$3"
  shopt -s nullglob
  local files=("$dir"/*."$ext")
  shopt -u nullglob
  for f in "${files[@]}"; do
    [ -f "$f" ] || continue
    cp "$f" "$RELEASES_DIR/$target"
    echo "    + $target"
    return 0
  done
  return 1
}

if [ $DO_BUILD -eq 1 ]; then
  # Clean out any existing staging artifacts for this version
  find "$RELEASES_DIR" -maxdepth 1 -type f \
    \( -name 'ImageDreamPro-*' -o -name '*.AppImage' -o -name '*.deb' \
       -o -name '*.exe' -o -name '*.dmg' -o -name '*.zip' \) -delete || true

  # ---------- Linux ----------
  if run_npm_build "Linux" "build:linux"; then
    name="ImageDreamPro-$VERSION-linux-x86_64.AppImage"
    copy_first "$DIST_DIR" "AppImage" "$name" && LINUX_APPIMAGE="$name"
    name="ImageDreamPro-$VERSION-linux-amd64.deb"
    copy_first "$DIST_DIR" "deb" "$name" && LINUX_DEB="$name"
  fi

  # ---------- Windows ----------
  WIN_EXTRA=()
  WIN_TARGET_EXT="exe"
  WIN_TARGET_SUFFIX="setup.exe"
  if [ "$HOST_OS" = "Linux" ]; then
    # NSIS's makensis is a Windows binary that would need wine. Use `zip`
    # instead: a portable bundle users extract and run. No wine required.
    WIN_EXTRA+=(
      --config.win.target=zip
      --config.win.signAndEditExecutable=false
    )
    WIN_TARGET_EXT="zip"
    WIN_TARGET_SUFFIX="portable.zip"
    WIN_LABEL="portable zip"
  else
    WIN_LABEL="installer"
  fi
  if run_npm_build "Windows" "build:win" "${WIN_EXTRA[@]}"; then
    name="ImageDreamPro-$VERSION-win-x64-$WIN_TARGET_SUFFIX"
    copy_first "$DIST_DIR" "$WIN_TARGET_EXT" "$name" && WIN_FILE="$name"
  fi

  # ---------- macOS ----------
  MAC_EXTRA=()
  if [ "$HOST_OS" != "Darwin" ]; then
    # On non-macOS hosts, dmg/codesign aren't available. Produce a zipped
    # .app bundle instead so at least something ships for Mac users.
    MAC_EXTRA+=(
      --config.mac.target=zip
      --config.mac.identity=null
    )
  fi
  if run_npm_build "macOS" "build:mac" "${MAC_EXTRA[@]}"; then
    shopt -s nullglob
    for f in "$DIST_DIR"/*.dmg "$DIST_DIR"/*.zip; do
      [ -f "$f" ] || continue
      # dist/ may also contain non-mac zips? mac target=zip names them *.zip
      # Try to classify by architecture
      ext="${f##*.}"
      if [[ "$f" == *arm64* ]]; then
        name="ImageDreamPro-$VERSION-mac-arm64.$ext"
        cp "$f" "$RELEASES_DIR/$name"
        echo "    + $name"
        MAC_ARM64="$name"
      elif [[ "$f" == *mac* ]] || [[ "$ext" == "dmg" ]]; then
        name="ImageDreamPro-$VERSION-mac-x64.$ext"
        cp "$f" "$RELEASES_DIR/$name"
        echo "    + $name"
        MAC_X64="$name"
      fi
    done
    shopt -u nullglob
  fi
else
  # --skip-build: discover any artifacts already present in releases/
  shopt -s nullglob
  for f in "$RELEASES_DIR"/ImageDreamPro-"$VERSION"-*; do
    base=$(basename "$f")
    case "$base" in
      *linux-x86_64.AppImage) LINUX_APPIMAGE="$base" ;;
      *linux-amd64.deb)       LINUX_DEB="$base" ;;
      *win-x64-setup.exe)     WIN_FILE="$base"; WIN_LABEL="installer" ;;
      *win-x64-portable.zip)  WIN_FILE="$base"; WIN_LABEL="portable zip" ;;
      *mac-x64.dmg|*mac-x64.zip)     MAC_X64="$base" ;;
      *mac-arm64.dmg|*mac-arm64.zip) MAC_ARM64="$base" ;;
    esac
  done
  shopt -u nullglob
fi

echo ""
echo "==> Staged artifacts in releases/:"
ls -lh "$RELEASES_DIR" 2>/dev/null || true

# ---------- Publish to GitHub Releases ----------
if [ $DO_PUBLISH -eq 1 ]; then
  if ! command -v gh >/dev/null 2>&1; then
    echo ""
    echo "==> 'gh' CLI not found. Install from https://cli.github.com/ to publish."
    echo "    Skipping publish step. Artifacts remain in releases/."
  elif ! gh auth status >/dev/null 2>&1; then
    echo ""
    echo "==> 'gh' is not authenticated. Run 'gh auth login' first."
    echo "    Skipping publish step. Artifacts remain in releases/."
  else
    echo ""
    echo "==> Publishing $TAG to GitHub Releases"

    shopt -s nullglob
    assets=("$RELEASES_DIR"/ImageDreamPro-"$VERSION"-*)
    shopt -u nullglob

    if [ ${#assets[@]} -eq 0 ]; then
      echo "==> No artifacts to publish."
    else
      if gh release view "$TAG" --repo "$REPO_SLUG" >/dev/null 2>&1; then
        echo "    Release $TAG already exists — uploading assets with --clobber"
        gh release upload "$TAG" "${assets[@]}" --repo "$REPO_SLUG" --clobber
      else
        echo "    Creating release $TAG"
        NOTES="Pre-built installers for Image Dream Pro $TAG.

Download the appropriate binary for your platform below. See the [README]($REPO_URL#downloads) for installation instructions."
        gh release create "$TAG" \
          --repo "$REPO_SLUG" \
          --title "Image Dream Pro $TAG" \
          --notes "$NOTES" \
          "${assets[@]}"
      fi
    fi
  fi
else
  echo ""
  echo "==> --no-publish: skipping GitHub Releases upload."
fi

# ---------- README update ----------
echo ""
echo "==> Updating README.md Downloads section"

RELEASE_PAGE="$REPO_URL/releases/latest"
DL_BASE="$REPO_URL/releases/download/$TAG"

BLOCK_FILE="$(mktemp)"
{
  echo "## Downloads"
  echo ""
  echo "Pre-built installers are published on the [Releases page]($RELEASE_PAGE)."
  echo ""
  echo "**Latest version: $VERSION**"
  echo ""
  [ -n "$LINUX_APPIMAGE" ] && echo "- **Linux (AppImage):** [$LINUX_APPIMAGE]($DL_BASE/$LINUX_APPIMAGE)"
  [ -n "$LINUX_DEB" ]      && echo "- **Linux (.deb):** [$LINUX_DEB]($DL_BASE/$LINUX_DEB)"
  [ -n "$WIN_FILE" ]       && echo "- **Windows ($WIN_LABEL):** [$WIN_FILE]($DL_BASE/$WIN_FILE)"
  [ -n "$MAC_X64" ]        && echo "- **macOS (Intel):** [$MAC_X64]($DL_BASE/$MAC_X64)"
  [ -n "$MAC_ARM64" ]      && echo "- **macOS (Apple Silicon):** [$MAC_ARM64]($DL_BASE/$MAC_ARM64)"
  echo ""
} > "$BLOCK_FILE"

BLOCK_FILE="$BLOCK_FILE" node <<'NODEEOF'
const fs = require('fs');
const readmePath = 'README.md';
const block = fs.readFileSync(process.env.BLOCK_FILE, 'utf8').trimEnd();
const startTag = '<!-- DOWNLOADS:START -->';
const endTag   = '<!-- DOWNLOADS:END -->';
const wrapped  = `${startTag}\n${block}\n${endTag}`;

let readme = fs.readFileSync(readmePath, 'utf8');
if (readme.includes(startTag) && readme.includes(endTag)) {
  const re = new RegExp(`${startTag}[\\s\\S]*?${endTag}`);
  readme = readme.replace(re, wrapped);
} else {
  const anchor = '## Features';
  const idx = readme.indexOf(anchor);
  if (idx >= 0) {
    readme = readme.slice(0, idx) + wrapped + '\n\n' + readme.slice(idx);
  } else {
    readme = readme.trimEnd() + '\n\n' + wrapped + '\n';
  }
}
fs.writeFileSync(readmePath, readme);
console.log('README.md updated');
NODEEOF

rm -f "$BLOCK_FILE"

echo ""
echo "==> Done."
