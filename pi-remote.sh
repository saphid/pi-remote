#!/usr/bin/env sh
set -eu
PATH="$HOME/.bun/bin:$HOME/.local/bin:/opt/homebrew/bin:/usr/local/bin:$PATH"
export PATH
SOURCE=$0
while [ -L "$SOURCE" ]; do
  DIR=$(CDPATH='' cd -P -- "$(dirname -- "$SOURCE")" && pwd)
  TARGET=$(readlink "$SOURCE")
  case $TARGET in
    /*) SOURCE=$TARGET ;;
    *) SOURCE=$DIR/$TARGET ;;
  esac
done
DIR=$(CDPATH='' cd -P -- "$(dirname -- "$SOURCE")" && pwd)
if [ -x "$DIR/pi-remote" ] && [ "$DIR/pi-remote" != "$SOURCE" ]; then
  exec "$DIR/pi-remote" "$@"
fi
export PI_REMOTE_PACKAGE_ROOT=${PI_REMOTE_PACKAGE_ROOT:-$DIR}
JS="$DIR/dist/pi-remote.js"
if command -v bun >/dev/null 2>&1 && [ -r "$JS" ]; then
  exec bun "$JS" "$@"
fi
if command -v node >/dev/null 2>&1 && [ -r "$JS" ]; then
  exec node "$JS" "$@"
fi
cat >&2 <<EOF
pi-remote: Bun or Node is required; no slow shell fallback is available.
Install Bun with:
  curl -fsSL https://bun.sh/install | bash
Then run:
  pi-remote --update
EOF
exit 127
