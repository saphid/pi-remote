#!/usr/bin/env sh
set -eu
PATH="$HOME/.local/bin:/opt/homebrew/bin:/usr/local/bin:$PATH"
export PATH
PI_REMOTE_INVOKED_AS=${PI_REMOTE_INVOKED_AS:-$(basename -- "$0")}
export PI_REMOTE_INVOKED_AS
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
export PI_REMOTE_PACKAGE_ROOT="${PI_REMOTE_PACKAGE_ROOT:-$DIR}"
JS="$DIR/dist/pi-remote.js"
if command -v node >/dev/null 2>&1 && [ -r "$JS" ]; then
  exec node "$JS" "$@"
fi
cat >&2 <<EOF
pi-remote: Node.js is required; no slow shell fallback is available.
Install Node.js, then run:
  pi-remote --update
EOF
exit 127
