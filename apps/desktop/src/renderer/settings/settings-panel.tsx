import type { AccountSnapshot } from "@sidecar/credentials/snapshot";
import { ACCOUNT_STATUS } from "@sidecar/credentials/snapshot";
import { PowerIcon } from "@sidecar/panel";
import type { SettingsRowsInput } from "@sidecar/settings";
import type { AppSettingsView } from "@sidecar/settings/wire";
import { cssCustomProperties } from "@sidecar/surface/react-css";
import type { ActionResult } from "@sidecar/wire";
import { useEffect, useRef, useState } from "react";
import type { FeedbackEntryControl } from "../feedback-entry";
import { microphoneAccessRow, voiceAttentionNote } from "../microphone-access";
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
import type { MicrophoneControl, ShortcutControl, UpdateControl } from "./controls";
import { FeedbackSection } from "./feedback-section";
import { SETTINGS_PAGE, SettingsNavRow, SettingsPageHeader } from "./pages";
import { pageResetControl } from "./reset";
import { ShortcutSection } from "./shortcuts-page";
import { UpdatesSection } from "./updates";
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
   * unwinds it.
   */
  view: SettingsView;
  onViewChange: (view: SettingsView) => void;
  microphone: MicrophoneControl;
  updates: UpdateControl;
  settings?: AppSettingsView;
  /** The one note to the founders being written, and everything that can be done to it. */
  feedback: FeedbackEntryControl;
  /**
   * True while the panel is the shape on screen. A field can only hold the
   * caret then: everything here sits in an inert stage the rest of the time,
   * and an entry can outlast the panel it was started in.
   */
  panelOpen: boolean;
  onQuit: () => void;
  shortcuts: ShortcutControl;
  /**
   * Whether the search field stands at the head of the settings surface,
   * above whichever page is showing. Held by the app rather than here because
   * the magnifier that answers for it lives beside the tab bar, above this
   * panel.
   */
  searchOpen: boolean;
  /** The field's own way out — Escape on an empty query — which also clears. */
  onSearchClose: () => void;
  /**
   * Reports someone being part-way through a settings search, which holds the
   * panel open against the pointer wandering off: the caret is the signal that
   * hands are here.
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
  feedback,
  panelOpen,
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
    ? {
        settings,
        voiceControlsDrawn: microphoneAccessRow({
          voiceAvailable: microphone.voiceAvailable,
          status: microphone.status,
        }).ready,
        accountDrawn: account.status === ACCOUNT_STATUS.SIGNED_IN,
      }
    : undefined;
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
  // A front-page row pressed under an open, empty field is the same press —
  // the field was reached for and not used, and the page is the answer.
  const openPage = (page: SettingsSubview) => {
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
    <div className="settings">
      {/* The search stands first, above a page's own head: it reads across
          every page, so it is the surface's field rather than the page's,
          the way a desktop settings window keeps its search above whichever
          pane is showing. */}
      {settings && searchOpen ? (
        <SettingsSearch
          query={searchQuery}
          search={search}
          onQueryChange={setSearchQuery}
          onClose={onSearchClose}
          onEngagedChange={onSearchEngaged}
        />
      ) : null}

      {view !== SETTINGS_VIEW.ROOT ? (
        <SettingsPageHeader
          view={view}
          onBack={() => onViewChange(SETTINGS_VIEW.ROOT)}
          backControl={backControl}
          {...(pageReset ? { reset: pageReset } : undefined)}
        />
      ) : null}

      {search ? (
        <SettingsSearchResults
          search={search}
          pageIcon={(page) => SETTINGS_PAGE[page].icon}
          onOpenPage={openPage}
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
              onOpen={openPage}
              {...(subview === SETTINGS_VIEW.VOICE && voiceNote
                ? { attention: voiceNote }
                : undefined)}
            />
          ))}
        </section>
      ) : null}

      {view === SETTINGS_VIEW.VOICE && panelView && !search ? (
        <VoiceSection view={panelView} writes={writes} microphone={microphone} />
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
