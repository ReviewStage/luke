import { githubAutomationsOn, recordAutomationRun } from "@luke/database/models/automation-store";
import type { PlanStoreEffect } from "@luke/database/models/plan-store";
import {
  AUTOMATION_FIRING,
  AUTOMATION_TRIGGER,
  type AutomationFiring,
  type AutomationTrigger,
  GITHUB_TRIGGER_EVENT,
  type GitHubTriggerEvent,
} from "@luke/features/automation-wire";
import { EXCESS_KEYS, type UnparsedWireValue } from "@luke/wire";
import { readEither } from "@luke/wire/effect";
import { Clock, Effect, Option, Result, Schema } from "effect";

/**
 * automation-github.ts -- a GitHub delivery read as an automation's trigger: which event it is, the issue, pull request, or branch it names, and the runs it queues.
 *
 * The Luke GitHub App's webhook (`github-webhook-app.ts`) hands every signed
 * delivery here as well. A pull request opened or labelled, an issue opened
 * or labelled, a check suite that completed without passing, and a push to
 * a branch are read; nothing else is. Only what the run's history shows is
 * read off the delivery: the repository, the number, title, and address of
 * the issue or pull request, the branch, and a failed check's commit by its
 * address, never a body. The run is
 * recorded queued under GitHub's own delivery id, which a redelivery
 * carries again, so a delivery GitHub sends twice records one run per
 * automation; the sweep acts on it within the minute, since starting an
 * agent inside GitHub's ten seconds is not a promise this can keep.
 *
 * The events an automation's own agents cause are kept out, so an
 * automation cannot fire itself in a loop: a pull request, an issue, or a
 * push whose sender is a bot (the App's own installation token among them)
 * fires nothing, and neither does a failed check on a `luke/` branch, which
 * is where a coding agent works and where it already watches its own
 * checks.
 */

/** The deliveries read, by GitHub's own event and action names. */
const GITHUB_EVENT = {
  PULL_REQUEST: "pull_request",
  ISSUES: "issues",
  CHECK_SUITE: "check_suite",
  PUSH: "push",
} as const;

const GITHUB_ACTION = {
  OPENED: "opened",
  LABELED: "labeled",
  COMPLETED: "completed",
} as const;

/** The conclusions of a check suite that read as failed. */
const FAILED_CONCLUSIONS: ReadonlySet<string> = new Set(["failure", "timed_out"]);

/** What a sender's type says when the sender is an App or another bot. */
const BOT_SENDER = "Bot";

/** The ref prefix a branch's push names. */
const BRANCH_REF = "refs/heads/";

/** The branch prefix a coding agent works on, whose own checks it already watches. */
const AGENT_BRANCH_PREFIX = "luke/";

/** The most automations one delivery queues runs for, of those listening for its event. */
const MAXIMUM_AUTOMATIONS = 100;

const LabelSchema = Schema.Struct({ name: Schema.String });
const RepositorySchema = Schema.Struct({ full_name: Schema.String });
const SenderSchema = Schema.Struct({ type: Schema.String });

const PullRequestSchema = Schema.Struct({
  action: Schema.String,
  repository: RepositorySchema,
  sender: SenderSchema,
  label: Schema.optionalKey(LabelSchema),
  pull_request: Schema.Struct({
    number: Schema.Int,
    title: Schema.String,
    html_url: Schema.String,
    labels: Schema.Array(LabelSchema),
    base: Schema.Struct({ ref: Schema.String }),
  }),
});

const IssueSchema = Schema.Struct({
  action: Schema.String,
  repository: RepositorySchema,
  sender: SenderSchema,
  label: Schema.optionalKey(LabelSchema),
  issue: Schema.Struct({
    number: Schema.Int,
    title: Schema.String,
    html_url: Schema.String,
    labels: Schema.Array(LabelSchema),
    // An issue's delivery says it is a pull request where it is one; those come as pull requests.
    pull_request: Schema.optionalKey(Schema.Unknown),
  }),
});

const CheckSuiteSchema = Schema.Struct({
  action: Schema.String,
  repository: Schema.Struct({ full_name: Schema.String, html_url: Schema.String }),
  check_suite: Schema.Struct({
    head_branch: Schema.NullOr(Schema.String),
    head_sha: Schema.String,
    conclusion: Schema.NullOr(Schema.String),
  }),
});

const PushSchema = Schema.Struct({
  ref: Schema.String,
  deleted: Schema.Boolean,
  compare: Schema.String,
  repository: RepositorySchema,
  sender: SenderSchema,
});

/**
 * One delivery read as a trigger: the event, the repository, the firing the
 * history keeps, the labels a label filter is read against (the one just
 * applied, or every label of what was opened), and the branch a branch
 * filter is read against.
 */
interface GitHubEventRead {
  readonly event: GitHubTriggerEvent;
  readonly repository: string;
  readonly firing: AutomationFiring;
  readonly labels: readonly string[];
  readonly branch: string | undefined;
}

/** A delivery read against the few fields it is read for; every other key GitHub sends is dropped unread. */
function readDelivery<S extends Schema.ConstraintDecoder<unknown>>(
  schema: S,
  payload: UnparsedWireValue,
) {
  return readEither(schema, { excess: EXCESS_KEYS.DROP })(payload);
}

/** An issue's or pull request's event, read where it is one an automation listens for and no bot sent it. */
function itemEvent(
  read: { readonly action: string; readonly sender: { readonly type: string } },
  events: { readonly opened: GitHubTriggerEvent; readonly labeled: GitHubTriggerEvent },
  applied: string | undefined,
): GitHubTriggerEvent | undefined {
  if (read.sender.type === BOT_SENDER) return undefined;
  if (read.action === GITHUB_ACTION.OPENED) return events.opened;
  if (read.action === GITHUB_ACTION.LABELED && applied !== undefined) return events.labeled;
  return undefined;
}

/** The delivery as a trigger, where it is one an automation listens for; nothing otherwise. */
function githubEventOf(event: string, payload: UnparsedWireValue): GitHubEventRead | undefined {
  switch (event) {
    case GITHUB_EVENT.PULL_REQUEST: {
      const read = readDelivery(PullRequestSchema, payload);
      if (Result.isFailure(read)) return undefined;
      const { pull_request: pull, label, repository } = read.success;
      const kind = itemEvent(
        read.success,
        {
          opened: GITHUB_TRIGGER_EVENT.PULL_REQUEST_OPENED,
          labeled: GITHUB_TRIGGER_EVENT.PULL_REQUEST_LABELED,
        },
        label?.name,
      );
      if (kind === undefined) return undefined;
      return {
        event: kind,
        repository: repository.full_name,
        labels: label === undefined ? pull.labels.map((each) => each.name) : [label.name],
        branch: pull.base.ref,
        firing: {
          kind: AUTOMATION_FIRING.GITHUB,
          event: kind,
          repository: repository.full_name,
          number: pull.number,
          title: pull.title,
          branch: pull.base.ref,
          url: pull.html_url,
        },
      };
    }
    case GITHUB_EVENT.ISSUES: {
      const read = readDelivery(IssueSchema, payload);
      if (Result.isFailure(read) || read.success.issue.pull_request !== undefined) return undefined;
      const { issue, label, repository } = read.success;
      const kind = itemEvent(
        read.success,
        {
          opened: GITHUB_TRIGGER_EVENT.ISSUE_OPENED,
          labeled: GITHUB_TRIGGER_EVENT.ISSUE_LABELED,
        },
        label?.name,
      );
      if (kind === undefined) return undefined;
      return {
        event: kind,
        repository: repository.full_name,
        labels: label === undefined ? issue.labels.map((each) => each.name) : [label.name],
        branch: undefined,
        firing: {
          kind: AUTOMATION_FIRING.GITHUB,
          event: kind,
          repository: repository.full_name,
          number: issue.number,
          title: issue.title,
          url: issue.html_url,
        },
      };
    }
    case GITHUB_EVENT.CHECK_SUITE: {
      const read = readDelivery(CheckSuiteSchema, payload);
      if (Result.isFailure(read)) return undefined;
      const { check_suite: suite, repository, action } = read.success;
      const branch = suite.head_branch;
      if (
        action !== GITHUB_ACTION.COMPLETED ||
        !FAILED_CONCLUSIONS.has(suite.conclusion ?? "") ||
        branch === null ||
        branch.startsWith(AGENT_BRANCH_PREFIX)
      ) {
        return undefined;
      }
      return {
        event: GITHUB_TRIGGER_EVENT.CHECK_FAILED,
        repository: repository.full_name,
        labels: [],
        branch,
        firing: {
          kind: AUTOMATION_FIRING.GITHUB,
          event: GITHUB_TRIGGER_EVENT.CHECK_FAILED,
          repository: repository.full_name,
          branch,
          // The failed commit by its address, so the agent reads the revision that failed even after the branch moves on.
          url: `${repository.html_url}/commit/${suite.head_sha}`,
        },
      };
    }
    case GITHUB_EVENT.PUSH: {
      const read = readDelivery(PushSchema, payload);
      if (Result.isFailure(read)) return undefined;
      const { ref, deleted, compare, repository, sender } = read.success;
      if (deleted || sender.type === BOT_SENDER || !ref.startsWith(BRANCH_REF)) return undefined;
      const branch = ref.slice(BRANCH_REF.length);
      return {
        event: GITHUB_TRIGGER_EVENT.PUSH,
        repository: repository.full_name,
        labels: [],
        branch,
        firing: {
          kind: AUTOMATION_FIRING.GITHUB,
          event: GITHUB_TRIGGER_EVENT.PUSH,
          repository: repository.full_name,
          branch,
          url: compare,
        },
      };
    }
    default:
      return undefined;
  }
}

/** Whether the trigger listens for this event: its event, and its label and branch filters where it names any. */
function triggerMatches(trigger: AutomationTrigger, read: GitHubEventRead): boolean {
  if (trigger.kind !== AUTOMATION_TRIGGER.GITHUB || trigger.event !== read.event) return false;
  const labels = trigger.labels ?? [];
  const branches = trigger.branches ?? [];
  // A label is matched the way GitHub folds a label's case.
  const labelled =
    labels.length === 0 ||
    labels.some((wanted) =>
      read.labels.some((label) => label.toLowerCase() === wanted.toLowerCase()),
    );
  const branched =
    branches.length === 0 || (read.branch !== undefined && branches.includes(read.branch));
  return labelled && branched;
}

/**
 * Queues a run, under the delivery's own id, for every enabled automation
 * on a plan of the delivery's repository whose trigger listens for the
 * event; answers how many it queued, none for a delivery no automation
 * listens for or one recorded before.
 */
export function queueGithubRuns(
  deliveryId: string,
  event: string,
  payload: UnparsedWireValue,
): PlanStoreEffect<number> {
  const read = githubEventOf(event, payload);
  if (read === undefined || deliveryId.length === 0) return Effect.succeed(0);
  return Effect.gen(function* () {
    const listening = (yield* githubAutomationsOn(
      read.repository,
      read.event,
      MAXIMUM_AUTOMATIONS,
    )).filter((automation) => triggerMatches(automation.trigger, read));
    const firedAt = new Date(yield* Clock.currentTimeMillis);
    const recorded = yield* Effect.forEach(listening, (automation) =>
      recordAutomationRun(automation, { dedupeKey: deliveryId, firing: read.firing, firedAt }),
    );
    return recorded.filter(Option.isSome).length;
  });
}
