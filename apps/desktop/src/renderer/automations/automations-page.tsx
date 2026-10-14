import {
  AUTOMATION_PAUSE,
  AUTOMATION_RUN_STATUS,
  AUTOMATION_TRIGGER,
  AUTOMATION_WEBHOOK,
  type AutomationRunSummary,
  type AutomationSummary,
  GITHUB_TRIGGER_EVENT,
} from "@sidecar/hosted/automation-wire";
import { INTEGRATION_PROVIDER } from "@sidecar/hosted/integration-wire";
import type { PlanSummary } from "@sidecar/hosted/plan-wire";
import { ACTION_RESULT_STATUS } from "@sidecar/wire";
import {
  ChevronRightIcon,
  CircleAlertIcon,
  CircleCheckIcon,
  CircleDashedIcon,
  ClockIcon,
  CopyIcon,
  PencilIcon,
  PlayIcon,
  PlusIcon,
  RefreshCwIcon,
  SkipForwardIcon,
  Trash2Icon,
  WebhookIcon,
  XIcon,
  ZapIcon,
} from "lucide-react";
import { useState } from "react";
import { useCopyToast } from "../copy-feedback";
import { EmptyState } from "../empty-state";
import { momentText, sinceText, useMinute } from "../planning/plan-time";
import type { PlansControl } from "../planning/use-plans-tab";
import { ProviderMark } from "../provider-marks";
import { RetryButton } from "../retry-button";
import { ConfirmDialog, useConfirmDialog } from "../settings/confirm-dialog";
import { SPINNER_SIZE, Spinner } from "../spinner";
import { TOAST_HOLD, TOAST_TONE, useToast } from "../toast";
import { WorkingMark } from "../working-mark";
import {
  type AutomationDraft,
  AutomationEditor,
  type AutomationSave,
  actionOf,
  DialogFrame,
  draftOf,
  mintWebhookSecret,
  scheduleOf,
} from "./automation-editor";
import {
  firingText,
  RUN_TONE,
  type RunTone,
  reasonText,
  runState,
  triggerText,
} from "./automation-words";
import { type AutomationWrite, useAutomationRuns, useAutomations } from "./use-automations";

/**
 * automations-page.tsx -- the window's Automations page: the account's automations in a list, one read with its runs, and the dialogs that make, change, and delete them.
 *
 * It stands in the plan's place beside the sidebar, whose Automations row
 * is marked while it does, as the Inbox does. The list says each
 * automation's trigger, plan, next run, and newest run, with its switch; a
 * page opened from a plan's ⋯ menu lists that plan's alone, under a chip
 * that lets the list widen again. A press reads one: its runs first, since what it did is what is looked for,
 * each opening to say what fired it, when, and how it went, with the
 * agent's tab a press away, then how it is set up. An automation the
 * service paused after its starts kept failing says so in a banner over
 * its runs. With none made, the page says what an automation is and offers
 * three to start from. A webhook's secret is shown once, in a dialog of its
 * own, the moment it is minted, and never again.
 */

/** The automations a new one may start from: a name, a trigger, and a task. */
const TEMPLATES: readonly {
  readonly glyph: React.ReactNode;
  readonly line: string;
  readonly draft: Partial<AutomationDraft>;
}[] = [
  {
    glyph: <ClockIcon />,
    line: "Weekdays at 2:00",
    draft: {
      name: "Nightly flaky-test sweep",
      kind: AUTOMATION_TRIGGER.SCHEDULE,
      schedule: scheduleOf("0 2 * * 1-5"),
      prompt:
        "Find the flakiest test in this repository's recent CI runs, fix its cause rather than retrying it, and open a pull request with the fix.",
    },
  },
  {
    glyph: <ProviderMark provider={INTEGRATION_PROVIDER.GITHUB} />,
    line: "When a check fails on main",
    draft: {
      name: "Fix failing CI on main",
      kind: AUTOMATION_TRIGGER.GITHUB,
      event: GITHUB_TRIGGER_EVENT.CHECK_FAILED,
      branches: "main",
      prompt:
        "A check just failed on main. Read the failing job's log, find the change that broke it, fix the cause, run the suite, and open a pull request.",
    },
  },
  {
    glyph: <ProviderMark provider={INTEGRATION_PROVIDER.GITHUB} />,
    line: "When an issue is labelled bug",
    draft: {
      name: "Triage new bugs",
      kind: AUTOMATION_TRIGGER.GITHUB,
      event: GITHUB_TRIGGER_EVENT.ISSUE_LABELED,
      labels: "bug",
      prompt:
        "An issue was just labelled bug. Reproduce it, find the cause, and open a pull request with a fix and a test, or post to the inbox what you need to go on.",
    },
  },
];

/** What a "Run now" the service did not take says. */
const RUN_NOW_FAILED = "Couldn't run it now. Try again.";

const NEXT_RUN = new Intl.DateTimeFormat(undefined, {
  weekday: "short",
  day: "numeric",
  month: "short",
  hour: "numeric",
  minute: "2-digit",
});

/** The editor's state: closed, or open on a draft, for a new automation or one to edit. */
type Editing =
  | undefined
  | { readonly draft: AutomationDraft; readonly automation: AutomationSummary | undefined };

/** A secret to show once, and where it is called. */
interface ShownSecret {
  readonly url: string;
  readonly secret: string;
}

/** A trigger's glyph. */
function TriggerGlyph({ trigger }: { trigger: AutomationSummary["trigger"] }): React.JSX.Element {
  switch (trigger.kind) {
    case AUTOMATION_TRIGGER.SCHEDULE:
      return <ClockIcon />;
    case AUTOMATION_TRIGGER.GITHUB:
      return <ProviderMark provider={INTEGRATION_PROVIDER.GITHUB} />;
    case AUTOMATION_TRIGGER.WEBHOOK:
      return <WebhookIcon />;
  }
}

/** A run's state as a pill, its agent's working mark while it runs. */
function RunPill({ run, now }: { run: AutomationRunSummary; now?: number }): React.JSX.Element {
  const state = runState(run);
  return (
    <span className="automation-pill" data-tone={state.tone} title={momentText(run.firedAt)}>
      {state.tone === RUN_TONE.WORKING ? <WorkingMark /> : null}
      {state.word}
      {now === undefined ? null : ` · ${sinceText(run.firedAt, now)}`}
    </span>
  );
}

/** The switch that turns an automation on or off. */
function AutomationSwitch({
  automation,
  onToggle,
}: {
  automation: AutomationSummary;
  onToggle: (enabled: boolean) => void;
}): React.JSX.Element {
  return (
    <button
      type="button"
      role="switch"
      aria-checked={automation.enabled}
      aria-label={automation.enabled ? `Turn off ${automation.name}` : `Turn on ${automation.name}`}
      className="switch"
      onClick={(event) => {
        event.stopPropagation();
        onToggle(!automation.enabled);
      }}
    >
      <span className="switch-thumb" />
    </button>
  );
}

/** When an automation runs next, as a list row says it: a label over a value. */
interface WhenWords {
  readonly label: string;
  readonly value: string;
}

/** When the automation runs next, as a list row says it. */
function whenText(automation: AutomationSummary): WhenWords {
  if (automation.pausedReason !== null) return { label: "Status", value: "Paused" };
  if (!automation.enabled) return { label: "Status", value: "Off" };
  if (automation.nextRunAt !== null)
    return { label: "Next run", value: NEXT_RUN.format(automation.nextRunAt) };
  return { label: "Runs", value: "On each event" };
}

/** One automation's row in the list. */
function AutomationRow({
  automation,
  plan,
  now,
  onOpen,
  onToggle,
}: {
  automation: AutomationSummary;
  plan: PlanSummary | undefined;
  now: number;
  onOpen: () => void;
  onToggle: (enabled: boolean) => void;
}): React.JSX.Element {
  const when = whenText(automation);
  return (
    // biome-ignore lint/a11y/useSemanticElements: the row holds its own switch, which a button may not.
    <div
      className="automation-row"
      role="button"
      tabIndex={0}
      data-enabled={String(automation.enabled)}
      onClick={onOpen}
      onKeyDown={(event) => {
        if (event.key === "Enter" || event.key === " ") {
          event.preventDefault();
          onOpen();
        }
      }}
    >
      <span className="automation-mark" aria-hidden="true">
        <TriggerGlyph trigger={automation.trigger} />
      </span>
      <span className="settings-copy">
        <strong>{automation.name}</strong>
        <small>
          {triggerText(automation.trigger)}
          <span className="automation-dot" />
          {automation.planName}
          {plan?.repository == null ? null : (
            <>
              <span className="automation-dot" />
              {plan.repository}
            </>
          )}
        </small>
      </span>
      <span className="automation-when">
        <small>{when.label}</small>
        <span>{when.value}</span>
      </span>
      {automation.lastRun === null ? (
        <span className="automation-pill" data-tone={RUN_TONE.QUIET}>
          No runs yet
        </span>
      ) : (
        <RunPill run={automation.lastRun} now={now} />
      )}
      <AutomationSwitch automation={automation} onToggle={onToggle} />
    </div>
  );
}

/** The page with none made: what an automation is, and three to start from. */
function EmptyAutomations({
  onNew,
}: {
  onNew: (draft?: Partial<AutomationDraft>) => void;
}): React.JSX.Element {
  return (
    <div className="automation-empty">
      <EmptyState icon={<ZapIcon />}>
        Automations start a coding agent on one of your plans when something happens: on a schedule,
        on a GitHub event, or when a webhook is called.
      </EmptyState>
      <button type="button" className="primary-button" onClick={() => onNew()}>
        <PlusIcon />
        New automation
      </button>
      <h2 className="automation-templates-title">Start from a template</h2>
      <div className="automation-templates">
        {TEMPLATES.map((template) => (
          <button
            key={template.line}
            type="button"
            className="automation-template"
            onClick={() => onNew(template.draft)}
          >
            <span className="automation-mark" aria-hidden="true">
              {template.glyph}
            </span>
            <strong>{template.draft.name}</strong>
            <p>{template.draft.prompt}</p>
            <span className="automation-template-line">{template.line}</span>
          </button>
        ))}
      </div>
    </div>
  );
}

/** A run's glyph, by the tone of its state. */
function RunGlyph({ tone }: { tone: RunTone }): React.JSX.Element {
  switch (tone) {
    case RUN_TONE.WORKING:
      return <WorkingMark />;
    case RUN_TONE.COMPLETE:
      return <CircleCheckIcon />;
    case RUN_TONE.DANGER:
      return <CircleAlertIcon />;
    case RUN_TONE.ATTENTION:
      return <SkipForwardIcon />;
    case RUN_TONE.QUIET:
      return <CircleDashedIcon />;
  }
}

/** One run's row, opening under itself to what fired it, when, how it went, and its agent. */
function RunRow({
  run,
  now,
  open,
  onToggle,
  onOpenAgent,
}: {
  run: AutomationRunSummary;
  now: number;
  open: boolean;
  onToggle: () => void;
  onOpenAgent: (agentId: string) => void;
}): React.JSX.Element {
  const reason = reasonText(run.reason);
  const { firing } = run;
  return (
    <>
      <button type="button" className="automation-run" aria-expanded={open} onClick={onToggle}>
        <span className="automation-run-glyph" data-tone={runState(run).tone} aria-hidden="true">
          <RunGlyph tone={runState(run).tone} />
        </span>
        <span className="settings-copy">
          <strong>{firingText(firing)}</strong>
          <small>
            {reason ??
              run.agent?.title ??
              (run.status === AUTOMATION_RUN_STATUS.QUEUED ? "Waiting to start" : "")}
          </small>
        </span>
        <RunPill run={run} />
        <span className="automation-run-time" title={momentText(run.firedAt)}>
          {sinceText(run.firedAt, now)}
        </span>
        <ChevronRightIcon className="settings-chevron" aria-hidden="true" />
      </button>
      {open ? (
        <div className="automation-run-detail">
          <dl className="automation-run-facts">
            <dt>Fired</dt>
            <dd>{momentText(run.firedAt)}</dd>
            {run.settledAt === null ? null : (
              <>
                <dt>{run.status === AUTOMATION_RUN_STATUS.STARTED ? "Started" : "Settled"}</dt>
                <dd>{momentText(run.settledAt)}</dd>
              </>
            )}
            {"url" in firing && firing.url !== undefined ? (
              <>
                <dt>Event</dt>
                <dd className="automation-run-link">{firing.url}</dd>
              </>
            ) : null}
            {reason === undefined ? null : (
              <>
                <dt>Why</dt>
                <dd>{reason}</dd>
              </>
            )}
          </dl>
          {run.agent === null ? null : (
            <div className="automation-run-actions">
              <button
                type="button"
                className="primary-button"
                onClick={() => run.agent && onOpenAgent(run.agent.id)}
              >
                Open agent tab
              </button>
            </div>
          )}
        </div>
      ) : null}
    </>
  );
}

/** How the automation is set up, one row a part. */
function SetupCard({ automation }: { automation: AutomationSummary }): React.JSX.Element {
  const { guards } = automation;
  return (
    <section className="settings-group">
      <h2 className="settings-group-title">Setup</h2>
      <div className="settings-card automation-facts">
        <div className="settings-row">
          <span className="automation-fact-label">When</span>
          <span className="automation-fact">
            {triggerText(automation.trigger)}
            {automation.webhookUrl === undefined ? null : (
              <small className="automation-run-link">{automation.webhookUrl}</small>
            )}
          </span>
        </div>
        <div className="settings-row">
          <span className="automation-fact-label">Plan</span>
          <span className="automation-fact">{automation.planName}</span>
        </div>
        <div className="settings-row">
          <span className="automation-fact-label">Task</span>
          <p className="automation-fact automation-prompt">{automation.action.prompt}</p>
        </div>
        <div className="settings-row">
          <span className="automation-fact-label">Limits</span>
          <span className="automation-fact">
            {guards.maxConcurrentRuns} at a time · up to {guards.dailyRunCap} runs a day
            <small>A run past either limit is skipped, not queued.</small>
          </span>
        </div>
      </div>
    </section>
  );
}

/** The chosen automation: its head, a banner where the service paused it, its runs, and its setup. */
function AutomationDetail({
  automation,
  runs,
  onToggle,
  onOpenAgent,
}: {
  automation: AutomationSummary;
  runs: ReturnType<typeof useAutomationRuns>;
  onToggle: (enabled: boolean) => void;
  onOpenAgent: (agentId: string) => void;
}): React.JSX.Element {
  const now = useMinute();
  const [opened, setOpened] = useState<string | undefined>(undefined);
  const read = runs.read;
  return (
    <>
      <header className="settings-page-head">
        <span className="automation-head-copy">
          <h1 className="settings-page-title">{automation.name}</h1>
          <span className="automation-head-line">
            <TriggerGlyph trigger={automation.trigger} />
            {triggerText(automation.trigger)}
            <span className="automation-dot" />
            {automation.planName}
          </span>
        </span>
        <span className="settings-actions">
          <span className="automation-next">{automation.enabled ? "On" : "Off"}</span>
          <AutomationSwitch automation={automation} onToggle={onToggle} />
        </span>
      </header>
      {automation.pausedReason === AUTOMATION_PAUSE.FAILURES ? (
        <section className="document-banner automation-paused" aria-label="Paused">
          <div className="document-banner-words">
            <p className="document-banner-title">Paused after 3 failed starts</p>
            <p className="document-banner-detail">
              Luke stopped firing it. Fix what its last run says, then turn it back on.
            </p>
          </div>
          <button type="button" className="primary-button" onClick={() => onToggle(true)}>
            Turn on
          </button>
        </section>
      ) : null}
      <div className="settings">
        <section className="settings-group">
          <h2 className="settings-group-title">Runs</h2>
          <div className="settings-card">
            {read === undefined ? (
              <Spinner label="Loading runs" size={SPINNER_SIZE.INLINE} />
            ) : null}
            {read !== undefined && "failure" in read ? (
              <div className="settings-row" role="alert">
                <span className="settings-copy">
                  <strong>Couldn't read its runs.</strong>
                </span>
                <RetryButton onRetry={() => void runs.reload()} />
              </div>
            ) : null}
            {read !== undefined && "runs" in read && read.runs.length === 0 ? (
              <p className="settings-row automation-none">No runs yet. Run it now to try it.</p>
            ) : null}
            {read !== undefined && "runs" in read
              ? read.runs.map((run) => (
                  <RunRow
                    key={run.id}
                    run={run}
                    now={now}
                    open={opened === run.id}
                    onToggle={() => setOpened((held) => (held === run.id ? undefined : run.id))}
                    onOpenAgent={onOpenAgent}
                  />
                ))
              : null}
          </div>
        </section>
        <SetupCard automation={automation} />
      </div>
    </>
  );
}

/** One value of the webhook's, in a mono well with its copy button under its label. */
function SecretLine({
  label,
  value,
  onCopy,
}: {
  label: string;
  value: string;
  onCopy: () => void;
}): React.JSX.Element {
  return (
    <div className="automation-field">
      <p className="automation-field-label">{label}</p>
      <div className="automation-secret">
        <code>{value}</code>
        <button
          type="button"
          className="icon-button"
          aria-label={`Copy ${label.toLowerCase()}`}
          onClick={onCopy}
        >
          <CopyIcon />
        </button>
      </div>
    </div>
  );
}

/** The webhook's address and secret, shown once, the moment the secret is minted. */
function WebhookSecretDialog({
  shown,
  onClose,
}: {
  shown: ShownSecret;
  onClose: () => void;
}): React.JSX.Element {
  const copy = useCopyToast();
  const curl = `curl -X POST ${shown.url} \\\n  -H "Authorization: Bearer ${shown.secret}" \\\n  -H "${AUTOMATION_WEBHOOK.IDEMPOTENCY_HEADER}: <unique id>" \\\n  -d '{"text": "..."}'`;
  return (
    <DialogFrame title="Webhook ready" busy={false} onClose={onClose}>
      <div className="automation-dialog-body">
        <p className="automation-field-note">
          Copy the secret now: it is shown this once. Send it as the bearer, or as the address's{" "}
          <code>{AUTOMATION_WEBHOOK.TOKEN_QUERY}</code> query where the sender can set no header.
        </p>
        <SecretLine
          label="Address"
          value={shown.url}
          onCopy={() => copy(shown.url, "Address copied")}
        />
        <SecretLine
          label="Secret"
          value={shown.secret}
          onCopy={() => copy(shown.secret, "Secret copied")}
        />
        <pre className="automation-curl">{curl}</pre>
      </div>
      <div className="confirm-dialog-actions">
        <button type="button" className="primary-button" onClick={onClose}>
          Done
        </button>
      </div>
    </DialogFrame>
  );
}

/** The window's Automations page, in the plan's place. */
export function AutomationsPage({ plans }: { plans: PlansControl }): React.JSX.Element {
  const view = plans.automationsView;
  const store = useAutomations(view.plan);
  const now = useMinute();
  const [editing, setEditing] = useState<Editing>(undefined);
  const [secret, setSecret] = useState<ShownSecret | undefined>(undefined);
  const { read } = store;
  const automations = read !== undefined && "automations" in read ? read.automations : [];
  const chosen = automations.find((each) => each.id === view.chosen);
  const runs = useAutomationRuns(chosen?.id);
  const planOf = (planId: string) => plans.plans.find((plan) => plan.id === planId);
  const toggle = (automation: AutomationSummary) => (enabled: boolean) =>
    void store.change({ automationId: automation.id, change: { enabled } });
  const deletion = useConfirmDialog(
    { subject: chosen !== undefined, surfaceOpen: true },
    async () => {
      if (chosen === undefined) return { status: ACTION_RESULT_STATUS.ACCEPTED };
      const answer = await store.remove(chosen.id);
      if ("failure" in answer)
        return { status: ACTION_RESULT_STATUS.REJECTED, reason: "Couldn't delete it. Try again." };
      view.onDeleted(chosen.id);
      return { status: ACTION_RESULT_STATUS.ACCEPTED };
    },
  );
  const save = async (made: AutomationSave): Promise<AutomationWrite> => {
    const target = editing?.automation;
    // Note that an edit keeps the model the automation runs on, which the form does not show.
    const action = { ...target?.action, ...actionOf(made) };
    const answer =
      target === undefined
        ? await store.create({
            planId: made.planId,
            name: made.name,
            trigger: made.trigger,
            action,
            guards: made.guards,
            ...(made.webhookSecret === undefined
              ? undefined
              : { webhookSecret: made.webhookSecret }),
          })
        : await store.change({
            automationId: target.id,
            change: {
              name: made.name,
              trigger: made.trigger,
              action,
              guards: made.guards,
              ...(made.webhookSecret === undefined
                ? undefined
                : { webhookSecret: made.webhookSecret }),
            },
          });
    if ("automation" in answer) {
      setEditing(undefined);
      view.onChoose(answer.automation.id);
      if (made.webhookSecret !== undefined && answer.automation.webhookUrl !== undefined) {
        setSecret({ url: answer.automation.webhookUrl, secret: made.webhookSecret });
      }
    }
    return answer;
  };
  const rotate = (automation: AutomationSummary) => {
    const minted = mintWebhookSecret();
    void store.rotate(automation.id, minted).then((answer) => {
      if ("automation" in answer && answer.automation.webhookUrl !== undefined) {
        setSecret({ url: answer.automation.webhookUrl, secret: minted });
      }
    });
  };
  const openNew = (draft?: Partial<AutomationDraft>) =>
    setEditing({ draft: draftOf(draft, view.plan ?? plans.boundFor), automation: undefined });
  return (
    <section className="automations-view" aria-label="Automations">
      <header className="desktop-toolbar">
        <div className="desktop-toolbar-heading">
          {chosen === undefined ? (
            <h1 className="desktop-toolbar-title">Automations</h1>
          ) : (
            <nav className="automation-crumbs" aria-label="Path">
              <button
                type="button"
                className="toolbar-button"
                onClick={() => view.onChoose(undefined)}
              >
                <ZapIcon />
                Automations
              </button>
              <ChevronRightIcon aria-hidden="true" />
              <span className="automation-crumb">{chosen.name}</span>
            </nav>
          )}
        </div>
        <div className="desktop-toolbar-actions">
          {chosen === undefined ? (
            automations.length === 0 ? null : (
              <button type="button" className="primary-button" onClick={() => openNew()}>
                <PlusIcon />
                New automation
              </button>
            )
          ) : (
            <>
              <button
                type="button"
                className="toolbar-button bordered-button"
                onClick={() =>
                  setEditing({ draft: draftOf(chosen, undefined), automation: chosen })
                }
              >
                <PencilIcon />
                Edit
              </button>
              <RunNowButton runs={runs} onRan={() => void store.reload()} />
              {chosen.trigger.kind === AUTOMATION_TRIGGER.WEBHOOK ? (
                <button
                  type="button"
                  className="toolbar-button bordered-button"
                  onClick={() => rotate(chosen)}
                >
                  <RefreshCwIcon />
                  New secret
                </button>
              ) : null}
              <button
                type="button"
                className="icon-button"
                aria-label="Delete automation"
                onClick={deletion.ask}
              >
                <Trash2Icon />
              </button>
            </>
          )}
        </div>
      </header>
      <div className="settings-page automation-page">
        <div className="settings-page-scroll">
          {read === undefined ? (
            <Spinner label="Loading automations" size={SPINNER_SIZE.INLINE} />
          ) : null}
          {read !== undefined && "failure" in read ? (
            <div className="automation-empty" role="alert">
              <p>Couldn't read your automations.</p>
              <RetryButton onRetry={() => void store.reload()} />
            </div>
          ) : null}
          {read !== undefined && "automations" in read && automations.length === 0 ? (
            <EmptyAutomations onNew={openNew} />
          ) : null}
          {chosen === undefined && view.plan !== undefined ? (
            <div className="automation-filter">
              <span>Automations on</span>
              <button
                type="button"
                className="plan-compose-chip"
                aria-label="Show every plan's automations"
                onClick={() => view.onOpen(undefined)}
              >
                {planOf(view.plan)?.name ?? "this plan"}
                <XIcon />
              </button>
            </div>
          ) : null}
          {chosen === undefined && automations.length > 0 ? (
            <div className="settings automation-list">
              <div className="settings-card">
                {automations.map((automation) => (
                  <AutomationRow
                    key={automation.id}
                    automation={automation}
                    plan={planOf(automation.planId)}
                    now={now}
                    onOpen={() => view.onChoose(automation.id)}
                    onToggle={toggle(automation)}
                  />
                ))}
              </div>
              <p className="settings-note">
                Automations run in the cloud as you, whether or not this Mac is awake. Each run
                starts a coding agent you'll find on its plan, and in your Inbox when it needs you.
              </p>
            </div>
          ) : null}
          {chosen === undefined ? null : (
            <AutomationDetail
              automation={chosen}
              runs={runs}
              onToggle={toggle(chosen)}
              onOpenAgent={(agentId) => plans.onShowAgent(chosen.planId, agentId)}
            />
          )}
        </div>
      </div>
      {editing === undefined ? null : (
        <AutomationEditor
          editing={editing.automation}
          initial={editing.draft}
          plans={plans.plans}
          onSave={save}
          onClose={() => setEditing(undefined)}
        />
      )}
      {secret === undefined ? null : (
        <WebhookSecretDialog shown={secret} onClose={() => setSecret(undefined)} />
      )}
      {chosen === undefined ? null : (
        <ConfirmDialog
          confirm={deletion}
          question={{
            title: `Delete "${chosen.name}"?`,
            body: "It stops firing, and its run history goes with it. Agents it started stay on their plan.",
            verb: "Delete",
            running: "Deleting",
          }}
        />
      )}
    </section>
  );
}

/** Run now, busy while the run is asked for. */
function RunNowButton({
  runs,
  onRan,
}: {
  runs: ReturnType<typeof useAutomationRuns>;
  onRan: () => void;
}): React.JSX.Element {
  const [running, setRunning] = useState(false);
  const show = useToast();
  return (
    <button
      type="button"
      className="toolbar-button bordered-button"
      aria-busy={running}
      disabled={running}
      onClick={() => {
        setRunning(true);
        void runs.runNow().then((answer) => {
          setRunning(false);
          onRan();
          if ("failure" in answer) {
            show({ words: RUN_NOW_FAILED, tone: TOAST_TONE.FAILED, hold: TOAST_HOLD.FAILED });
          }
        });
      }}
    >
      <PlayIcon />
      Run now
    </button>
  );
}
