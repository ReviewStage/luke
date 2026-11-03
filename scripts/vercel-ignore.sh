#!/usr/bin/env bash
# vercel-ignore.sh -- skip every Vercel build of this media-only branch.
#
# The Vercel project's Ignored Build Step runs this file where a branch holds
# one, and builds the branch where it holds none. This branch has no app to
# build, so the step exits 0, which skips the deployment rather than failing it.
exit 0
