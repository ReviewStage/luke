import {
  AppWindow,
  BookBookmark,
  BookOpen,
  Bot,
  CircleDot,
  CircleSlash,
  Clock,
  File,
  FileDiff,
  Folder,
  FolderGit,
  FolderInput,
  GitBranch,
  GitPullRequest,
  Hash,
  Layers,
  ListTodo,
  PhoneOff,
  Pin,
  PinOff,
  RotateCcw,
  Users,
  Zap,
} from "lucide-react";
import React from "react";

import {
  ArchiveIcon,
  BackIcon,
  BoardIcon,
  CloseIcon,
  CopyIcon,
  DocumentIcon,
  EllipsisIcon,
  ExternalIcon,
  GearIcon,
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
  AGENT: lucideGlyph(Bot),
  PULL_REQUEST: lucideGlyph(GitPullRequest),
  BRANCH: lucideGlyph(GitBranch),
  PULL_REQUEST_STACK: lucideGlyph(Layers),
  PULL_REQUEST_CHANGES: lucideGlyph(FileDiff),
  PULL_REQUEST_CHAPTERS: lucideGlyph(BookBookmark),
  ISSUE: lucideGlyph(CircleDot),
  FILE: lucideGlyph(File),
  FOLDER: lucideGlyph(Folder),
  REPOSITORY: lucideGlyph(FolderGit),
  PAGE: lucideGlyph(AppWindow),
  PLAN: DocumentIcon,
  INBOX: InboxIcon,
  AUTOMATION: lucideGlyph(Zap),
  PERSON: UserIcon,
  PEOPLE: lucideGlyph(Users),
  SKILL: lucideGlyph(BookOpen),
  COMMENT: CommentsIcon,
  CHANNEL: lucideGlyph(Hash),
  TERMINAL: TerminalIcon,
  WHITEBOARD: BoardIcon,
  MEMORY: MemoryIcon,
  MCP_SERVER: McpIcon,
  CALL: WaveformIcon,
  SETTINGS: GearIcon,
  TIME: lucideGlyph(Clock),

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
  OPEN_EXTERNALLY: ExternalIcon,
  OPEN_ON_GITHUB: GitHubMarkGlyph,
} as const;

export type Glyph = (typeof GLYPH)[keyof typeof GLYPH];
