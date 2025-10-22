#!/usr/bin/env bash
#
# Normalize the dynamic library references that ship with the macOS build.
# NativePHP will run this script from the project root before bundling,
# ensuring every binary points at the copies that live in
# resources/commands/lib rather than Homebrew.

set -euo pipefail

ROOT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
LIB_DIR="$ROOT_DIR/resources/commands/lib"
MAC_BIN_DIR="$ROOT_DIR/resources/commands/mac"

if ! command -v brew >/dev/null 2>&1; then
  echo "brew not found; install Homebrew so we can locate the source dylibs." >&2
  exit 1
fi

BREW_PREFIX="$(brew --prefix)"

mkdir -p "$LIB_DIR"

copy_if_needed() {
  local src="$1"
  local dst="$LIB_DIR/$(basename "$src")"

  if [[ ! -f "$src" ]]; then
    echo "Expected dependency $src is missing." >&2
    exit 1
  fi

  if [[ ! -f "$dst" || "$src" -nt "$dst" ]]; then
    cp -p "$src" "$dst"
  fi
}

copy_if_needed "$BREW_PREFIX/opt/jpeg-turbo/lib/libjpeg.8.dylib"
copy_if_needed "$BREW_PREFIX/opt/jpeg-turbo/lib/libturbojpeg.0.dylib"
copy_if_needed "$BREW_PREFIX/opt/openssl@3/lib/libcrypto.3.dylib"

repoint_dependency() {
  local target="$1"
  local original="$2"
  local replacement="$3"

  if otool -L "$target" | grep -q "$original"; then
    install_name_tool -change "$original" "$replacement" "$target"
  fi
}

# Update the libraries first so every other binary can safely target them.
for dylib in "$LIB_DIR"/lib*.dylib; do
  [[ -f "$dylib" ]] || continue

  basename="$(basename "$dylib")"
  install_name_tool -id "@loader_path/$basename" "$dylib"

  repoint_dependency "$dylib" "/opt/homebrew/opt/jpeg-turbo/lib/libjpeg.8.dylib" "@loader_path/libjpeg.8.dylib"
  repoint_dependency "$dylib" "/opt/homebrew/opt/jpeg-turbo/lib/libturbojpeg.0.dylib" "@loader_path/libturbojpeg.0.dylib"
  repoint_dependency "$dylib" "/opt/homebrew/opt/openssl@3/lib/libcrypto.3.dylib" "@loader_path/libcrypto.3.dylib"
  repoint_dependency "$dylib" "/opt/homebrew/opt/qpdf/lib/libqpdf.30.dylib" "@loader_path/libqpdf.30.dylib"
done

# Now fix the macOS executable(s) that ship alongside the libraries.
for bin in "$MAC_BIN_DIR"/*; do
  [[ -x "$bin" && ! -d "$bin" ]] || continue

  repoint_dependency "$bin" "/opt/homebrew/opt/jpeg-turbo/lib/libjpeg.8.dylib" "@loader_path/../lib/libjpeg.8.dylib"
  repoint_dependency "$bin" "/opt/homebrew/opt/jpeg-turbo/lib/libturbojpeg.0.dylib" "@loader_path/../lib/libturbojpeg.0.dylib"
  repoint_dependency "$bin" "/opt/homebrew/opt/openssl@3/lib/libcrypto.3.dylib" "@loader_path/../lib/libcrypto.3.dylib"
  repoint_dependency "$bin" "/opt/homebrew/opt/qpdf/lib/libqpdf.30.dylib" "@rpath/libqpdf.30.dylib"

  if otool -l "$bin" | grep -q "@loader_path/../lib"; then
    :
  else
    install_name_tool -add_rpath "@loader_path/../lib" "$bin"
  fi

  codesign --force --deep --sign - "$bin"
done

# Re-sign the dylibs after modifications so later codesign passes cleanly.
if compgen -G "$LIB_DIR/lib*.dylib" >/dev/null; then
  codesign --force --deep --sign - "$LIB_DIR"/lib*.dylib
fi

