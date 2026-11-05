#!/bin/sh
# vespin -- the command as a curl install runs it: the bundle (lib/vespin.mjs) on the Node its release carries.
#
# Shipped as bin/vespin in every release tarball (scripts/package.ts). The
# install script's cli mode (apps/web/install/install.sh) unpacks each release
# into ~/.local/share/vespin-cli/versions/<version> and links
# ~/.local/bin/vespin to its bin/vespin. Note that the bundle is handed its
# real path, which is how it tells a curl install from npm's (`vespin version`,
# `vespin update`).
set -eu

root="$(dirname "$(dirname "$(readlink -f "$0")")")"
exec "$root/node/bin/node" "$root/lib/vespin.mjs" "$@"
