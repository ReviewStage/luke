import type { GitHubRepository } from "@repo/features";
import { AGENT_BOUNDS } from "@repo/features/agent-wire";
import { GITHUB_ACCESS } from "@repo/features/github-repositories-wire";
import { FAILURE_SURFACE } from "@repo/features/shown-failure";
import { TASK_CALL_FAILURE } from "@repo/features/tasks-view";
import { countWords, orList, readingWords } from "@repo/features/words";
import { WORKSPACE_ROLE } from "@repo/features/workspace-wire";
import { EVERY_WORKSPACE } from "@repo/host/app-state";
import { SETTINGS_SECTION, SETTINGS_VIEW, type SettingsLink } from "@repo/settings/settings-views";
import {
  AVATAR_SIZE,
  CHIP_LOOK,
  Chip,
  type ChipLook,
  ChipName,
  type ChipWidth,
  ErrorState,
  MARK_PROVIDER,
  MenuNoteRow,
  type MenuRow,
  NoRepositoryGlyph,
  POPOVER_ALIGN,
  type PopoverAlign,
  ProviderMark,
  RepositoryCard,
  RepositoryPicture,
  repositoryMenuRow,
  SearchableMenu,
  Spinner,
  Tooltip,
} from "@repo/ui";
import { GLYPH } from "@repo/ui/icons";
import { ReplayMask } from "@repo/ui/session-replay-marks";
import { NO_REPOSITORY, repositoryParts } from "@repo/ui/task-list-model";
import { repositoryFailureNote } from "@repo/ui/tasks-model";
import { useDisclosure } from "@repo/ui/use-disclosure";
import { useMutation, useQuery } from "@tanstack/react-query";
import { useEffect, useId, useRef, useState } from "react";
import { failureShown } from "../failure-report.js";
import {
  repositoryListsQuery,
  repositoryListsRetryMutation,
  repositoryScope,
  workspaceMembersQuery,
} from "../live-reads.js";
import { useOpenSettings } from "../open-settings.js";

/**
 * repository-chip.tsx -- the chip that names a task's GitHub repository, and the menu that picks one.
 *
 * Drawn along the composer card's foot for a task about to start, the way a
 * branch or model chip is: the owner's picture and `owner/name`, or the
 * GitHub mark and the pick it is waiting on. In the open plan the same
 * menu drops from the first crumb of the task's path over its title
 * (`task-standing.tsx`, through `useRepositoryMenu`), reading `Choose a
 * repository` while the task has none and the repository once the task
 * names one; ⌘K's Change repository opens its menu from there. Its menu is the shared searchable one: a search over every
 * repository the GitHub connected to the workspace reaches, the
 * repositories the account's tasks were about lately first and the rest as
 * GitHub last saw them change, each under its owner's picture, one the
 * developer's own GitHub token reaches marked Token. Nothing the
 * workspace's GitHub does not reach is offered, so a task never starts on
 * a repository its workspace cannot work in; a pick the read finds out of
 * reach is handed back, and with nothing to offer the chip reads No
 * repository, which a task can start with. An opener that may stand on
 * no repository, as New task and an automation's editor may, is offered No repository
 * pinned under the list, which lets the pick go. With no
 * GitHub connected to the workspace, one GitHub removed or suspended, or
 * one installed that reaches no repository, the list's place holds one
 * GitHub row, as a disconnected server's row in the Integrations menu is
 * drawn (`MenuNoteRow`): an owner or an admin is offered Connect, Reconnect,
 * or Choose repositories at its end, each opening the workspace's GitHub
 * repositories in Settings, the one place they are set, and a member is
 * told there which owners and admins, by name, to ask. The list is held by the host while the chip stands, drawn at once from its
 * last answer, and asked again whenever a window comes forward, so a
 * developer back from connecting GitHub in the browser sees the change on
 * the next opening; nothing polls. Where the opener picks several, as New
 * task does for an agent in the cloud, a press checks or unchecks a row and
 * the menu stands open: the first pick is the primary, marked Primary once
 * another is picked beside it, where
 * the agent starts and its pull requests open by default, and unchecking it
 * makes the next pick the primary, unless the opener holds it, as a
 * sub-task's card holds its parent's, its row then checked and disabled
 * saying why; the chip names the picks, the first two
 * and then the rest counted, under the first's owner picture; and once a
 * primary is picked, each row the service would refuse beside it
 * (`start.ts`'s `extraRepositoriesOf`) is dimmed, saying why, so it is
 * known before the Start rather than refused by it. The menu
 * is placed as a Settings picker's is, below the chip or above it where the
 * window leaves more room there, its list capped to that room. A one-pick
 * menu closes on a choice, and every menu on Escape and on focus leaving
 * it; Escape stops there, so it closes the menu and not the panel behind it.
 */

/** What the chip's menu offers, read from the account's tasks and the service. */
export interface RepositoryChooser {
  /** The repositories the account's tasks were about lately, the newest first, each once. */
  recent: readonly string[];
  /** Whether those tasks are still being read, so the newest's repository, a card's default, is not yet known; never where left out. */
  reading?: boolean | undefined;
  /** Opens a page of GitHub's in the browser, such as a repository's own. */
  openGitHub: (url: string) => void;
  /** Whether a repository is drawn with its owner's picture: not in a fixture run (`RepositoryPicture`). */
  pictures: boolean;
  /** The workspace the list is for, where one is chosen, whose repositories the host holds for the chip (`LIVE_READ.REPOSITORY_LISTS`); every workspace's where none is. */
  scope?: string | undefined;
  /** Whether the account manages that workspace, so can connect its GitHub; a member is told to ask. */
  manages: boolean;
  /**
   * Whether the workspace has a GitHub connected, as its row last said: a read
   * that then finds none installed means GitHub removed or suspended it, which
   * the row offers Reconnect for rather than Connect, whether or not the row
   * has heard yet.
   */
  connected?: boolean | undefined;
}

/** Where the chip stands, which is how it is sized. */
export const CHIP_PLACE = {
  COMPOSER: "composer",
  /** A form row's value, or the plan's chip row, as a Settings picker's chip is drawn. */
  FIELD: "field",
} as const;

export type ChipPlace = (typeof CHIP_PLACE)[keyof typeof CHIP_PLACE];

/** The chip's look in each place: the composer's pill, or a form row's field. */
const PLACE_LOOK = {
  [CHIP_PLACE.COMPOSER]: CHIP_LOOK.PILL,
  [CHIP_PLACE.FIELD]: CHIP_LOOK.FIELD,
} as const satisfies Record<ChipPlace, ChipLook>;

/** The chip's words while it waits on a pick. */
export const CHOOSE_LABEL = "Choose a repository";

/** The chip's words while what its default is read from, the tasks or the repositories, is still being read, which ask nothing yet. */
const READING_LABEL = "Repository";

/** How many repositories a chip naming several names before it counts the rest. */
const NAMED_PICKS = 2;

/**
 * Why a row cannot stand beside the primary, as the service would refuse
 * it, in the few words the dimmed row ends with: reached only on the
 * member's own token, the primary itself reached so, on another
 * installation of the App than the primary's, or past the bound a Start
 * holds its extras to.
 */
const EXTRA_REFUSED = {
  TOKEN: "Token only",
  PRIMARY_TOKEN: "Primary on token",
  OTHER_INSTALLATION: "Another installation",
  FULL: "Limit reached",
} as const;

/** The id of the row pinned under the list that chooses no repository. */
const NONE_ROW = "none";

/** What the menu says where the search matches no repository. */
const NO_MATCH = "No repositories match";

/** What the row in the list's place names, where nothing can be picked. */
const GITHUB_LABEL = "GitHub";

/**
 * Each way the list can stand empty for want of GitHub: the press an owner
 * or an admin mends it with, and what a member asks them to do, finishing
 * "Ask … to".
 */
const DEAD_END = {
  NOT_CONNECTED: { action: "Connect", ask: "connect" },
  LAPSED: { action: "Reconnect", ask: "reconnect" },
  NONE_REACHED: { action: "Choose repositories", ask: "choose repositories" },
} as const;

type DeadEnd = (typeof DEAD_END)[keyof typeof DEAD_END];

/** How many owners and admins a member's row names before it counts the rest. */
const NAMED_OWNERS = 3;

/**
 * A member's way out of a dead end: the GitHub row, ending in the
 * workspace's owners and admins by name, who alone can mend it, read while
 * the row stands. Until the read answers, or if it never does, it says an
 * owner or admin without names, since a name is only ever a help.
 */
function AskOwnersRow({
  workspaceId,
  ask,
}: {
  workspaceId: string | undefined;
  ask: DeadEnd["ask"];
}): React.JSX.Element {
  const members = useQuery(workspaceMembersQuery(workspaceId)).data?.members;
  const owners = (members ?? [])
    .filter((each) => each.role === WORKSPACE_ROLE.OWNER || each.role === WORKSPACE_ROLE.ADMIN)
    .map((each) => each.name);
  const named = owners.slice(0, NAMED_OWNERS);
  const rest = owners.length - named.length;
  const others = rest > 0 ? [countWords(rest, { one: "other", many: "others" })] : [];
  const whom = owners.length === 0 ? "an owner or admin" : orList([...named, ...others]);
  return (
    <MenuNoteRow
      glyph={<ProviderMark provider={MARK_PROVIDER.GITHUB} />}
      label={GITHUB_LABEL}
      end={{ words: `Ask ${whom} to ${ask}` }}
    />
  );
}

/** Whether the read's repositories hold one, as GitHub spells it or not. */
function listedIn(reached: readonly GitHubRepository[], repository: string): boolean {
  const wanted = repository.toLowerCase();
  return reached.some((each) => each.fullName.toLowerCase() === wanted);
}

/**
 * The menu's rows: the recent repositories first, then every other the App
 * reaches as the service ordered them, most recently updated first, each
 * once, every one under its owner's picture whether private or not. Once
 * the read has answered, a recent repository it does not list is left out,
 * because a plan started on it would be refused. A row names the repository
 * first and its owner muted after it, since the owner is the part rows most
 * often share, and a narrow menu cuts the end of a row; it is found by its
 * whole `owner/name` all the same.
 */
function repositoryRows(
  recent: readonly string[],
  reached: readonly GitHubRepository[] | undefined,
  pictures: boolean,
  primary: string | undefined,
): MenuRow[] {
  const names =
    reached === undefined ? [...recent] : recent.filter((each) => listedIn(reached, each));
  for (const each of reached ?? []) {
    if (!names.includes(each.fullName)) names.push(each.fullName);
  }
  const onToken = new Set(
    (reached ?? [])
      .filter((each) => each.access === GITHUB_ACCESS.TOKEN)
      .map((each) => each.fullName),
  );
  return names.map((fullName) =>
    repositoryMenuRow(fullName, pictures, {
      token: onToken.has(fullName),
      primary: primary !== undefined && sameName(fullName, primary),
    }),
  );
}

/** Whether two `owner/name`s name one repository, as GitHub spells it or not. */
function sameName(one: string, other: string): boolean {
  return one.toLowerCase() === other.toLowerCase();
}

/**
 * Why a repository the listing names could not stand beside the primary,
 * where the listing can tell: none where it cannot. Note that an App
 * installation is on one account and reaches only that account's
 * repositories, so one owned by another account than the primary's is on
 * another installation, which `repositorySetReach` refuses.
 */
function extraRefusal(
  row: GitHubRepository | undefined,
  primary: GitHubRepository | undefined,
  extras: number,
): string | undefined {
  if (extras >= AGENT_BOUNDS.MAX_ALSO_REPOSITORIES) return EXTRA_REFUSED.FULL;
  if (row?.access === GITHUB_ACCESS.TOKEN) return EXTRA_REFUSED.TOKEN;
  if (primary?.access === GITHUB_ACCESS.TOKEN) return EXTRA_REFUSED.PRIMARY_TOKEN;
  if (row !== undefined && primary !== undefined && !sameName(row.owner, primary.owner)) {
    return EXTRA_REFUSED.OTHER_INSTALLATION;
  }
  return undefined;
}

/**
 * The words a chip names the repositories picked with, in pick order: one
 * by its whole `owner/name`, as a chip setting one repository names it, and
 * several by their names, the first two and then the rest counted
 * ("vespin, meerkat +1").
 */
export function pickedRepositoriesWords(picked: readonly string[]): string {
  if (picked.length === 1) return picked[0] ?? "";
  const named = picked.slice(0, NAMED_PICKS).map((each) => repositoryParts(each).name);
  const more = picked.length - named.length;
  return more > 0 ? `${named.join(", ")} +${more}` : named.join(", ");
}

/** The repositories a chip picks several of beside its one, and the press that checks or unchecks one. */
export interface SeveralPicks {
  /** The repositories picked after `value`, in pick order. */
  readonly also: readonly string[];
  /** Hears a press on a row, which checks it where it stands unchecked and unchecks it where it stands checked. */
  readonly onToggle: (repository: string) => void;
  /** Why the primary is held, its row drawn checked and disabled with these words, so it is neither unchecked nor replaced; none where it may be. */
  readonly held?: string | undefined;
}

/** What the repository's menu is handed, whatever opens it: the chip, or the plan's repository crumb. */
interface RepositoryMenuProps {
  /** The repository named now, `owner/name`, or null while none is. */
  value: string | null;
  chooser: RepositoryChooser;
  onChoose: (repository: string) => void;
  /** Lets the pick go, offered as No repository pinned under the list, where the opener may stand on none, as a new task or an automation's runs may; a null value then reads No repository. */
  onClear?: (() => void) | undefined;
  /** Lets go of a pick the read finds the workspace's GitHub does not reach, where the pick is the opener's own to drop. */
  onUnreached?: (() => void) | undefined;
  /** Whether a null value is a default still waiting on the read rather than No repository picked, so it reads as waiting while the read could still name one. */
  pending?: boolean | undefined;
  /** Hears the repositories each successful read lists, `owner/name`. */
  onListed?: ((repositories: readonly string[]) => void) | undefined;
  /** Counts the asks from elsewhere to open the menu, each opening it. */
  openRequest?: number | undefined;
  /** Hears each ask the menu opened for, so the asker can let it go. */
  onAsked?: ((request: number) => void) | undefined;
  /** The edge of its room the menu hangs from, the trailing one where none is named. */
  align?: PopoverAlign | undefined;
  /** The repositories the menu leaves out, in any case, as an opener that adds one leaves out those it holds; none where left out. */
  omit?: readonly string[] | undefined;
  /** Whether the menu offers only what the workspace's GitHub App reaches, leaving out what the developer's own token alone reaches, as a repository added to a running agent must be; every reached one where left out. */
  appOnly?: boolean | undefined;
  /** Several picks rather than one, `value` the primary and these after it, each row checked and a press leaving the menu open; one pick, which closes it, where left out. */
  several?: SeveralPicks | undefined;
}

/**
 * The repository's menu as its opener draws it: whether it stands open, the
 * opener's words and mark, the card it hangs while shut, the press that
 * opens and shuts it from the element pressed, the room the menu hangs in,
 * which the opener's box holds as the menu's anchor, and the menu itself,
 * drawn in that room.
 */
export interface RepositoryMenu {
  readonly open: boolean;
  readonly menuId: string;
  /** The opener's words: the repository, the repositories picked, or the pick it waits on. */
  readonly label: string;
  /** What the opener's hint names: every repository picked, whole; none while none is. */
  readonly hint: string | undefined;
  /** The owner's picture, or the repository's glyph while none is named. */
  readonly glyph: React.JSX.Element;
  /** The repository's card, none while none is named, several are, or the menu stands open. */
  readonly card: React.ReactNode;
  readonly press: (opener: HTMLElement) => void;
  readonly room: React.RefObject<HTMLDivElement | null>;
  readonly menu: React.ReactNode;
}

/** The repository's menu, read and placed as the chip's always was, for whatever opener draws it (`RepositoryMenu`). */
export function useRepositoryMenu(props: RepositoryMenuProps): RepositoryMenu {
  const { chooser, openRequest, onAsked, onUnreached, onListed, onClear, value } = props;
  const openSettings = useOpenSettings();
  const [open, setOpen] = useState(false);
  const drawn = useDisclosure(open);
  // Note that the host asks the list again as a window comes forward, which is how a developer returns from installing the App in the browser.
  const scope = chooser.scope ?? EVERY_WORKSPACE;
  const list = useQuery(repositoryListsQuery(scope));
  const retry = useMutation(repositoryListsRetryMutation());
  const menuId = useId();
  const room = useRef<HTMLDivElement>(null);
  /** What held focus as the menu opened, which closing hands it back to. */
  const opener = useRef<HTMLElement | null>(null);
  // Each ask from elsewhere, ⌘K's Change repository, opens the menu once, and is answered.
  const answered = useRef<number | undefined>(undefined);
  useEffect(() => {
    if (openRequest === undefined || openRequest === 0 || openRequest === answered.current) return;
    answered.current = openRequest;
    opener.current = document.activeElement instanceof HTMLElement ? document.activeElement : null;
    setOpen(true);
    onAsked?.(openRequest);
  }, [openRequest, onAsked]);

  // Note that we hand focus back to where it came from, the opener or the task
  // menu's button, as a native menu returns it to its trigger, because
  // closing takes the focused field away with it.
  const close = () => {
    setOpen(false);
    opener.current?.focus();
  };
  const choose = (pick: () => void) => {
    close();
    pick();
  };

  const listed = list.data;
  const failure = list.isError ? TASK_CALL_FAILURE.UNANSWERED : undefined;
  // A pick the read does not list is handed back, so nothing out of reach stands chosen.
  const unreached = value !== null && listed !== undefined && !listedIn(listed.repositories, value);
  useEffect(() => {
    if (unreached) onUnreached?.();
  }, [unreached, onUnreached]);
  useEffect(() => {
    if (listed !== undefined) onListed?.(listed.repositories.map((each) => each.fullName));
  }, [listed, onListed]);
  // A GitHub not connected, or reaching nothing, is mended at the workspace's GitHub row.
  const workspaceGitHub: SettingsLink = {
    page: SETTINGS_VIEW.WORKSPACE,
    section: SETTINGS_SECTION.GITHUB_REPOSITORIES,
    ...(chooser.scope === undefined ? undefined : { workspaceId: chooser.scope }),
  };
  const press = (from: HTMLElement) => {
    opener.current = from;
    setOpen(!open);
  };
  const omitted = new Set((props.omit ?? []).map((each) => each.toLowerCase()));
  const reached =
    props.appOnly === true
      ? listed?.repositories.filter((each) => each.access === GITHUB_ACCESS.APP)
      : listed?.repositories;
  // Note that an App-only menu offers no recent repository before the read says how each is reached.
  const recent = props.appOnly === true && reached === undefined ? [] : chooser.recent;
  const { several } = props;
  const picked = value === null ? [] : [value, ...(several?.also ?? [])];
  const isPicked = (name: string) => picked.some((each) => sameName(each, name));
  const listing = (name: string) => reached?.find((each) => sameName(each.fullName, name));
  const primary = several === undefined || value === null ? undefined : value;
  // Note that the primary is marked only beside another pick, since a lone pick is simply the task's.
  const rows = repositoryRows(
    recent,
    reached,
    chooser.pictures,
    picked.length > 1 ? primary : undefined,
  )
    .filter((row) => !omitted.has(row.id.toLowerCase()))
    .map((row) => {
      // Once a primary is picked, a row the service would refuse beside it says why before the pick.
      const why =
        primary === undefined
          ? undefined
          : sameName(row.id, primary)
            ? several?.held
            : isPicked(row.id)
              ? undefined
              : extraRefusal(listing(row.id), listing(primary), picked.length - 1);
      return why === undefined ? row : { ...row, disabled: why };
    });
  // Note that no repository is a choice of its own where the opener lets one go, so it is not said as a pick still owed.
  const nothingReached = rows.length === 0 && listed !== undefined;
  const none = nothingReached || (onClear !== undefined && props.pending !== true);
  const label =
    (value === null ? undefined : pickedRepositoriesWords(picked)) ??
    (none
      ? NO_REPOSITORY
      : chooser.reading === true || props.pending === true
        ? READING_LABEL
        : CHOOSE_LABEL);
  // A list with nothing to pick is mended at the workspace's GitHub, by an owner or an admin, whom a member is told to ask.
  const deadEnd = (way: DeadEnd) =>
    chooser.manages ? (
      <MenuNoteRow
        glyph={<ProviderMark provider={MARK_PROVIDER.GITHUB} />}
        label={GITHUB_LABEL}
        end={{ action: way.action, onClick: () => choose(() => openSettings(workspaceGitHub)) }}
      />
    ) : (
      <AskOwnersRow workspaceId={chooser.scope} ask={way.ask} />
    );
  const note =
    failure !== undefined ? (
      <ErrorState
        failure={failureShown({ surface: FAILURE_SURFACE.REPOSITORIES_READ, cause: failure })}
        onRetry={() => retry.mutate(repositoryScope(scope))}
      >
        {repositoryFailureNote(failure)}
      </ErrorState>
    ) : listed !== undefined && !listed.installed && listed.repositories.length === 0 ? (
      // Note that a workspace whose row says GitHub is connected, yet whose read finds none installed, had it removed or suspended on GitHub.
      deadEnd(chooser.connected === true ? DEAD_END.LAPSED : DEAD_END.NOT_CONNECTED)
    ) : listed === undefined ? (
      <Spinner delay label={readingWords("repositories")} />
    ) : rows.length === 0 && listed?.installed ? (
      // Installed but giving us nothing: the repositories are chosen on GitHub, through the workspace's row.
      deadEnd(DEAD_END.NONE_REACHED)
    ) : undefined;

  return {
    open,
    menuId,
    label,
    hint: value === null ? undefined : picked.join(", "),
    glyph:
      value === null ? (
        none ? (
          <NoRepositoryGlyph />
        ) : (
          <GLYPH.REPOSITORY />
        )
      ) : (
        <RepositoryPicture
          repository={value}
          pictures={chooser.pictures}
          size={AVATAR_SIZE.GLYPH}
        />
      ),
    card:
      value === null || picked.length > 1 || open ? undefined : (
        <RepositoryCard repository={value} pictures={chooser.pictures} />
      ),
    press,
    room,
    menu: drawn.mounted ? (
      <SearchableMenu
        leaving={drawn.leaving}
        ref={drawn.ref}
        id={menuId}
        label="Repository"
        placeholder="Search repositories"
        // Note that every row names a repository and its owner, so each stays masked, and the note, which can name the workspace, is left unmarked.
        replayUnmasked
        rows={rows.map((row) => ({ ...row, replayMasked: true }))}
        value={several === undefined ? (value ?? undefined) : undefined}
        // Note that a pick is checked on its row as the row spells it, which a preset may spell in another case.
        checked={
          several === undefined
            ? undefined
            : new Set(rows.filter((row) => isPicked(row.id)).map((row) => row.id))
        }
        note={note}
        noMatch={NO_MATCH}
        align={props.align ?? POPOVER_ALIGN.END}
        onPick={(repository) =>
          several === undefined
            ? choose(() => props.onChoose(repository))
            : several.onToggle(repository)
        }
        foot={
          onClear === undefined
            ? undefined
            : [
                {
                  id: NONE_ROW,
                  label: NO_REPOSITORY,
                  icon: <NoRepositoryGlyph />,
                  onPress: () => choose(onClear),
                },
              ]
        }
        onClose={close}
        onLeave={(left) => {
          if (!(left instanceof Node && room.current?.contains(left))) setOpen(false);
        }}
      />
    ) : null,
  };
}

export function RepositoryChip(
  props: RepositoryMenuProps & {
    place: ChipPlace;
    /** A form row's chip: how wide it stands, its words' own width where none is named. */
    width?: ChipWidth | undefined;
    /** A form row's chip: the ids of the row's words that describe it, its error among them while it has one. */
    describedBy?: string | undefined;
    /** A form row's chip: whether the row says its value is refused. */
    invalid?: true | undefined;
    /** Why the repository is held to `value` and takes no pick, said on hover; none where it may be changed. */
    held?: string | undefined;
  },
): React.JSX.Element {
  const menu = useRepositoryMenu(props);
  return (
    <div className="repository-chip relative min-w-0" data-place={props.place} ref={menu.room}>
      <RepositoryMenuChip
        place={props.place}
        width={props.width}
        describedBy={props.describedBy}
        invalid={props.invalid}
        held={props.held}
        open={menu.open}
        menuId={menu.menuId}
        hint={menu.hint}
        card={menu.card}
        glyph={menu.glyph}
        label={menu.label}
        named={props.value !== null}
        onPress={menu.press}
      />
      {menu.menu}
    </div>
  );
}

/**
 * The chip a repository's menu drops from, in its place's look: the first
 * pick's owner picture, or the glyph standing for none, and its words,
 * masked in a screen recording where they name a repository; a press opens
 * and shuts the menu from it, and its hint names every pick while the menu
 * is shut. Note that a held chip is `aria-disabled` rather than disabled,
 * because a disabled button hears no pointer, and its hint says why.
 */
export function RepositoryMenuChip(props: {
  place: ChipPlace;
  /** A form row's chip: how wide it stands, its words' own width where none is named. */
  width?: ChipWidth | undefined;
  /** A form row's chip: the ids of the row's words that describe it. */
  describedBy?: string | undefined;
  /** A form row's chip: whether the row says its value is refused. */
  invalid?: true | undefined;
  /** Why the chip takes no pick, said on hover; none where it may be changed. */
  held?: string | undefined;
  open: boolean;
  menuId: string;
  /** What the hint names while the menu is shut: every pick, whole. */
  hint?: string | undefined;
  /** The card hung while the pointer rests on the chip. */
  card?: React.ReactNode;
  glyph: React.JSX.Element;
  label: string;
  /** Whether the words name a repository rather than the pick waited on. */
  named: boolean;
  onPress: (opener: HTMLElement) => void;
}): React.JSX.Element {
  const { held } = props;
  return (
    <Tooltip
      label={held ?? (props.open ? undefined : props.hint)}
      card={held === undefined ? props.card : undefined}
    >
      <Chip
        look={PLACE_LOOK[props.place]}
        width={props.width}
        chevron={props.place === CHIP_PLACE.FIELD}
        aria-describedby={props.describedBy}
        aria-invalid={props.invalid}
        aria-disabled={held === undefined ? undefined : true}
        aria-haspopup="dialog"
        aria-expanded={props.open}
        aria-controls={props.open ? props.menuId : undefined}
        onClick={(event) => {
          if (held === undefined) props.onPress(event.currentTarget);
        }}
      >
        {props.glyph}
        <ChipName>{props.named ? <ReplayMask>{props.label}</ReplayMask> : props.label}</ChipName>
      </Chip>
    </Tooltip>
  );
}
