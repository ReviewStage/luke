import {
  ACCOUNT_STATUS,
  type AccountProvider,
  type AccountSnapshot,
} from "@sidecar/credentials/snapshot";
import { ProviderMark } from "@sidecar/panel";
import type {
  ChildTranscriptSnapshot,
  ConversationViewSnapshot,
  SessionApplicationId,
  SessionIdentity,
} from "@sidecar/session";
import { cssCustomProperties } from "@sidecar/surface/react-css";
import type { ChildrenSnapshot } from "#shared/messages/children";
import { CalendarGate, type CalendarGateControl } from "./calendar-gate";
import { ConductorKeyGate, type ConductorKeyGateControl } from "./conductor-key-gate";
import type { PlacedLiveEntry } from "./conversation-live-lines";
import { ConversationClearButton, ConversationPanel } from "./conversation-panel";
import { PANEL_TAB, type PanelTab, TabBar } from "./panel-tabs";
import {
  type ArrangedSessions,
  type SessionArrangement,
  type SessionFilter,
  type SessionListRun,
  type SessionView,
  sessionListRuns,
  sessionRunKeys,
  type WorkspaceTrayChange,
  workspaceTrayActions,
  workspaceTrayChange,
} from "./session-model";
import {
  type RosterRow,
  useRoster,
  useSessionReorderMotion,
  WORKSPACE_TRAY_ID_ATTRIBUTE,
} from "./session-motion";
import {
  EmptyState,
  LoadingState,
  SessionOptions,
  SessionOptionsButton,
  SessionsPanel,
  WorkspaceGlyph,
} from "./session-parts";
import {
  runDrawsTray,
  SessionRow,
  type SessionWriteHandlers,
  WorkspaceTrayActs,
} from "./session-row-view";
import {
  Highlighted,
  SearchEmptyState,
  SessionSearch,
  SessionSearchButton,
  widenedView,
} from "./session-search";
import { CalendarGateReview } from "./settings/calendar-gate-review";
import { SettingsPanel, type SettingsPanelProps } from "./settings/settings-panel";
import { SettingsSearchButton } from "./settings-search";
import { SignInGate } from "./sign-in-gate";
import {
  CONVERSATION_PAGE,
  type ConversationPage,
  SubagentsButton,
  SubagentsPanel,
  SubagentTranscriptPanel,
} from "./subagents-panel";
import { updateAvailable, updateRow } from "./update-row";
import { useMeasuredHeight } from "./use-measured-height";

/**
 * One run of the list, tray or not. Several of one workspace's chats sit in
 * the tray: a single card that visibly contains them, named once at its top —
 * the workspace's name on the left, and at the far end the glyph leading the
 * repository — with the chats divided by hairlines inside.
 * A workspace holding one chat earns no tray — its one row carries the
 * workspace's chip and mark itself — and an ungrouped session never does;
 * either way the wrapper stays, drawing as nothing. It has to: a workspace crosses
 * between one chat and several as siblings come and go, and if that crossing
 * changed the row's parent element, React would remount the row and lose the
 * outcome line a chip had just answered on. The chrome is a class, never a
 * different tree.
 *
 * The header opens nothing — the rows are what press through to a provider's
 * window — but it does carry the controls that belong to the workspace rather
 * than to any one chat: an archive files away every chat in the tray, so its
 * chip sits where the workspace is named once instead of on each row it
 * would empty, and the one pull request the chats share sits beside it on the
 * same reasoning. The header names the tray in the reading order the same way
 * it does on screen: the workspace once, then its chats. A tray is a member of the
 * arrival stack in its rows' stead: it fans in at its lead row's turn, and
 * the rows ride it rather than fanning a second time inside it. A wrapper
 * that draws as nothing leaves its row in the stack exactly as before.
 */
function SessionRun({
  run,
  sessions,
  change,
  highlight,
  writes,
  children,
}: {
  run: SessionListRun;
  /** The tray's living chats, in drawn order — what the header's controls are
   * read from and carried through. A leaving row's session is already gone
   * from the model, so it can neither offer a control nor carry one. */
  sessions: readonly SessionView[];
  /** The workspace's one pull request, when the header carries it. Handed in
   * rather than read here, because the rows suppressing their own chips must
   * answer to the same reading. */
  change?: WorkspaceTrayChange | undefined;
  /** The search's words, marked on the tray's own header lines too. */
  highlight?: readonly string[] | undefined;
  writes: SessionWriteHandlers;
  children: React.ReactNode;
}): React.JSX.Element {
  const tray = runDrawsTray(run);
  const acts = tray ? workspaceTrayActions(sessions) : [];
  return (
    <section
      className={tray ? "workspace-tray" : "session-run"}
      {...(tray && run.workspace
        ? {
            // The tray is a slot of the list in its own right: measured by
            // this id, it travels to a re-sorted seat carrying its rows,
            // which are translated only by their movement within it.
            [WORKSPACE_TRAY_ID_ATTRIBUTE]: run.workspace.id,
            style: cssCustomProperties({ "--row-index": (run.indexes[0] ?? 0) + 1 }),
          }
        : undefined)}
    >
      {/* Held in its slot by the null, so the header appearing or leaving can
          never reseat the keyed rows beside it. */}
      {tray ? (
        <header className="workspace-tray-header">
          <span className="workspace-tray-name">
            <Highlighted text={run.workspace?.name ?? ""} tokens={highlight} />
          </span>
          <span className="workspace-tray-meta">
            {run.workspace?.scopeId && run.workspace.managerName ? (
              <span
                className="workspace-manager-mark"
                title={`${run.workspace.managerName} workspace`}
              >
                <ProviderMark providerId={run.workspace.scopeId} />
                <span className="visually-hidden">{run.workspace.managerName}</span>
              </span>
            ) : (
              <WorkspaceGlyph />
            )}
            {run.repository ? (
              <span>
                <Highlighted text={run.repository} tokens={highlight} />
              </span>
            ) : null}
          </span>
          {acts.length > 0 || change ? (
            <WorkspaceTrayActs acts={acts} {...(change ? { change } : undefined)} writes={writes} />
          ) : null}
        </header>
      ) : null}
      {children}
    </section>
  );
}

interface PanelBodyProps {
  accountRequired: boolean;
  account: AccountSnapshot;
  /** Starts a sign-in; the app stands the panel down to the waiting popup. */
  onBeginSignIn: (provider: AccountProvider) => void;
  /** Why the last sign-in ended without landing, for the gate to show. */
  signInFailure?: string;
  /**
   * The calendar step of onboarding, present exactly while it stands: signed
   * in, still owed, and with at least one source this build can offer.
   * Assembled by the app, which knows all three.
   */
  calendarGate?: CalendarGateControl;
  /**
   * The Conductor key step of onboarding, present exactly while it stands:
   * signed in and still owed. Ahead of the calendar step and of any row.
   */
  conductorKeyGate?: ConductorKeyGateControl;
  /**
   * Whether any cloud agent provider is connected, and the Connect press for
   * the empty desk when none is: the same entry the Connections row runs.
   */
  providerConnect: { connected: boolean; onConnect: () => void };
  list: ArrangedSessions;
  /**
   * Whether the roster has been read at all yet. Until it has, an empty list
   * draws loading rows rather than the empty state: an unread zero only means
   * "not looked yet", never "nothing to watch".
   */
  sessionsSettled: boolean;
  view: SessionArrangement;
  onViewChange: (view: SessionArrangement) => void;
  /** Carries a toggled filter selection; unlike a view change it leaves the sheet open. */
  onFiltersChange: (filters: readonly SessionFilter[]) => void;
  /**
   * The instant the rows' ages are read against. Passed down rather than read
   * here, because only the app knows which clock is honest: the wall clock for
   * live sessions, the fixture's own epoch for fixture rows.
   */
  now: number;
  /** Sends the pressed session to its provider, wherever the provider keeps it. */
  onOpenSession: (session: SessionView) => void;
  /** Opens one exact app association without exposing its address to the renderer. */
  onOpenSessionApplication: (session: SessionView, applicationId: SessionApplicationId) => void;
  /** A row's writes and its pull-request open, handed down to every row and tray header. */
  writes: SessionWriteHandlers;
  /** The conversation between the developer and Luke, as the host's reads of the service compose it. */
  conversation: ConversationViewSnapshot;
  /** Every session the roster holds, so an action's chip names a session by its current title. */
  roster: readonly SessionView[];
  /** A session row's own press by identity, for the chip naming the session an action reached. */
  onOpenChat: (identity: SessionIdentity) => void;
  /** The lines still being said, drawn under that thread while their words grow. */
  liveConversationEntries: readonly PlacedLiveEntry[];
  /** Opens the feedback composer on the draft a thumbs down offers, as the Conversation tab's own press. */
  onOfferRatingFeedback: (draft: string) => void;
  /** Whether a spoken turn is still owed its first words, so the thread holds its place. */
  spokenAskPending: boolean;
  /** Clears that same thread on the service, for every Mac signed in to the account. */
  onClearConversationConversation: () => void;
  /** Which of the Conversation tab's three pages is showing: the thread, the sub-agents list, or one transcript. */
  conversationPage: ConversationPage;
  onConversationPageChange: (page: ConversationPage) => void;
  /** The account's sub-agents as the document holds them, for the list page and the transcript's header. */
  subagents: ChildrenSnapshot;
  /** Opens one sub-agent's transcript on the host and turns to its page, as the list page's row press. */
  onOpenSubagent: (childId: string) => void;
  /** The child the transcript page is of, held exactly while that page shows. */
  transcriptChildId: string | undefined;
  /** The one child's transcript the host holds open, as the document carries it. */
  childTranscript: ChildTranscriptSnapshot | undefined;
  /** Reports someone being part-way through the session search, so the panel holds for them. */
  onFieldEngaged: (engaged: boolean) => void;
  /**
   * Whether there is anything for the sheet to decide. Decided by the panel
   * rather than here, because whoever offers the button also has to be the one
   * that closes the sheet when it stops offering it.
   */
  offerOptions: boolean;
  optionsOpen: boolean;
  onOptionsToggle: () => void;
  /** Whether there is anything to search, on the same terms as the options. */
  offerSearch: boolean;
  searchOpen: boolean;
  /** Opens the field focused, or closes it and lets go of its query. */
  onSearchToggle: () => void;
  /** The field's own way out — Escape on an empty query — which also clears. */
  onSearchClose: () => void;
  /** The settings search's field state, on the sessions search's own terms. */
  settingsSearchOpen: boolean;
  onSettingsSearchToggle: () => void;
  tab: PanelTab;
  onTabChange: (tab: PanelTab) => void;
  /**
   * The settings tab's controls, grouped the way a credential's is. Forwarded
   * untouched: this body chooses which tab is showing, not what a row writes.
   */
  settings: SettingsPanelProps;
}

/** Full-width rows that unfold out of the capsule, one session per line. */
export function PanelBody({
  accountRequired,
  account,
  onBeginSignIn,
  signInFailure,
  calendarGate,
  conductorKeyGate,
  providerConnect,
  list,
  sessionsSettled,
  view,
  onViewChange,
  onFiltersChange,
  now,
  onOpenSession,
  onOpenSessionApplication,
  writes,
  conversation,
  roster,
  onOpenChat,
  liveConversationEntries,
  onOfferRatingFeedback,
  spokenAskPending,
  onClearConversationConversation,
  conversationPage,
  onConversationPageChange,
  subagents,
  onOpenSubagent,
  transcriptChildId,
  childTranscript,
  onFieldEngaged,
  offerOptions,
  optionsOpen,
  onOptionsToggle,
  offerSearch,
  searchOpen,
  onSearchToggle,
  onSearchClose,
  settingsSearchOpen,
  onSettingsSearchToggle,
  tab,
  onTabChange,
  settings,
}: PanelBodyProps): React.JSX.Element {
  const sessionListRef = useSessionReorderMotion();
  const rows = useRoster(list.sessions, sessionListRef);
  // The sheet floats over the list, so its height never reaches the panel's
  // measurement — and a list of one row measures shorter than the sheet over
  // it, cropping the sheet at the surface's clipped edge. Measured here and
  // reserved on the view below, so the surface grows to hold whichever of the
  // two is taller.
  const [optionsElement, optionsHeight] = useMeasuredHeight();
  const optionsRoom =
    optionsOpen && optionsHeight !== undefined
      ? cssCustomProperties({ "--options-height": `${optionsHeight}px` })
      : undefined;
  if (accountRequired && account.status !== ACCOUNT_STATUS.SIGNED_IN) {
    return (
      <div className="body">
        <SignInGate
          account={account}
          {...(signInFailure ? { failure: signInFailure } : undefined)}
          onBegin={onBeginSignIn}
          onQuit={settings.onQuit}
        />
      </div>
    );
  }
  // Onboarding's key step, past the account's gate and the spoken introduction:
  // the roster waits behind it until the vault holds a Conductor key or the
  // skip declines, so no desk is drawn before it can hold a real session.
  if (conductorKeyGate) {
    return (
      <div className="body">
        <ConductorKeyGate control={conductorKeyGate} onQuit={settings.onQuit} />
      </div>
    );
  }
  // Onboarding's calendar gate, past the key step: the roster and the settings
  // both wait behind it until the step is answered — Done over a connected
  // calendar, so Luke can tell a meeting from a moment to speak into, or the
  // skip declining it for good. A connection moves the gate to its review
  // half, which is the Connections page's own calendar block, so the
  // calendars read exactly as they do everywhere else.
  if (calendarGate) {
    const gateReview =
      settings.settings !== undefined &&
      (settings.settings.calendarAccounts.length > 0 ||
        settings.settings.appleCalendar !== undefined) ? (
        <CalendarGateReview settings={settings} />
      ) : undefined;
    return (
      <div className="body">
        <CalendarGate
          control={calendarGate}
          {...(gateReview !== undefined ? { review: gateReview } : undefined)}
          onQuit={settings.onQuit}
        />
      </div>
    );
  }
  const highlight = list.search?.tokens;
  const runs = sessionListRuns(rows.map((row) => row.item));
  const runKeys = sessionRunKeys(runs, rows);
  // The tab wears the update row's own words, so the dot's hover and the row
  // it leads to can never tell two different stories about the same release.
  const settingsNote = updateAvailable(settings.updates.update)
    ? updateRow(settings.updates.update).detail
    : undefined;
  const conversationTab = tab === PANEL_TAB.CONVERSATION;
  const subagentsPage = conversationTab && conversationPage === CONVERSATION_PAGE.SUBAGENTS;
  // The transcript page is of one child; a page with none to be of falls back to the thread.
  const transcriptChild =
    conversationTab && conversationPage === CONVERSATION_PAGE.TRANSCRIPT
      ? transcriptChildId
      : undefined;
  const threadPage = conversationTab && !subagentsPage && transcriptChild === undefined;
  // Clear retires recorded turns, so only a thread holding some, and showing, offers it.
  const offerConversationClear = threadPage && conversation.groups.length > 0;
  return (
    <div className="body">
      {/* The tab bar says what you are looking at; the buttons beside it say
          how it is being shown. One line, because the second is only ever a
          qualifier on the first. */}
      <div className="panel-header">
        <TabBar
          tab={tab}
          onTabChange={onTabChange}
          {...(settingsNote ? { settingsNote } : undefined)}
        />
        {offerSearch || offerOptions || tab === PANEL_TAB.SETTINGS || conversationTab ? (
          <span className="header-controls">
            {offerSearch ? (
              <SessionSearchButton open={searchOpen} onToggle={onSearchToggle} />
            ) : null}
            {/* The settings' own magnifier, in the sessions magnifier's spot:
                each tab's search is opened from the same place, and only the
                showing tab's is offered. */}
            {tab === PANEL_TAB.SETTINGS ? (
              <SettingsSearchButton open={settingsSearchOpen} onToggle={onSettingsSearchToggle} />
            ) : null}
            {/* Conversation's clear, in the same spot again: its words are the
                build's own, so it may stand outside the blocked subtree the
                thread's words never leave. */}
            {offerConversationClear ? (
              <ConversationClearButton onClear={onClearConversationConversation} />
            ) : null}
            {/* The turn to the sub-agents list and back, offered whenever the
                tab is showing: an empty list has its own words to say. Lit on
                the list and on a transcript alike, since both are the
                sub-agents' pages; either press returns to the thread. */}
            {conversationTab ? (
              <SubagentsButton
                open={!threadPage}
                onToggle={() =>
                  onConversationPageChange(
                    threadPage ? CONVERSATION_PAGE.SUBAGENTS : CONVERSATION_PAGE.THREAD,
                  )
                }
              />
            ) : null}
            {offerOptions ? (
              <SessionOptionsButton
                list={list}
                open={optionsOpen}
                onToggle={onOptionsToggle}
                onClear={() => onFiltersChange([])}
              />
            ) : null}
          </span>
        ) : null}
      </div>
      {tab === PANEL_TAB.SETTINGS ? (
        <SettingsPanel {...settings} />
      ) : subagentsPage ? (
        <SubagentsPanel
          subagents={subagents}
          now={now}
          onOpenChild={onOpenSubagent}
          onBack={() => onConversationPageChange(CONVERSATION_PAGE.THREAD)}
        />
      ) : transcriptChild !== undefined ? (
        <SubagentTranscriptPanel
          childId={transcriptChild}
          subagents={subagents}
          transcript={childTranscript}
          roster={roster}
          now={now}
          onOpenChat={onOpenChat}
          onBack={() => onConversationPageChange(CONVERSATION_PAGE.SUBAGENTS)}
        />
      ) : conversationTab ? (
        <ConversationPanel
          view={conversation}
          roster={roster}
          subagents={subagents.children}
          onOpenChat={onOpenChat}
          onOpenChild={onOpenSubagent}
          onOfferRatingFeedback={onOfferRatingFeedback}
          live={liveConversationEntries}
          spokenAskPending={spokenAskPending}
          now={now}
        />
      ) : (
        <SessionsPanel
          className="session-view"
          {...(optionsRoom ? { style: optionsRoom } : undefined)}
        >
          {offerOptions && optionsOpen ? (
            <SessionOptions
              list={list}
              view={view}
              onViewChange={onViewChange}
              onFiltersChange={onFiltersChange}
              measure={optionsElement}
            />
          ) : null}
          {searchOpen ? (
            <SessionSearch
              list={list}
              view={view}
              onViewChange={onViewChange}
              onClose={onSearchClose}
              onEngagedChange={onFieldEngaged}
            />
          ) : null}
          <div className="session-list" ref={sessionListRef}>
            {rows.length === 0 ? (
              // Only a roster actually read may say the list is empty: before
              // the first reading, "nothing to watch" and "no matches" alike
              // would claim a fact nobody has checked — a search restored at
              // launch arrives before the roster does — so the loading rows
              // stand in for both.
              !sessionsSettled ? (
                <LoadingState />
              ) : list.search ? (
                <SearchEmptyState
                  beyondFilter={list.search.beyondFilter}
                  onWiden={() => onViewChange(widenedView(view))}
                />
              ) : (
                <EmptyState
                  providerConnected={providerConnect.connected}
                  onConnectProvider={providerConnect.onConnect}
                />
              )
            ) : (
              // Runs are read over the drawn order, leaving rows and all: a
              // fading chat still holds its slot in its tray, and the tray
              // may not close around it until it has gone. Keys are resolved
              // over the whole list at once, because a run's key depends on
              // the other runs of its workspace.
              runs.map((run, at) => {
                const tray = runDrawsTray(run);
                const living = run.indexes
                  .map((index) => rows[index])
                  .filter((row): row is RosterRow<SessionView> => row !== undefined && !row.leaving)
                  .map((row) => row.item);
                const change = tray ? workspaceTrayChange(living) : undefined;
                return (
                  <SessionRun
                    key={runKeys[at]}
                    run={run}
                    sessions={living}
                    {...(change ? { change } : undefined)}
                    highlight={highlight}
                    writes={writes}
                  >
                    {run.indexes.map((index) => {
                      const row = rows[index];
                      return row ? (
                        <SessionRow
                          key={row.item.id}
                          session={row.item}
                          index={index}
                          now={now}
                          leaving={row.leaving}
                          inWorkspaceTray={tray}
                          changeInTrayHeader={change !== undefined}
                          highlight={highlight}
                          onOpen={onOpenSession}
                          onOpenApplication={onOpenSessionApplication}
                          writes={writes}
                        />
                      ) : null;
                    })}
                  </SessionRun>
                );
              })
            )}
          </div>
        </SessionsPanel>
      )}
    </div>
  );
}
