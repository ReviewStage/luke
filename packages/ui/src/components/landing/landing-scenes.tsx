import { MODEL_PROVIDER } from "@luke/features/models-wire";
import { TASK_STATUS, type TaskStatus } from "@luke/features/task-wire";
import { type ReactNode, type RefObject, useEffect, useRef, useState } from "react";
import { ComposeIcon, SearchIcon } from "../../face/glyphs.js";
import {
  CheckIcon,
  ChevronDownIcon,
  GLYPH,
  ICON_SIZE,
  InboxIcon,
  ListTodoIcon,
  PlusIcon,
  SendIcon,
  SlidersHorizontalIcon,
  SquareCheckIcon,
  ZapIcon,
} from "../../icons/icons.js";
import { HarnessMark } from "../../marks/harness-mark.js";
import { MARK_PROVIDER, ProviderMark } from "../../marks/provider-mark.js";
import { TaskStatusMark } from "../../marks/task-marks.js";
import { STATUS_TONE } from "../../status-tone.js";
import { AttentionMark } from "../attention-mark/attention-mark.js";
import { AVATAR_SHAPE, AVATAR_SIZE, Avatar } from "../avatar/avatar.js";
import { Breadcrumbs } from "../breadcrumbs/breadcrumbs.js";
import { IconButton } from "../button/button.js";
import { CHOICE_LOOK, CHOICE_SELECT, ChoiceList } from "../choice-list/choice-list.js";
import { COMMENT_ELEMENT, Comment, type CommentAuthor } from "../comment/comment.js";
import { ComposerFrame } from "../composer-frame/composer-frame.js";
import { Fact, Facts } from "../facts/facts.js";
import { GlyphSlot } from "../glyph-slot/glyph-slot.js";
import { GROUP_HEADING, GroupHeader } from "../group-header/group-header.js";
import { INLINE_REF_LOOK, InlineRef } from "../inline-ref/inline-ref.js";
import {
  LIST_DENSITY,
  LIST_ROW_CURRENT,
  LIST_ROW_CURRENT_LOOK,
  LIST_ROW_INK,
  LIST_ROW_LEAD,
  LIST_ROW_META,
  LIST_VARIANT,
  List,
  ListRow,
} from "../list-row/list-row.js";
import { MessageFrame } from "../message/message.js";
import { MessageHead } from "../message/message-head.js";
import { MoreButton } from "../more-button/more-button.js";
import { NAV_CURRENT, NAV_ITEM_VARIANT, NavItem } from "../nav-item/nav-item.js";
import { NOTE_LINE_LOOK, NoteLine } from "../note-line/note-line.js";
import { SearchField } from "../search-field/search-field.js";
import { Shimmer } from "../shimmer/shimmer.js";
import { SidebarPlaces, SidebarRule } from "../sidebar/sidebar.js";
import { TEXT_ELEMENT, TEXT_TONE, Text } from "../text/text.js";
import { TEXT_VARIANT } from "../text/text-role.js";
import { Time } from "../time/time.js";
import { TOOLBAR_INSET } from "../toolbar/toolbar-frame.js";
import { Toolbar } from "../toolbar/toolbar.js";
import { UnreadMark } from "../unread-mark/unread-mark.js";
import { WorkingMark } from "../working-mark/working-mark.js";
import { LandingPhone, LandingWindow } from "./landing-devices.js";
import { prefersStill } from "./landing-paint.js";

/**
 * landing-scenes.tsx -- the landing's moving screens: the app's own components, composed as the panel composes them, stepping through a short story each.
 *
 * Every scene is drawn from `@luke/ui`'s parts in the panel's own
 * arrangement (the desktop's sidebar, the Inbox's list and thread, an
 * agent's log, an automation's runs), so what the landing shows is what the
 * app draws. None is pressed: each plays its story on a clock that runs
 * only while the scene is on screen, starts over at its end, and under
 * reduced motion stands at its last step, where the whole story is told.
 * The work in them is one made-up team's, acme, building teammate
 * invitations.
 */

/** The moment every scene's times count back from, so a page drawn on any day says the same ages. */
const NOW = Date.UTC(2026, 10, 2, 21, 52);

const MINUTE = 60_000;

/** How long each scene holds a step, in milliseconds. */
const BEAT = { INBOX: 1900, AGENTS: 1700, RUNS: 1600, MODELS: 1500 } as const;

/** The scenes the landing plays, by the feature each shows. */
export const LANDING_SCENE = {
  INBOX: "inbox",
  AGENTS: "agents",
  AUTOMATIONS: "automations",
  DEVICES: "devices",
  MODELS: "models",
} as const;

export type LandingScene = (typeof LANDING_SCENE)[keyof typeof LANDING_SCENE];

/** Nothing: no part of a scene is ever pressed. */
function still(): void {}

/**
 * A story's step, from 0 to `count - 1`, held `beat` milliseconds each, on a
 * clock that runs only while the element `ref` names is on screen, or the
 * last step under reduced motion.
 */
function useStory(
  count: number,
  beat: number,
): readonly [RefObject<HTMLDivElement | null>, number] {
  const ref = useRef<HTMLDivElement>(null);
  const [step, setStep] = useState(0);
  useEffect(() => {
    const scene = ref.current;
    if (!scene) return undefined;
    if (prefersStill()) {
      setStep(count - 1);
      return undefined;
    }
    let shown = false;
    let played = 0;
    let previous: number | undefined;
    let frame = 0;
    const watch = new IntersectionObserver(([entry]) => {
      shown = entry?.isIntersecting ?? false;
    });
    watch.observe(scene);
    // Note that time only counts while the scene is shown, so a reader scrolling to it meets the story's start.
    const tick = (ms: number): void => {
      if (shown && previous !== undefined) played += ms - previous;
      previous = ms;
      setStep(Math.floor(played / beat) % count);
      frame = requestAnimationFrame(tick);
    };
    frame = requestAnimationFrame(tick);
    return () => {
      cancelAnimationFrame(frame);
      watch.disconnect();
    };
  }, [count, beat]);
  return [ref, step];
}

/** An agent as a comment's writer: its name on the square of the harness it runs in. */
function agentAuthor(name: string): CommentAuthor {
  return {
    name,
    shape: AVATAR_SHAPE.SQUARE,
    glyph: <HarnessMark provider={MODEL_PROVIDER.ANTHROPIC} />,
  };
}

/** A member's workspace at the sidebar's head: its tile, its name, and what kind of workspace it is. */
function Workspace(): React.JSX.Element {
  return (
    <div className="ui-landing-workspace">
      <NavItem variant={NAV_ITEM_VARIANT.IDENTITY} mark={<ChevronDownIcon />}>
        <span className="ui-landing-workspace-ref">
          <Avatar name="acme" size={AVATAR_SIZE.CARD} shape={AVATAR_SHAPE.TILE} decorative />
          <span className="ui-landing-workspace-words">
            <Text as={TEXT_ELEMENT.SPAN} variant={TEXT_VARIANT.SECTION}>
              acme
            </Text>
            <Text as={TEXT_ELEMENT.SPAN} variant={TEXT_VARIANT.CAPTION} tone={TEXT_TONE.MUTED}>
              Team
            </Text>
          </span>
        </span>
      </NavItem>
    </div>
  );
}

/** One of My tasks: its status, its name, and how long ago it moved. */
type SidebarTask = {
  readonly id: string;
  readonly name: string;
  readonly status: TaskStatus;
  readonly ago: number;
};

/** The desktop's sidebar: the workspace, the places, and My tasks, the page on show marked. */
function Sidebar({
  current,
  tasks,
  openTask,
}: {
  current: "inbox" | "task";
  tasks: readonly SidebarTask[];
  openTask?: string | undefined;
}): React.JSX.Element {
  return (
    <aside className="ui-landing-sidebar">
      <Workspace />
      <SidebarPlaces label="Places">
        <NavItem icon={<ComposeIcon />}>New task</NavItem>
        <NavItem icon={<SearchIcon />}>Search</NavItem>
        <NavItem
          icon={<InboxIcon />}
          current={current === "inbox" ? NAV_CURRENT.PAGE : undefined}
          count={{ value: 2, noun: "need you", tone: STATUS_TONE.ATTENTION }}
        >
          Inbox
        </NavItem>
        <NavItem icon={<ListTodoIcon />}>Tasks</NavItem>
        <NavItem icon={<ZapIcon />}>Automations</NavItem>
      </SidebarPlaces>
      <SidebarRule />
      <nav className="ui-landing-sidebar-group" aria-label="My tasks">
        <GroupHeader heading={GROUP_HEADING.NONE} label="My tasks" />
        <List label="My tasks" density={LIST_DENSITY.DENSE}>
          {tasks.map((task) => (
            <ListRow
              key={task.id}
              motionKey={task.id}
              density={LIST_DENSITY.DENSE}
              ink={LIST_ROW_INK.SIDEBAR}
              leading={<TaskStatusMark status={task.status} />}
              title={task.name}
              meta={
                <span className="ui-landing-row-time">
                  {task.status === TASK_STATUS.IN_PROGRESS ? <WorkingMark /> : null}
                  <Time at={NOW - task.ago * MINUTE} now={NOW} hint={false} />
                </span>
              }
              current={task.id === openTask ? LIST_ROW_CURRENT.PAGE : undefined}
              onPress={still}
            />
          ))}
        </List>
      </nav>
      <span className="ui-landing-sidebar-foot">
        <NavItem icon={<Avatar name="Sam Reyes" size={AVATAR_SIZE.ROW} decorative />}>
          Sam Reyes
        </NavItem>
      </span>
    </aside>
  );
}

const MY_TASKS: readonly SidebarTask[] = [
  { id: "invites", name: "Teammate invitations", status: TASK_STATUS.IN_PROGRESS, ago: 1 },
  { id: "digest", name: "Weekly digest email", status: TASK_STATUS.IN_PROGRESS, ago: 25 },
  { id: "bounces", name: "Handle Postmark bounces", status: TASK_STATUS.DONE, ago: 140 },
  { id: "expiry", name: "Expire invite links after 7 days", status: TASK_STATUS.TODO, ago: 300 },
];

/** What a line of the Inbox asks: a decision, a to-do, or one that is settled. */
const LINE = {
  DECIDE: "decide",
  DO: "do",
  SETTLED: "settled",
} as const;

type Line = (typeof LINE)[keyof typeof LINE];

const LINE_GLYPH: Readonly<Record<Line, ReactNode>> = {
  [LINE.DECIDE]: <GLYPH.DECIDE />,
  [LINE.DO]: <SquareCheckIcon />,
  [LINE.SETTLED]: <CheckIcon />,
};

/** One of the Inbox's items: its task, what it asks, its last line, and where the reader stands with it. */
type InboxItem = {
  readonly id: string;
  readonly task: string;
  readonly status: TaskStatus;
  readonly title: string;
  readonly line: string;
  readonly kind: Line;
  readonly ago: number;
  readonly unread?: boolean;
  readonly current?: boolean;
};

/** An Inbox row as the panel draws it: the task above, the ask's glyph before its last line, its age beside the title. */
function InboxRow({ item }: { item: InboxItem }): React.JSX.Element {
  const open = item.kind !== LINE.SETTLED;
  return (
    <ListRow
      motionKey={item.id}
      ink={LIST_ROW_INK.SIDEBAR}
      currentLook={LIST_ROW_CURRENT_LOOK.TINT}
      leading={<UnreadMark unread={item.unread === true} />}
      title={item.title}
      lead={{ icon: <TaskStatusMark status={item.status} />, label: item.task }}
      leadAt={LIST_ROW_LEAD.ABOVE}
      description={
        <span className="ui-landing-line">
          <span className="ui-landing-line-glyph" data-open={open}>
            {LINE_GLYPH[item.kind]}
          </span>
          {item.line}
        </span>
      }
      meta={
        <span className="ui-landing-row-marks">
          {open ? <AttentionMark /> : null}
          <Time at={NOW - item.ago * MINUTE} now={NOW} hint={false} />
        </span>
      }
      metaAt={LIST_ROW_META.TITLE}
      current={item.current === true ? LIST_ROW_CURRENT.PAGE : undefined}
      unread={item.unread === true}
      onPress={still}
    />
  );
}

/** The question the Inbox's story turns on, its options, and the one the reader picks. */
const QUESTION = {
  TITLE: "Who can withdraw an invite?",
  TASK: "Teammate invitations",
  AGENT: "Invite emails",
  WORDS:
    "An invite is a pending membership row, so withdrawing one deletes it. The plan leaves open who may.",
  OPTIONS: [
    {
      value: "sender",
      label: "The member who sent it",
      detail: "Admins can't take back someone else's invite.",
    },
    { value: "admin", label: "Any admin", detail: "A sender waits on an admin to withdraw one." },
    {
      value: "both",
      label: "Both",
      detail: "The sender, or any admin of the workspace.",
      badge: "Recommended",
    },
  ],
  PICK: "both",
  REPLY: "Both, and log who withdrew it.",
} as const;

const OTHER_ITEMS: readonly InboxItem[] = [
  {
    id: "domain",
    task: "Weekly digest email",
    status: TASK_STATUS.IN_PROGRESS,
    title: "Verify the digest's sender domain",
    line: "3 steps left · Open the mail provider's Domains page",
    kind: LINE.DO,
    ago: 25,
  },
  {
    id: "migration",
    task: "Teammate invitations",
    status: TASK_STATUS.IN_PROGRESS,
    title: "Run the memberships migration on preview?",
    line: "Approve (recommended) / Decline",
    kind: LINE.DECIDE,
    ago: 40,
  },
  {
    id: "subject",
    task: "Weekly digest email",
    status: TASK_STATUS.DONE,
    title: "The digest's subject line",
    line: "Answered",
    kind: LINE.SETTLED,
    ago: 62,
  },
];

/** The thread's path in its bar: its task, then the agent that asked. */
function ThreadPath(): React.JSX.Element {
  return (
    <Breadcrumbs
      label="Path"
      crumbs={[
        { label: QUESTION.TASK, glyph: <TaskStatusMark status={TASK_STATUS.IN_PROGRESS} /> },
        { label: QUESTION.AGENT, glyph: <HarnessMark provider={MODEL_PROVIDER.ANTHROPIC} /> },
      ]}
    />
  );
}

/** The question's thread at `step` of the story: asked, picked, answered, and the agent back at work. */
function QuestionThread({ step }: { step: number }): React.JSX.Element {
  const picked = step >= 3;
  return (
    <div className="ui-landing-thread">
      <header className="ui-landing-subject">
        <Text variant={TEXT_VARIANT.DIALOG} as={TEXT_ELEMENT.H2}>
          {QUESTION.TITLE}
        </Text>
      </header>
      <ol className="ui-landing-comments">
        <Comment
          as={COMMENT_ELEMENT.LI}
          author={agentAuthor(QUESTION.AGENT)}
          at={NOW - MINUTE}
          now={NOW}
        >
          <Text>{QUESTION.WORDS}</Text>
        </Comment>
        {step >= 4 ? (
          <Comment as={COMMENT_ELEMENT.LI} author={{ name: "Sam Reyes" }} at={NOW} now={NOW}>
            <Text>{QUESTION.REPLY}</Text>
          </Comment>
        ) : null}
      </ol>
      <ComposerFrame>
        <div className="ui-landing-ask">
          {picked ? (
            <ChoiceList
              legend="Options"
              options={QUESTION.OPTIONS}
              value={[QUESTION.PICK]}
              settled
              pickedNote="Your pick"
            />
          ) : (
            <ChoiceList
              legend="Options"
              options={QUESTION.OPTIONS}
              value={[]}
              select={CHOICE_SELECT.ONE}
              look={CHOICE_LOOK.MARKED}
              numbered
              onChange={still}
            />
          )}
        </div>
      </ComposerFrame>
      {step >= 5 ? (
        <NoteLine look={NOTE_LINE_LOOK.INSET}>
          <span className="ui-landing-working">
            <WorkingMark />
            <Shimmer>{`${QUESTION.AGENT} is working…`}</Shimmer>
          </span>
        </NoteLine>
      ) : null}
    </div>
  );
}

/** The Inbox's screen at `step`: the list, a question arriving, opened, picked, answered, and the agent back at work. */
function InboxScreen({ step }: { step: number }): React.JSX.Element {
  const open = step >= 2;
  const question: InboxItem = {
    id: "question",
    task: QUESTION.TASK,
    status: TASK_STATUS.IN_PROGRESS,
    title: QUESTION.TITLE,
    line: step >= 3 ? "Both (recommended)" : "The member who sent it / Any admin / Both",
    kind: step >= 3 ? LINE.SETTLED : LINE.DECIDE,
    ago: 1,
    unread: !open,
    current: open,
  };
  const items = step >= 1 ? [question, ...OTHER_ITEMS] : OTHER_ITEMS;
  return (
    <div className="ui-landing-app">
      <Sidebar current="inbox" tasks={MY_TASKS} />
      <div className="ui-landing-main ui-landing-inbox">
        <nav className="ui-landing-inbox-list" aria-label="Inbox">
          <Toolbar
            title="Inbox"
            end={TOOLBAR_INSET.COLUMN}
            actions={
              <IconButton icon={<SlidersHorizontalIcon />} label="View options" onClick={still} />
            }
          />
          <div className="ui-landing-sheet-start">
            <search className="ui-landing-search">
              <SearchField
                label="Search inbox"
                placeholder="Search inbox"
                value=""
                onChange={still}
              />
            </search>
            <div className="ui-landing-rows">
              <List label="Inbox items">
                {items.map((item) => (
                  <InboxRow key={item.id} item={item} />
                ))}
              </List>
            </div>
          </div>
        </nav>
        <section className="ui-landing-inbox-thread">
          <Toolbar
            start={TOOLBAR_INSET.COLUMN}
            title={open ? <ThreadPath /> : undefined}
            actions={open ? <MoreButton thing="thread" onClick={still} /> : undefined}
          />
          <div className="ui-landing-sheet-end">
            {open ? (
              <QuestionThread step={step} />
            ) : (
              <div className="ui-landing-empty">
                <Text tone={TEXT_TONE.MUTED}>Choose an item</Text>
              </div>
            )}
          </div>
        </section>
      </div>
    </div>
  );
}

function InboxScene(): React.JSX.Element {
  const [ref, step] = useStory(6, BEAT.INBOX);
  return (
    <div ref={ref} className="ui-landing-scene">
      <LandingWindow label="The Inbox, where an agent's question is answered">
        <InboxScreen step={step} />
      </LandingWindow>
    </div>
  );
}

/** One line of an agent's log: what it did, the agent or task it did it to, and what it said. */
function CallLine({
  icon,
  verb,
  to,
  glyph,
  words,
}: {
  icon: ReactNode;
  verb: string;
  to: string;
  glyph: ReactNode;
  words?: string;
}): React.JSX.Element {
  return (
    <div className="ui-landing-call ui-landing-enter">
      <GlyphSlot size={ICON_SIZE.MEDIUM}>{icon}</GlyphSlot>
      <span className="ui-landing-call-words">
        <span>{verb}</span>
        <InlineRef look={INLINE_REF_LOOK.PILL} glyph={glyph} label={to} hint={false} />
        {words === undefined ? null : <span className="ui-landing-call-subject">{words}</span>}
      </span>
    </div>
  );
}

/** Another agent's message in the log: its name over its words in a bubble. */
function AgentMessage({ sender, words }: { sender: string; words: string }): React.JSX.Element {
  return (
    <MessageFrame className="ui-landing-message ui-landing-enter">
      <MessageHead sender={sender} />
      <div className="ui-landing-bubble">
        <Text>{words}</Text>
      </div>
    </MessageFrame>
  );
}

const ACCEPT_PAGE = "Accept page";
const INVITE_EMAILS = "Invite emails";

function AgentsScene(): React.JSX.Element {
  const [ref, step] = useStory(7, BEAT.AGENTS);
  const agentGlyph = <HarnessMark provider={MODEL_PROVIDER.ANTHROPIC} />;
  const subTask = (from: number, to: number): TaskStatus =>
    step >= to ? TASK_STATUS.DONE : step >= from ? TASK_STATUS.IN_PROGRESS : TASK_STATUS.TODO;
  const subTasks = [
    { id: "schema", name: "Pending memberships schema", status: TASK_STATUS.DONE, key: "ACME-54" },
    {
      id: "endpoints",
      name: "Invite and accept endpoints",
      status: TASK_STATUS.DONE,
      key: "ACME-55",
    },
    { id: "accept", name: ACCEPT_PAGE, status: subTask(1, 5), key: "ACME-56" },
    { id: "emails", name: "Invite emails through Postmark", status: subTask(0, 6), key: "ACME-57" },
  ] as const;
  return (
    <div ref={ref} className="ui-landing-scene">
      <LandingWindow label="An agent's log, as it starts another agent and they message each other">
        <div className="ui-landing-app">
          <Sidebar current="task" tasks={MY_TASKS} openTask="invites" />
          <div className="ui-landing-main ui-landing-agent">
            <section className="ui-landing-agent-log">
              <Toolbar
                title={INVITE_EMAILS}
                actions={<MoreButton thing="agent" onClick={still} />}
              />
              <div className="ui-landing-sheet-start ui-landing-log">
                <MessageFrame>
                  <Text>
                    The emails need the accept page's route before they can link to it, so I'll
                    start an agent on the page and wire the emails meanwhile.
                  </Text>
                </MessageFrame>
                {step >= 1 ? (
                  <CallLine
                    icon={<PlusIcon />}
                    verb="Started an agent"
                    to={ACCEPT_PAGE}
                    glyph={agentGlyph}
                  />
                ) : null}
                {step >= 2 ? (
                  <AgentMessage
                    sender={ACCEPT_PAGE}
                    words="The token column is in, and the page is at /invites/:token."
                  />
                ) : null}
                {step >= 3 ? (
                  <CallLine
                    icon={<SendIcon />}
                    verb="Messaged"
                    to={ACCEPT_PAGE}
                    glyph={agentGlyph}
                    words="Linking the email there now."
                  />
                ) : null}
                {step >= 5 ? (
                  <AgentMessage sender={ACCEPT_PAGE} words="#216 is ready for review." />
                ) : null}
                {step >= 6 ? (
                  <CallLine
                    icon={<ListTodoIcon />}
                    verb="Moved"
                    to="Invite emails through Postmark"
                    glyph={<TaskStatusMark status={TASK_STATUS.DONE} />}
                    words="to Done"
                  />
                ) : (
                  <NoteLine look={NOTE_LINE_LOOK.INSET}>
                    <Shimmer>Working…</Shimmer>
                  </NoteLine>
                )}
              </div>
            </section>
            <aside className="ui-landing-side">
              <GroupHeader
                label="Sub-tasks"
                count={{ value: subTasks.length, noun: "sub-tasks" }}
              />
              <List label="Sub-tasks" density={LIST_DENSITY.DENSE}>
                {subTasks.map((task) => (
                  <ListRow
                    key={task.id}
                    motionKey={task.id}
                    density={LIST_DENSITY.DENSE}
                    leading={<TaskStatusMark status={task.status} />}
                    title={task.name}
                    meta={task.key}
                    onPress={still}
                  />
                ))}
              </List>
            </aside>
          </div>
        </div>
      </LandingWindow>
    </div>
  );
}

/** An automation's run: when it started, and whether it is still at work or what it opened. */
type Run = { readonly id: number; readonly ago: number; readonly opened: string };

const RUNS: readonly Run[] = [
  { id: 231, ago: 60 * 24, opened: "Opened #231 Quarantine the billing export timeout" },
  { id: 228, ago: 60 * 48, opened: "Opened #228 Retry the usage alert webhook once" },
  { id: 224, ago: 60 * 72, opened: "Nothing flaky found" },
];

function AutomationsScene(): React.JSX.Element {
  const [ref, step] = useStory(5, BEAT.RUNS);
  const latest: Run = {
    id: 236,
    ago: 0,
    opened: "Opened #236 Wait for the invite email in the accept test",
  };
  const runs = step >= 1 ? [latest, ...RUNS] : RUNS;
  return (
    <div ref={ref} className="ui-landing-scene">
      <div className="ui-landing-sheet ui-landing-automation" inert>
        <Toolbar
          lead={<GlyphSlot size={ICON_SIZE.MEDIUM}>{<GLYPH.AUTOMATION />}</GlyphSlot>}
          title="Nightly flaky-test sweep"
          actions={<MoreButton thing="automation" onClick={still} />}
        />
        <div className="ui-landing-automation-body">
          <div className="ui-landing-automation-settings">
            <GroupHeader heading={GROUP_HEADING.NONE} label="Trigger" />
            <Facts>
              <Fact label="Type">Schedule</Fact>
              <Fact label="Repeats">Weekdays</Fact>
              <Fact label="Time">2:00 AM</Fact>
              <Fact label="Time zone">Europe/London</Fact>
            </Facts>
            <GroupHeader heading={GROUP_HEADING.NONE} label="Agent" />
            <Facts>
              <Fact label="Repository">acme/relay</Fact>
              <Fact label="Model">Claude Opus 5.5 · High</Fact>
            </Facts>
          </div>
          <div className="ui-landing-automation-runs">
            <GroupHeader heading={GROUP_HEADING.NONE} label="Runs" />
            <List label="Runs" density={LIST_DENSITY.COMPACT}>
              {runs.map((run) => {
                const working = run.id === latest.id && step < 3;
                return (
                  <ListRow
                    key={run.id}
                    motionKey={String(run.id)}
                    density={LIST_DENSITY.COMPACT}
                    leading={
                      <TaskStatusMark
                        status={working ? TASK_STATUS.IN_PROGRESS : TASK_STATUS.DONE}
                      />
                    }
                    title="Scheduled run"
                    description={working ? <Shimmer>Working…</Shimmer> : run.opened}
                    meta={<Time at={NOW - run.ago * MINUTE} now={NOW} hint={false} />}
                    onPress={still}
                  />
                );
              })}
            </List>
          </div>
        </div>
      </div>
    </div>
  );
}

/** The question's thread as a phone draws it: the path in its bar over the thread. */
function PhoneThread(): React.JSX.Element {
  return (
    <div className="ui-landing-phone-app">
      <Toolbar start={TOOLBAR_INSET.COLUMN} title={<ThreadPath />} />
      <div className="ui-landing-phone-body">
        <QuestionThread step={2} />
      </div>
    </div>
  );
}

function DevicesScene(): React.JSX.Element {
  return (
    <div className="ui-landing-scene ui-landing-devices">
      <div className="ui-landing-devices-window">
        <LandingWindow label="The Inbox in the Mac app">
          <InboxScreen step={2} />
        </LandingWindow>
      </div>
      <div className="ui-landing-devices-phone">
        <LandingPhone label="The same question on a phone">
          <PhoneThread />
        </LandingPhone>
      </div>
    </div>
  );
}

/** An agent at work on the harness and model it was started on, and the step of the story it finishes at. */
type ModelAgent = {
  readonly id: string;
  readonly name: string;
  readonly mark: ReactNode;
  readonly model: string;
  readonly done: number;
};

const MODEL_AGENTS: readonly ModelAgent[] = [
  {
    id: "emails",
    name: INVITE_EMAILS,
    mark: <HarnessMark provider={MODEL_PROVIDER.ANTHROPIC} />,
    model: "Claude Code · Opus 5.5 · High",
    done: 3,
  },
  {
    id: "accept",
    name: ACCEPT_PAGE,
    mark: <ProviderMark provider={MARK_PROVIDER.CHATGPT} />,
    model: "Codex · GPT-6.1 Sol · Medium",
    done: 4,
  },
  {
    id: "review",
    name: "Review #229",
    mark: <HarnessMark provider={MODEL_PROVIDER.ANTHROPIC} />,
    model: "Claude Code · Sonnet 5.5 · Low",
    done: 5,
  },
];

function ModelsScene(): React.JSX.Element {
  const [ref, step] = useStory(7, BEAT.MODELS);
  return (
    <div ref={ref} className="ui-landing-scene ui-landing-models">
      <List label="Agents" variant={LIST_VARIANT.CARD}>
        {MODEL_AGENTS.map((agent) => (
          <ListRow
            key={agent.id}
            motionKey={agent.id}
            leading={agent.mark}
            title={agent.name}
            description={agent.model}
            meta={
              step >= agent.done ? (
                <span className="ui-landing-row-marks">
                  <TaskStatusMark status={TASK_STATUS.DONE} />
                  Done
                </span>
              ) : (
                <span className="ui-landing-row-marks">
                  <WorkingMark />
                  <Shimmer>Working</Shimmer>
                </span>
              )
            }
            onPress={still}
          />
        ))}
      </List>
    </div>
  );
}

const SCENES: Readonly<Record<LandingScene, () => React.JSX.Element>> = {
  [LANDING_SCENE.INBOX]: InboxScene,
  [LANDING_SCENE.AGENTS]: AgentsScene,
  [LANDING_SCENE.AUTOMATIONS]: AutomationsScene,
  [LANDING_SCENE.DEVICES]: DevicesScene,
  [LANDING_SCENE.MODELS]: ModelsScene,
};

/** The scene that shows `scene`'s feature. */
export function LandingSceneView({ scene }: { scene: LandingScene }): React.JSX.Element {
  const Scene = SCENES[scene];
  return <Scene />;
}
