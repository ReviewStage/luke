# Third-party notices

Luke is licensed under the Apache License 2.0 (see `LICENSE`). The portions
below were copied or adapted from other projects and remain under their own
licenses, reproduced here.

## OpenClaw

`packages/brain/src/loop-guard.ts` ports the tool-loop detection of OpenClaw
at commit `b7528507af5a4ea04b5165ac64d30f504e898f19`
(`src/agents/tool-loop-detection.ts`, `src/agents/tool-loop-no-progress.ts`,
`src/agents/tool-loop-argument-churn.ts`, `src/agents/tool-loop-thresholds.ts`;
<https://github.com/openclaw/openclaw>). `packages/brain/src/store/maintenance.ts`
and `maintenance-run.ts` port the session store maintenance policy of the
same commit (`src/config/sessions/store-maintenance.ts`,
`store-maintenance-plan.ts`, `disk-budget.ts`); `packages/brain/src/store/archives.ts`
and `compression.ts` follow the shape of its transcript archives
(`session-accessor.sqlite-archive.ts`, `archive-compression.ts`); and
`packages/brain/src/compaction.ts` takes its reserve and recent-tail policy
from `packages/agent-core/src/harness/compaction/compaction.ts` and
`branch-summarization.ts`. `packages/runtime/src/lanes.ts` and
`packages/runtime/src/queue.ts` port, at the same commit, its execution lanes
and their defaults (`src/config/agent-limits.ts`, `src/gateway/server-lanes.ts`) and its reply queue modes and bounds
(`src/auto-reply/reply/queue/`).

MIT License

Copyright (c) 2026 OpenClaw Foundation

Permission is hereby granted, free of charge, to any person obtaining a copy
of this software and associated documentation files (the "Software"), to deal
in the Software without restriction, including without limitation the rights
to use, copy, modify, merge, publish, distribute, sublicense, and/or sell
copies of the Software, and to permit persons to whom the Software is
furnished to do so, subject to the following conditions:

The above copyright notice and this permission notice shall be included in all
copies or substantial portions of the Software.

THE SOFTWARE IS PROVIDED "AS IS", WITHOUT WARRANTY OF ANY KIND, EXPRESS OR
IMPLIED, INCLUDING BUT NOT LIMITED TO THE WARRANTIES OF MERCHANTABILITY,
FITNESS FOR A PARTICULAR PURPOSE AND NONINFRINGEMENT. IN NO EVENT SHALL THE
AUTHORS OR COPYRIGHT HOLDERS BE LIABLE FOR ANY CLAIM, DAMAGES OR OTHER
LIABILITY, WHETHER IN AN ACTION OF CONTRACT, TORT OR OTHERWISE, ARISING FROM,
OUT OF OR IN CONNECTION WITH THE SOFTWARE OR THE USE OR OTHER DEALINGS IN THE
SOFTWARE.
