import {
  AppWindow,
  BookBookmark,
  BookOpen,
  Bot,
  CircleDashed,
  CircleDot,
  CircleDotDashed,
  CircleSlash,
  ClipboardCheck,
  Clock,
  Cloud,
  CornerDownRight,
  File,
  FileDiff,
  FilePenLine,
  Folder,
  FolderGit,
  FolderInput,
  FolderKanban,
  GitBranch,
  GitPullRequest,
  Globe,
  GripVertical,
  Hash,
  Layers,
  ListChecks,
  ListEnd,
  ListTodo,
  ListTree,
  MessageSquareHeart,
  MessagesSquare,
  PhoneOff,
  Pin,
  PinOff,
  RotateCcw,
  Server,
  Split,
  Unplug,
  Users,
  Zap,
} from "lucide-react";
import React from "react";

import {
  ArchiveIcon,
  BackIcon,
  CloseIcon,
  CopyIcon,
  DocumentIcon,
  EllipsisIcon,
  ExternalIcon,
  GearIcon,
  LaptopIcon,
  MarkDoneIcon,
  McpIcon,
  MemoryIcon,
  PencilIcon,
  PlusIcon,
  SearchIcon,
  StopIcon,
  TerminalIcon,
  TrashIcon,
  UnarchiveIcon,
  UserIcon,
} from "../face/glyphs.js";
import { MARK_PROVIDER, ProviderMark } from "../marks/provider-mark.js";
import { lucideGlyph } from "./lucide-glyph.js";
import {
  AlertIcon,
  CircleCheckIcon,
  CommentsIcon,
  InboxIcon,
  LinkIcon,
  RetryIcon,
  WaveformIcon,
} from "./lucide-glyphs.js";

// `tsx` executes imported workspace-package JSX with the classic runtime.
void React;

/** The GitHub mark, which is what "Open on GitHub" is drawn with. */
function GitHubMarkGlyph(): React.JSX.Element {
  return <ProviderMark provider={MARK_PROVIDER.GITHUB} />;
}

/**
 * glyph-registry.tsx -- every concept the app draws as an icon, and the one
 * glyph that stands for it.
 *
 * One glyph per meaning and one meaning per glyph: a screen that draws a task
 * asks for `GLYPH.TASK` and never picks a drawing, so a task wears the same
 * mark in the sidebar, a tab, a chip, and a menu. A concept is a thing the
 * app has (a task, an agent, a pull request) or an act a control does (copy,
 * stop, open somewhere else). Where the audit found one thing drawn three
 * ways, the entry here is the winner, and where one drawing meant several
 * things, it keeps the one it is most used for and the others have their
 * own row. A state wears its own glyph (`SETTLED`, `FAILED`, `DISMISSED`), and
 * the glyph a state is drawn with is never a thing's: `CircleDot` is a GitHub
 * issue and nothing else.
 *
 * The values are components that take no props, `glyphs.tsx`'s own or
 * Lucide's behind `lucide-glyph.tsx`, so `GlyphIcon` seats any of them alike.
 * A brand's mark is a glyph here only where a concept is the brand: "Open on
 * GitHub" opens GitHub.
 */
export const GLYPH = {
  // Things the app has.
  TASK: lucideGlyph(ListTodo),
  // A task under another, its parent, wherever sub-tasks are named, counted, or added.
  SUB_TASK: lucideGlyph(ListTree),
  AGENT: lucideGlyph(Bot),
  PULL_REQUEST: lucideGlyph(GitPullRequest),
  BRANCH: lucideGlyph(GitBranch),
  PULL_REQUEST_STACK: lucideGlyph(Layers),
  PULL_REQUEST_CHANGES: lucideGlyph(FileDiff),
  PULL_REQUEST_CHAPTERS: lucideGlyph(BookBookmark),
  // A pull request's CI checks, GitHub's Checks tab and its summary.
  CHECKS: lucideGlyph(ClipboardCheck),
  ISSUE: lucideGlyph(CircleDot),
  // A linked GitHub issue whose provider did not answer, so it says no state: neither open nor closed.
  ISSUE_UNREAD: lucideGlyph(CircleDashed),
  FILE: lucideGlyph(File),
  FOLDER: lucideGlyph(Folder),
  // A section a person keeps tasks in, where it was given no glyph of its own.
  SECTION: lucideGlyph(FolderKanban),
  REPOSITORY: lucideGlyph(FolderGit),
  PAGE: lucideGlyph(AppWindow),
  // A page of the web, outside the app, as a website chip names it.
  WEBSITE: lucideGlyph(Globe),
  PLAN: DocumentIcon,
  // What one version of a plan changed: its changed sections.
  VERSION_CHANGES: lucideGlyph(FilePenLine),
  INBOX: InboxIcon,
  AUTOMATION: lucideGlyph(Zap),
  PERSON: UserIcon,
  PEOPLE: lucideGlyph(Users),
  SKILL: lucideGlyph(BookOpen),
  COMMENT: CommentsIcon,
  CHANNEL: lucideGlyph(Hash),
  // A thread in a channel, the Inbox's item, where no ask of its own says more.
  THREAD: lucideGlyph(MessagesSquare),
  TERMINAL: TerminalIcon,
  MEMORY: MemoryIcon,
  MCP_SERVER: McpIcon,
  CALL: WaveformIcon,
  SETTINGS: GearIcon,
  TIME: lucideGlyph(Clock),
  // Where a task's coding agents run: the cloud, a member's Mac running Luke, or a host they added.
  CLOUD: lucideGlyph(Cloud),
  DESKTOP: LaptopIcon,
  HOST: lucideGlyph(Server),
  // A task's or an item's status as a field: what a filter or a grouping is by.
  STATUS: lucideGlyph(CircleDotDashed),
  // An agent's to-do list, the same ticked list a plan's to-do block wears.
  TODOS: lucideGlyph(ListChecks),
  // An ask that wants a choice among options, the Inbox's "decide".
  DECIDE: lucideGlyph(Split),
  // Word sent back to the makers of Luke, which no comment is.
  FEEDBACK: lucideGlyph(MessageSquareHeart),
  // A message waiting behind an agent's running turn, to open the next one.
  QUEUED: lucideGlyph(ListEnd),

  // States.
  DONE: MarkDoneIcon,
  SETTLED: CircleCheckIcon,
  FAILED: AlertIcon,
  DISMISSED: lucideGlyph(CircleSlash),

  // Acts.
  ADD: PlusIcon,
  CLOSE: CloseIcon,
  MORE: EllipsisIcon,
  SEARCH: SearchIcon,
  RENAME: PencilIcon,
  DELETE: TrashIcon,
  COPY: CopyIcon,
  LINK: LinkIcon,
  STOP: StopIcon,
  END_CALL: lucideGlyph(PhoneOff),
  RETRY: RetryIcon,
  GO_BACK: lucideGlyph(RotateCcw),
  // The way back to the place above, which `BackButton` alone draws.
  BACK: BackIcon,
  PIN: lucideGlyph(Pin),
  UNPIN: lucideGlyph(PinOff),
  ARCHIVE: ArchiveIcon,
  UNARCHIVE: UnarchiveIcon,
  MOVE: lucideGlyph(FolderInput),
  // Ending a connection to a service, which deletes nothing of it.
  DISCONNECT: lucideGlyph(Unplug),
  // A queued message sent into the turn under way now, rather than waiting for it to end.
  STEER: lucideGlyph(CornerDownRight),
  // What a row is dragged by to put it in another place.
  DRAG_HANDLE: lucideGlyph(GripVertical),
  OPEN_EXTERNALLY: ExternalIcon,
  OPEN_ON_GITHUB: GitHubMarkGlyph,
} as const;

export type Glyph = (typeof GLYPH)[keyof typeof GLYPH];
