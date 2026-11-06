import type { GitHubRepository } from "@repo/features";
import { AGENT_BOUNDS } from "@repo/features/agent-wire";
import { GITHUB_ACCESS } from "@repo/features/github-repositories-wire";
import { FAILURE_SURFACE } from "@repo/features/shown-failure";
import { TASK_CALL_FAILURE } from "@repo/features/tasks-view";
import { countWords, orList, readingWords } from "@repo/features/words";
import { WORKSPACE_ROLE, type WorkspaceMember } from "@repo/features/workspace-wire";
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

export interface RepositoryChooser {
  recent: readonly string[];
  reading?: boolean | undefined;
  openGitHub: (url: string) => void;
  pictures: boolean;
  scope?: string | undefined;
  manages: boolean;
  connected?: boolean | undefined;
}

export const CHIP_PLACE = {
  COMPOSER: "composer",
  FIELD: "field",
} as const;

export type ChipPlace = (typeof CHIP_PLACE)[keyof typeof CHIP_PLACE];

const PLACE_LOOK = {
  [CHIP_PLACE.COMPOSER]: CHIP_LOOK.PILL,
  [CHIP_PLACE.FIELD]: CHIP_LOOK.FIELD,
} as const satisfies Record<ChipPlace, ChipLook>;

export const CHOOSE_LABEL = "Choose a repository";

const READING_LABEL = "Repository";

const NAMED_PICKS = 2;

const EXTRA_REFUSED = {
  TOKEN: "Token only",
  PRIMARY_TOKEN: "Primary on token",
  OTHER_INSTALLATION: "Another installation",
  FULL: "Limit reached",
} as const;

const NONE_ROW = "none";

const NO_MATCH = "No repositories match";

const GITHUB_LABEL = "GitHub";

const DEAD_END = {
  NOT_CONNECTED: { action: "Connect", ask: "connect" },
  LAPSED: { action: "Reconnect", ask: "reconnect" },
  NONE_REACHED: { action: "Choose repositories", ask: "choose repositories" },
} as const;

type DeadEnd = (typeof DEAD_END)[keyof typeof DEAD_END];

const NAMED_OWNERS = 3;

export const ANY_OWNER = "an owner or admin";

export function otherOwnersWords(rest: number): string {
  return countWords(rest, { one: "other", many: "others" });
}

export function useOwnersToAsk(workspaceId: string | undefined): {
  readonly named: readonly WorkspaceMember[];
  readonly rest: number;
} {
  const members = useQuery(workspaceMembersQuery(workspaceId)).data?.members;
  const owners = (members ?? []).filter(
    (each) => each.role === WORKSPACE_ROLE.OWNER || each.role === WORKSPACE_ROLE.ADMIN,
  );
  const named = owners.slice(0, NAMED_OWNERS);
  return { named, rest: owners.length - named.length };
}

function AskOwnersRow({
  workspaceId,
  ask,
}: {
  workspaceId: string | undefined;
  ask: DeadEnd["ask"];
}): React.JSX.Element {
  const { named, rest } = useOwnersToAsk(workspaceId);
  const others = rest > 0 ? [otherOwnersWords(rest)] : [];
  const whom =
    named.length === 0 ? ANY_OWNER : orList([...named.map((each) => each.name), ...others]);
  return (
    <MenuNoteRow
      glyph={<ProviderMark provider={MARK_PROVIDER.GITHUB} />}
      label={GITHUB_LABEL}
      end={{ words: `Ask ${whom} to ${ask}` }}
    />
  );
}

function listedIn(reached: readonly GitHubRepository[], repository: string): boolean {
  const wanted = repository.toLowerCase();
  return reached.some((each) => each.fullName.toLowerCase() === wanted);
}

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

function sameName(one: string, other: string): boolean {
  return one.toLowerCase() === other.toLowerCase();
}

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

function pickedRepositoriesWords(picked: readonly string[]): string {
  if (picked.length === 1) return picked[0] ?? "";
  const named = picked.slice(0, NAMED_PICKS).map((each) => repositoryParts(each).name);
  const more = picked.length - named.length;
  return more > 0 ? `${named.join(", ")} +${more}` : named.join(", ");
}

export interface SeveralPicks {
  readonly also: readonly string[];
  readonly onToggle: (repository: string) => void;
  readonly held?: string | undefined;
  readonly standIn?: boolean | undefined;
}

function useMenuPlace() {
  const [open, setOpen] = useState(false);
  const drawn = useDisclosure(open);
  const menuId = useId();
  const room = useRef<HTMLDivElement>(null);
  const opener = useRef<HTMLElement | null>(null);
  return {
    open,
    drawn,
    menuId,
    room,
    ask: () => {
      opener.current =
        document.activeElement instanceof HTMLElement ? document.activeElement : null;
      setOpen(true);
    },
    press: (from: HTMLElement) => {
      opener.current = from;
      setOpen(!open);
    },
    close: () => {
      setOpen(false);
      opener.current?.focus();
    },
    leave: (left: EventTarget | null) => {
      if (!(left instanceof Node && room.current?.contains(left))) setOpen(false);
    },
  };
}

type MenuPlace = ReturnType<typeof useMenuPlace>;

type SearchableMenuProps = React.ComponentProps<typeof SearchableMenu>;

function repositoryMenu(
  place: MenuPlace,
  menu: Pick<SearchableMenuProps, "rows" | "value" | "checked" | "note" | "onPick" | "foot"> & {
    align: PopoverAlign;
  },
): React.ReactNode {
  return place.drawn.mounted ? (
    <SearchableMenu
      {...menu}
      leaving={place.drawn.leaving}
      ref={place.drawn.ref}
      id={place.menuId}
      label={menu.checked === undefined ? "Repository" : "Repositories"}
      placeholder="Search repositories"
      replayUnmasked
      rows={menu.rows.map((row) => ({ ...row, replayMasked: true }))}
      noMatch={NO_MATCH}
      onClose={place.close}
      onLeave={place.leave}
    />
  ) : null;
}

function checkedAmong(rows: readonly MenuRow[], picked: readonly string[]): ReadonlySet<string> {
  return new Set(
    rows.filter((row) => picked.some((each) => sameName(each, row.id))).map((row) => row.id),
  );
}

function firstPicture(repository: string, pictures: boolean): React.JSX.Element {
  return <RepositoryPicture repository={repository} pictures={pictures} size={AVATAR_SIZE.GLYPH} />;
}

interface RepositoryMenuProps {
  value: string | null;
  chooser: RepositoryChooser;
  onChoose: (repository: string) => void;
  onClear?: (() => void) | undefined;
  onUnreached?: (() => void) | undefined;
  pending?: boolean | undefined;
  onListed?: ((repositories: readonly string[]) => void) | undefined;
  openRequest?: number | undefined;
  onAsked?: ((request: number) => void) | undefined;
  align?: PopoverAlign | undefined;
  omit?: readonly string[] | undefined;
  appOnly?: boolean | undefined;
  several?: SeveralPicks | undefined;
}

export interface RepositoryMenu {
  readonly open: boolean;
  readonly menuId: string;
  readonly label: string;
  readonly hint: string | undefined;
  readonly glyph: React.JSX.Element;
  readonly card: React.ReactNode;
  readonly press: (opener: HTMLElement) => void;
  readonly room: React.RefObject<HTMLDivElement | null>;
  readonly menu: React.ReactNode;
}

export function useRepositoryMenu(props: RepositoryMenuProps): RepositoryMenu {
  const { chooser, openRequest, onAsked, onUnreached, onListed, onClear, value } = props;
  const openSettings = useOpenSettings();
  const place = useMenuPlace();
  const scope = chooser.scope ?? EVERY_WORKSPACE;
  const list = useQuery(repositoryListsQuery(scope));
  const retry = useMutation(repositoryListsRetryMutation());
  const answered = useRef<number | undefined>(undefined);
  useEffect(() => {
    if (openRequest === undefined || openRequest === 0 || openRequest === answered.current) return;
    answered.current = openRequest;
    place.ask();
    onAsked?.(openRequest);
  }, [openRequest, onAsked, place.ask]);
  const choose = (pick: () => void) => {
    place.close();
    pick();
  };

  const listed = list.data;
  const failure = list.isError ? TASK_CALL_FAILURE.UNANSWERED : undefined;
  const unreached = value !== null && listed !== undefined && !listedIn(listed.repositories, value);
  useEffect(() => {
    if (unreached) onUnreached?.();
  }, [unreached, onUnreached]);
  useEffect(() => {
    if (listed !== undefined) onListed?.(listed.repositories.map((each) => each.fullName));
  }, [listed, onListed]);
  const workspaceGitHub: SettingsLink = {
    page: SETTINGS_VIEW.WORKSPACE,
    section: SETTINGS_SECTION.GITHUB_REPOSITORIES,
    ...(chooser.scope === undefined ? undefined : { workspaceId: chooser.scope }),
  };
  const omitted = new Set((props.omit ?? []).map((each) => each.toLowerCase()));
  const reached =
    props.appOnly === true
      ? listed?.repositories.filter((each) => each.access === GITHUB_ACCESS.APP)
      : listed?.repositories;
  const recent = props.appOnly === true && reached === undefined ? [] : chooser.recent;
  const { several } = props;
  const picked = value === null ? [] : [value, ...(several?.also ?? [])];
  const isPicked = (name: string) => picked.some((each) => sameName(each, name));
  const listing = (name: string) => reached?.find((each) => sameName(each.fullName, name));
  const primary = several === undefined || value === null ? undefined : value;
  const judgedBeside = several?.standIn === true ? undefined : primary;
  const rows = repositoryRows(
    recent,
    reached,
    chooser.pictures,
    picked.length > 1 ? primary : undefined,
  )
    .filter((row) => !omitted.has(row.id.toLowerCase()))
    .map((row) => {
      const why =
        judgedBeside === undefined
          ? undefined
          : sameName(row.id, judgedBeside)
            ? several?.held
            : isPicked(row.id)
              ? undefined
              : extraRefusal(listing(row.id), listing(judgedBeside), picked.length - 1);
      return why === undefined ? row : { ...row, disabled: why };
    });
  const nothingReached = rows.length === 0 && listed !== undefined;
  const none = nothingReached || (onClear !== undefined && props.pending !== true);
  const label =
    (value === null ? undefined : pickedRepositoriesWords(picked)) ??
    (none
      ? NO_REPOSITORY
      : chooser.reading === true || props.pending === true
        ? READING_LABEL
        : CHOOSE_LABEL);
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
      deadEnd(chooser.connected === true ? DEAD_END.LAPSED : DEAD_END.NOT_CONNECTED)
    ) : listed === undefined ? (
      <Spinner delay label={readingWords("repositories")} />
    ) : rows.length === 0 && listed?.installed ? (
      deadEnd(DEAD_END.NONE_REACHED)
    ) : undefined;

  return {
    ...place,
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
        firstPicture(value, chooser.pictures)
      ),
    card:
      value === null || picked.length > 1 || place.open ? undefined : (
        <RepositoryCard repository={value} pictures={chooser.pictures} />
      ),
    menu: repositoryMenu(place, {
      rows,
      value: several === undefined ? (value ?? undefined) : undefined,
      checked: several === undefined ? undefined : checkedAmong(rows, picked),
      note,
      align: props.align ?? POPOVER_ALIGN.END,
      onPick: (repository) =>
        several === undefined
          ? choose(() => props.onChoose(repository))
          : several.onToggle(repository),
      foot:
        onClear === undefined
          ? undefined
          : [
              {
                id: NONE_ROW,
                label: NO_REPOSITORY,
                icon: <NoRepositoryGlyph />,
                onPress: () => choose(onClear),
              },
            ],
    }),
  };
}

interface ChipStanding {
  place: ChipPlace;
  width?: ChipWidth | undefined;
  describedBy?: string | undefined;
  invalid?: true | undefined;
  held?: string | undefined;
}

export function RepositoryChip(props: RepositoryMenuProps & ChipStanding): React.JSX.Element {
  return <MenuChip {...props} menu={useRepositoryMenu(props)} named={props.value !== null} />;
}

export function CheckedRepositoryChip(props: {
  rows: readonly MenuRow[];
  picked: readonly string[];
  pictures: boolean;
  empty: string;
  note: React.ReactNode;
  onToggle: (repository: string) => void;
  onOpen: () => void;
}): React.JSX.Element {
  const place = useMenuPlace();
  const first = props.picked[0];
  const menu: RepositoryMenu = {
    ...place,
    label: first === undefined ? props.empty : pickedRepositoriesWords(props.picked),
    hint: first === undefined ? undefined : props.picked.join(", "),
    glyph: first === undefined ? <GLYPH.ADD /> : firstPicture(first, props.pictures),
    card: undefined,
    press: (from) => {
      if (!place.open) props.onOpen();
      place.press(from);
    },
    menu: repositoryMenu(place, {
      rows: props.rows,
      value: undefined,
      checked: checkedAmong(props.rows, props.picked),
      note: props.note,
      align: POPOVER_ALIGN.START,
      onPick: props.onToggle,
    }),
  };
  return <MenuChip place={CHIP_PLACE.FIELD} menu={menu} named={first !== undefined} />;
}

function MenuChip(
  props: ChipStanding & {
    menu: RepositoryMenu;
    named: boolean;
  },
): React.JSX.Element {
  const { held, menu } = props;
  return (
    <div className="repository-chip relative min-w-0" data-place={props.place} ref={menu.room}>
      <Tooltip
        label={held ?? (menu.open ? undefined : menu.hint)}
        card={held === undefined ? menu.card : undefined}
      >
        <Chip
          look={PLACE_LOOK[props.place]}
          width={props.width}
          chevron={props.place === CHIP_PLACE.FIELD}
          aria-describedby={props.describedBy}
          aria-invalid={props.invalid}
          aria-disabled={held === undefined ? undefined : true}
          aria-haspopup="dialog"
          aria-expanded={menu.open}
          aria-controls={menu.open ? menu.menuId : undefined}
          onClick={(event) => {
            if (held === undefined) menu.press(event.currentTarget);
          }}
        >
          {menu.glyph}
          <ChipName>{props.named ? <ReplayMask>{menu.label}</ReplayMask> : menu.label}</ChipName>
        </Chip>
      </Tooltip>
      {menu.menu}
    </div>
  );
}
