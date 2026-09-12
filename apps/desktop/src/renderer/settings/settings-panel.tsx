import type { AccountSnapshot } from "@sidecar/credentials/snapshot";
import { ACCOUNT_STATUS } from "@sidecar/credentials/snapshot";
import { PowerIcon } from "@sidecar/panel";
import { SETTINGS_PAGE as SCHEMA_SETTINGS_PAGE, type SettingsRowsInput } from "@sidecar/settings";
import type { AppSettingsView } from "@sidecar/settings/wire";
import { cssCustomProperties } from "@sidecar/surface/react-css";
import type { ActionResult } from "@sidecar/wire";
import { useEffect, useRef, useState } from "react";
import type { CredentialEntryControl } from "../credential-entry";
import type { FeedbackEntryControl } from "../feedback-entry";
import { voiceAttentionNote } from "../microphone-access";
import { PANEL_TAB, panelPanelId, panelTabId } from "../panel-tabs";
import { SETTINGS_SEARCH_ROW, searchAnchorProps } from "../settings-anchors";
import {
  landOnSettingsRow,
  SettingsSearch,
  type SettingsSearchEntry,
  SettingsSearchResults,
  searchSettings,
  settingsSearchEntries,
} from "../settings-search";
import {
  SETTINGS_SUBVIEW_LIST,
  SETTINGS_VIEW,
  type SettingsSubview,
  type SettingsView,
  settingsNavRowId,
} from "../settings-views";
import { AccountSection } from "./account-section";
import { AppearanceSection } from "./appearance-page";
import { CredentialsSection, IntegrationsSection, WorkspacesSection } from "./connections-page";
import type {
  AppleCalendarControl,
  CalendarControl,
  MicrophoneControl,
  ShortcutControl,
  UpdateControl,
  WorkspaceProviderOption,
} from "./controls";
import { FeedbackSection } from "./feedback-section";
import { SETTINGS_PAGE, SettingsNavRow, SettingsPageHeader } from "./pages";
import { pageResetControl } from "./reset";
import { SchemaSettingRows } from "./schema-rows";
import { ShortcutSection } from "./shortcuts-page";
import { UpdatesSection } from "./updates";
import { settingsRowsInput, useConnectionInput } from "./use-connection-input";
import { VoiceSection } from "./voice-page";
import { useSettingsWrites } from "./writes";

/**
 * The settings tab, as the grouped controls that draw it. A preference write
 * or a shortcut lives on its own bundle so a leaf can change without the
 * panel, the body, or the app's settings object growing a new field.
 */
export interface SettingsPanelProps {
  account: AccountSnapshot;
  onSignOut: () => Promise<void>;
  /**
   * Asks the service to erase the account, resolving to why when it refuses —
   * the row keeps drawing the account it still has, with the answer under it.
   */
  onDeleteAccount: () => Promise<ActionResult>;
  /**
   * Which settings page is showing: the front page, or one of the pages a
   * front-page row opens. Held by the app rather than here because Escape
   * unwinds it and a credential entry has to survive a trip to the key slot
   * with its page intact.
   */
  view: SettingsView;
  onViewChange: (view: SettingsView) => void;
  microphone: MicrophoneControl;
  updates: UpdateControl;
  settings?: AppSettingsView;
  /** The one credential being entered anywhere, and everything that can be done to it. */
  credentials: CredentialEntryControl;
  /** The one note to the founders being written, and everything that can be done to it. */
  feedback: FeedbackEntryControl;
  /**
   * True while the panel is the shape on screen. A field can only hold the
   * caret then: everything here sits in an inert stage the rest of the time,
   * and an entry can outlast the panel it was started in.
   */
  panelOpen: boolean;
  /**
   * The providers the default-workspace row may offer: the ones currently
   * offering projects, plus a stored default that is not — a choice the row
   * cannot show is one that can be neither seen nor cleared.
   */
  workspaceProviders: readonly WorkspaceProviderOption[];
  /** Everything the Google Calendar block can do. */
  calendar: CalendarControl;
  /** Everything the Apple Calendar block can do. */
  appleCalendar: AppleCalendarControl;
  onQuit: () => void;
  shortcuts: ShortcutControl;
  /**
   * Whether the search field stands at the head of the front page. Held by
   * the app rather than here because the magnifier that answers for it lives
   * beside the tab bar, above this panel.
   */
  searchOpen: boolean;
  /** The field's own way out — Escape on an empty query — which also clears. */
  onSearchClose: () => void;
  /**
   * Reports someone being part-way through a settings search, which holds the
   * panel open against the pointer wandering off — the same hold a half-typed
   * ask has, for the same reason: the caret is the signal that hands are here.
   */
  onSearchEngaged: (engaged: boolean) => void;
}

export function SettingsPanel({
  account,
  onSignOut,
  onDeleteAccount,
  view,
  onViewChange,
  microphone,
  updates,
  settings,
  credentials,
  feedback,
  panelOpen,
  workspaceProviders,
  calendar,
  appleCalendar,
  onQuit,
  shortcuts,
  searchOpen,
  onSearchClose,
  onSearchEngaged,
}: SettingsPanelProps): React.JSX.Element {
  const writes = useSettingsWrites();
  // Why the front page's Voice row wears its mark, or nothing while voice is
  // fully set up. Judged here rather than on the Voice page because the mark
  // has to stand while that page is not drawn: it is the front page saying a
  // page one press away still needs a hand. The keyless half moved to the
  // Account and usage heading with the ways in, so the row marks only a
  // microphone still ungranted for a voice that can run.
  const voiceNote = microphone.voiceAvailable
    ? voiceAttentionNote({ voiceAvailable: true, status: microphone.status })
    : undefined;
  // The query someone typed into the search field. Held here rather than
  // above because nothing else answers to it — and corrected during the
  // render that discovers the field closed or the panel gone, the way the
  // removal confirm is, because a query belongs to the field it was typed in.
  const [searchQuery, setSearchQuery] = useState("");
  if (searchQuery !== "" && (!panelOpen || !searchOpen)) setSearchQuery("");
  // What the pages currently offer, read afresh each render: every row's own
  // condition is judged from this one record, by the rows the pages draw and
  // by the search corpus alike, so a result never leads to a page without
  // its row.
  const panelView: SettingsRowsInput | undefined = settings
    ? settingsRowsInput({ settings, account, microphone, workspaceProviders })
    : undefined;
  // Everything the connection rows are judged from and acted through,
  // assembled once for every page that draws one.
  const connections = useConnectionInput({
    ...(panelView ? { view: panelView } : undefined),
    ...(settings ? { settings } : undefined),
    account,
    credentials,
    calendar,
    appleCalendar,
    workspaceProviders,
    panelOpen,
  });
  // Built only while a query stands: an empty field searches nothing.
  const search =
    panelView && searchOpen && searchQuery !== ""
      ? searchSettings(settingsSearchEntries(panelView), searchQuery)
      : undefined;
  // A pressed result is the search answered: the field closes, the page the
  // result named opens, and the view follows to the row itself — its control
  // focused where it has one, the row scrolled into view where it does not.
  // Fire-and-forget like the session search's summons — the seek gives
  // itself up after its own frame limit.
  const openSearchResult = (entry: SettingsSearchEntry) => {
    onSearchClose();
    onViewChange(entry.page);
    landOnSettingsRow(entry.id);
  };
  // A pressed group head is the same answer one level up: the page itself.
  const openSearchPage = (page: SettingsSubview) => {
    onSearchClose();
    onViewChange(page);
  };
  // Moving between pages moves the keyboard with it: into a page, onto its
  // back button; back out, onto the row that opened the page just left. Keyed
  // to the page, because the control being reached for only exists once the
  // new page is mounted. Only while the panel is the shape on screen — a
  // view reset behind a closed panel is housekeeping, and reaching into an
  // inert stage would find nothing focusable anyway.
  const backControl = useRef<HTMLButtonElement | null>(null);
  const heldView = useRef(view);
  useEffect(() => {
    const previous = heldView.current;
    heldView.current = view;
    if (previous === view || !panelOpen) return;
    if (view === SETTINGS_VIEW.ROOT) {
      if (previous !== SETTINGS_VIEW.ROOT) {
        document.getElementById(settingsNavRowId(previous))?.focus();
      }
      return;
    }
    backControl.current?.focus();
  }, [view, panelOpen]);
  // The drawn page's reset, absent while that page stands at its defaults.
  const pageReset = pageResetControl(view, settings, writes);
  return (
    <div
      className="settings"
      role="tabpanel"
      id={panelPanelId(PANEL_TAB.SETTINGS)}
      aria-labelledby={panelTabId(PANEL_TAB.SETTINGS)}
    >
      {view !== SETTINGS_VIEW.ROOT ? (
        <SettingsPageHeader
          view={view}
          onBack={() => onViewChange(SETTINGS_VIEW.ROOT)}
          backControl={backControl}
          {...(pageReset ? { reset: pageReset } : undefined)}
        />
      ) : null}

      {settings && searchOpen ? (
        <SettingsSearch
          query={searchQuery}
          search={search}
          onQueryChange={setSearchQuery}
          onClose={onSearchClose}
          onEngagedChange={onSearchEngaged}
        />
      ) : null}

      {search ? (
        <SettingsSearchResults
          search={search}
          pageIcon={(page) => SETTINGS_PAGE[page].icon}
          onOpenPage={openSearchPage}
          onOpen={openSearchResult}
        />
      ) : null}

      {view === SETTINGS_VIEW.ROOT && !search ? (
        /* A newer release waiting is marked on the tab rather than given a
           section of its own here: a section that changed places as its own
           check found news would rearrange the page under the hand that
           pressed it. */
        <section
          className="settings-section settings-index"
          style={cssCustomProperties({ "--row-index": 1 })}
        >
          {SETTINGS_SUBVIEW_LIST.map((subview) => (
            <SettingsNavRow
              key={subview}
              view={subview}
              onOpen={onViewChange}
              {...(subview === SETTINGS_VIEW.VOICE && voiceNote
                ? { attention: voiceNote }
                : undefined)}
            />
          ))}
        </section>
      ) : null}

      {view === SETTINGS_VIEW.VOICE && connections && panelView && !search ? (
        <VoiceSection
          input={connections}
          view={panelView}
          writes={writes}
          microphone={microphone}
        />
      ) : null}

      {view === SETTINGS_VIEW.APPEARANCE && panelView && !search ? (
        <AppearanceSection view={panelView} writes={writes} />
      ) : null}

      {view === SETTINGS_VIEW.SHORTCUTS && !search ? (
        <ShortcutSection
          shortcuts={shortcuts}
          writes={writes}
          {...(panelView ? { view: panelView } : undefined)}
          voiceAvailable={microphone.voiceAvailable}
        />
      ) : null}

      {view === SETTINGS_VIEW.CONNECTIONS && connections && panelView && !search ? (
        <>
          <WorkspacesSection view={panelView} writes={writes} />
          <CredentialsSection input={connections} />
          <IntegrationsSection input={connections} view={panelView} writes={writes} />
          {/* Whatever the page holds that stands under no heading of its
              own: the sections above draw their own members, and a setting
              added to this page with no section named lands here. */}
          <SchemaSettingRows
            page={SCHEMA_SETTINGS_PAGE.CONNECTIONS}
            view={panelView}
            writes={writes}
          />
        </>
      ) : null}

      {view !== SETTINGS_VIEW.ROOT || search ? null : (
        <>
          <UpdatesSection control={updates} rowIndex={2} />

          <FeedbackSection control={feedback} />

          {account.status === ACCOUNT_STATUS.SIGNED_IN ? (
            <AccountSection
              account={account}
              onSignOut={onSignOut}
              onDeleteAccount={onDeleteAccount}
              panelOpen={panelOpen}
            />
          ) : null}

          <button
            type="button"
            className="quit-button"
            style={cssCustomProperties({ "--row-index": 5 })}
            {...searchAnchorProps(SETTINGS_SEARCH_ROW.QUIT)}
            onClick={onQuit}
          >
            <PowerIcon />
            Quit Luke
          </button>
        </>
      )}
    </div>
  );
}
