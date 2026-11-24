#!/bin/sh
# Double-clic : installe Apo aventure sur ce Mac et le lance à chaque ouverture de session.
set -e
cd "$(dirname "$0")"
if [ "$(uname -m)" = "arm64" ]; then BIN=dist/apo-mac-arm64; else BIN=dist/apo-mac-intel; fi
DEST="$HOME/Applications/Apo aventure"
mkdir -p "$DEST"
cp "$BIN" "$DEST/apo"
chmod +x "$DEST/apo"
xattr -d com.apple.quarantine "$DEST/apo" 2>/dev/null || true
"$DEST/apo" install
sleep 1
open "http://localhost:4321"
echo
echo "C'est installé. Tu peux fermer cette fenêtre."
