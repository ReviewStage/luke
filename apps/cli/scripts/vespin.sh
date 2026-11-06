#!/bin/sh
set -eu

root="$(dirname "$(dirname "$(readlink -f "$0")")")"
exec "$root/node/bin/node" "$root/lib/vespin.mjs" "$@"
