import {
  AUTOMATION_FIRING,
  AUTOMATION_PAUSE,
  AUTOMATION_RUN_STATUS,
  AUTOMATION_TRIGGER,
  AUTOMATION_WEBHOOK,
  type AutomationFiring,
  type AutomationRunSummary,
  type AutomationSummary,
  GITHUB_TRIGGER_EVENT,
} from "@sidecar/hosted/automation-wire";
import { INTEGRATION_PROVIDER } from "@sidecar/hosted/integration-wire";
import { ACTION_RESULT_STATUS } from "@sidecar/wire";
import {
  ChevronRightIcon,
  ClockIcon,
  CopyIcon,
  PencilIcon,
  PlayIcon,
  PlusIcon,
  RefreshCwIcon,
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
import { GLYPH_STATE, StateGlyph, stateEndMark } from "../state-glyph";
import { Switch } from "../switch";
import { TOAST_HOLD, TOAST_TONE, useToast } from "../toast";
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
  nextRunText,
  reasonText,
  runGlyphState,
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

/** The switch that turns an automation on or off. */
function AutomationSwitch({
  automation,
  onToggle,
}: {
  automation: AutomationSummary;
  onToggle: (enabled: boolean) => void;
}): React.JSX.Element {
  return (
    <Switch
      checked={automation.enabled}
      label={automation.enabled ? `Turn off ${automation.name}` : `Turn on ${automation.name}`}
      onChange={(enabled, event) => {
        event.stopPropagation();
        onToggle(enabled);
      }}
    />
  );
}

/**
 * One automation's row: its trigger's glyph wearing where its newest run
 * stands, its name over what fires it, when it runs next, a failure's mark,
 * and its switch, nothing else, so a list of them reads as one.
 */
function AutomationRow({
  automation,
  onOpen,
  onToggle,
}: {
  automation: AutomationSummary;
  onOpen: () => void;
  onToggle: (enabled: boolean) => void;
}): React.JSX.Element {
  const now = useMinute();
  const state = automation.lastRun === null ? GLYPH_STATE.REST : runGlyphState(automation.lastRun);
  return (
    // biome-ignore lint/a11y/useSemanticElements: the row holds its own switch, which a button may not.
    <div
      className="automation-list-row"
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
      <StateGlyph glyph={<TriggerGlyph trigger={automation.trigger} />} state={state} />
      <span className="automation-list-copy">
        <span className="automation-list-name">{automation.name}</span>
        <span className="automation-list-detail">{triggerText(automation.trigger)}</span>
      </span>
      <span className="automation-list-when">{nextRunText(automation, now)}</span>
      {stateEndMark(state, true)}
      <AutomationSwitch automation={automation} onToggle={onToggle} />
    </div>
  );
}

/** The page with none made: what an automation does, the one way to make one, and three to start from as plain rows. */
function EmptyAutomations({
  onNew,
}: {
  onNew: (draft?: Partial<AutomationDraft>) => void;
}): React.JSX.Element {
  return (
    <div className="automation-empty">
      <EmptyState icon={<ZapIcon />}>
        Start a coding agent on one of your plans on a schedule, a GitHub event, or a webhook.
      </EmptyState>
      <button type="button" className="primary-button" onClick={() => onNew()}>
        New automation
      </button>
      <section className="automation-templates">
        <h2 className="settings-group-title">Templates</h2>
        <div className="settings-card">
          {TEMPLATES.map((template) => (
            <button
              key={template.line}
              type="button"
              className="automation-list-row"
              onClick={() => onNew(template.draft)}
            >
              <StateGlyph glyph={template.glyph} state={GLYPH_STATE.REST} />
              <span className="automation-list-copy">
                <span className="automation-list-name">{template.draft.name}</span>
                <span className="automation-list-detail">{template.line}</span>
              </span>
            </button>
          ))}
        </div>
      </section>
    </div>
  );
}

/** What fired a run, as a glyph: its trigger's, or Run now's play. */
function FiringGlyph({ firing }: { firing: AutomationFiring }): React.JSX.Element {
  switch (firing.kind) {
    case AUTOMATION_FIRING.SCHEDULE:
      return <ClockIcon />;
    case AUTOMATION_FIRING.GITHUB:
      return <ProviderMark provider={INTEGRATION_PROVIDER.GITHUB} />;
    case AUTOMATION_FIRING.WEBHOOK:
      return <WebhookIcon />;
    default:
      return <PlayIcon />;
  }
}

/**
 * One run as a row: what fired it on its glyph, wearing where its agent
 * stands, the agent's title over what fired it, or what fired it over why
 * it never started, then how long ago and a failure's mark. A run with an
 * agent opens the agent's tab; one without has nothing more to say.
 */
function RunRow({
  run,
  now,
  onOpenAgent,
}: {
  run: AutomationRunSummary;
  now: number;
  onOpenAgent: (agentId: string) => void;
}): React.JSX.Element {
  const state = runGlyphState(run);
  const fired = firingText(run.firing);
  const waiting = run.status === AUTOMATION_RUN_STATUS.QUEUED ? "Waiting to start" : undefined;
  const title = run.agent?.title ?? fired;
  const line = run.agent?.title == null ? (reasonText(run.reason) ?? waiting) : fired;
  const body = (
    <>
      <StateGlyph glyph={<FiringGlyph firing={run.firing} />} state={state} />
      <span className="automation-list-copy">
        <span className="automation-list-name">{title}</span>
        {line === undefined ? null : <span className="automation-list-detail">{line}</span>}
      </span>
      <span className="automation-list-when" title={momentText(run.firedAt)}>
        {sinceText(run.firedAt, now)}
      </span>
      {stateEndMark(state, true)}
    </>
  );
  const agent = run.agent;
  if (agent === null) return <div className="automation-list-row">{body}</div>;
  return (
    <button type="button" className="automation-list-row" onClick={() => onOpenAgent(agent.id)}>
      {body}
    </button>
  );
}

/** How the automation is set up, past what its head says: its task, its webhook's address, and its limits in a line under them. */
function SetupCard({ automation }: { automation: AutomationSummary }): React.JSX.Element {
  const { guards } = automation;
  return (
    <section className="settings-group">
      <h2 className="settings-group-title">Task</h2>
      <div className="settings-card">
        <p className="settings-row automation-prompt">{automation.action.prompt}</p>
        {automation.webhookUrl === undefined ? null : (
          <p className="settings-row automation-run-link">{automation.webhookUrl}</p>
        )}
      </div>
      <p className="settings-note automation-limits">
        {guards.maxConcurrentRuns} at a time, up to {guards.dailyRunCap} runs a day. A run past
        either limit is skipped, not queued.
      </p>
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
  const read = runs.read;
  return (
    <>
      <header className="settings-page-head">
        <span className="automation-head-copy">
          <h1 className="settings-page-title">{automation.name}</h1>
          <span className="automation-head-line">
            {triggerText(automation.trigger)} · {automation.planName}
          </span>
        </span>
        <AutomationSwitch automation={automation} onToggle={onToggle} />
      </header>
      <div className="settings">
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
                  <RunRow key={run.id} run={run} now={now} onOpenAgent={onOpenAgent} />
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
                    onOpen={() => view.onChoose(automation.id)}
                    onToggle={toggle(automation)}
                  />
                ))}
              </div>
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
