import { type BrainRequestSnapshot, brainRequestPending } from "@sidecar/brain/requests-wire";
import {
  ACCOUNT_STATUS,
  type AccountProvider,
  type AccountSnapshot,
} from "@sidecar/credentials/snapshot";
import { ProviderMark } from "@sidecar/panel";
import type { ConversationEntry, SessionApplicationId } from "@sidecar/session";
import { cssCustomProperties } from "@sidecar/surface/react-css";
import { type AskHandler, AskLuke } from "./ask-luke";
import { CalendarGate, type CalendarGateControl } from "./calendar-gate";
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
  WorkspaceTrayChangeChip,
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
 * window — but it does carry the one pull request the chats share, which
 * sits where the workspace is named once instead of on each row of the
 * branch. The header names the tray in the reading order the same way
 * it does on screen: the workspace once, then its chats. A tray is a member of the
 * arrival stack in its rows' stead: it fans in at its lead row's turn, and
 * the rows ride it rather than fanning a second time inside it. A wrapper
 * that draws as nothing leaves its row in the stack exactly as before.
 */
function SessionRun({
  run,
  change,
  highlight,
  writes,
  children,
}: {
  run: SessionListRun;
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
          {change ? <WorkspaceTrayChangeChip change={change} writes={writes} /> : null}
        </header>
      ) : null}
      {children}
    </section>
  );
}

export interface PanelBodyProps {
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
  /** Opens the pull request a row or tray header reports; the panel writes nothing else. */
  writes: SessionWriteHandlers;
  /** The conversation between the developer and Luke, this launch's and what survived the last. */
  conversationLines: readonly ConversationEntry[];
  /** The lines still being said, drawn under that thread while their words grow. */
  liveConversationEntries: readonly ConversationEntry[];
  /** Clears that same thread from the view, Luke's next context, and the stored file. */
  onClearConversationConversation: () => void;
  /** The brain's runs, so Conversation draws Luke's turn while one is going and the composer offers its stop. */
  brainRequests: readonly BrainRequestSnapshot[];
  /** Stops every run still going, at the composer's press. */
  onStopThinking: () => void;
  /** Carries a typed ask to Luke's own conversation, answering why it could not go. */
  ask: AskHandler;
  /** Reports someone being part-way through an ask, so the panel holds for them. */
  onAskEngaged: (engaged: boolean) => void;
  /** The registered summon key the field should teach, if the system granted one. */
  askShortcut?: string;
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
  list,
  sessionsSettled,
  view,
  onViewChange,
  onFiltersChange,
  now,
  onOpenSession,
  onOpenSessionApplication,
  writes,
  conversationLines,
  liveConversationEntries,
  onClearConversationConversation,
  brainRequests,
  onStopThinking,
  ask,
  onAskEngaged,
  askShortcut,
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
  // Whether a run of Luke's is still going, read from the same records
  // Conversation draws the wait from, so the disc and the wait cannot disagree.
  const thinking = brainRequests.some(brainRequestPending);
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
  // Onboarding's second gate, past the account's: the roster and the settings
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
  // Clear retires recorded lines, so only a thread holding some offers it.
  const offerConversationClear = tab === PANEL_TAB.CONVERSATION && conversationLines.length > 0;
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
        {offerSearch || offerOptions || tab === PANEL_TAB.SETTINGS || offerConversationClear ? (
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
      ) : tab === PANEL_TAB.CONVERSATION ? (
        <ConversationPanel
          entries={conversationLines}
          live={liveConversationEntries}
          requests={brainRequests}
          now={now}
          ask={ask}
          onAskEngaged={onAskEngaged}
          onStop={onStopThinking}
          {...(askShortcut ? { askShortcut } : undefined)}
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
              onEngagedChange={onAskEngaged}
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
                <EmptyState />
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
          {/* Luke's own composer holds the panel's foot, under whatever the
              list shows — even an empty one, because "what needs me?" is a
              question worth typing before any session has appeared. It arrives
              at the tail of the same fan the rows ride. */}
          <AskLuke
            ask={ask}
            onEngagedChange={onAskEngaged}
            rowIndex={rows.length + 1}
            thinking={thinking}
            onStop={onStopThinking}
            {...(askShortcut ? { shortcut: askShortcut } : undefined)}
          />
        </SessionsPanel>
      )}
    </div>
  );
}
