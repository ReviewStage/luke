import type { GitHubRepository } from "@sidecar/hosted";
import { PLAN_CALL_FAILURE, type PlanningRepositoriesAnswer } from "@sidecar/hosted/planning-view";
import { CheckIcon, ExternalIcon, SearchIcon } from "@sidecar/panel";
import { useCallback, useEffect, useId, useRef, useState } from "react";
import { GitHubMark } from "../account-marks";
import { repositoryFailureNote } from "./planning-model";

/**
 * repository-chip.tsx -- the chip that names a plan's GitHub repository, and the menu that picks one.
 *
 * Drawn along the composer card's foot for a plan about to start, and in the
 * open plan's toolbar for the plan's own repository, the way a branch or
 * model chip is: the GitHub mark and `owner/name`, or the pick it is
 * waiting on. Its menu offers the repositories the account's plans were
 * about lately, a search over every repository the Luke GitHub App reaches,
 * and the page on GitHub where the developer chooses which repositories the
 * App reaches. With the App installed nowhere for the account, the chip
 * offers installing it instead. The list is read from the service when the
 * chip mounts and again whenever the window takes focus, so a developer back
 * from installing the App in the browser sees the change on the next
 * opening; nothing polls. The menu closes on a choice, on Escape, and on
 * focus leaving it; Escape stops here, so it closes the menu and not the
 * panel behind it.
 */

/** What the chip's menu offers, read from the account's plans and the service. */
export interface RepositoryChooser {
  /** The repositories the account's plans were about lately, the newest first, each once. */
  recent: readonly string[];
  /** Reads the repositories the account reaches now, as the service answers them. */
  read: () => Promise<PlanningRepositoriesAnswer>;
  /** Opens a page of GitHub's in the browser. */
  openGitHub: (url: string) => void;
}

/** Where the chip stands, which is how it is sized. */
export const CHIP_PLACE = {
  COMPOSER: "composer",
  TOOLBAR: "toolbar",
} as const;

export type ChipPlace = (typeof CHIP_PLACE)[keyof typeof CHIP_PLACE];

/** The chip's words while it waits on a pick, and while the App is installed nowhere. */
const CHIP_LABEL = {
  CHOOSE: "Choose repository",
  INSTALL: "Install Luke on GitHub",
} as const;

/** How many repositories the menu lists outright; the rest are a search away. */
const LISTED_LIMIT = 5;

/** How many matches a search shows at once. */
const MATCHES_LIMIT = 8;

const MENU_ITEM = "[role=menuitem]";

/** The repositories whose full name holds the query, case aside, the first few. */
function matching(repositories: readonly GitHubRepository[], query: string): string[] {
  const needle = query.trim().toLowerCase();
  return repositories
    .map((repository) => repository.fullName)
    .filter((fullName) => fullName.toLowerCase().includes(needle))
    .slice(0, MATCHES_LIMIT);
}

/** One repository in the menu, checked where it is the one chosen. */
function RepositoryRow({
  repository,
  chosen,
  onPick,
}: {
  repository: string;
  chosen: boolean;
  onPick: () => void;
}): React.JSX.Element {
  return (
    <button type="button" role="menuitem" className="plan-compose-menu-row" onClick={onPick}>
      <GitHubMark />
      <span className="plan-compose-menu-name">{repository}</span>
      {chosen ? <CheckIcon /> : null}
    </button>
  );
}

export function RepositoryChip(props: {
  /** The repository named now, `owner/name`, or null while none is. */
  value: string | null;
  chooser: RepositoryChooser;
  onChoose: (repository: string) => void;
  /** Counts the asks from elsewhere to open the menu, each opening it. */
  openRequest?: number | undefined;
  place: ChipPlace;
}): React.JSX.Element {
  const { chooser, openRequest } = props;
  const [open, setOpen] = useState(false);
  const [list, setList] = useState<PlanningRepositoriesAnswer | undefined>(undefined);
  /** The search's words while the menu is searching; nothing while it lists. */
  const [query, setQuery] = useState<string | undefined>(undefined);
  const menuId = useId();
  const chip = useRef<HTMLDivElement>(null);
  const trigger = useRef<HTMLButtonElement>(null);
  const menu = useRef<HTMLDivElement>(null);
  const searchField = useRef<HTMLInputElement>(null);
  // Note that the chooser is read through a ref, because the tab hands a
  // new one on every render and a read is owed to the window's focus, not
  // to a render.
  const latest = useRef(chooser);
  latest.current = chooser;

  const read = useCallback(() => {
    latest.current.read().then(setList, () => {
      setList({ failure: PLAN_CALL_FAILURE.UNANSWERED });
    });
  }, []);

  // The list is read on arrival and whenever the window comes back, which
  // is how a developer returns from installing the App in the browser.
  useEffect(() => {
    read();
    window.addEventListener("focus", read);
    return () => window.removeEventListener("focus", read);
  }, [read]);

  // Each ask from elsewhere, such as the plan menu's Change repository…, opens the menu.
  // biome-ignore lint/correctness/useExhaustiveDependencies: each new request is what asks the menu open.
  useEffect(() => {
    if (openRequest !== undefined && openRequest > 0) setOpen(true);
  }, [openRequest]);

  // Note that we hand focus back to the chip, as a native menu returns it to
  // its trigger, because closing takes the focused row away with it.
  const close = () => {
    setOpen(false);
    setQuery(undefined);
    trigger.current?.focus();
  };
  const choose = (pick: () => void) => {
    close();
    pick();
  };

  const searching = query !== undefined;
  // The menu opens with its first row focused, as a native menu does, and the search with its field.
  useEffect(() => {
    if (!open) return;
    if (searching) searchField.current?.focus();
    else menu.current?.querySelector<HTMLElement>(MENU_ITEM)?.focus();
  }, [open, searching]);

  // Arrows walk the menu's rows, wrapping at either end; from the search field they enter the rows.
  const onMenuKey = (event: React.KeyboardEvent<HTMLDivElement>) => {
    if (event.key === "Escape") {
      event.stopPropagation();
      close();
      return;
    }
    if (event.key !== "ArrowDown" && event.key !== "ArrowUp") return;
    const rows = [...event.currentTarget.querySelectorAll<HTMLElement>(MENU_ITEM)];
    if (rows.length === 0) return;
    event.preventDefault();
    const focused = rows.find((row) => row === document.activeElement);
    const at = focused === undefined ? -1 : rows.indexOf(focused);
    const next =
      at === -1
        ? event.key === "ArrowDown"
          ? 0
          : rows.length - 1
        : (at + (event.key === "ArrowDown" ? 1 : -1) + rows.length) % rows.length;
    rows[next]?.focus();
  };

  const listed = list !== undefined && "repositories" in list ? list.repositories : undefined;
  const failure = list !== undefined && "failure" in list ? list.failure : undefined;
  const installing = listed !== undefined && !listed.installed;
  // With the App installed nowhere and no repository named, the chip's one press is installing it.
  const offersInstall = installing && props.value === null;
  const label = props.value ?? (offersInstall ? CHIP_LABEL.INSTALL : CHIP_LABEL.CHOOSE);
  const installationUrl = listed?.installationUrl;
  const press = () => {
    if (offersInstall && installationUrl !== undefined) {
      chooser.openGitHub(installationUrl);
      return;
    }
    setOpen(!open);
  };

  const pick = (repository: string) => choose(() => props.onChoose(repository));
  const row = (repository: string) => (
    <RepositoryRow
      key={repository}
      repository={repository}
      chosen={repository === props.value}
      onPick={() => pick(repository)}
    />
  );
  // The rows listed outright: the recent repositories, or the first few the App reaches.
  const outright =
    chooser.recent.length > 0
      ? chooser.recent
      : (listed?.repositories.slice(0, LISTED_LIMIT).map((repository) => repository.fullName) ??
        []);

  const matches = searching && listed !== undefined ? matching(listed.repositories, query) : [];
  const body = searching ? (
    <>
      <div className="plan-compose-menu-search">
        <SearchIcon />
        <input
          ref={searchField}
          type="text"
          aria-label="Search repositories"
          placeholder="Search all repositories"
          value={query}
          onChange={(event) => setQuery(event.currentTarget.value)}
        />
      </div>
      {listed === undefined ? (
        <p className="plan-compose-menu-note">Reading your repositories…</p>
      ) : (
        matches.map(row)
      )}
      {listed !== undefined && matches.length === 0 ? (
        <p className="plan-compose-menu-note">No repositories match.</p>
      ) : null}
    </>
  ) : (
    <>
      {outright.length > 0 ? (
        <p className="plan-compose-menu-heading">
          {chooser.recent.length > 0 ? "Recent" : "Repositories"}
        </p>
      ) : null}
      {outright.map(row)}
      {failure !== undefined ? (
        <p className="plan-compose-menu-note" role="alert">
          {repositoryFailureNote(failure)}
        </p>
      ) : null}
      {list === undefined ? (
        <p className="plan-compose-menu-note">Reading your repositories…</p>
      ) : null}
      {listed?.installed && listed.repositories.length === 0 ? (
        <p className="plan-compose-menu-note">Luke can't see any repository yet.</p>
      ) : null}
      {failure !== undefined ? (
        <button type="button" role="menuitem" className="plan-compose-menu-row" onClick={read}>
          Try again
        </button>
      ) : null}
      {listed?.installed ? (
        <button
          type="button"
          role="menuitem"
          className="plan-compose-menu-row"
          onClick={() => setQuery("")}
        >
          <SearchIcon />
          <span className="plan-compose-menu-name">Search all repositories…</span>
        </button>
      ) : null}
      {installationUrl !== undefined ? (
        <>
          <hr />
          <button
            type="button"
            role="menuitem"
            className="plan-compose-menu-row"
            onClick={() => choose(() => chooser.openGitHub(installationUrl))}
          >
            <span className="plan-compose-menu-name">
              {installing ? CHIP_LABEL.INSTALL : "Choose which repositories Luke can see"}
            </span>
            <ExternalIcon />
          </button>
        </>
      ) : null}
    </>
  );

  return (
    <div className="repository-chip" data-place={props.place} ref={chip}>
      <button
        ref={trigger}
        type="button"
        className="plan-compose-chip"
        aria-haspopup={offersInstall ? undefined : "menu"}
        aria-expanded={offersInstall ? undefined : open}
        aria-controls={open ? menuId : undefined}
        onClick={press}
      >
        <GitHubMark />
        <span className="plan-compose-chip-name">{label}</span>
        {offersInstall ? <ExternalIcon /> : null}
      </button>
      {open ? (
        <div
          ref={menu}
          className="plan-compose-menu"
          id={menuId}
          role="menu"
          aria-label="Repository"
          onKeyDown={onMenuKey}
          onBlur={(event) => {
            if (!chip.current?.contains(event.relatedTarget)) {
              setOpen(false);
              setQuery(undefined);
            }
          }}
        >
          {body}
        </div>
      ) : null}
    </div>
  );
}
