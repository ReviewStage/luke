import { AUTOMATION_TRIGGER } from "@repo/features/automation-wire";
import { MODEL_PROVIDER } from "@repo/features/models-wire";
import { TASK_STATUS, type TaskStatus } from "@repo/features/task-wire";
import type { ReactNode } from "react";
import { ComposeIcon, MicrophoneIcon, PlayIcon, PlusIcon, SidebarIcon } from "../../face/glyphs.js";
import {
  CheckIcon,
  EllipsisIcon,
  GLYPH,
  ICON_SIZE,
  InboxIcon,
  ListTodoIcon,
  SendIcon,
  SlidersHorizontalIcon,
  SquareCheckIcon,
  ZapIcon,
} from "../../icons/icons.js";
import { FiringGlyph } from "../../marks/firing-glyph.js";
import { HarnessMark } from "../../marks/harness-mark.js";
import { MARK_PROVIDER, ProviderMark } from "../../marks/provider-mark.js";
import { TaskStatusMark } from "../../marks/task-marks.js";
import { STATUS_TONE } from "../../status-tone.js";
import { PROFILE, THEME, surfaceAttributes } from "../../tokens/surface.js";
import { AttentionMark } from "../attention-mark/attention-mark.js";
import { AVATAR_SHAPE, AVATAR_SIZE, Avatar } from "../avatar/avatar.js";
import { Badge } from "../badge/badge.js";
import { BarItem } from "../bar-item/bar-item.js";
import { Breadcrumbs } from "../breadcrumbs/breadcrumbs.js";
import { BUTTON_SIZE, BUTTON_VARIANT, Button, IconButton } from "../button/button.js";
import { Checkbox } from "../checkbox/checkbox.js";
import { CHIP_LOOK, CHIP_WIDTH, Chip, ChipName } from "../chip/chip.js";
import { CountParts, linesCount } from "../choice/count-part.js";
import { CHOICE_LOOK, CHOICE_SELECT, ChoiceList } from "../choice-list/choice-list.js";
import { Comment, type CommentAuthor } from "../comment/comment.js";
import { ComposerBody } from "../composer-frame/composer-body.js";
import { ComposerFoot } from "../composer-frame/composer-foot.js";
import { ComposerFrame } from "../composer-frame/composer-frame.js";
import { Disclosure, DisclosureBody, DisclosureSummary } from "../disclosure/disclosure.js";
import { FoldingButton } from "../folding-button/folding-button.js";
import { GlyphSlot } from "../glyph-slot/glyph-slot.js";
import { GROUP_HEADING, GroupHeader } from "../group-header/group-header.js";
import { INLINE_REF_LOOK, InlineRef } from "../inline-ref/inline-ref.js";
import { LineRow } from "../line-button/line-button.js";
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
import { NOTE_LINE_LOOK, NoteLine } from "../note-line/note-line.js";
import { PROGRESS_COUNT_LOOK, ProgressCount } from "../progress-ring/progress-ring.js";
import { SearchField } from "../search-field/search-field.js";
import { SettingsRow } from "../settings-row/settings-row.js";
import { SETTINGS_SECTION_FRAME, SettingsSection } from "../settings-section/settings-section.js";
import { Shimmer } from "../shimmer/shimmer.js";
import { Switch } from "../switch/switch.js";
import { TABS_GROUND, Tab, Tabs } from "../tabs/tabs.js";
import { TEXT_ELEMENT, TEXT_TONE, Text } from "../text/text.js";
import { TEXT_VARIANT } from "../text/text-role.js";
import { TEXT_AREA_LOOK, TextArea } from "../text-field/text-field.js";
import { TIME_LOOK, Time } from "../time/time.js";
import { Toolbar } from "../toolbar/toolbar.js";
import { TOOLBAR_INSET, TOOLBAR_LOOK } from "../toolbar/toolbar-frame.js";
import { UnreadMark } from "../unread-mark/unread-mark.js";
import { WorkingMark } from "../working-mark/working-mark.js";
import {
  agentFace,
  DESKTOP_PLACE,
  DesktopSidebar,
  MEMBER,
  SidePanelToggle,
} from "./landing-desktop.js";
import { LandingPhone, LandingWindow } from "./landing-devices.js";
import { MINUTE, STORY_NOW, still, useStory } from "./landing-story.js";

/**
 * landing-scenes.tsx -- the landing's moving screens: the app's own components, composed as the panel composes them, stepping through a short story each.
 *
 * Every scene is drawn from `@repo/ui`'s parts in the panel's own
 * arrangement, at the profile the screen stands for: a Mac window draws at
 * the desktop's, the phone at the site's on a phone. The Inbox answers an
 * agent's question in the draft under it; a task's page shows its agent's
 * log, folded calls and all, starting another agent and trading messages
 * with it, the plan's sub-tasks beside it; an automation's page fires a run;
 * the phone holds the same Inbox; and three agents run on the models they
 * were started on. None is pressed: each plays its story on a clock that
 * runs only while it is on screen (`landing-story.ts`).
 */

/** How long each scene holds a step, in milliseconds. */
const BEAT = { INBOX: 1900, AGENTS: 1800, RUNS: 1700, MODELS: 1500 } as const;

/** The scenes the landing plays, by the feature each shows. */
export const LANDING_SCENE = {
  INBOX: "inbox",
  AGENTS: "agents",
  AUTOMATIONS: "automations",
  DEVICES: "devices",
  MODELS: "models",
} as const;

export type LandingScene = (typeof LANDING_SCENE)[keyof typeof LANDING_SCENE];

/** The Mac app's own surface, which a window's screen is drawn at. */
const DESKTOP_SURFACE = surfaceAttributes(PROFILE.DESKTOP, THEME.DARK);

/** An agent as a comment's writer: its name on the square of the harness it runs in. */
function agentAuthor(name: string): CommentAuthor {
  return {
    name,
    shape: AVATAR_SHAPE.SQUARE,
    glyph: <HarnessMark provider={MODEL_PROVIDER.ANTHROPIC} />,
  };
}

/** A pill naming an agent, its face before its name. */
function AgentPill({
  name,
  look = INLINE_REF_LOOK.PILL,
}: {
  name: string;
  look?: (typeof INLINE_REF_LOOK)[keyof typeof INLINE_REF_LOOK];
}): React.JSX.Element {
  return (
    <InlineRef look={look} glyph={agentFace(name, AVATAR_SIZE.INLINE)} label={name} hint={false} />
  );
}

/** The Mac app's window: the desktop's surface holding `children` as the app on show. */
function DesktopWindow({
  label,
  children,
}: {
  label: string;
  children: ReactNode;
}): React.JSX.Element {
  return (
    <LandingWindow label={label}>
      <div className="ui-landing-desktop" {...DESKTOP_SURFACE}>
        {children}
      </div>
    </LandingWindow>
  );
}

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
          {open && item.unread === true ? <AttentionMark /> : null}
          <Time at={STORY_NOW - item.ago * MINUTE} now={STORY_NOW} hint={false} />
        </span>
      }
      metaAt={LIST_ROW_META.TITLE}
      current={item.current === true ? LIST_ROW_CURRENT.PAGE : undefined}
      unread={item.unread === true}
      onPress={still}
    />
  );
}

/** The question the Inbox's story turns on, its options, the one the reader picks, and the note they send with it. */
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
      detail: "Admins can't touch someone else's invite.",
    },
    { value: "admin", label: "Any admin", detail: "Senders wait on an admin to take one back." },
    {
      value: "both",
      label: "Both",
      detail: "The sender, or any admin of the workspace.",
      badge: "Recommended",
    },
  ],
  PICK: "both",
  NOTE: "Log who withdrew it.",
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
    status: TASK_STATUS.IN_PROGRESS,
    title: "The digest's subject line",
    line: "Answered",
    kind: LINE.SETTLED,
    ago: 62,
  },
];

/** The Inbox's items at `step` of the story: the question arriving on top, opened, and settled once answered. */
function inboxItems(step: number): readonly InboxItem[] {
  if (step < 1) return OTHER_ITEMS;
  const answered = step >= 5;
  const question: InboxItem = {
    id: "question",
    task: QUESTION.TASK,
    status: TASK_STATUS.IN_PROGRESS,
    title: QUESTION.TITLE,
    line: answered ? "Both (recommended)" : "The member who sent it / Any admin / Both",
    kind: answered ? LINE.SETTLED : LINE.DECIDE,
    ago: 1,
    unread: step < 2,
    current: step >= 2,
  };
  return [question, ...OTHER_ITEMS];
}

/** The thread's path in its bar: its task, then the agent that asked. */
function ThreadPath(): React.JSX.Element {
  return (
    <Breadcrumbs
      label="Path"
      crumbs={[
        { label: QUESTION.TASK, glyph: <TaskStatusMark status={TASK_STATUS.IN_PROGRESS} /> },
        { label: QUESTION.AGENT, glyph: agentFace(QUESTION.AGENT, AVATAR_SIZE.INLINE) },
      ]}
    />
  );
}

/** The ask's options as the thread holds them, `picked` checked; numbered while they wait on the reader. */
function AskChoices({
  picked,
  readOnly,
}: {
  picked: boolean;
  readOnly: boolean;
}): React.JSX.Element {
  return (
    <ChoiceList
      legend="Options"
      options={QUESTION.OPTIONS}
      value={picked ? [QUESTION.PICK] : []}
      select={CHOICE_SELECT.ONE}
      look={CHOICE_LOOK.MARKED}
      numbered={!readOnly}
      readOnly={readOnly}
      onChange={still}
    />
  );
}

/** A composer's body: its one field, empty but for `placeholder` or holding `words`. */
function ComposerField({
  label,
  placeholder,
  words = "",
}: {
  label: string;
  placeholder: string;
  words?: string | undefined;
}): React.JSX.Element {
  return (
    <ComposerBody>
      <div className="ui-landing-composer-field">
        <TextArea
          label={label}
          value={words}
          placeholder={placeholder}
          look={TEXT_AREA_LOOK.BARE}
          rows={1}
          onChange={still}
        />
      </div>
    </ComposerBody>
  );
}

/** A reply's composer: its field over its foot of attach, dictate, and send. */
function ReplyComposer({
  placeholder,
  words,
  sendable,
  children,
}: {
  placeholder: string;
  words?: string | undefined;
  sendable: boolean;
  children?: ReactNode;
}): React.JSX.Element {
  return (
    <ComposerFrame>
      {children}
      <ComposerField label={placeholder} placeholder={placeholder} words={words} />
      <ComposerFoot
        send={{ label: "Send", empty: !sendable }}
        tools={<IconButton icon={<PlusIcon />} label="Attach files" onClick={still} />}
        actions={<IconButton icon={<MicrophoneIcon />} label="Dictate" onClick={still} />}
      />
    </ComposerFrame>
  );
}

/** The reader's draft under the question: its options in the composer, a note, and the new thread's choice. */
function DraftAnswer({ picked, note }: { picked: boolean; note: string }): React.JSX.Element {
  return (
    <>
      <ReplyComposer placeholder="Add a note" words={note} sendable={picked}>
        <div className="ui-landing-draft-ask">
          <div className="ui-landing-draft-ask-options">
            <AskChoices picked={picked} readOnly={false} />
          </div>
          <IconButton
            icon={<GLYPH.CLOSE />}
            label="Resolve without answering"
            size={BUTTON_SIZE.COMPACT}
            onClick={still}
          />
        </div>
      </ReplyComposer>
      <div className="ui-landing-new-thread">
        <Checkbox checked={false} onChange={still}>
          Send as a new thread to <AgentPill name={QUESTION.AGENT} look={INLINE_REF_LOOK.WASH} />
        </Checkbox>
      </div>
    </>
  );
}

/**
 * The question's thread at `step` of the story: the agent's question over
 * the reader's draft, an option picked, a note written, and the answer sent,
 * a fresh draft waiting under it.
 */
function QuestionThread({ step }: { step: number }): React.JSX.Element {
  const sent = step >= 5;
  return (
    <div className="ui-landing-thread">
      <header className="ui-landing-subject">
        <Text variant={TEXT_VARIANT.DIALOG} as={TEXT_ELEMENT.H2}>
          {QUESTION.TITLE}
        </Text>
      </header>
      <ol className="ui-landing-comments">
        <li className="ui-landing-comment">
          <Comment
            author={agentAuthor(QUESTION.AGENT)}
            at={STORY_NOW - 12 * MINUTE}
            now={STORY_NOW}
          >
            <Text>{QUESTION.WORDS}</Text>
          </Comment>
        </li>
        {sent ? (
          <li className="ui-landing-comment ui-landing-enter">
            <Comment author={{ name: MEMBER }} at={STORY_NOW} now={STORY_NOW}>
              <AskChoices picked readOnly />
              <Text>{QUESTION.NOTE}</Text>
            </Comment>
          </li>
        ) : null}
        <li className="ui-landing-comment">
          <Comment author={{ name: MEMBER }} nameRef="You">
            {sent ? (
              <ReplyComposer placeholder="Reply" sendable={false} />
            ) : (
              <DraftAnswer picked={step >= 3} note={step >= 4 ? QUESTION.NOTE : ""} />
            )}
          </Comment>
        </li>
      </ol>
    </div>
  );
}

/** The Inbox's page at `step`: the list, a question arriving, opened, answered in the draft under it, and sent. */
function InboxPage({ step }: { step: number }): React.JSX.Element {
  const open = step >= 2;
  return (
    <div className="ui-landing-app">
      <DesktopSidebar place={DESKTOP_PLACE.INBOX} />
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
                {inboxItems(step).map((item) => (
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
                <GlyphSlot size={ICON_SIZE.LARGE}>
                  <InboxIcon />
                </GlyphSlot>
                <Text tone={TEXT_TONE.MUTED}>Choose an item</Text>
              </div>
            )}
          </div>
        </section>
      </div>
      <SidePanelToggle />
    </div>
  );
}

function InboxScene(): React.JSX.Element {
  const [ref, step] = useStory(7, BEAT.INBOX);
  return (
    <div ref={ref} className="ui-landing-scene">
      <DesktopWindow label="The Inbox, where an agent's question is answered">
        <InboxPage step={Math.min(step, 5)} />
      </DesktopWindow>
    </div>
  );
}

/** One call in an agent's log: its glyph, what it did, the agent or file it did it to, and what it said. */
function CallRow({
  icon,
  verb,
  to,
  words,
}: {
  icon: ReactNode;
  verb: string;
  to: ReactNode;
  words?: string;
}): React.JSX.Element {
  return (
    <div className="ui-landing-call ui-landing-enter">
      <LineRow>
        <GlyphSlot size={ICON_SIZE.MEDIUM}>{icon}</GlyphSlot>
        <span className="ui-landing-call-words">
          <span className="ui-landing-call-verb">{verb}</span>
          {to}
          {words === undefined ? null : <span className="ui-landing-call-subject">{words}</span>}
        </span>
      </LineRow>
    </div>
  );
}

/** Another agent's message in the log: its name over its words in a bubble. */
function ReceivedMessage({ sender, words }: { sender: string; words: string }): React.JSX.Element {
  return (
    <MessageFrame className="ui-landing-received ui-landing-enter">
      <MessageHead sender={<AgentPill name={sender} look={INLINE_REF_LOOK.WASH} />} />
      <div className="ui-landing-bubble">
        <Text>{words}</Text>
      </div>
    </MessageFrame>
  );
}

const ACCEPT_PAGE = "Accept page";
const INVITE_EMAILS = "Invite emails";

/** A sub-task of the plan beside the log. */
type SubTask = {
  readonly id: string;
  readonly name: string;
  readonly status: TaskStatus;
  readonly key: string;
};

/** The sub-tasks at `step`, each stepping toward done as the story goes. */
function subTasks(step: number): readonly SubTask[] {
  const at = (from: number, to: number): TaskStatus =>
    step >= to ? TASK_STATUS.DONE : step >= from ? TASK_STATUS.IN_PROGRESS : TASK_STATUS.TODO;
  return [
    { id: "schema", name: "Pending memberships schema", status: TASK_STATUS.DONE, key: "ACME-54" },
    {
      id: "endpoints",
      name: "Invite and accept endpoints",
      status: TASK_STATUS.DONE,
      key: "ACME-55",
    },
    { id: "accept", name: ACCEPT_PAGE, status: at(1, 4), key: "ACME-56" },
    { id: "emails", name: "Invite emails through Postmark", status: at(0, 9), key: "ACME-57" },
  ];
}

/** The task's tab strip: the agent on show, the one it started once it has, and the way to open another. */
function TaskTabs({ step }: { step: number }): React.JSX.Element {
  return (
    <span className="ui-landing-tabs">
      <Tabs label="Task" ground={TABS_GROUND.FRAME}>
        <Tab icon={<WorkingMark />} label={INVITE_EMAILS} selected onSelect={still} />
        {step >= 1 ? (
          <Tab
            icon={step >= 4 ? <HarnessMark provider={MODEL_PROVIDER.ANTHROPIC} /> : <WorkingMark />}
            label={ACCEPT_PAGE}
            selected={false}
            onSelect={still}
          />
        ) : null}
      </Tabs>
      <IconButton icon={<PlusIcon />} label="Open a tab" onClick={still} />
    </span>
  );
}

/** The agent's log at `step`: its words, its folded calls, the other agent's messages, and its working line. */
function AgentLog({ step }: { step: number }): React.JSX.Element {
  const calls = step >= 3 ? 3 : step >= 1 ? 2 : 1;
  return (
    <div className="ui-landing-log">
      <MessageFrame>
        <Text>
          The emails link to the accept page, which isn't built yet, so I'll start an agent on the
          page and wire the emails meanwhile.
        </Text>
      </MessageFrame>
      <Disclosure defaultOpen>
        <DisclosureSummary>{calls === 1 ? "1 tool call" : `${calls} tool calls`}</DisclosureSummary>
        <DisclosureBody>
          <CallRow
            icon={<GLYPH.FILE />}
            verb="Read"
            to={<span className="ui-landing-call-subject">plan.md</span>}
          />
          {step >= 1 ? (
            <CallRow
              icon={<PlayIcon />}
              verb="Started an agent"
              to={<AgentPill name={ACCEPT_PAGE} />}
            />
          ) : null}
          {step >= 3 ? (
            <CallRow
              icon={<SendIcon />}
              verb="Messaged"
              to={<AgentPill name={ACCEPT_PAGE} />}
              words="Link the email to /invites/:token."
            />
          ) : null}
        </DisclosureBody>
      </Disclosure>
      {step >= 2 ? (
        <ReceivedMessage
          sender={ACCEPT_PAGE}
          words="The token column is in, and the page is at /invites/:token."
        />
      ) : null}
      {step >= 4 ? (
        <ReceivedMessage sender={ACCEPT_PAGE} words="#216 is ready for review." />
      ) : null}
      <NoteLine look={NOTE_LINE_LOOK.INSET}>
        <span className="ui-landing-working">
          <Shimmer>Working…</Shimmer>
          <Time at={STORY_NOW - 14 * MINUTE} now={STORY_NOW} look={TIME_LOOK.DURATION} />
        </span>
      </NoteLine>
    </div>
  );
}

/** The log's foot at `step`: the pull request once opened, over the composer with the model the agent runs on. */
function AgentFoot({ step }: { step: number }): React.JSX.Element {
  return (
    <div className="ui-landing-agent-foot">
      {step >= 5 ? (
        <div className="ui-landing-dock ui-landing-enter">
          <List label="Pull request" variant={LIST_VARIANT.CARD}>
            <ListRow
              leading={
                <span className="ui-landing-pull-request">
                  <GLYPH.PULL_REQUEST />
                </span>
              }
              title="#217 Invite emails through Postmark"
              meta={
                <span className="ui-landing-row-marks">
                  <CountParts parts={linesCount(184, 12)} />
                </span>
              }
              onPress={still}
            />
          </List>
        </div>
      ) : null}
      <div className="ui-landing-composer">
        <ComposerFrame>
          <ComposerField label="Follow up" placeholder="Send a follow up" />
          <ComposerFoot
            send={{ label: "Send", empty: true }}
            stop={{ label: "Stop", onStop: still }}
            tools={
              <>
                <IconButton icon={<PlusIcon />} label="Attach files" onClick={still} />
                <Badge tone={STATUS_TONE.NEUTRAL} icon={<GLYPH.CLOUD />}>
                  Cloud
                </Badge>
              </>
            }
            actions={
              <>
                <Chip look={CHIP_LOOK.TOOLBAR} chevron onClick={still}>
                  <ChipName>
                    Opus 5.5 <span className="ui-landing-effort">High</span>
                  </ChipName>
                </Chip>
                <IconButton icon={<MicrophoneIcon />} label="Dictate" onClick={still} />
              </>
            }
          />
        </ComposerFrame>
      </div>
    </div>
  );
}

/** The side panel at `step`: the plan's tab, with its sub-tasks and agents. */
function PlanPanel({ step }: { step: number }): React.JSX.Element {
  const tasks = subTasks(step);
  const done = tasks.filter((task) => task.status === TASK_STATUS.DONE).length;
  return (
    <aside className="ui-landing-side">
      <div className="ui-landing-side-bar">
        <Tabs label="Panel" ground={TABS_GROUND.FRAME}>
          <Tab
            icon={<TaskStatusMark status={TASK_STATUS.IN_PROGRESS} />}
            label="Teammate invitations"
            selected
            onSelect={still}
          />
          <Tab icon={<InboxIcon />} label="Inbox" selected={false} onSelect={still} />
        </Tabs>
      </div>
      <div className="ui-landing-side-sheet">
        <GroupHeader
          heading={GROUP_HEADING.NONE}
          glyph={<GLYPH.SUB_TASK />}
          label="Sub-tasks"
          mark={
            <ProgressCount
              done={done}
              total={tasks.length}
              label="sub-tasks done"
              look={PROGRESS_COUNT_LOOK.BADGE}
            />
          }
        />
        <List label="Sub-tasks" density={LIST_DENSITY.DENSE}>
          {tasks.map((task) => (
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
        <GroupHeader
          heading={GROUP_HEADING.NONE}
          glyph={<GLYPH.AGENT />}
          label="Agents"
          count={{ value: step >= 1 ? 2 : 1, noun: "agents" }}
        />
        <List label="Agents" density={LIST_DENSITY.DENSE}>
          <ListRow
            density={LIST_DENSITY.DENSE}
            leading={<WorkingMark />}
            title={INVITE_EMAILS}
            meta="Opus 5.5"
            onPress={still}
          />
          {step >= 1 ? (
            <ListRow
              density={LIST_DENSITY.DENSE}
              leading={step >= 4 ? agentFace(ACCEPT_PAGE, AVATAR_SIZE.ROW) : <WorkingMark />}
              title={ACCEPT_PAGE}
              meta="Sonnet 5.5"
              onPress={still}
            />
          ) : null}
        </List>
      </div>
    </aside>
  );
}

/** The task's page at `step`: its tabs, the agent's log over its foot, and the plan beside it. */
function TaskPage({ step }: { step: number }): React.JSX.Element {
  return (
    <div className="ui-landing-app">
      <DesktopSidebar place={DESKTOP_PLACE.TASK} openTask="invites" />
      <div className="ui-landing-main ui-landing-task">
        <section className="ui-landing-agent-log">
          <Toolbar
            start={TOOLBAR_INSET.COLUMN}
            look={TOOLBAR_LOOK.TABS}
            title={<TaskTabs step={step} />}
            actions={<MoreButton thing="agent" onClick={still} />}
          />
          <div className="ui-landing-sheet-start ui-landing-log-sheet">
            <AgentLog step={step} />
            <AgentFoot step={step} />
          </div>
        </section>
        <PlanPanel step={step} />
      </div>
      <SidePanelToggle />
    </div>
  );
}

function AgentsScene(): React.JSX.Element {
  const [ref, step] = useStory(7, BEAT.AGENTS);
  return (
    <div ref={ref} className="ui-landing-scene">
      <DesktopWindow label="A task's agent starting another agent, and the two trading messages">
        <TaskPage step={Math.min(step, 5)} />
      </DesktopWindow>
    </div>
  );
}

/** An automation's run: when it started, what it was, and how it went. */
type Run = {
  readonly id: string;
  readonly ago: number;
  readonly title: string;
  readonly line: string;
};

const RUNS: readonly Run[] = [
  { id: "231", ago: 60 * 24, title: "Quarantine the billing export test", line: "Finished" },
  { id: "228", ago: 60 * 48, title: "Retry the usage alert webhook once", line: "Finished" },
  { id: "224", ago: 60 * 72, title: "Scheduled run", line: "Nothing flaky found" },
];

/** The automation's trigger: weekdays at 2:00 AM in London. */
const SCHEDULE = {
  kind: AUTOMATION_TRIGGER.SCHEDULE,
  cron: "0 2 * * 1-5",
  timezone: "Europe/London",
} as const;

/** A row's chip in a settings card: a field's chevron over `words`. */
function FieldChip({ children }: { children: ReactNode }): React.JSX.Element {
  return (
    <Chip look={CHIP_LOOK.FIELD} width={CHIP_WIDTH.MIN_FIELD} chevron onClick={still}>
      <ChipName>{children}</ChipName>
    </Chip>
  );
}

/** The automation's toolbar: the way back to Automations, and its state, run, save, switch, and more. */
function AutomationBar(): React.JSX.Element {
  return (
    <div className="ui-landing-automation-bar">
      <Toolbar
        title={
          <span className="ui-landing-crumb">
            <ZapIcon />
            Automations
          </span>
        }
        actions={
          <>
            <Text as={TEXT_ELEMENT.SPAN} variant={TEXT_VARIANT.CAPTION} tone={TEXT_TONE.MUTED}>
              Saved
            </Text>
            <FoldingButton
              label="Run now"
              icon={<PlayIcon />}
              variant={BUTTON_VARIANT.OUTLINE}
              onClick={still}
            />
            <Button variant={BUTTON_VARIANT.PRIMARY} disabled onClick={still}>
              Save
            </Button>
            <Switch checked label="Turn off Nightly flaky-test sweep" onChange={still} />
            <MoreButton thing="Automation" onClick={still} />
          </>
        }
      />
    </div>
  );
}

/** The automation's settings: its title, its trigger, its prompt, and where it runs. */
function AutomationSettings(): React.JSX.Element {
  return (
    <div className="ui-landing-automation-page">
      <div className="ui-landing-automation-title">
        <Avatar
          name="Nightly flaky-test sweep"
          shape={AVATAR_SHAPE.SQUARE}
          size={AVATAR_SIZE.PAGE}
          glyph={<FiringGlyph of={SCHEDULE} />}
          decorative
        />
        <Text variant={TEXT_VARIANT.TITLE} as={TEXT_ELEMENT.H2}>
          Nightly flaky-test sweep
        </Text>
      </div>
      <SettingsSection title="Trigger">
        <SettingsRow label="Type" description="Every weekday at 2:00 AM, Europe/London">
          {() => <FieldChip>Schedule</FieldChip>}
        </SettingsRow>
      </SettingsSection>
      <SettingsSection title="Prompt" frame={SETTINGS_SECTION_FRAME.NONE}>
        <TextArea
          label="Prompt"
          value="Run the suite three times. Quarantine any test that fails once and passes twice, and open a pull request with the fix you'd make."
          rows={3}
          onChange={still}
        />
      </SettingsSection>
      <SettingsSection title="Where it runs">
        <SettingsRow label="Repository">{() => <FieldChip>acme/relay</FieldChip>}</SettingsRow>
        <SettingsRow label="Model">
          {() => (
            <FieldChip>
              Opus 5.5 <span className="ui-landing-effort">High</span>
            </FieldChip>
          )}
        </SettingsRow>
      </SettingsSection>
    </div>
  );
}

/** The automation's runs at `step`: a scheduled run firing, working, and finishing on top of the earlier ones. */
function AutomationRuns({ step }: { step: number }): React.JSX.Element {
  const working = step >= 1 && step < 3;
  const latest: Run = {
    id: "236",
    ago: 0,
    title: step >= 3 ? "Wait for the invite email in the accept test" : "Scheduled run",
    line: "Finished",
  };
  const runs = step >= 1 ? [latest, ...RUNS] : RUNS;
  return (
    <aside className="ui-landing-runs">
      <Text as={TEXT_ELEMENT.H2} variant={TEXT_VARIANT.SECTION} tone={TEXT_TONE.MUTED}>
        Runs
      </Text>
      <List label="Runs">
        {runs.map((run) => {
          const running = run.id === latest.id && working;
          return (
            <ListRow
              key={run.id}
              motionKey={run.id}
              leading={
                <Avatar
                  name={run.title}
                  shape={AVATAR_SHAPE.SQUARE}
                  size={AVATAR_SIZE.ROW}
                  glyph={running ? <WorkingMark /> : <FiringGlyph of={SCHEDULE} />}
                  decorative
                />
              }
              title={run.title}
              description={running ? <Shimmer>Working</Shimmer> : run.line}
              meta={<Time at={STORY_NOW - run.ago * MINUTE} now={STORY_NOW} hint={false} />}
              metaAt={LIST_ROW_META.TITLE}
              onPress={still}
            />
          );
        })}
      </List>
    </aside>
  );
}

/** The automation's page at `step`, its sidebar folded: its toolbar over its settings beside its runs. */
function AutomationPage({ step }: { step: number }): React.JSX.Element {
  return (
    <div className="ui-landing-app ui-landing-app-folded">
      <div className="ui-landing-main ui-landing-automation">
        <AutomationBar />
        <div className="ui-landing-automation-sheet">
          <AutomationSettings />
          <AutomationRuns step={step} />
        </div>
      </div>
      <span className="ui-landing-title-bar-folded">
        <IconButton icon={<SidebarIcon />} label="Show sidebar" onClick={still} />
        <IconButton icon={<ComposeIcon />} label="New task" onClick={still} />
      </span>
      <SidePanelToggle />
    </div>
  );
}

function AutomationsScene(): React.JSX.Element {
  const [ref, step] = useStory(5, BEAT.RUNS);
  return (
    <div ref={ref} className="ui-landing-scene">
      <DesktopWindow label="An automation's page, a scheduled run firing and finishing">
        <AutomationPage step={step} />
      </DesktopWindow>
    </div>
  );
}

/** The Inbox as a phone draws it: its bar, its search, its rows, and the bar of places at its foot. */
function PhoneInbox(): React.JSX.Element {
  return (
    <div className="ui-landing-phone-app">
      <Toolbar
        look={TOOLBAR_LOOK.PHONE}
        folded
        start={TOOLBAR_INSET.COLUMN}
        end={TOOLBAR_INSET.COLUMN}
        lead={<IconButton icon={<ComposeIcon />} label="New task" onClick={still} />}
        title={
          <Text as={TEXT_ELEMENT.H1} variant={TEXT_VARIANT.TOOLBAR_TITLE}>
            Inbox
          </Text>
        }
        actions={<MoreButton thing="Inbox" onClick={still} />}
      />
      <search className="ui-landing-search">
        <SearchField label="Search inbox" placeholder="Search inbox" value="" onChange={still} />
      </search>
      <div className="ui-landing-rows">
        <List label="Inbox items">
          {inboxItems(1).map((item) => (
            <InboxRow key={item.id} item={item} />
          ))}
        </List>
      </div>
      <nav className="ui-landing-phone-places" aria-label="Places">
        <BarItem
          icon={<InboxIcon />}
          current
          count={{ value: 2, noun: "need you" }}
          onPress={still}
        >
          Inbox
        </BarItem>
        <BarItem icon={<ListTodoIcon />} onPress={still}>
          Tasks
        </BarItem>
        <BarItem icon={<EllipsisIcon />} onPress={still}>
          More
        </BarItem>
      </nav>
    </div>
  );
}

function DevicesScene(): React.JSX.Element {
  return (
    <div className="ui-landing-scene ui-landing-devices">
      <div className="ui-landing-devices-window">
        <DesktopWindow label="The Inbox in the Mac app">
          <InboxPage step={2} />
        </DesktopWindow>
      </div>
      <div className="ui-landing-devices-phone">
        <LandingPhone label="The same Inbox on a phone">
          <PhoneInbox />
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
    <div ref={ref} className="ui-landing-scene ui-landing-models" {...DESKTOP_SURFACE}>
      <List label="Agents" variant={LIST_VARIANT.CARD}>
        {MODEL_AGENTS.map((agent) => (
          <ListRow
            key={agent.id}
            motionKey={agent.id}
            leading={
              <Avatar
                name={agent.name}
                shape={AVATAR_SHAPE.SQUARE}
                size={AVATAR_SIZE.ROW}
                glyph={agent.mark}
                decorative
              />
            }
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
