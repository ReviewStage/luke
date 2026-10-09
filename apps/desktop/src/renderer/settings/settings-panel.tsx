import type { AccountSnapshot } from "@sidecar/credentials/snapshot";
import { ACCOUNT_STATUS } from "@sidecar/credentials/snapshot";
import type { SettingsRowsInput } from "@sidecar/settings";
import type { AppSettingsView } from "@sidecar/settings/wire";
import { cssCustomProperties } from "@sidecar/surface/react-css";
import type { ActionResult } from "@sidecar/wire";
import { useEffect, useRef } from "react";
import type { FeedbackEntryControl } from "../feedback-entry";
import { microphoneAccessRow, voiceAttentionNote } from "../microphone-access";
import {
  SETTINGS_SUBVIEW_LIST,
  SETTINGS_VIEW,
  type SettingsView,
  settingsNavRowId,
} from "../settings-views";
import { AccountSection } from "./account-section";
import { AppearanceSection } from "./appearance-page";
import { CodingAgentsSection } from "./coding-agents-page";
import type { MicrophoneControl, ShortcutControl, UpdateControl } from "./controls";
import { FeedbackSection } from "./feedback-section";
import { SettingsNavRow, SettingsPageHeader } from "./pages";
import { ShortcutSection, WindowShortcutSections } from "./shortcuts-page";
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
  shortcuts: ShortcutControl;
}

/**
 * What the pages currently offer, read afresh each render: every row's own
 * condition is judged from this one record, by the rows the pages draw and by
 * the search corpus alike, so a result never leads to a page without its row.
 * Absent until the settings have arrived.
 */
export function settingsRowsInput({
  settings,
  microphone,
  account,
}: {
  settings?: AppSettingsView | undefined;
  microphone: MicrophoneControl;
  account: AccountSnapshot;
}): SettingsRowsInput | undefined {
  if (!settings) return undefined;
  return {
    settings,
    voiceControlsDrawn: microphoneAccessRow({
      voiceAvailable: microphone.voiceAvailable,
      status: microphone.status,
    }).ready,
    accountDrawn: account.status === ACCOUNT_STATUS.SIGNED_IN,
  };
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
  shortcuts,
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
  const panelView = settingsRowsInput({ settings, microphone, account });
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
  return (
    <div className="settings">
      {view !== SETTINGS_VIEW.ROOT ? (
        <SettingsPageHeader
          view={view}
          onBack={() => onViewChange(SETTINGS_VIEW.ROOT)}
          backControl={backControl}
        />
      ) : null}

      {view === SETTINGS_VIEW.ROOT ? (
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

      {view === SETTINGS_VIEW.VOICE && panelView ? (
        <VoiceSection view={panelView} writes={writes} microphone={microphone} />
      ) : null}

      {view === SETTINGS_VIEW.APPEARANCE && panelView ? (
        <AppearanceSection view={panelView} writes={writes} />
      ) : null}

      {view === SETTINGS_VIEW.CODING_AGENTS ? (
        <CodingAgentsSection signedIn={account.status === ACCOUNT_STATUS.SIGNED_IN} />
      ) : null}

      {view === SETTINGS_VIEW.SHORTCUTS ? (
        <>
          <ShortcutSection
            shortcuts={shortcuts}
            writes={writes}
            {...(panelView ? { view: panelView } : undefined)}
            voiceAvailable={microphone.voiceAvailable}
          />
          <WindowShortcutSections />
        </>
      ) : null}

      {view !== SETTINGS_VIEW.ROOT ? null : (
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
        </>
      )}
    </div>
  );
}
