#!/usr/bin/env bash

SCRIPT_DIR="$(cd "$(dirname "$0")" && pwd)"
# Source .env if it exists (for BUN_PATH and other overrides)
if [ -f "$SCRIPT_DIR/.env" ]; then
  set -a
  . "$SCRIPT_DIR/.env"
  set +a
fi

BUN="${BUN:-${BUN_PATH:-bun}}"

if [ ! -t 0 ]; then
  gnome-terminal -- bash "$0" 2>/dev/null || x-terminal-emulator -e bash "$0" 2>/dev/null || xterm -e bash "$0" 2>/dev/null || konsole -e bash "$0" 2>/dev/null || exec bash "$0"
  exit 0
fi

RESULT=$("$BUN" run "$SCRIPT_DIR/scripts/tui-menu.ts" 2>/dev/null)
MODE=$(echo "$RESULT" | "$BUN" -e "const d=JSON.parse(await Bun.stdin.text()); process.stdout.write(d.mode)")

if [ "$MODE" = "dev" ]; then
  export MODE=dev
  "$BUN" run dev
elif [ "$MODE" = "prod" ]; then
  FOLDER_NAME=$(echo "$RESULT" | "$BUN" -e "const d=JSON.parse(await Bun.stdin.text()); process.stdout.write(d.folderName||'standard')")
  CLONE=$(echo "$RESULT" | "$BUN" -e "const d=JSON.parse(await Bun.stdin.text()); process.stdout.write(String(d.clone||false))")
  CATEGORIES=$(echo "$RESULT" | "$BUN" -e "const d=JSON.parse(await Bun.stdin.text()); process.stdout.write(d.categories||'')")
  CLONE_MODE=$(echo "$RESULT" | "$BUN" -e "const d=JSON.parse(await Bun.stdin.text()); process.stdout.write(d.cloneMode||'merge')")

  PROD_DATA="$(cd "$SCRIPT_DIR/.." && pwd)/data/prod/$FOLDER_NAME"

  export MODE=prod
  export DATA_DIR="$PROD_DATA"

  if [ "$CLONE" = "true" ] && [ -n "$CATEGORIES" ]; then
    echo "Cloning from dev ($CLONE_MODE)..."
    "$BUN" run scripts/clone-dev.ts --target "$PROD_DATA" --categories "$CATEGORIES" --mode "$CLONE_MODE"
    echo ""
  fi

  echo "Building + running single-file prod binary (port 3002)..."
  echo "Data: $PROD_DATA"
  "$BUN" run prod
elif [ "$MODE" = "package" ]; then
  TARGET=$(echo "$RESULT" | "$BUN" -e "const d=JSON.parse(await Bun.stdin.text()); process.stdout.write(d.target||'bun-linux-x64-modern')")
  TYPE=$(echo "$RESULT" | "$BUN" -e "const d=JSON.parse(await Bun.stdin.text()); process.stdout.write(d.type||'portable')")
  SEED=$(echo "$RESULT" | "$BUN" -e "const d=JSON.parse(await Bun.stdin.text()); process.stdout.write(JSON.stringify(d.seed||{}))")

  export MODE=prod
  unset DATA_DIR
  unset PACKAGE_DIR

  if [ "$TARGET" = "all" ]; then
    echo "Building for all platforms..."
    "$BUN" run build:all
  else
    echo "Building for target: $TARGET  type: $TYPE"
    "$BUN" run scripts/build-prod.ts --target="$TARGET" --type="$TYPE" --seed="$SEED"
  fi

  echo ""
  echo "==========================="
  echo "  Binary in ../data/package/"
  echo "==========================="
fi

echo ""
echo "==========================="
echo "  Process exited (code $?)"
echo "==========================="
echo "Press Enter to close..."
read -r
