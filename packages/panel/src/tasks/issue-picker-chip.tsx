import { useAtom } from "@effect/atom-react";
import { type GitHubIssuePick, isOutsideAuthor } from "@luke/features/github-repositories-wire";
import { INTEGRATION_PROVIDER } from "@luke/features/integration-wire";
import type { LinearIssueSummary } from "@luke/features/linear-wire";
import { TASK_BOUNDS } from "@luke/features/task-wire";
import { sinceText } from "@luke/features/time-format";
import { readFailedWords, readingWords } from "@luke/features/words";
import { SHORTCUT_KEY, type ShortcutChord, shortcutAria } from "@luke/settings/shortcuts";
import {
  Badge,
  CHIP_LOOK,
  CHIP_WIDTH,
  Chip,
  ChipName,
  ErrorState,
  type MenuRow,
  POPOVER_ALIGN,
  POPOVER_WIDTH,
  type PopoverAlign,
  ProviderMark,
  SearchableMenu,
  Spinner,
  STATUS_TONE,
  TEXT_ELEMENT,
  TEXT_VARIANT,
  Text,
  Tooltip,
  useMinute,
} from "@luke/ui";
import { type LinearIssuesAsk, linearIssuesAskOf, offeredIssues } from "@luke/ui/tasks-model";
import { useDisclosure } from "@luke/ui/use-disclosure";
import { Duration, Effect } from "effect";
import * as AsyncResult from "effect/reactivity/AsyncResult";
import { CircleDotIcon, ExternalLinkIcon, ListTodoIcon, PlusIcon } from "lucide-react";
import { useEffect, useId, useRef, useState } from "react";
import { appPlatform } from "../app-platform.js";
import { rendererRuntime } from "../renderer-runtime.js";
import {
  GITHUB_ISSUES_STANDING,
  type GitHubIssuesStanding,
  useGitHubIssues,
} from "./github-issues-read.js";
import type { TasksControl } from "./use-tasks-tab.js";

/**
 * issue-picker-chip.tsx -- New task's Issue chip: a press away from one search over the chosen repository's GitHub issues and, where it has Linear connected, its Linear issues.
 *
 * Where the workspace has GitHub connected, the menu lists first, under
 * "GitHub · owner/name", the issues of the repository chosen in the head
 * row (`github-issues-read.ts`): its open issues, what GitHub finds for the
 * words once the typing rests, or the one issue `#N`, `owner/name#N`, or a
 * link to its page names, of another repository too, which picking it
 * makes the task's. Each is its title, then its number, who opened it, and
 * how long ago it changed, with an "outside" badge where GitHub names its
 * author neither the repository's owner, a member, nor a collaborator, since
 * an agent that can push reads its words. An installation that has not
 * granted the App issues says so in the section's one row, which opens the
 * installation's settings on GitHub, and Linear's rows stand beside it as
 * ever. With no repository chosen and no key pasted that finds one, the
 * section is not drawn. An issue the card already links, and every issue
 * once the card links as many as a task may, stands dimmed and says why.
 *
 * Drawn where the workspace the task starts in offers either, as an issue
 * glyph, "Issue", and a chevron, the chip opens the app's one searchable
 * menu, hung from its leading edge, or its trailing edge where it ends its
 * row as at the right of the New task dialog's head (`align`), and placed as
 * a Settings picker's is. The menu lists Linear's issues under "Linear"
 * where GitHub's section stands beside them, and under no heading
 * otherwise. With nothing typed in the menu's field it lists every Linear
 * issue read as the card opened, newest changed first; as soon as anything
 * is typed, those whose title or key holds every word stand nearest first,
 * and once the typing rests Linear itself is searched for the words, so a
 * Linear issue older than those read is found too; a Linear key typed whole
 * or a link to a Linear issue pasted asks Linear for that one issue
 * instead. ↑ and ↓ move the highlight, Return
 * chooses the highlighted issue, and Escape closes the menu, not the card,
 * handing focus back to what opened it: the chip, or the field whose ⌘L
 * asked for it (`openRequest`). The issues are read as the chip first
 * stands and again for another workspace, which closes the menu. Nothing
 * typed in the menu's field names the task; choosing an issue is the
 * owner's to act on.
 *
 * A task's page opens the same menu from the end of its row of linked
 * issues (`task-issue-links.tsx`), drawn as a quiet chip that names what it
 * does (`trigger`) in the issue chip's place, over the task's own repository, the
 * issues the task links standing dimmed as linked.
 */

/** The chord that opens the menu from the card's own field. */
export const ISSUE_CHORD: ShortcutChord = { key: SHORTCUT_KEY.L };

/** What the chip and its menu say. */
const ISSUE_WORDS = {
  CHIP: "Issue",
  LABEL: "Choose an issue",
  MENU: "Issues",
  LINEAR: "Linear",
  GITHUB: "GitHub",
  SEARCH: "Search issues, or paste a key, #number, or link",
  NONE: "No issues found",
  GITHUB_NONE: "No open issues match",
  OUTSIDE: "outside",
  OUTSIDE_HINT: "Opened by someone outside the repository",
  GRANT_DETAIL: "Grant access",
  LINKED: "Linked",
  FULL: `At most ${TASK_BOUNDS.MAX_ISSUES} issues`,
} as const;

/** What each source's failure says it could not read. */
const ISSUE_READ = {
  GITHUB: "GitHub's issues",
  LINEAR: "Linear's issues",
} as const;

/** The GitHub section's heading, for the repository it lists. */
function githubSection(repository: string): string {
  return `${ISSUE_WORDS.GITHUB} · ${repository}`;
}

/** The grant row's words, for the repository whose issues cannot be read. */
function grantLabel(repository: string): string {
  return `Luke cannot read ${repository}'s issues yet`;
}

/** The ids of the GitHub section's rows that are no issue. */
const GITHUB_ROW = {
  GRANT: "github-grant",
  NONE: "github-none",
} as const;

/**
 * A GitHub row's detail: the outside badge where its author is outside the
 * repository, then its number, author, and age, or the grant row's words and
 * the mark that says they leave for GitHub, all but the words held whole.
 */
const GITHUB_DETAIL =
  "issue-picker-github-detail inline-flex min-w-0 max-w-full items-center gap-item-gap [&>:not(.issue-picker-github-said)]:flex-none [&>svg]:size-luke-12";

/** How long the typing rests before Linear is searched for the words as typed. */
const SEARCH_PAUSE = Duration.millis(250);

/** What the Linear read of the workspace's issues stands as: the issues, none while they are read or where the workspace offers none, whether the read is still out, and whether it was refused. */
interface LinearIssuesRead<Issue> {
  readonly issues: readonly Issue[];
  readonly reading: boolean;
  readonly failed: boolean;
  /** Reads them again. */
  readonly retry: () => void;
}

/**
 * The Linear issues of the workspace the task starts in, read as the card
 * opens and again for another workspace or when `retry` asks; none while
 * they are read or where the workspace offers none, `reading` until the read
 * answers, and `failed` where it was refused, which is not an empty workspace.
 */
function useIssuesRead<Issue>(
  readIn: (workspaceId: string | undefined) => (() => Promise<readonly Issue[]>) | undefined,
  workspaceId: string | undefined,
): LinearIssuesRead<Issue> {
  const [issues, setIssues] = useState<readonly Issue[]>([]);
  const [failed, setFailed] = useState(false);
  const [answered, setAnswered] = useState(false);
  const [attempts, setAttempts] = useState(0);
  // Note that the reader is held through a ref, because the tab hands a new
  // one on every render and a read is owed to a workspace, not a render.
  const latest = useRef(readIn);
  latest.current = readIn;
  const connected = readIn(workspaceId) !== undefined;
  useEffect(() => {
    setIssues([]);
    setFailed(false);
    setAnswered(false);
    const reading = connected ? latest.current(workspaceId) : undefined;
    if (reading === undefined) return;
    let current = true;
    reading().then(
      (listed) => {
        if (!current) return;
        setIssues(listed);
        setAnswered(true);
      },
      () => {
        if (!current) return;
        setFailed(true);
        setAnswered(true);
      },
    );
    return () => {
      current = false;
    };
    // Note that `attempts` is no value the read uses, only each Retry's ask to read again.
  }, [connected, workspaceId, attempts]);
  return {
    issues,
    reading: connected && !answered,
    failed,
    retry: () => setAttempts((count) => count + 1),
  };
}

/** One search of a workspace's Linear for the words as typed, and the read that asks it. */
interface IssueSearch {
  readonly workspaceId: string | undefined;
  readonly typed: string;
  readonly ask: LinearIssuesAsk;
  readonly read: (ask: LinearIssuesAsk) => Promise<readonly LinearIssueSummary[]>;
}

/** What one search found or that it failed, and the workspace and the words it was for. */
interface IssueSearchAnswer {
  readonly workspaceId: string | undefined;
  readonly typed: string;
  readonly issues: readonly LinearIssueSummary[];
  /** Whether the search was refused, which is not a search that found nothing. */
  readonly failed: boolean;
}

/**
 * A search once the typing has rested, as an atom whose work is the wait and
 * then the read: setting it again starts the wait over and lets go of the
 * read still out, so only the newest words are answered. A refused read
 * answers `failed`, with no issues.
 */
const issueSearchAtom = () =>
  rendererRuntime.fn((search: IssueSearch) =>
    Effect.gen(function* () {
      yield* Effect.sleep(SEARCH_PAUSE);
      const found = yield* Effect.tryPromise(() => search.read(search.ask)).pipe(
        Effect.orElseSucceed(() => undefined),
      );
      return {
        workspaceId: search.workspaceId,
        typed: search.typed,
        issues: found ?? [],
        failed: found === undefined,
      };
    }),
  );

/**
 * Linear searched for the words as typed in the workspace given, once the
 * typing rests: the last answer, whichever words and workspace it was for,
 * and the search to ask as the words or the workspace change.
 */
function useLinearSearch(
  readIn: TasksControl["newTask"]["linearIssuesIn"],
): readonly [
  IssueSearchAnswer | undefined,
  (typed: string, workspaceId: string | undefined) => void,
] {
  const [atom] = useState(issueSearchAtom);
  const [answer, search] = useAtom(atom);
  const ask = (typed: string, workspaceId: string | undefined) => {
    const read = readIn(workspaceId);
    const asked = linearIssuesAskOf(typed);
    if (read === undefined || asked === undefined) return;
    search({ workspaceId, typed: typed.trim(), ask: asked, read });
  };
  return [AsyncResult.isSuccess(answer) ? answer.value : undefined, ask];
}

/**
 * The issues the menu lists for the words typed so far: every issue read
 * while nothing is typed; else those read that hold the words and what
 * Linear found for them, nearest first. What Linear found for the words as
 * they now stand is offered whatever it holds; what it found for earlier
 * words stands with the issues read, offered only where it holds the words,
 * until the newer search answers.
 */
function listedIssues(
  issues: readonly LinearIssueSummary[],
  searched: IssueSearchAnswer | undefined,
  workspaceId: string | undefined,
  typed: string,
): readonly LinearIssueSummary[] {
  if (typed.trim() === "") return issues;
  const answered = searched?.workspaceId === workspaceId ? searched : undefined;
  const current = answered !== undefined && answered.typed === typed.trim();
  const found = current ? answered.issues : [];
  const known = current || answered === undefined ? issues : [...issues, ...answered.issues];
  return offeredIssues(known, typed, found);
}

/** One Linear issue as a row: its title, then its key and the state it stands in, under Linear's heading where one is drawn. */
function linearRow(
  issue: LinearIssueSummary,
  section: string | undefined,
  disabled: string | undefined,
): MenuRow {
  return {
    id: issue.id,
    label: issue.title,
    icon: <ProviderMark provider={INTEGRATION_PROVIDER.LINEAR} />,
    detail: issue.state === undefined ? issue.identifier : `${issue.identifier} · ${issue.state}`,
    section,
    disabled,
  };
}

/** Why an issue cannot be picked now: the card links it already, or links as many as a task may. */
function unpickable(linked: boolean, full: boolean): string | undefined {
  if (linked) return ISSUE_WORDS.LINKED;
  return full ? ISSUE_WORDS.FULL : undefined;
}

/** One GitHub issue as a row: its title, then its number, who opened it, how long ago it changed, and whether they are outside the repository. */
function githubRow(
  issue: GitHubIssuePick,
  section: string,
  now: number,
  disabled: string | undefined,
): MenuRow {
  const said = [`#${issue.number}`, issue.author, sinceText(issue.updatedAt, now)]
    .filter((each) => each !== undefined)
    .join(" · ");
  return {
    id: issue.nodeId,
    label: issue.title,
    icon: <CircleDotIcon className="issue-picker-github-open text-complete" />,
    detail: isOutsideAuthor(issue.authorAssociation) ? (
      <span className={GITHUB_DETAIL}>
        <Tooltip label={ISSUE_WORDS.OUTSIDE_HINT}>
          <span>
            <Badge tone={STATUS_TONE.ATTENTION}>{ISSUE_WORDS.OUTSIDE}</Badge>
          </span>
        </Tooltip>
        <Text
          as={TEXT_ELEMENT.SPAN}
          variant={TEXT_VARIANT.INHERIT}
          truncate
          className="issue-picker-github-said"
        >
          {said}
        </Text>
      </span>
    ) : (
      said
    ),
    section,
    disabled,
  };
}

/** The GitHub section's rows: its issues, the one row saying none match, or the one row that grants Luke them. */
function githubRows(
  standing: GitHubIssuesStanding,
  now: number,
  pickable: (issue: GitHubIssuePick) => string | undefined,
): readonly MenuRow[] {
  if (
    standing.kind === GITHUB_ISSUES_STANDING.NONE ||
    standing.kind === GITHUB_ISSUES_STANDING.READING ||
    standing.kind === GITHUB_ISSUES_STANDING.FAILED
  ) {
    return [];
  }
  const section = githubSection(standing.repository);
  if (standing.kind === GITHUB_ISSUES_STANDING.UNGRANTED) {
    return [
      {
        id: GITHUB_ROW.GRANT,
        label: grantLabel(standing.repository),
        icon: <ProviderMark provider={INTEGRATION_PROVIDER.GITHUB} />,
        detail: (
          <span className={GITHUB_DETAIL}>
            {ISSUE_WORDS.GRANT_DETAIL}
            <ExternalLinkIcon />
          </span>
        ),
        section,
      },
    ];
  }
  if (standing.issues.length === 0) {
    return [{ id: GITHUB_ROW.NONE, label: ISSUE_WORDS.GITHUB_NONE, section, disabled: "" }];
  }
  return standing.issues.map((issue) => githubRow(issue, section, now, pickable(issue)));
}

export function IssuePickerChip({
  linearIn,
  githubIn,
  workspaceId,
  repository,
  linked,
  full,
  disabled,
  openRequest,
  align = POPOVER_ALIGN.START,
  trigger,
  onChoose,
  onChooseGitHub,
}: {
  /** The read of a workspace's Linear issues, none where it has no Linear connected (`TasksControl`'s). */
  linearIn: TasksControl["newTask"]["linearIssuesIn"];
  /** The read of a repository's GitHub issues, none where the workspace has no GitHub connected (`TasksControl`'s). */
  githubIn: TasksControl["newTask"]["githubIssuesIn"];
  /** The repository chosen in the head row, whose GitHub issues are listed; none where none is. */
  repository: string | null;
  /** The provider ids of the issues the card links already: a Linear issue's id, a GitHub issue's node id. */
  linked: ReadonlySet<string>;
  /** Whether the card links as many issues as a task may, so no more is offered. */
  full: boolean;
  /** The workspace the task starts in, whose issues are listed. */
  workspaceId: string | undefined;
  disabled: boolean;
  /** Counts the asks from elsewhere to open the menu, such as the field's ⌘L, each opening it. */
  openRequest?: number | undefined;
  /** Which of the chip's edges its menu hangs from: the leading one, or the trailing one where the chip ends its row. */
  align?: PopoverAlign | undefined;
  /** The words of a quiet chip drawn in the issue chip's place, as a task page's "Link issue"; the issue chip where none are given. */
  trigger?: string | undefined;
  onChoose: (issue: LinearIssueSummary) => void;
  onChooseGitHub: (issue: GitHubIssuePick) => void;
}): React.JSX.Element | null {
  const linear = linearIn(workspaceId) !== undefined;
  const github = githubIn(workspaceId) !== undefined;
  const connected = linear || github;
  const now = useMinute();
  const linearRead = useIssuesRead(linearIn, workspaceId);
  const [searched, searchLinear] = useLinearSearch(linearIn);
  const [typed, setTyped] = useState("");
  // How many times the menu has opened, each of which reads the repository's issues afresh.
  const [openings, setOpenings] = useState(0);
  const [githubStanding, searchGitHub] = useGitHubIssues(
    githubIn,
    workspaceId,
    repository,
    typed,
    openings,
  );
  const [open, setOpen] = useState(false);
  const drawn = useDisclosure(open);
  const menuId = useId();
  const box = useRef<HTMLDivElement>(null);
  const button = useRef<HTMLButtonElement>(null);
  /** What held focus as the menu opened, which closing hands it back to. */
  const opener = useRef<HTMLElement | null>(null);
  // A switch of workspace closes the menu, in the render that brings it,
  // since what it listed and what was typed in it were the other's.
  const [listedFor, setListedFor] = useState(workspaceId);
  if (listedFor !== workspaceId) {
    setListedFor(workspaceId);
    setOpen(false);
    setTyped("");
  }
  // Every source of issues let go while the menu stood closes it too, so
  // one coming back draws nothing until the chip is pressed again.
  if (!connected && open) {
    setOpen(false);
    setTyped("");
  }

  // Note that whether the menu stands is read through a ref, because an ask
  // is owed to its count alone and one made while it stands changes nothing.
  const standing = useRef(open);
  standing.current = open;

  // Each ask from elsewhere opens the menu afresh.
  useEffect(() => {
    if (openRequest === undefined || openRequest === 0 || standing.current) return;
    opener.current = document.activeElement instanceof HTMLElement ? document.activeElement : null;
    setTyped("");
    setOpen(true);
    setOpenings((count) => count + 1);
  }, [openRequest]);

  if (!connected) return null;

  const listed = linear ? listedIssues(linearRead.issues, searched, workspaceId, typed) : [];
  // Note that a search answered for the words as they stand says whether Linear could be read for them, and else the read of the list does.
  const searchedNow =
    searched !== undefined &&
    typed.trim() !== "" &&
    searched.workspaceId === workspaceId &&
    searched.typed === typed.trim();
  const linearFailed = linear && (searchedNow ? searched.failed : linearRead.failed);
  const retryLinear = () => {
    linearRead.retry();
    searchLinear(typed, workspaceId);
  };
  const retryGitHub = () => {
    setOpenings(openings + 1);
    searchGitHub(typed);
  };
  const githubListed =
    githubStanding.kind === GITHUB_ISSUES_STANDING.LISTED ? githubStanding.issues : [];
  // Note that GitHub's section always stands under its heading, and Linear's only where GitHub's stands beside it.
  const headed =
    linear &&
    githubStanding.kind !== GITHUB_ISSUES_STANDING.NONE &&
    githubStanding.kind !== GITHUB_ISSUES_STANDING.READING &&
    githubStanding.kind !== GITHUB_ISSUES_STANDING.FAILED;
  const reading = githubStanding.kind === GITHUB_ISSUES_STANDING.READING || linearRead.reading;
  const rows = [
    ...githubRows(githubStanding, now, (issue) => unpickable(linked.has(issue.nodeId), full)),
    ...listed.map((issue) =>
      linearRow(
        issue,
        headed ? ISSUE_WORDS.LINEAR : undefined,
        unpickable(linked.has(issue.id), full),
      ),
    ),
  ];
  // Note that we hand focus back to where it came from, the chip or the
  // field, as a native menu returns it to its trigger, because closing takes
  // the focused search away with it.
  const close = () => {
    setOpen(false);
    opener.current?.focus();
  };
  const press = () => {
    opener.current = button.current;
    setTyped("");
    if (!open) setOpenings(openings + 1);
    setOpen(!open);
  };

  return (
    <div className="issue-picker-chip relative min-w-0" ref={box}>
      {trigger !== undefined ? (
        <Chip
          ref={button}
          look={CHIP_LOOK.TOOLBAR}
          aria-haspopup="dialog"
          aria-expanded={open}
          aria-controls={open ? menuId : undefined}
          disabled={disabled}
          onClick={press}
        >
          <PlusIcon />
          <ChipName>{trigger}</ChipName>
        </Chip>
      ) : (
        <Tooltip label={ISSUE_WORDS.LABEL} chord={ISSUE_CHORD}>
          <Chip
            ref={button}
            look={CHIP_LOOK.FIELD}
            width={CHIP_WIDTH.AUTO}
            chevron
            aria-label={ISSUE_WORDS.LABEL}
            aria-keyshortcuts={shortcutAria(ISSUE_CHORD)}
            aria-haspopup="dialog"
            aria-expanded={open}
            aria-controls={open ? menuId : undefined}
            disabled={disabled}
            onClick={press}
          >
            <ListTodoIcon />
            <ChipName>{ISSUE_WORDS.CHIP}</ChipName>
          </Chip>
        </Tooltip>
      )}
      {drawn.mounted ? (
        <SearchableMenu
          leaving={drawn.leaving}
          ref={drawn.ref}
          id={menuId}
          label={ISSUE_WORDS.MENU}
          placeholder={ISSUE_WORDS.SEARCH}
          rows={rows}
          value={undefined}
          note={
            reading || githubStanding.kind === GITHUB_ISSUES_STANDING.FAILED || linearFailed ? (
              <>
                {reading ? <Spinner delay label={readingWords("issues")} /> : null}
                {githubStanding.kind === GITHUB_ISSUES_STANDING.FAILED ? (
                  <ErrorState onRetry={retryGitHub}>
                    {readFailedWords(ISSUE_READ.GITHUB)}
                  </ErrorState>
                ) : null}
                {linearFailed ? (
                  <ErrorState onRetry={retryLinear}>
                    {readFailedWords(ISSUE_READ.LINEAR)}
                  </ErrorState>
                ) : null}
              </>
            ) : undefined
          }
          noMatch={ISSUE_WORDS.NONE}
          align={align}
          width={POPOVER_WIDTH.WIDE}
          onSearch={(words) => {
            setTyped(words);
            searchLinear(words, workspaceId);
            searchGitHub(words);
          }}
          onPick={(id) => {
            const issue = listed.find((each) => each.id === id);
            const githubIssue = githubListed.find((each) => each.nodeId === id);
            close();
            if (
              githubStanding.kind === GITHUB_ISSUES_STANDING.UNGRANTED &&
              id === GITHUB_ROW.GRANT
            ) {
              appPlatform().openGitHub(githubStanding.settingsUrl);
            } else if (githubIssue !== undefined) onChooseGitHub(githubIssue);
            else if (issue !== undefined) onChoose(issue);
          }}
          onClose={close}
          onLeave={(left) => {
            if (!(left instanceof Node && box.current?.contains(left))) setOpen(false);
          }}
        />
      ) : null}
    </div>
  );
}
