import { githubAutomationsOn, recordAutomationRun } from "@luke/database/models/automation-store";
import type { TaskStoreEffect } from "@luke/database/models/task-store";
import {
  AUTOMATION_FIRING,
  AUTOMATION_TRIGGER,
  type AutomationFiring,
  type AutomationTrigger,
  GITHUB_DEFAULT_SENDERS,
  GITHUB_SENDER,
  GITHUB_TRIGGER_EVENT,
  type GitHubSender,
  type GitHubTriggerEvent,
  PULL_REQUEST_DEFAULT_MOMENTS,
  PULL_REQUEST_MOMENT,
  type PullRequestMoment,
} from "@luke/features/automation-wire";
import { EXCESS_KEYS, type UnparsedWireValue } from "@luke/wire";
import { readEither } from "@luke/wire/effect";
import { Clock, Effect, Option, Result, Schema } from "effect";

/**
 * automation-github.ts -- a GitHub delivery read as an automation's trigger: which events it is, the issue, pull request, or branch it names, and the runs it queues.
 *
 * The Luke GitHub App's webhook (`github-webhook-app.ts`) hands every signed
 * delivery here as well. A pull request opened or labelled, a pull request
 * ready for review opened, reopened, marked ready, or pushed to, an issue
 * opened or labelled, a check suite that completed without passing, and a
 * push to a branch are read; nothing else is. A pull request opened is
 * both its own event and an update, so it fires the automations listening
 * for either. Only what the run's history shows is
 * read off the delivery: the repository, the number, title, and address of
 * the issue or pull request, the branch, and a failed check's commit by its
 * address, never a body. The run is
 * recorded queued under GitHub's own delivery id, which a redelivery
 * carries again, so a delivery GitHub sends twice records one run per
 * automation; the sweep acts on it within the minute, since starting an
 * agent inside GitHub's ten seconds is not a promise this can keep.
 *
 * Each event is read with who sent it, people, Luke's agents (the App's
 * own bot, or a person opening, reopening, or marking ready a pull request
 * from a `luke/` branch, which is a coding agent writing as its developer),
 * or another bot, and, for a pull request, the moment it is
 * (opened, marked ready, or pushed to), whether it is a draft, and whether
 * it comes from a fork; an issue an agent opened as its developer has no
 * branch to tell it by, and reads as people's; the trigger's own settings say which of those fire
 * it (`triggerMatches`), people's events alone and no draft or fork where
 * it names none. Two things fire nothing whatever a trigger says, so an
 * automation cannot fire itself in a loop: a push by Luke's agents, to a
 * branch or to a pull request, since an agent answering its run with a
 * push would start that run again, and a failed check on a `luke/` branch,
 * which is where a coding agent works and where it already watches its own
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

/** Each pull request action an update is, as the moment a trigger chooses. */
const UPDATE_MOMENT: ReadonlyMap<string, PullRequestMoment> = new Map([
  [GITHUB_ACTION.OPENED, PULL_REQUEST_MOMENT.OPENED],
  ["reopened", PULL_REQUEST_MOMENT.OPENED],
  ["ready_for_review", PULL_REQUEST_MOMENT.READY],
  ["synchronize", PULL_REQUEST_MOMENT.PUSHED],
]);

/** The ref prefix a branch's push names. */
const BRANCH_REF = "refs/heads/";

/** The branch prefix a coding agent works on, whose own checks it already watches. */
const AGENT_BRANCH_PREFIX = "luke/";

/**
 * The pull request actions a coding agent takes on its own pull request, as
 * the developer it writes as: opening it, reopening it, and marking it
 * ready. A push is never among them, since every push goes out as the App.
 */
const AGENT_OPENING_ACTIONS: ReadonlySet<string> = new Set([
  GITHUB_ACTION.OPENED,
  "reopened",
  "ready_for_review",
]);

/** The most automations one delivery queues runs for, of those listening for its event. */
const MAXIMUM_AUTOMATIONS = 100;

const LabelSchema = Schema.Struct({ name: Schema.String });
const RepositorySchema = Schema.Struct({ full_name: Schema.String });
const SenderSchema = Schema.Struct({ type: Schema.String, login: Schema.String });

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
    // The head branch, and the repository it is in: a fork's, or none where the fork was deleted.
    head: Schema.optionalKey(
      Schema.Struct({
        ref: Schema.optionalKey(Schema.String),
        repo: Schema.NullOr(Schema.Struct({ full_name: Schema.String })),
      }),
    ),
    draft: Schema.optionalKey(Schema.Boolean),
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
 * applied, or every label of what was opened), the branch a branch filter
 * is read against, who sent it (none for a check, which names no sender),
 * the moment of a pull request's update, whether it is a push, and whether
 * a pull request is a draft or a fork's.
 */
interface GitHubEventRead {
  readonly event: GitHubTriggerEvent;
  readonly repository: string;
  readonly firing: AutomationFiring;
  readonly labels: readonly string[];
  readonly branch: string | undefined;
  readonly sender: GitHubSender | undefined;
  readonly moment: PullRequestMoment | undefined;
  readonly pushed: boolean;
  readonly draft: boolean;
  readonly fork: boolean;
}

/** Who sent a delivery: Luke's agents where it is the App's own bot, another bot, or a person. */
function senderOf(
  sender: { readonly type: string; readonly login: string },
  agentLogin: string | undefined,
): GitHubSender {
  if (agentLogin !== undefined && sender.login.toLowerCase() === agentLogin.toLowerCase()) {
    return GITHUB_SENDER.LUKE_AGENTS;
  }
  return sender.type === BOT_SENDER ? GITHUB_SENDER.OTHER_BOTS : GITHUB_SENDER.PEOPLE;
}

/**
 * Who sent a pull request's delivery. A person who opened, reopened, or
 * marked ready a pull request from a `luke/` branch of the repository's own
 * is Luke's agents, because a coding agent that writes as its developer
 * opens its pull request on their token, so GitHub names the developer;
 * the branch is where every coding agent works. Note that a person doing
 * the same by hand reads as Luke's agents too, which mislabels the event
 * and grants nothing, and that a push is read by its sender alone, which
 * is the App's for every push an agent makes.
 */
function pullRequestSender(
  read: typeof PullRequestSchema.Type,
  agentLogin: string | undefined,
  fork: boolean,
): GitHubSender {
  const sender = senderOf(read.sender, agentLogin);
  const agentBranch = read.pull_request.head?.ref?.startsWith(AGENT_BRANCH_PREFIX) === true;
  const agentOpened = !fork && agentBranch && AGENT_OPENING_ACTIONS.has(read.action);
  return sender === GITHUB_SENDER.PEOPLE && agentOpened ? GITHUB_SENDER.LUKE_AGENTS : sender;
}

/** A delivery read against the few fields it is read for; every other key GitHub sends is dropped unread. */
function readDelivery<S extends Schema.ConstraintDecoder<unknown>>(
  schema: S,
  payload: UnparsedWireValue,
) {
  return readEither(schema, { excess: EXCESS_KEYS.DROP })(payload);
}

/** An issue's or pull request's event, read where it is one an automation listens for. */
function itemEvent(
  read: { readonly action: string },
  events: { readonly opened: GitHubTriggerEvent; readonly labeled: GitHubTriggerEvent },
  applied: string | undefined,
): GitHubTriggerEvent | undefined {
  if (read.action === GITHUB_ACTION.OPENED) return events.opened;
  if (read.action === GITHUB_ACTION.LABELED && applied !== undefined) return events.labeled;
  return undefined;
}

/**
 * The events a pull request's delivery is: opened or labelled, as
 * `itemEvent` reads them, and an update where its action is one of the
 * moments an update fires on, each read with who sent it, whether it is a
 * draft, and whether it comes from a fork, for the trigger to choose.
 */
function pullRequestEvents(
  read: typeof PullRequestSchema.Type,
  agentLogin: string | undefined,
): readonly GitHubEventRead[] {
  const { pull_request: pull, label, repository } = read;
  const kind = itemEvent(
    read,
    {
      opened: GITHUB_TRIGGER_EVENT.PULL_REQUEST_OPENED,
      labeled: GITHUB_TRIGGER_EVENT.PULL_REQUEST_LABELED,
    },
    label?.name,
  );
  const moment = UPDATE_MOMENT.get(read.action);
  const head = pull.head === undefined ? repository.full_name : pull.head.repo?.full_name;
  const fork = head?.toLowerCase() !== repository.full_name.toLowerCase();
  const shared = {
    repository: repository.full_name,
    labels: label === undefined ? pull.labels.map((one) => one.name) : [label.name],
    branch: pull.base.ref,
    sender: pullRequestSender(read, agentLogin, fork),
    pushed: moment === PULL_REQUEST_MOMENT.PUSHED,
    draft: pull.draft === true,
    fork,
  };
  const kinds = [
    ...(kind === undefined ? [] : [{ event: kind, moment: undefined }]),
    ...(moment === undefined ? [] : [{ event: GITHUB_TRIGGER_EVENT.PULL_REQUEST_UPDATED, moment }]),
  ];
  return kinds.map(({ event, moment: at }) => ({
    ...shared,
    event,
    moment: at,
    firing: {
      kind: AUTOMATION_FIRING.GITHUB,
      event,
      repository: repository.full_name,
      number: pull.number,
      title: pull.title,
      branch: pull.base.ref,
      url: pull.html_url,
    },
  }));
}

/** The delivery as the triggers it is, where it is one an automation listens for; none otherwise. */
function githubEventsOf(
  event: string,
  payload: UnparsedWireValue,
  agentLogin: string | undefined,
): readonly GitHubEventRead[] {
  if (event === GITHUB_EVENT.PULL_REQUEST) {
    const read = readDelivery(PullRequestSchema, payload);
    return Result.isFailure(read) ? [] : pullRequestEvents(read.success, agentLogin);
  }
  const read = githubEventOf(event, payload, agentLogin);
  return read === undefined ? [] : [read];
}

/** An issue's, a check suite's, or a push's delivery as a trigger, where it is one an automation listens for; nothing otherwise. */
function githubEventOf(
  event: string,
  payload: UnparsedWireValue,
  agentLogin: string | undefined,
): GitHubEventRead | undefined {
  // Of an issue, a check, or a push, only who sent it is read beside the event itself.
  const plain = { moment: undefined, pushed: false, draft: false, fork: false } as const;
  switch (event) {
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
        ...plain,
        sender: senderOf(read.success.sender, agentLogin),
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
        ...plain,
        sender: undefined,
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
      if (deleted || !ref.startsWith(BRANCH_REF)) return undefined;
      const branch = ref.slice(BRANCH_REF.length);
      return {
        ...plain,
        pushed: true,
        sender: senderOf(sender, agentLogin),
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

/**
 * Whether the trigger listens for this event: its event, whose events it
 * hears (people's alone where it names none), the moments of an update it
 * fires on (every one where it names none), a draft or a fork's pull
 * request only where it asks for them, and its label and branch filters
 * where it names any. Note that a push by Luke's agents fires nothing
 * whatever the trigger says, because an agent answering its own run with
 * a push would start that run again.
 */
function triggerMatches(trigger: AutomationTrigger, read: GitHubEventRead): boolean {
  if (trigger.kind !== AUTOMATION_TRIGGER.GITHUB || trigger.event !== read.event) return false;
  if (
    read.sender !== undefined &&
    !(trigger.senders ?? GITHUB_DEFAULT_SENDERS).includes(read.sender)
  ) {
    return false;
  }
  if (read.sender === GITHUB_SENDER.LUKE_AGENTS && read.pushed) return false;
  const moments = trigger.moments ?? PULL_REQUEST_DEFAULT_MOMENTS;
  if (read.moment !== undefined && !moments.includes(read.moment)) return false;
  if ((read.draft && trigger.drafts !== true) || (read.fork && trigger.forks !== true)) {
    return false;
  }
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

/** Queues a run under the delivery's id for every automation listening for the one event read, answering how many it queued. */
const queueRunsOf = Effect.fnUntraced(function* (deliveryId: string, read: GitHubEventRead) {
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

/**
 * Queues a run, under the delivery's own id, for every enabled automation
 * working in the delivery's repository whose trigger listens for one of the
 * events it is, `agentLogin` naming the App's own bot, which Luke's agents
 * act as; answers how many it queued, none for a delivery no automation
 * listens for or one recorded before. Note that the one id
 * serves every event of the delivery, because an automation listens for
 * one event and so records at most one run of it.
 */
export function queueGithubRuns(
  deliveryId: string,
  event: string,
  payload: UnparsedWireValue,
  agentLogin: string | undefined,
): TaskStoreEffect<number> {
  const reads = githubEventsOf(event, payload, agentLogin);
  if (reads.length === 0 || deliveryId.length === 0) return Effect.succeed(0);
  return Effect.map(
    Effect.forEach(reads, (read) => queueRunsOf(deliveryId, read)),
    (counts) => counts.reduce((sum, count) => sum + count, 0),
  );
}
