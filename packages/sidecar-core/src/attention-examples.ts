import { ATTENTION_TRIGGER, type AttentionUpdate } from "./attention";
import { ATTENTION_DISPOSITION, type AttentionDisposition, SESSION_STATUS } from "./session";

/**
 * One redacted update paired with the decision Luke should reach for it. The
 * examples are synthetic: every workspace name, provider summary, and spoken
 * sentence here is written for tuning and contains no observed developer data.
 */
export interface AttentionTuningExample {
  name: string;
  update: AttentionUpdate;
  expected: {
    disposition: AttentionDisposition;
    summary: string | null;
  };
  rationale: string;
}

export const ATTENTION_TUNING_EXAMPLES: readonly AttentionTuningExample[] = [
  {
    name: "A session starts being observed",
    update: {
      providerId: "claude-code",
      providerSessionId: "example-observed",
      trigger: ATTENTION_TRIGGER.OBSERVED,
      providerName: "Claude Code",
      title: "Claude Code: checkout-service",
      status: SESSION_STATUS.WORKING,
      summary: "Claude Code working; transcript content is not retained.",
      observedAt: 1_760_000_000_000,
    },
    expected: {
      disposition: ATTENTION_DISPOSITION.SILENT,
      summary: null,
    },
    rationale:
      "Noticing a session that is already running is not a development the developer asked to hear about.",
  },
  {
    name: "A working session begins waiting on the developer",
    update: {
      providerId: "claude-code",
      providerSessionId: "example-waiting",
      trigger: ATTENTION_TRIGGER.STATUS_CHANGED,
      providerName: "Claude Code",
      title: "Claude Code: checkout-service",
      status: SESSION_STATUS.WAITING,
      previousStatus: SESSION_STATUS.WORKING,
      summary: "Claude Code waiting; transcript content is not retained.",
      observedAt: 1_760_000_090_000,
    },
    expected: {
      disposition: ATTENTION_DISPOSITION.SPEAK_DURING_TURN,
      summary: "Claude Code is waiting on you in checkout-service.",
    },
    rationale:
      "The session cannot progress without the developer, so the interruption saves idle time.",
  },
  {
    name: "A working session finishes its turn",
    update: {
      providerId: "codex",
      providerSessionId: "example-complete",
      trigger: ATTENTION_TRIGGER.STATUS_CHANGED,
      providerName: "Codex",
      title: "Codex: billing-api",
      status: SESSION_STATUS.COMPLETE,
      previousStatus: SESSION_STATUS.WORKING,
      summary: "Codex complete; transcript content is not retained.",
      observedAt: 1_760_000_180_000,
    },
    expected: {
      disposition: ATTENTION_DISPOSITION.SPEAK_AT_TURN_END,
      summary: "Codex finished its turn in billing-api.",
    },
    rationale:
      "The session reached a resting point, which is worth one short sentence once the current turn ends.",
  },
  {
    name: "A session goes quiet without resolving",
    update: {
      providerId: "codex",
      providerSessionId: "example-unknown",
      trigger: ATTENTION_TRIGGER.STATUS_CHANGED,
      providerName: "Codex",
      title: "Codex: billing-api",
      status: SESSION_STATUS.UNKNOWN,
      previousStatus: SESSION_STATUS.WORKING,
      summary: "Codex unknown; transcript content is not retained.",
      observedAt: 1_760_000_400_000,
    },
    expected: {
      disposition: ATTENTION_DISPOSITION.SILENT,
      summary: null,
    },
    rationale:
      "An observation Luke cannot explain is not a development; announcing it would invent certainty Luke does not have.",
  },
  {
    name: "A summary changes while the session keeps working",
    update: {
      providerId: "claude-code",
      providerSessionId: "example-summary",
      trigger: ATTENTION_TRIGGER.SUMMARY_CHANGED,
      providerName: "Claude Code",
      title: "Claude Code: docs-site",
      status: SESSION_STATUS.WORKING,
      previousStatus: SESSION_STATUS.WORKING,
      summary: "Claude Code working; transcript content is not retained.",
      observedAt: 1_760_000_480_000,
    },
    expected: {
      disposition: ATTENTION_DISPOSITION.SILENT,
      summary: null,
    },
    rationale: "Ongoing work is the normal case, and narrating it would make Luke noise.",
  },
];
