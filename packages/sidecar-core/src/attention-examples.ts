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
      title: "Split the checkout total into line items",
      status: SESSION_STATUS.WORKING,
      context: {
        repository: "checkout-service",
        branch: "main",
        activity: "Read: src/totals.ts",
      },
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
    name: "A turn ends with something the session needs answered",
    update: {
      providerId: "claude-code",
      providerSessionId: "example-waiting",
      trigger: ATTENTION_TRIGGER.STATUS_CHANGED,
      providerName: "Claude Code",
      title: "Split the checkout total into line items",
      status: SESSION_STATUS.WAITING,
      previousStatus: SESSION_STATUS.WORKING,
      summary:
        "I split the total into line items, but the tax rounding rule is ambiguous. Next: tell me whether to round per line or on the total.",
      context: { repository: "checkout-service", branch: "main" },
      observedAt: 1_760_000_090_000,
    },
    expected: {
      disposition: ATTENTION_DISPOSITION.SPEAK_DURING_TURN,
      summary: "Claude Code needs to know how to round tax in checkout-service.",
    },
    rationale:
      "The recap names the decision the session is blocked on, so the sentence can carry it instead of merely reporting a state change.",
  },
  {
    name: "A turn ends with nothing outstanding",
    update: {
      providerId: "codex",
      providerSessionId: "example-resting",
      trigger: ATTENTION_TRIGGER.STATUS_CHANGED,
      providerName: "Codex",
      title: "Release the billing client to npm",
      status: SESSION_STATUS.WAITING,
      previousStatus: SESSION_STATUS.WORKING,
      summary: "Published 0.4.2 and merged the release pull request.",
      context: { repository: "billing-api", branch: "codex/release-0-4-2" },
      observedAt: 1_760_000_180_000,
    },
    expected: {
      disposition: ATTENTION_DISPOSITION.SPEAK_AT_TURN_END,
      summary: "Codex published billing-api 0.4.2 and merged the release.",
    },
    rationale:
      "The session reached a resting point and nothing is blocked, so it waits for a natural pause rather than interrupting.",
  },
  {
    name: "A session stops on a failure it cannot pass",
    update: {
      providerId: "claude-code",
      providerSessionId: "example-error",
      trigger: ATTENTION_TRIGGER.STATUS_CHANGED,
      providerName: "Claude Code",
      title: "Backfill the subscription migration",
      status: SESSION_STATUS.ERROR,
      previousStatus: SESSION_STATUS.WORKING,
      context: {
        repository: "billing-api",
        branch: "dean/backfill",
        error: "429 rate limit exceeded",
      },
      observedAt: 1_760_000_300_000,
    },
    expected: {
      disposition: ATTENTION_DISPOSITION.SPEAK_DURING_TURN,
      summary: "Claude Code hit a rate limit in billing-api and stopped.",
    },
    rationale:
      "A stopped session burns wall-clock until someone restarts it, and the error names what to fix.",
  },
  {
    name: "A session goes quiet without resolving",
    update: {
      providerId: "codex",
      providerSessionId: "example-unknown",
      trigger: ATTENTION_TRIGGER.STATUS_CHANGED,
      providerName: "Codex",
      title: "Release the billing client to npm",
      status: SESSION_STATUS.UNKNOWN,
      previousStatus: SESSION_STATUS.WORKING,
      context: { repository: "billing-api" },
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
    name: "A recap changes while the session keeps working",
    update: {
      providerId: "claude-code",
      providerSessionId: "example-summary",
      trigger: ATTENTION_TRIGGER.SUMMARY_CHANGED,
      providerName: "Claude Code",
      title: "Rewrite the docs landing page",
      status: SESSION_STATUS.WORKING,
      previousStatus: SESSION_STATUS.WORKING,
      summary: "Rewrote the hero section and moved on to the feature grid.",
      context: {
        repository: "docs-site",
        branch: "dean/landing",
        activity: "Edit: src/pages/index.astro",
      },
      observedAt: 1_760_000_480_000,
    },
    expected: {
      disposition: ATTENTION_DISPOSITION.SILENT,
      summary: null,
    },
    rationale:
      "Ongoing work is the normal case however specific the recap is, and narrating it would make Luke noise.",
  },
];
