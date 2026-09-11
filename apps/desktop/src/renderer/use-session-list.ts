import { PRODUCT_SEARCH_SURFACE, PRODUCT_SURFACE_EVENT } from "@sidecar/analytics";
import { CREDENTIAL_PROVIDERS, isCredentialProviderId } from "@sidecar/credentials/vocabulary";
import {
  type ObservedWorkspaceProject,
  type SessionApplicationId,
  type SessionIdentity,
  workspaceProjectSelectionId,
} from "@sidecar/session";
import { APP_SETTING_SCHEMA } from "@sidecar/settings";
import type { AppSettingsView } from "@sidecar/settings/wire";
import { ACTION_RESULT_STATUS } from "@sidecar/wire";
import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { ACT_KIND } from "#shared/messages/acts";
import type { AppStateSnapshot } from "#shared/messages/app-state";
import type { SessionWriteResult, WorkspaceProviderId } from "#shared/messages/session";
import { isWorkspaceProviderId } from "#shared/messages/session";
import { act, tell, updateSetting } from "./act";
import { PANEL_TAB, type PanelTab } from "./panel-tabs";
import {
  type ArrangedSessions,
  arrangeSessions,
  DEFAULT_SESSION_VIEW,
  displaySessions,
  type SessionArrangement,
  type SessionFilter,
  type SessionTally,
  type SessionView,
  sameSessionFilters,
  sessionTally,
} from "./session-model";
import { SESSION_OPTIONS_CONTROL_ID, SESSION_OPTIONS_ID } from "./session-parts";
import type { SessionWriteHandlers } from "./session-row-view";
import { focusSearchField, SESSION_SEARCH_INPUT_ID } from "./session-search";
import type { WorkspaceProviderOption } from "./settings/controls";

/**
 * How long a changed search query waits before it is stored. The query moves
 * at typing speed and the store is a file write per change, so only where the
 * words settle is worth writing — long enough to sit out a burst of
 * keystrokes, short enough that quitting mid-thought still keeps the search.
 */
const SEARCH_QUERY_STORE_DELAY_MS = 400;

export interface UseSessionListOptions {
  state: AppStateSnapshot | undefined;
  /** The document's own settings, which the stored view is baselined against. */
  liveSettings: AppSettingsView | undefined;
  /** The settings the panel is drawing, held back while an errand flies. */
  settings: AppSettingsView | undefined;
  tab: PanelTab;
  /** Gets the panel out of the way of whatever a press just brought forward. */
  dismissPanel: () => void;
  /** Brings the list's own tab forward, which is where its field is drawn. */
  showSessionsTab: () => void;
}

export interface SessionList {
  /** The rows as arranged, and the counts the widen button reads. */
  list: ArrangedSessions;
  /** What the capsule reports, taken before the list is narrowed. */
  tally: SessionTally;
  view: SessionArrangement;
  optionsOpen: boolean;
  searchOpen: boolean;
  offerOptions: boolean;
  offerSearch: boolean;
  workspaceProviders: readonly WorkspaceProviderOption[];
  writes: SessionWriteHandlers;
  onViewChange: (next: SessionArrangement) => void;
  onFiltersChange: (filters: readonly SessionFilter[]) => void;
  /** Every session the roster holds, unnarrowed, for a chip that names one by its current title. */
  roster: readonly SessionView[];
  onOpenSession: (session: SessionView) => void;
  /** A row's press by identity alone, for a chip naming a session the roster may have let go. */
  onOpenChat: (identity: SessionIdentity) => void;
  onOpenSessionApplication: (session: SessionView, applicationId: SessionApplicationId) => void;
  toggleOptions: () => void;
  closeOptions: () => void;
  openSearch: () => void;
  closeSearch: () => void;
  /** The capsule's close putting the order back where the mark still reads it. */
  resetSort: () => void;
  /** A narrowing an errand held back, drawn now that Luke has arrived at it. */
  applyView: (view: Partial<SessionArrangement>) => void;
  /** Opens the field a landed query fills, which nothing else may leave hidden. */
  openSearchField: () => void;
}

/**
 * The session roster as the panel sees it: how it is narrowed and ordered,
 * which of its two controls are offered and open, what the store remembers of
 * all that, the presses that open a session, and the writes a row hands on.
 */
export function useSessionList(options: UseSessionListOptions): SessionList {
  const { state, liveSettings, settings, tab, dismissPanel, showSessionsTab } = options;
  const [view, setView] = useState<SessionArrangement>(DEFAULT_SESSION_VIEW);
  const [optionsOpen, setOptionsOpen] = useState(false);
  const [searchOpen, setSearchOpen] = useState(false);
  const sessionsSettled = state?.sessions.settled === true;
  const workspaceProjects = state?.sessions.workspaceProjects;

  /**
   * The selection as last stored, so only a change of selection writes.
   * Seeded from the document's own snapshot rather than from nothing, because
   * restoring the stored chips must not read as a fresh choice to store
   * again. A ref rather than reading the settings state: a stored write's
   * reply races the next chip press, and the last value this window sent is
   * the only honest baseline either way.
   */
  const storedFilters = useRef<readonly SessionFilter[] | undefined>(undefined);
  /** Whether the stored way of viewing the list has been taken up. */
  const restored = useRef(false);
  /**
   * The stored filter chips and search words coming back with the panel: each
   * is a standing way of viewing the list, and this is the one moment they are
   * read from the store — from here on the view leads and the store follows.
   * Never in a fixture or capture run, whose evidence must not vary with what
   * a developer last chose.
   *
   * Taken up during the render that first has them rather than from an
   * effect, for the reason the emptied filter below is: an effect would let
   * one paint, and the two effects that store the view, read this build's
   * default as though the developer had chosen it — and storing that would
   * clear the very narrowing being restored.
   */
  if (!restored.current && state?.settings !== undefined) {
    restored.current = true;
    const filters = state.settings.stored.sessionFilters;
    const query = state.settings.stored.sessionSearchQuery;
    if (!state.run.fixtureMode && (filters !== undefined || query !== undefined)) {
      setView((current) => ({
        ...current,
        ...(filters !== undefined ? { filters } : undefined),
        ...(query !== undefined ? { query } : undefined),
      }));
      // A restored query opens the field it refills, on the rule the field's
      // own closing keeps: a narrowing in force behind no visible control
      // would hide sessions with nothing on screen admitting it.
      if (query !== undefined) setSearchOpen(true);
    }
  }
  // Every way the selection changes funnels through the view — a chip, a
  // spoken ask, the widen button, the list correcting an emptied selection —
  // so the store follows the view from one place. Never in a fixture or
  // capture run, which must not write a developer's own settings file.
  useEffect(() => {
    if (!restored.current || state === undefined || state.run.fixtureMode) return;
    storedFilters.current ??= liveSettings?.sessionFilters ?? [];
    const filters = view.filters;
    if (sameSessionFilters(storedFilters.current, filters)) return;
    storedFilters.current = filters;
    void updateSetting(
      APP_SETTING_SCHEMA.sessionFilters.field,
      filters.length > 0 ? filters : undefined,
    );
  }, [state, view.filters, liveSettings?.sessionFilters]);

  /**
   * The search query as last stored, on the filter selection's own terms:
   * seeded from the document's snapshot so restoring the stored words must
   * not read as fresh typing to store again.
   */
  const storedQuery = useRef<string | undefined>(undefined);
  // The query funnels through the view the way the selection does — typing,
  // a spoken ask, Escape clearing the field — so the store follows the view
  // from one place, never in a fixture or capture run. Unlike a chip press
  // the query changes at typing speed, so a write waits out the keystrokes
  // and stores only where the words settled — except letting go, which writes
  // at once: a clear is a discrete act rather than a keystroke on the way
  // somewhere, and a quit inside a waited write would bring back a search the
  // developer deliberately let go.
  useEffect(() => {
    if (!restored.current || state === undefined || state.run.fixtureMode) return;
    storedQuery.current ??= liveSettings?.sessionSearchQuery ?? "";
    const query = view.query;
    if (storedQuery.current === query) return;
    const store = () => {
      storedQuery.current = query;
      void updateSetting(
        APP_SETTING_SCHEMA.sessionSearchQuery.field,
        query !== "" ? query : undefined,
      );
    };
    if (query === "") {
      store();
      return;
    }
    const settled = window.setTimeout(store, SEARCH_QUERY_STORE_DELAY_MS);
    return () => window.clearTimeout(settled);
  }, [state, view.query, liveSettings?.sessionSearchQuery]);

  // A press anywhere else is the same dismissal Escape is, and the one a sheet
  // over a list has to answer: what is behind it can only be reached by asking
  // it to move, so pressing there has to be what asks. The press is taken on the
  // way down, before whatever it lands on can act on it, and the control that
  // opened the sheet — toggle and, while a selection stands, the X that clears
  // it — is left to its own clicks. Nothing outside the drawn shape reaches
  // this renderer at all — those presses belong to whatever is behind Luke —
  // so leaving the shape is what closes the panel, and closing the panel is
  // what puts the sheet away.
  useEffect(() => {
    if (!optionsOpen) return;
    const handlePointerDown = (event: PointerEvent) => {
      const target = event.target instanceof Node ? event.target : undefined;
      if (!target) return;
      const sheet = document.getElementById(SESSION_OPTIONS_ID);
      const control = document.getElementById(SESSION_OPTIONS_CONTROL_ID);
      if (sheet?.contains(target) || control?.contains(target)) return;
      setOptionsOpen(false);
    };
    window.addEventListener("pointerdown", handlePointerDown, { capture: true });
    return () => window.removeEventListener("pointerdown", handlePointerDown, { capture: true });
  }, [optionsOpen]);

  /**
   * The providers the default-workspace rows can offer: every provider
   * currently offering projects, named the way its adapter names itself, plus
   * one holding a stored default provider that is not offering right now — a
   * provider falls back to its own display name, so the row still shows a
   * choice it can name. A project has no such name to fall back to: its label
   * lived on the observed list that stopped listing it, and an option labelled
   * with the stored identity would offer a raw id for a default that already
   * steers nothing. So each option carries only the projects its provider is
   * offering, and a default the provider stops offering is cleared by the main
   * process rather than shown here.
   */
  const storedWorkspaceProvider = settings?.defaultWorkspaceProvider;
  const storedWorkspaceProjects = settings?.workspaceProjectDefaults;
  const workspaceProviders = useMemo(() => {
    const offering: readonly ObservedWorkspaceProject[] = workspaceProjects ?? [];
    const fallbackName = (providerId: WorkspaceProviderId) =>
      isCredentialProviderId(providerId)
        ? CREDENTIAL_PROVIDERS[providerId].displayName
        : providerId;
    const names = new Map<WorkspaceProviderId, string>();
    for (const project of offering) {
      if (isWorkspaceProviderId(project.providerId)) {
        names.set(project.providerId, project.providerName);
      }
    }
    if (storedWorkspaceProvider && !names.has(storedWorkspaceProvider)) {
      names.set(storedWorkspaceProvider, fallbackName(storedWorkspaceProvider));
    }
    for (const providerId of Object.keys(storedWorkspaceProjects ?? {})) {
      if (!isWorkspaceProviderId(providerId)) continue;
      if (!names.has(providerId)) names.set(providerId, fallbackName(providerId));
    }
    return [...names.entries()].map(([id, name]) => {
      const offered = offering
        .filter((project) => project.providerId === id)
        .map((project) => ({
          id: workspaceProjectSelectionId(project),
          label: project.targetName
            ? `${project.repository} on ${project.targetName}`
            : project.repository,
        }));
      return { id, name, projects: offered };
    });
  }, [workspaceProjects, storedWorkspaceProvider, storedWorkspaceProjects]);

  /**
   * The acts a row asks for by session identity, each leaving the panel up so
   * its answer lands back on the row that asked. The two writes travel as one
   * act each to the main process and on to the host, whose admission decides
   * them against the roster it reads for itself; a refusal the channel itself
   * raises — the host unreachable, the kind refused — is folded into the same
   * answer shape, because a write's outcome belongs beside the field it left
   * and never in a thrown error nothing draws.
   */
  const writes: SessionWriteHandlers = useMemo(() => {
    const identityOf = (session: SessionView) => ({
      providerId: session.providerId,
      providerSessionId: session.id,
    });
    const answered = async (write: Promise<SessionWriteResult>): Promise<SessionWriteResult> => {
      try {
        return await write;
      } catch (error) {
        return {
          status: ACTION_RESULT_STATUS.REJECTED,
          reason: error instanceof Error ? error.message : String(error),
        };
      }
    };
    return {
      sendMessage: (session, text) =>
        answered(act(ACT_KIND.SESSION_SEND_MESSAGE, { identity: identityOf(session), text })),
      runAction: (session, actionId) =>
        answered(
          act(ACT_KIND.SESSION_EXECUTE_CONTROL, {
            identity: identityOf(session),
            controlId: actionId,
          }),
        ),
      openChange: (session) => act(ACT_KIND.SESSION_OPEN_CHANGE, { identity: identityOf(session) }),
    };
  }, []);

  // A sort chosen in the sheet puts the sheet away: an order is one choice of
  // two, made once. The fallback the render performs when a selection empties
  // writes the view directly instead: that is the list correcting itself, not
  // somebody choosing.
  const onViewChange = useCallback((next: SessionArrangement) => {
    setView(next);
    setOptionsOpen(false);
  }, []);

  // A filter toggled in the sheet leaves it open: the chips combine, and a
  // sheet that closed on every press would make choosing two filters cost two
  // openings. The sheet still goes away by hand — its button, a press outside
  // it, Escape — and the options button names the narrowing the whole time.
  const onFiltersChange = useCallback((filters: readonly SessionFilter[]) => {
    setView((current) => ({ ...current, filters }));
  }, []);

  /**
   * Sends a session to its provider and gets out of the way. Luke floats above
   * every window, so a panel left open would be sitting on top of the very chat
   * it was just asked to bring forward — the same reason fetching a key stands
   * the panel down. The pointer is on the row that was pressed and cannot leave
   * a shape that is no longer drawn, so the close is asked for here rather than
   * waited for.
   */
  const onOpenChat = useCallback(
    (identity: SessionIdentity) => {
      tell(ACT_KIND.SESSION_OPEN, {
        identity: {
          providerId: identity.providerId,
          providerSessionId: identity.providerSessionId,
        },
      });
      dismissPanel();
    },
    [dismissPanel],
  );
  const onOpenSession = useCallback(
    (session: SessionView) =>
      onOpenChat({ providerId: session.providerId, providerSessionId: session.id }),
    [onOpenChat],
  );

  /**
   * Opens the exact route carried by one app association. The app id, rather
   * than its address, crosses the bridge; the main process validates it against
   * the latest roster before handing the normalized route to macOS.
   */
  const onOpenSessionApplication = useCallback(
    (session: SessionView, applicationId: SessionApplicationId) => {
      tell(ACT_KIND.SESSION_OPEN_APPLICATION, {
        identity: {
          providerId: session.providerId,
          providerSessionId: session.id,
        },
        applicationId,
      });
      dismissPanel();
    },
    [dismissPanel],
  );

  /**
   * The session search summons, from its magnifier or Command-F over the
   * Sessions tab. It lands on that tab — the field it opens is that list's —
   * and the caret follows the same frame-by-frame seek the ask field needs,
   * because the field may not be drawn until React has answered.
   */
  const openSearch = useCallback(() => {
    showSessionsTab();
    setSearchOpen(true);
    focusSearchField(SESSION_SEARCH_INPUT_ID);
    window.sidecar.recordSurfaceEvent(PRODUCT_SURFACE_EVENT.SEARCH_OPEN, {
      search_surface: PRODUCT_SEARCH_SURFACE.SESSIONS,
    });
  }, [showSessionsTab]);

  /**
   * Closing the search lets go of its query in the same act: a field that
   * left its narrowing in force behind no visible control would be hiding
   * sessions with nothing on screen admitting it.
   */
  const closeSearch = useCallback(() => {
    setSearchOpen(false);
    setView((current) => (current.query === "" ? current : { ...current, query: "" }));
  }, []);

  const toggleOptions = useCallback(() => setOptionsOpen((open) => !open), []);
  const closeOptions = useCallback(() => setOptionsOpen(false), []);
  const resetSort = useCallback(
    () => setView((current) => ({ ...current, sort: DEFAULT_SESSION_VIEW.sort })),
    [],
  );
  const applyView = useCallback(
    (next: Partial<SessionArrangement>) => setView((current) => ({ ...current, ...next })),
    [],
  );
  const openSearchField = useCallback(() => setSearchOpen(true), []);

  const visible = state ? displaySessions(state) : [];
  // The tally is taken before the list is narrowed — the capsule reports what
  // Luke is watching, not what the panel is currently showing — but it reads
  // in the list's own sort, so the wing's marks sit in the order the rows do.
  const tally = sessionTally(visible, view.sort);
  const list = arrangeSessions(visible, view);
  // Dropping an emptied selection is a change of view, not a way of drawing
  // one. Left in state it would lie dormant behind a list that only looks
  // unnarrowed, and the next session to enter that state would narrow the list
  // back down to it with nothing having been pressed. Setting state here rather
  // than from an effect is what keeps that from being drawn first and corrected
  // after. Only a roster actually read and holding sessions can prove a
  // selection stale, though: before the first reading an empty list says "not
  // looked yet", and an empty roster hides nothing behind a chip — either way
  // a selection restored from the store is left to stand rather than wiped
  // against a list that has nothing to show under any view.
  if (sessionsSettled && visible.length > 0 && !sameSessionFilters(list.filters, view.filters)) {
    setView({ ...view, filters: list.filters });
  }
  // The sheet exists only while there is something for it to decide, and its
  // being open has to go when its button does — by the same rule the emptied
  // filter follows. Left set behind a button nobody can see, Escape would spend
  // itself closing a sheet that is not drawn instead of closing the panel, and
  // the next session to arrive would open it again with nothing pressed.
  const offerOptions = tab === PANEL_TAB.SESSIONS && list.total > 1;
  if (optionsOpen && !offerOptions) setOptionsOpen(false);
  // Search is offered on the options' own terms: one session leaves nothing
  // to find that is not already on screen. Its being open goes when its button
  // does — and the query goes with it, by the same rule the emptied filter
  // follows, because a narrowing left in force behind no visible control would
  // hide sessions with nothing admitting it. Only a roster actually read may
  // decide that, on the emptied filter's own gate: an unread roster says
  // nothing about how many sessions there are, and a search restored at
  // launch must not be let go on its silence. The tab is not part of this
  // gate: a search held while Settings shows is still the sessions tab's own
  // state, waiting where the developer left it.
  const offerSearch = tab === PANEL_TAB.SESSIONS && list.total > 1;
  if (searchOpen && sessionsSettled && list.total <= 1) {
    setSearchOpen(false);
    if (view.query !== "") setView({ ...view, query: "" });
  }

  return {
    list,
    roster: visible,
    tally,
    view,
    optionsOpen,
    searchOpen,
    offerOptions,
    offerSearch,
    workspaceProviders,
    writes,
    onViewChange,
    onFiltersChange,
    onOpenSession,
    onOpenChat,
    onOpenSessionApplication,
    toggleOptions,
    closeOptions,
    openSearch,
    closeSearch,
    resetSort,
    applyView,
    openSearchField,
  };
}
