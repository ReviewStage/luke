This branch holds the screenshots and recordings that pull request descriptions embed, one pr-<number>/ folder per pull request.

Keep `scripts/vercel-ignore.sh` when pruning it: the Vercel project's Ignored Build Step runs that file, and without it every push here builds and fails a preview.
