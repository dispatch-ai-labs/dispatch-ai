#!/usr/bin/env sh
set -eu

REPO="${DISPATCH_REPO:-dispatch-ai-labs/dispatch-ai}"
VERSION="${DISPATCH_VERSION:-latest}"
BIN_DIR="${DISPATCH_BIN_DIR:-$HOME/.local/bin}"

case "$(uname -s)-$(uname -m)" in
  Darwin-arm64) target="darwin-arm64" ;;
  Darwin-x86_64) target="darwin-x64" ;;
  Linux-aarch64|Linux-arm64) target="linux-arm64" ;;
  Linux-x86_64) target="linux-x64" ;;
  *) echo "Unsupported platform: $(uname -s)-$(uname -m)" >&2; exit 1 ;;
esac

mkdir -p "$BIN_DIR"
if [ "$VERSION" = "latest" ]; then
  url="https://github.com/$REPO/releases/latest/download/dispatch-$target"
else
  url="https://github.com/$REPO/releases/download/$VERSION/dispatch-$target"
fi

curl -fsSL "$url" -o "$BIN_DIR/dispatch"
chmod +x "$BIN_DIR/dispatch"
echo "Installed dispatch to $BIN_DIR/dispatch"
