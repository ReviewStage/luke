import assert from "node:assert/strict";
import test from "node:test";
import type { UnparsedWireValue, WireRecord } from "@sidecar/wire";
import { hostedActAnswerSchema, hostedActWorkspaceAnswerSchema } from "./act-wire.js";
import { brainTurnAuthoritySchema, hostedBrainRequestSchema } from "./brain-contract.js";
import { hostedConversationAnswerSchema } from "./conversation-wire.js";
import { deviceTokenDeleteAnswerSchema, deviceTokenStoreAnswerSchema } from "./device-wire.js";
import * as legacy from "./hosted-service-legacy.js";
import {
  HOSTED_CALLS_URL,
  HOSTED_WS_BASE_URL,
  hostedMintAnswerAt,
  remoteMintAnswerAt,
} from "./mint-wire.js";
import { observeAnswerSchema } from "./observe-wire.js";
import { hostedProjectsAnswerSchema } from "./projects-wire.js";
import { hostedErrorSchema, hostedQuotaSchema, hostedUsageAnswerSchema } from "./service-wire.js";
import {
  vaultKeyDeleteAnswerSchema,
  vaultKeyStoreAnswerSchema,
  vaultKeysListAnswerSchema,
} from "./vault-wire.js";

/**
 * The declarations answer what the hand-written readers answered. Each row
 * runs both over the same corpus — every valid shape the readers were written
 * for, every field of it absent, null, mistyped, empty, at its bound and one
 * past — and asserts they agree value for value. It goes with
 * `hosted-service-legacy.ts` once every reader has moved.
 */

const NOW = 1_800_000_000_000;
const MODEL = "gpt-realtime-2.1";

/** Values nothing on this wire has a shape for, run against every reader. */
const UNIVERSAL_CORPUS: readonly UnparsedWireValue[] = [
  undefined,
  null,
  0,
  -1,
  1.5,
  Number.NaN,
  Number.POSITIVE_INFINITY,
  "",
  " ",
  "x",
  true,
  false,
  [],
  [null],
  {},
  { unexpected: 1 },
  JSON.parse('{"__proto__":{"polluted":true}}') as WireRecord,
];

/** The values one field is tried as, beside whatever the row named itself. */
const FIELD_MUTATIONS: readonly UnparsedWireValue[] = [
  undefined,
  null,
  "",
  "  ",
  " padded ",
  0,
  -1,
  1.5,
  true,
  "unlisted",
  {},
  [],
  [null],
];

/**
 * One record with each of its own keys, in turn, replaced by each mutation
 * and by absence, one level deep into a nested record so a field of a
 * connection or a message is tried too.
 */
function mutations(valid: WireRecord): UnparsedWireValue[] {
  const cases: UnparsedWireValue[] = [valid];
  for (const key of Object.keys(valid)) {
    const { [key]: _removed, ...without } = valid;
    cases.push(without);
    for (const mutation of FIELD_MUTATIONS) {
      cases.push({ ...valid, [key]: mutation });
    }
    const nested = valid[key];
    if (nested && typeof nested === "object" && !Array.isArray(nested)) {
      for (const innerKey of Object.keys(nested)) {
        const { [innerKey]: _innerRemoved, ...innerWithout } = nested;
        cases.push({ ...valid, [key]: innerWithout });
        for (const mutation of FIELD_MUTATIONS) {
          cases.push({ ...valid, [key]: { ...nested, [innerKey]: mutation } });
        }
      }
    }
    const entries = valid[key];
    if (Array.isArray(entries) && entries.length > 0) {
      const [first] = entries;
      if (first && typeof first === "object" && !Array.isArray(first)) {
        for (const innerKey of Object.keys(first)) {
          const { [innerKey]: _entryRemoved, ...entryWithout } = first;
          cases.push({ ...valid, [key]: [entryWithout, ...entries.slice(1)] });
          for (const mutation of FIELD_MUTATIONS) {
            cases.push({
              ...valid,
              [key]: [{ ...first, [innerKey]: mutation }, ...entries.slice(1)],
            });
          }
        }
      }
    }
  }
  return cases;
}

const QUOTA: WireRecord = { used: 1, limit: 5, remaining: 4, resetsAt: NOW + 3_600_000 };

const CONNECTION: WireRecord = {
  value: "eph-secret",
  expiresAt: NOW + 60_000,
  model: MODEL,
  callsUrl: HOSTED_CALLS_URL,
  wsUrl: `${HOSTED_WS_BASE_URL}?model=${MODEL}`,
};

const MINT: WireRecord = { connection: CONNECTION, quota: QUOTA };

const REMOTE_MINT: WireRecord = {
  ...MINT,
  context: { sessions: { itemId: "item-0", text: "[observed session status]\nnone" } },
};

const OBSERVED_SESSION: WireRecord = {
  providerId: "conductor",
  sessionId: "session-1",
  title: "Fix the roster test",
  status: "working",
  workspace: "luke",
  branch: "main",
  change: "https://github.com/o/r/pull/1",
  link: "https://conductor.build/s/1",
  error: "npm ERR!",
  lastActivityAt: NOW,
  observedAt: NOW - 1,
  canReceiveMessage: true,
  controls: [{ id: "cancel-turn", label: "Cancel", kind: "cancel" }],
  spawnableAgents: ["claude", "codex"],
  canRename: true,
  canRenameWorkspace: true,
  canReadConversation: true,
};

const CONVERSATION: WireRecord = {
  messages: [
    { id: "message-1", author: "user", text: "  spaced words hold their shape  ", receivedAt: NOW },
  ],
  lastMessageId: "message-1",
  hasMore: true,
  firstOffset: 240,
  hasOlder: true,
};

const PROJECTS: WireRecord = {
  projects: [
    {
      providerId: "conductor",
      providerProjectId: "repo-1",
      repository: "luke",
      taskSupport: "optional",
      targetName: "mac-mini",
      namesItself: true,
    },
  ],
  agentModels: [
    {
      providerId: "conductor",
      agent: "claude",
      models: [{ id: "opus", label: "Opus" }],
      efforts: ["low", "high"],
    },
  ],
};

const BRAIN_ITEM: WireRecord = {
  type: "message",
  role: "user",
  content: [{ type: "input_text", text: "hi" }],
};

interface Migration {
  name: string;
  old: (value: UnparsedWireValue) => unknown;
  next: (value: UnparsedWireValue) => unknown;
  corpus: readonly UnparsedWireValue[];
}

const MIGRATIONS: readonly Migration[] = [
  {
    name: "hostedQuota",
    old: legacy.hostedQuotaFromWire,
    next: (value) => hostedQuotaSchema.parse(value),
    corpus: mutations(QUOTA),
  },
  {
    name: "hostedUsageAnswer",
    old: legacy.hostedUsageAnswerFromWire,
    next: (value) => hostedUsageAnswerSchema.parse(value),
    corpus: mutations({ voice: QUOTA, attention: QUOTA }),
  },
  {
    name: "hostedError",
    old: legacy.hostedErrorFromWire,
    next: (value) => hostedErrorSchema.parse(value),
    corpus: [
      ...mutations({ error: "invalid-token" }),
      { error: " quota-exhausted " },
      { error: "unknown-reason" },
    ],
  },
  {
    name: "hostedMintAnswer",
    old: (value) => legacy.hostedMintAnswerFromWire(value, NOW),
    next: (value) => hostedMintAnswerAt(value, NOW),
    corpus: [
      ...mutations(MINT),
      { connection: CONNECTION },
      { connection: { ...CONNECTION, expiresAt: NOW - 1 } },
      { connection: { ...CONNECTION, wsUrl: `${HOSTED_WS_BASE_URL}?model=other` } },
      { connection: { ...CONNECTION, callsUrl: "https://evil.example/v1/realtime/calls" } },
      { connection: { ...CONNECTION, quota: { ...QUOTA, used: -1 } } },
    ],
  },
  {
    name: "remoteMintAnswer",
    old: (value) => legacy.remoteMintAnswerFromWire(value, NOW),
    next: (value) => remoteMintAnswerAt(value, NOW),
    corpus: [
      ...mutations(REMOTE_MINT),
      { ...MINT, context: { sessions: {} } },
      { ...MINT, context: {} },
    ],
  },
  {
    name: "brainTurnAuthority",
    old: legacy.brainTurnAuthorityFromWire,
    next: (value) => brainTurnAuthoritySchema.parse(value),
    corpus: ["developer", "observation", " developer ", "root", 1],
  },
  {
    name: "hostedBrainRequest",
    old: legacy.hostedBrainRequestFromWire,
    next: (value) => hostedBrainRequestSchema.parse(value),
    corpus: [
      ...mutations({ authority: "observation", input: [BRAIN_ITEM] }),
      { authority: "developer", input: [BRAIN_ITEM] },
      { authority: "observation", input: [BRAIN_ITEM], model: "gpt-x" },
      { authority: "observation", input: ["text"] },
      { input: [BRAIN_ITEM] },
    ],
  },
  {
    name: "vaultKeyStoreAnswer",
    old: legacy.vaultKeyStoreAnswerFromWire,
    next: (value) => vaultKeyStoreAnswerSchema.parse(value),
    corpus: mutations({ stored: true }),
  },
  {
    name: "vaultKeysListAnswer",
    old: legacy.vaultKeysListAnswerFromWire,
    next: (value) => vaultKeysListAnswerSchema.parse(value),
    corpus: [
      ...mutations({ keys: [{ providerId: "conductor", updatedAt: NOW }] }),
      { keys: [] },
      { keys: [{ providerId: " conductor ", updatedAt: NOW }] },
      { keys: [{ providerId: "openai", updatedAt: NOW }] },
    ],
  },
  {
    name: "vaultKeyDeleteAnswer",
    old: legacy.vaultKeyDeleteAnswerFromWire,
    next: (value) => vaultKeyDeleteAnswerSchema.parse(value),
    corpus: mutations({ deleted: false }),
  },
  {
    name: "deviceTokenStoreAnswer",
    old: legacy.deviceTokenStoreAnswerFromWire,
    next: (value) => deviceTokenStoreAnswerSchema.parse(value),
    corpus: mutations({ stored: true }),
  },
  {
    name: "deviceTokenDeleteAnswer",
    old: legacy.deviceTokenDeleteAnswerFromWire,
    next: (value) => deviceTokenDeleteAnswerSchema.parse(value),
    corpus: mutations({ deleted: true }),
  },
  {
    name: "observeAnswer",
    old: legacy.observeAnswerFromWire,
    next: (value) => observeAnswerSchema.parse(value),
    corpus: [
      ...mutations({ sessions: [OBSERVED_SESSION] }),
      { sessions: [] },
      { sessions: [{ ...OBSERVED_SESSION, lastActivityAt: undefined }] },
      { sessions: [{ ...OBSERVED_SESSION, lastActivityAt: "no" }] },
      { sessions: [{ ...OBSERVED_SESSION, change: "http://insecure.example/pull/1" }] },
      { sessions: [{ ...OBSERVED_SESSION, link: "javascript:alert(1)" }] },
      {
        sessions: [{ ...OBSERVED_SESSION, controls: [{ id: "x", label: "X", kind: "invented" }] }],
      },
      { sessions: [{ ...OBSERVED_SESSION, controls: [{ id: "x" }] }] },
      { sessions: [{ ...OBSERVED_SESSION, spawnableAgents: ["", "codex"] }] },
      { sessions: [{ ...OBSERVED_SESSION, canRename: false }] },
      { sessions: [OBSERVED_SESSION, { providerId: "conductor" }] },
    ],
  },
  {
    name: "hostedConversationAnswer",
    old: legacy.hostedConversationAnswerFromWire,
    next: (value) => hostedConversationAnswerSchema.parse(value),
    corpus: [
      ...mutations(CONVERSATION),
      { messages: [], hasMore: false },
      { messages: [{ id: "m", author: "tool", text: "not a voice" }], hasMore: false },
      { messages: [{ id: "m", author: " agent ", text: "trimmed author" }], hasMore: false },
      { messages: [{ id: "m", author: "agent", text: "" }], hasMore: false },
      { messages: [{ id: "m", author: "agent", text: "  " }], hasMore: false },
      { messages: [{ id: "m", author: "agent", text: "words", receivedAt: -1 }], hasMore: false },
    ],
  },
  {
    name: "hostedProjectsAnswer",
    old: legacy.hostedProjectsAnswerFromWire,
    next: (value) => hostedProjectsAnswerSchema.parse(value),
    corpus: [
      ...mutations(PROJECTS),
      { projects: [] },
      { projects: [], agentModels: "none" },
      {
        projects: PROJECTS.projects,
        agentModels: [{ providerId: "conductor", agent: "claude", models: [], efforts: [] }],
      },
      {
        projects: PROJECTS.projects,
        agentModels: [
          { providerId: "conductor", agent: "claude", models: [{ id: "o" }], efforts: [] },
        ],
      },
      {
        projects: PROJECTS.projects,
        agentModels: [
          {
            providerId: "conductor",
            agent: "claude",
            models: [{ id: "o", label: "O" }],
            efforts: ["", "high"],
          },
        ],
      },
    ],
  },
  {
    name: "hostedActAnswer",
    old: legacy.hostedActAnswerFromWire,
    next: (value) => hostedActAnswerSchema.parse(value),
    corpus: [
      ...mutations({ result: "rejected", reason: "Session not found." }),
      { result: "accepted" },
      { result: " accepted " },
      { result: "accepted", reason: "  " },
      { result: "accepted", reason: "" },
    ],
  },
  {
    name: "hostedActWorkspaceAnswer",
    old: legacy.hostedActWorkspaceAnswerFromWire,
    next: (value) => hostedActWorkspaceAnswerSchema.parse(value),
    corpus: [
      ...mutations({ result: "accepted", providerSessionId: "session-9" }),
      { result: "accepted", reason: "why", providerSessionId: "session-9" },
      { result: "accepted", providerSessionId: "" },
      { result: "rejected", reason: "no" },
    ],
  },
];

for (const migration of MIGRATIONS) {
  test(`${migration.name}: the declaration answers what the reader answered`, () => {
    for (const value of [...UNIVERSAL_CORPUS, ...migration.corpus]) {
      assert.deepEqual(
        migration.next(value),
        migration.old(value),
        `${migration.name} disagreed on ${JSON.stringify(value)}`,
      );
    }
  });
}
