import { githubAutomationsOn, recordAutomationRun } from "@repo/database/models/automation-store";
import type { TaskStoreEffect } from "@repo/database/models/task-store";
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
} from "@repo/features/automation-wire";
import { EXCESS_KEYS, type UnparsedWireValue } from "@repo/wire";
import { readEither } from "@repo/wire/effect";
import { DateTime, Effect, Option, Result, Schema } from "effect";
import { isAgentBranch } from "../agents/coder-host/bounds.js";

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

const FAILED_CONCLUSIONS: ReadonlySet<string> = new Set(["failure", "timed_out"]);

const BOT_SENDER = "Bot";

const UPDATE_MOMENT: ReadonlyMap<string, PullRequestMoment> = new Map([
  [GITHUB_ACTION.OPENED, PULL_REQUEST_MOMENT.OPENED],
  ["reopened", PULL_REQUEST_MOMENT.OPENED],
  ["ready_for_review", PULL_REQUEST_MOMENT.READY],
  ["synchronize", PULL_REQUEST_MOMENT.PUSHED],
]);

const BRANCH_REF = "refs/heads/";

const AGENT_OPENING_ACTIONS: ReadonlySet<string> = new Set([
  GITHUB_ACTION.OPENED,
  "reopened",
  "ready_for_review",
]);

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

function senderOf(
  sender: { readonly type: string; readonly login: string },
  agentLogin: string | undefined,
): GitHubSender {
  if (agentLogin !== undefined && sender.login.toLowerCase() === agentLogin.toLowerCase()) {
    return GITHUB_SENDER.APP_AGENTS;
  }
  return sender.type === BOT_SENDER ? GITHUB_SENDER.OTHER_BOTS : GITHUB_SENDER.PEOPLE;
}

function pullRequestSender(
  read: typeof PullRequestSchema.Type,
  agentLogin: string | undefined,
  fork: boolean,
): GitHubSender {
  const sender = senderOf(read.sender, agentLogin);
  const head = read.pull_request.head?.ref;
  const agentBranch = head !== undefined && isAgentBranch(head);
  const agentOpened = !fork && agentBranch && AGENT_OPENING_ACTIONS.has(read.action);
  return sender === GITHUB_SENDER.PEOPLE && agentOpened ? GITHUB_SENDER.APP_AGENTS : sender;
}

function readDelivery<S extends Schema.ConstraintDecoder<unknown>>(
  schema: S,
  payload: UnparsedWireValue,
) {
  return readEither(schema, { excess: EXCESS_KEYS.DROP })(payload);
}

function itemEvent(
  read: { readonly action: string },
  events: { readonly opened: GitHubTriggerEvent; readonly labeled: GitHubTriggerEvent },
  applied: string | undefined,
): GitHubTriggerEvent | undefined {
  if (read.action === GITHUB_ACTION.OPENED) return events.opened;
  if (read.action === GITHUB_ACTION.LABELED && applied !== undefined) return events.labeled;
  return undefined;
}

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

function githubEventOf(
  event: string,
  payload: UnparsedWireValue,
  agentLogin: string | undefined,
): GitHubEventRead | undefined {
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
        isAgentBranch(branch)
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

function triggerMatches(trigger: AutomationTrigger, read: GitHubEventRead): boolean {
  if (trigger.kind !== AUTOMATION_TRIGGER.GITHUB || trigger.event !== read.event) return false;
  if (
    read.sender !== undefined &&
    !(trigger.senders ?? GITHUB_DEFAULT_SENDERS).includes(read.sender)
  ) {
    return false;
  }
  if (read.sender === GITHUB_SENDER.APP_AGENTS && read.pushed) return false;
  const moments = trigger.moments ?? PULL_REQUEST_DEFAULT_MOMENTS;
  if (read.moment !== undefined && !moments.includes(read.moment)) return false;
  if ((read.draft && trigger.drafts !== true) || (read.fork && trigger.forks !== true)) {
    return false;
  }
  const labels = trigger.labels ?? [];
  const branches = trigger.branches ?? [];
  const labeled =
    labels.length === 0 ||
    labels.some((wanted) =>
      read.labels.some((label) => label.toLowerCase() === wanted.toLowerCase()),
    );
  const branched =
    branches.length === 0 || (read.branch !== undefined && branches.includes(read.branch));
  return labeled && branched;
}

const queueRunsOf = Effect.fnUntraced(function* (deliveryId: string, read: GitHubEventRead) {
  const listening = (yield* githubAutomationsOn(
    read.repository,
    read.event,
    MAXIMUM_AUTOMATIONS,
  )).filter((automation) => triggerMatches(automation.trigger, read));
  const firedAt = yield* DateTime.nowAsDate;
  const recorded = yield* Effect.forEach(listening, (automation) =>
    recordAutomationRun(automation, { dedupeKey: deliveryId, firing: read.firing, firedAt }),
  );
  return recorded.filter(Option.isSome).length;
});

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
