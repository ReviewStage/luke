#!/usr/bin/env bash
set -euo pipefail

SCRIPT_DIRECTORY=$(CDPATH= cd -- "$(dirname -- "${BASH_SOURCE[0]}")" && pwd)

"$SCRIPT_DIRECTORY/check.sh"
"$SCRIPT_DIRECTORY/evidence.sh"
