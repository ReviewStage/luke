# Third-party notices

Luke is licensed under the Apache License 2.0 (see `LICENSE`). The portions
below were copied or adapted from other projects and remain under their own
licenses, reproduced here.

## OpenClaw

Every port below is of OpenClaw at commit
`b7528507af5a4ea04b5165ac64d30f504e898f19` (<https://github.com/openclaw/openclaw>).

`packages/runtime/src/children.ts` and `packages/runtime/src/child-records.ts`
port its sub-agent service (`src/agents/subagents/`): the spawn recorded before
it is acknowledged, the child's own conversation
(`agent:<agentId>:subagent:<uuid>`), the completion persisted before it is
delivered, and the delivery backoff. `packages/brain/src/tools/session-tools.ts`
ports its session tools (`src/agents/tools/sessions-*.ts`): delegation and the
inspection of an agent's own conversations. `packages/runtime/src/workspace.ts`
follows its agent workspace (`src/agents/workspace-*.ts`) and the bootstrap
order its system prompt documents (`docs/concepts/system-prompt.md`), and
`packages/memory/src/flush.ts` ports its pre-compaction memory flush
(`src/auto-reply/reply/memory-flush.ts`, `extensions/memory-core/src/flush-plan.ts`).
`packages/memory/src/defaults.ts` takes the four characters per token it sizes
a context by.

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
