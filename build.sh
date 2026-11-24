#!/bin/sh
# Compile Apo aventure pour les Mac Apple (M1, M2…) et Intel.
set -e
cd "$(dirname "$0")"
CGO_ENABLED=0 GOOS=darwin GOARCH=arm64 go build -trimpath -ldflags "-s -w" -o dist/apo-mac-arm64 .
CGO_ENABLED=0 GOOS=darwin GOARCH=amd64 go build -trimpath -ldflags "-s -w" -o dist/apo-mac-intel .
echo "OK : dist/apo-mac-arm64 et dist/apo-mac-intel"
