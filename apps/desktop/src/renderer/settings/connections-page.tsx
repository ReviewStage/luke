import { FolderIcon, KeyIcon, PlugIcon } from "@sidecar/panel";
import {
  SETTINGS_PAGE as SCHEMA_SETTINGS_PAGE,
  SETTING_SECTION,
  type SettingsRowsInput,
} from "@sidecar/settings";
import { cssCustomProperties } from "@sidecar/surface/react-css";
import { SETTINGS_VIEW } from "../settings-views";
import { ConnectionRow } from "./connection-row";
import {
  CONNECTION_SECTION,
  type ConnectionInput,
  connectionsFor,
  storageUnavailable,
} from "./connection-schema";
import { STORAGE_UNAVAILABLE_NOTE } from "./notes";
import { SchemaSettingRows } from "./schema-rows";
import type { SettingsWrites } from "./writes";

/** Every connection in one section, drawn by the one component that draws one. */
function ConnectionRows({
  section,
  input,
}: {
  section: (typeof CONNECTION_SECTION)[keyof typeof CONNECTION_SECTION];
  input: ConnectionInput;
}): React.JSX.Element {
  return (
    <>
      {connectionsFor(SETTINGS_VIEW.CONNECTIONS, section).map((spec) => (
        <ConnectionRow key={spec.id} spec={spec} input={input} />
      ))}
    </>
  );
}

/**
 * Every agent provider Luke can watch, one line each. A provider is listed
 * whether or not it is connected, because the list is how you learn which
 * services Luke can watch at all.
 */
export function CredentialsSection({ input }: { input: ConnectionInput }): React.JSX.Element {
  return (
    <section className="settings-section" style={cssCustomProperties({ "--row-index": 3 })}>
      <h2>
        <KeyIcon />
        Providers
      </h2>
      <ConnectionRows section={CONNECTION_SECTION.PROVIDERS} input={input} />
      {/* A Connect stilled by missing storage needs its why in this section too. */}
      {storageUnavailable(input) ? (
        <p className="settings-note">{STORAGE_UNAVAILABLE_NOTE}</p>
      ) : null}
    </section>
  );
}

/**
 * The calendar integrations, drawn as one block because they are one
 * capability: two ways into the same meetings — this Mac's own Calendar behind
 * macOS's consent dialog, and Google accounts behind Google's consent page —
 * sharing one line about what is read and the quiet switch the intervals exist
 * to drive. Each row appears only in a build that can offer it, and the block
 * only when either can.
 */
export function CalendarIntegrations({
  input,
  view,
  writes,
}: {
  input: ConnectionInput;
  /**
   * What the quiet row's own condition is judged from, absent for the
   * onboarding gate, which borrows this block without that row: the setting
   * defaults on, and a switch offered before the first calendar is even
   * confirmed reads as one more demand rather than a choice.
   */
  view?: SettingsRowsInput;
  writes: SettingsWrites;
}): React.JSX.Element | null {
  if (!input.settings.calendarSignInAvailable && !input.settings.appleCalendarAvailable) {
    return null;
  }
  return (
    <div className="credential">
      <ConnectionRows section={CONNECTION_SECTION.CALENDAR} input={input} />
      <p className="settings-note">
        Luke reads when your meetings start and end — never their titles — and can hold
        announcements until they finish.
      </p>
      {/* The quiet is a fact about the calendars above it, so it appears with
          the first connection and leaves with the last — a switch gating what
          a disconnected calendar cannot do would be a control over nothing.
          That condition is the setting's own, so this only says where. */}
      {view ? (
        <SchemaSettingRows
          page={SCHEMA_SETTINGS_PAGE.CONNECTIONS}
          section={SETTING_SECTION.CALENDAR}
          view={view}
          writes={writes}
        />
      ) : null}
    </div>
  );
}

/**
 * The services Luke connects to that are not agents: the calendars, signed
 * into rather than pasted into, so each is a mark, a name and one button, with its own one-line answer to what
 * connecting it buys. The OpenAI key is not here: it lives at the top of the
 * Voice page, beside the feature it turns on.
 */
export function IntegrationsSection({
  input,
  view,
  writes,
}: {
  input: ConnectionInput;
  view: SettingsRowsInput;
  writes: SettingsWrites;
}): React.JSX.Element {
  return (
    <section className="settings-section" style={cssCustomProperties({ "--row-index": 4 })}>
      <h2>
        <PlugIcon />
        Integrations
      </h2>
      <ConnectionRows section={CONNECTION_SECTION.INTEGRATIONS} input={input} />
      <CalendarIntegrations input={input} view={view} writes={writes} />
      {/* The same refusal the agents' section explains: a Connect stilled by
          missing storage needs its why in this section too. */}
      {storageUnavailable(input) ? (
        <p className="settings-note">{STORAGE_UNAVAILABLE_NOTE}</p>
      ) : null}
    </section>
  );
}

/**
 * What a conversational ask creates and where, beside the connections it
 * creates through: its own named group on the Connections page, because the
 * default is about every provider at once rather than any one row.
 */
export function WorkspacesSection({
  view,
  writes,
}: {
  view: SettingsRowsInput;
  writes: SettingsWrites;
}): React.JSX.Element {
  return (
    <section className="settings-section" style={cssCustomProperties({ "--row-index": 1 })}>
      {/* No group reset here: the workspace-creation defaults live as rows
          beside the providers they belong to, and a reset by this one select
          would reach settings drawn under other headings. */}
      <h2>
        <FolderIcon />
        Workspaces
      </h2>
      <SchemaSettingRows
        page={SCHEMA_SETTINGS_PAGE.CONNECTIONS}
        section={SETTING_SECTION.WORKSPACES}
        view={view}
        writes={writes}
      />
    </section>
  );
}
