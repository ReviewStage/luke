import { APPLE_CALENDAR_ACCESS, APPLE_CALENDAR_ID } from "@sidecar/calendar/vocabulary";
import type { AccountProvider } from "@sidecar/credentials/snapshot";
import type { CredentialProviderId } from "@sidecar/credentials/vocabulary";
import type { ObservedWorkspaceProject } from "@sidecar/session";
import { APP_SETTING_SCHEMA } from "@sidecar/settings";
import type { ObservedAccountCalendars, SettingsUpdateResult } from "@sidecar/settings/wire";
import { type RefObject, useCallback, useEffect, useMemo, useRef, useState } from "react";
import { CONSENT_SERVICE_ID, type ConsentServiceId } from "#shared/consent-services";
import { ACT_KIND } from "#shared/messages/acts";
import type { SupersetSignInSnapshot } from "#shared/messages/session";
import { SUPERSET_SIGN_IN_STAGE, SUPERSET_WORKSPACE_PROVIDER_ID } from "#shared/messages/session";
import { act, tell, updateSettingEntry } from "./act";
import type { ConsentConnectEntry } from "./consent-connect-slot";
import type { CredentialEntry, CredentialEntryControl } from "./credential-entry";
import { isSubmittable, removalEndsEntry } from "./credential-entry";
import { PANEL_PRESENTATION } from "./panel-state";
import type {
  AppleCalendarControl,
  CalendarControl,
  LinearControl,
  SupersetControl,
} from "./settings/controls";
import {
  PANEL_STAND_DOWN,
  type SettingsView,
  type SlotOccupant,
  standDownReturnPage,
} from "./settings-views";
import { type PanelEntrySurface, panelEntryOpen, usePanelEntry } from "./use-panel-entry";
import { useStateWithRef } from "./use-state-with-ref";

/**
 * The bridge acts behind each consent service's wait: the documented connect
 * the slot's send runs, the main-process side a mid-wait cancel must stop,
 * and — for the browser flows alone — the way a lost tab reopens. One row
 * per service, so a fourth service is a fourth row rather than a fourth
 * branch at every dispatch site.
 */
const CONSENT_ACTS = {
  [CONSENT_SERVICE_ID.APPLE_CALENDAR]: {
    connect: () => act(ACT_KIND.CALENDAR_CONNECT_APPLE),
    cancel: () => tell(ACT_KIND.CALENDAR_CANCEL_APPLE_CONNECT),
  },
  [CONSENT_SERVICE_ID.GOOGLE_CALENDAR]: {
    connect: () => act(ACT_KIND.CALENDAR_CONNECT_GOOGLE),
    cancel: () => tell(ACT_KIND.CALENDAR_CANCEL_GOOGLE_SIGN_IN),
    reopen: () => tell(ACT_KIND.CALENDAR_REOPEN_GOOGLE_SIGN_IN),
  },
  [CONSENT_SERVICE_ID.LINEAR]: {
    connect: () => act(ACT_KIND.TRACKER_CONNECT),
    cancel: () => tell(ACT_KIND.TRACKER_CANCEL_SIGN_IN),
    reopen: () => tell(ACT_KIND.TRACKER_REOPEN_SIGN_IN),
  },
} as const satisfies Readonly<
  Record<
    ConsentServiceId,
    { connect: () => Promise<SettingsUpdateResult>; cancel: () => void; reopen?: () => void }
  >
>;

export interface UseConnectionsOptions {
  surface: PanelEntrySurface;
  /** The three holds the presentation cluster reads without waiting a render. */
  credentialHeld: RefObject<boolean>;
  consentConnectHeld: RefObject<boolean>;
  supersetSignInHeld: RefObject<boolean>;
  /** Where leaving the slot this connection stood down to comes back to. */
  standDownPage: RefObject<SettingsView>;
  /** Brings the panel forward around what a landed sign-in just unlocked. */
  expand: () => void;
  calendars: readonly ObservedAccountCalendars[];
  superset: {
    installed: boolean;
    connected: boolean;
    signIn: SupersetSignInSnapshot;
    /** The stored default agent, which lives in the settings document. */
    defaultAgent: string | undefined;
  };
  workspaceProjects: readonly ObservedWorkspaceProject[];
}

export interface Connections {
  /** The one credential being entered anywhere, and everything done to it. */
  credentials: CredentialEntryControl;
  credentialEntry: CredentialEntry | undefined;
  /** Opens the key entry directly, which only the evidence run needs. */
  beginEntry: (providerId: CredentialProviderId) => void;
  cancelEntry: () => void;
  /** Which entry the slot shape is drawn around, read as the render draws it. */
  slotOccupant: RefObject<SlotOccupant>;
  consentEntry: ConsentConnectEntry | undefined;
  consentWaiting: () => ConsentConnectEntry | undefined;
  cancelConsentSignIn: () => void;
  /**
   * Reopens the consent page the waiting flow built, named by the service the
   * entry says is waiting — no address from here.
   */
  reopenConsentPage: () => void;
  calendar: CalendarControl;
  appleCalendar: AppleCalendarControl;
  linear: LinearControl;
  supersetControl: SupersetControl;
  beginSupersetSignIn: () => void;
  cancelSupersetSignIn: () => void;
  signInWait: AccountProvider | undefined;
  signInWaitNow: () => AccountProvider | undefined;
  signInFailure: string | undefined;
  beginSignIn: (provider: AccountProvider) => void;
  cancelSignIn: () => void;
}

/**
 * Every connection the panel offers, and the one slot they share. A key being
 * pasted, a consent page being waited on, a Superset login and an account
 * sign-in are four flows with one shape between them, so they are held
 * together: only here can one refuse to disturb another.
 */
export function useConnections(options: UseConnectionsOptions): Connections {
  const {
    surface,
    credentialHeld,
    consentConnectHeld,
    supersetSignInHeld,
    standDownPage,
    expand,
    calendars,
    workspaceProjects,
  } = options;
  const { presentation: presentationOf, applyPresentation, cancelHover, restorePanel } = surface;
  const supersetSignIn = options.superset.signIn;
  /**
   * Which entry the slot shape is drawn around — a key being pasted or either
   * sign-in being waited out. One shape, three occupants, never together.
   */
  const slotOccupant = useRef<SlotOccupant>(PANEL_STAND_DOWN.KEY);

  const removeCalendarAccount = useCallback(
    (accountId: string) => act(ACT_KIND.CALENDAR_REMOVE_ACCOUNT, { accountId }),
    [],
  );

  const toggleCalendarSelected = useCallback(
    (accountId: string, calendarId: string, selected: boolean) =>
      act(ACT_KIND.CALENDAR_SET_SELECTED, { accountId, calendarId, selected }),
    [],
  );

  const disconnectAppleCalendar = useCallback(() => act(ACT_KIND.CALENDAR_DISCONNECT_APPLE), []);

  const toggleAppleCalendarSelected = useCallback(
    (calendarId: string, selected: boolean) =>
      act(ACT_KIND.CALENDAR_SET_SELECTED, { accountId: APPLE_CALENDAR_ID, calendarId, selected }),
    [],
  );

  const disconnectLinear = useCallback(() => act(ACT_KIND.TRACKER_DISCONNECT), []);

  /**
   * A consent sign-in is asking for one thing too, so the panel gets out of
   * the way of it the same way it does for a key: the shape goes down to a
   * slot that says what it is waiting for. The flow itself runs in the
   * browser and the main process; when the grant lands, the panel comes back
   * around the newly connected service. One entry serves every such sign-in,
   * because only one consent page can be open at a time and there is only one
   * slot for it to stand in.
   */
  const consentConnect = usePanelEntry<ConsentConnectEntry>({
    ...surface,
    aside: PANEL_PRESENTATION.SLOT,
    // Giving up mid-wait leaves — the consent page is where the user is — but
    // a sign-in that failed is read in the slot, so its Close restores the
    // panel to try again from the row.
    restoresPanel: (held) => held.rejection !== undefined,
    isSendable: (entry): entry is ConsentConnectEntry => entry !== undefined && !entry.busy,
    send: async (sending) => {
      // Which service is being connected decides which documented act runs,
      // and nothing else does: the entry names a row of the acts table.
      const result = await CONSENT_ACTS[sending.serviceId].connect();
      return result.reason ? { rejection: result.reason } : {};
    },
    heldRef: consentConnectHeld,
  });

  /** One press: stand down to the waiting slot and open the consent page. */
  const beginConsentSignIn = useCallback(
    (serviceId: ConsentServiceId) => {
      // One slot, one occupant: a key mid-paste is not disturbed by a
      // sign-in, and neither is another sign-in already waiting.
      if (credentialHeld.current || consentConnectHeld.current) return;
      slotOccupant.current = PANEL_STAND_DOWN.CONSENT;
      // Every consent block stands under Integrations, so that is where a
      // cancelled or refused sign-in comes back to.
      standDownPage.current = standDownReturnPage({ kind: PANEL_STAND_DOWN.CONSENT });
      consentConnect.begin({ serviceId, busy: false });
      consentConnect.commit();
    },
    [
      consentConnect.begin,
      consentConnect.commit,
      consentConnectHeld,
      credentialHeld,
      standDownPage,
    ],
  );

  /** True while a granted-already connect runs on the row, dialog-free. */
  const [appleCalendarBusy, setAppleCalendarBusy] = useState(false);

  /**
   * Connecting this Mac's Calendar stands the panel down only when macOS is
   * actually about to ask: with the grant already standing, the dialog never
   * appears, and a stand-down would flash the slot for a single frame — so
   * the press probes the status first and connects in place when it can.
   */
  const connectAppleCalendar = useCallback(async () => {
    setAppleCalendarBusy(true);
    let granted = false;
    try {
      granted = (await act(ACT_KIND.CALENDAR_APPLE_ACCESS_STATUS)) === APPLE_CALENDAR_ACCESS.FULL;
      if (granted) await act(ACT_KIND.CALENDAR_CONNECT_APPLE);
    } finally {
      setAppleCalendarBusy(false);
    }
    if (!granted) beginConsentSignIn(CONSENT_SERVICE_ID.APPLE_CALENDAR);
  }, [beginConsentSignIn]);

  /** The Mac's own entry in the latest calendars broadcast, for its block. */
  const appleCalendarObserved = calendars.find((choice) => choice.accountId === APPLE_CALENDAR_ID);

  /**
   * Whether another entry holds the one slot, which refuses this service's
   * Connect: a key mid-paste, or a different service's consent wait.
   */
  const slotHeldExcept = (serviceId: ConsentServiceId) =>
    credentialsEntry.entry !== undefined ||
    (consentConnect.entry !== undefined && consentConnect.entry.serviceId !== serviceId);

  const cancelConsentSignIn = useCallback(() => {
    // Mid-wait, the flow's main-process side must stop listening too — a
    // browser flow's loopback, or Apple's System Settings watch; after a
    // failure there is nothing left to stop.
    const waiting = consentConnect.latest();
    if (waiting?.busy) CONSENT_ACTS[waiting.serviceId].cancel();
    consentConnect.cancel();
  }, [consentConnect.cancel, consentConnect.latest]);

  // The stage the slot draws is the document's throughout: the flow moves it
  // as it goes — browser code, exchanging, the organization choice — and each
  // stage reaches every window before the press's own reply returns.
  const beginSupersetSignIn = useCallback(() => {
    if (supersetSignInHeld.current) {
      if (supersetSignIn.stage === SUPERSET_SIGN_IN_STAGE.FAILURE) {
        tell(ACT_KIND.SUPERSET_BEGIN_SIGN_IN);
      }
      return;
    }
    if (credentialHeld.current || consentConnectHeld.current) return;
    supersetSignInHeld.current = true;
    slotOccupant.current = PANEL_STAND_DOWN.SUPERSET;
    standDownPage.current = standDownReturnPage({ kind: PANEL_STAND_DOWN.SUPERSET });
    cancelHover();
    applyPresentation(PANEL_PRESENTATION.SLOT);
    tell(ACT_KIND.SUPERSET_BEGIN_SIGN_IN);
  }, [
    applyPresentation,
    cancelHover,
    consentConnectHeld,
    credentialHeld,
    standDownPage,
    supersetSignIn.stage,
    supersetSignInHeld,
  ]);

  const cancelSupersetSignIn = useCallback(() => {
    if (!supersetSignInHeld.current) return;
    tell(ACT_KIND.SUPERSET_CANCEL_SIGN_IN);
    supersetSignInHeld.current = false;
    if (presentationOf() === PANEL_PRESENTATION.SLOT) restorePanel();
  }, [presentationOf, restorePanel, supersetSignInHeld]);

  const disconnectSuperset = useCallback(() => act(ACT_KIND.SUPERSET_DISCONNECT), []);

  /**
   * Asking to write a key is asking for one thing, so the panel gets out of the
   * way of it: the shape goes down to the slot, which is the field and nothing
   * else. It is the same wherever the key is coming from — a first connection, a
   * stored key being replaced, or one standing in front of the environment's —
   * because they are all the same act.
   */
  const credentialsEntry = usePanelEntry<CredentialEntry>({
    ...surface,
    aside: PANEL_PRESENTATION.SLOT,
    restoresPanel: (held) => held.away !== true,
    isSendable: isSubmittable,
    send: async (sending) => {
      const result = await act(ACT_KIND.CREDENTIAL_SET_API_KEY, {
        providerId: sending.providerId,
        apiKey: sending.draft,
      });
      return result.reason ? { rejection: result.reason } : {};
    },
    heldRef: credentialHeld,
  });

  const beginEntry = useCallback(
    (providerId: CredentialProviderId) => {
      // Where the entry's row is drawn, remembered before the trip to the
      // slot so coming back lands on the page the entry began on.
      standDownPage.current = standDownReturnPage({ kind: PANEL_STAND_DOWN.KEY, providerId });
      slotOccupant.current = PANEL_STAND_DOWN.KEY;
      credentialsEntry.begin({ providerId, draft: "", busy: false, away: false });
    },
    [credentialsEntry.begin, standDownPage],
  );

  /**
   * A Connect press: the same entry {@link beginEntry} opens, with the
   * provider's key page opened in the same press. Someone connecting has no
   * key yet, so the first thing they need is the page that issues one — the
   * consent and CLI connectors already work this way, because their browser
   * half *is* the connection. The entry starts `away` for the same reason
   * {@link fetchKey} marks it: the person this slot is now waiting for is
   * reading a browser, so giving up leaves the browser alone rather than
   * bringing the panel back over it. The page is still opened by provider id,
   * so the only addresses reachable are the ones the credential registry
   * fixes.
   */
  const connectEntry = useCallback(
    (providerId: CredentialProviderId) => {
      standDownPage.current = standDownReturnPage({ kind: PANEL_STAND_DOWN.KEY, providerId });
      slotOccupant.current = PANEL_STAND_DOWN.KEY;
      tell(ACT_KIND.CREDENTIAL_OPEN_API_KEYS, { providerId });
      credentialsEntry.begin({ providerId, draft: "", busy: false, away: true });
    },
    [credentialsEntry.begin, standDownPage],
  );

  /**
   * Sends the browser to the provider's key page. The entry remembers that it
   * did: from here on, the person this slot is waiting for is reading a page
   * that Luke — which floats above every window — would otherwise be sitting on
   * top of. It is also what the slot is for, so the shape is already right; the
   * panel is only stood down if the link was pressed from inside it.
   */
  const fetchKey = useCallback(() => {
    const current = credentialsEntry.latest();
    // Same rule as typing: the key on its way to the store is what the entry is
    // for, and going to fetch another one is not a reason to disturb it. Both
    // views disable the link while it is in flight, so this is the floor rather
    // than the answer.
    if (!panelEntryOpen(current)) return;
    tell(ACT_KIND.CREDENTIAL_OPEN_API_KEYS, { providerId: current.providerId });
    credentialsEntry.apply({ ...current, away: true });
    if (presentationOf() === PANEL_PRESENTATION.SLOT) return;
    credentialsEntry.standDown();
  }, [credentialsEntry.apply, credentialsEntry.latest, credentialsEntry.standDown, presentationOf]);

  const removeProviderApiKey = useCallback(
    async (providerId: CredentialProviderId) => {
      const result = await act(ACT_KIND.CREDENTIAL_SET_API_KEY, { providerId });
      // Delete and the field are on the row together once the panel has been
      // brought back around an entry, and a key that has been removed cannot be
      // replaced.
      if (removalEndsEntry(credentialsEntry.latest(), providerId, result.reason)) {
        credentialsEntry.apply(undefined);
      }
      return result;
    },
    [credentialsEntry.apply, credentialsEntry.latest],
  );

  const credentials: CredentialEntryControl = {
    entry: credentialsEntry.entry,
    begin: beginEntry,
    connect: connectEntry,
    change: (draft) => credentialsEntry.patch({ draft }),
    fetchKey,
    cancel: credentialsEntry.cancel,
    commit: credentialsEntry.commit,
    remove: removeProviderApiKey,
  };

  /**
   * Whose sign-in the surface is waiting on. Choosing a provider on the gate
   * sends the browser to it and stands the panel down to a small waiting
   * popup, the way fetching an API key stands it down to the slot: the real
   * work is in the browser, and Luke floats above the page it needs. Held as
   * app state with a ref because the attempt's own reply has to read whether
   * it is still the one being waited on.
   */
  const [signInWait, setSignInWait, signInWaitNow] = useStateWithRef<AccountProvider | undefined>(
    undefined,
  );
  /**
   * Which attempt any reply answers. Cancel advances it, so the outcome of a
   * sign-in already withdrawn is spent rather than moving the shape again.
   */
  const signInAttempt = useRef(0);
  const [signInFailure, setSignInFailure] = useState<string>();

  const beginSignIn = useCallback(
    (provider: AccountProvider) => {
      if (signInWaitNow() !== undefined) return;
      const attempt = ++signInAttempt.current;
      setSignInFailure(undefined);
      setSignInWait(provider);
      cancelHover();
      applyPresentation(PANEL_PRESENTATION.SLOT);
      act(ACT_KIND.ACCOUNT_BEGIN_SIGN_IN, { provider }).then(
        () => {
          if (signInAttempt.current !== attempt) return;
          setSignInWait(undefined);
          if (presentationOf() !== PANEL_PRESENTATION.SLOT) return;
          // The panel comes forward around what was just unlocked — the
          // session roster — and stays open like any other opened panel:
          // signing in is an arrival, not an errand to settle and leave.
          expand();
        },
        () => {
          if (signInAttempt.current !== attempt) return;
          setSignInWait(undefined);
          setSignInFailure("Sign-in did not finish. Try again when you’re ready.");
          if (presentationOf() === PANEL_PRESENTATION.SLOT) expand();
        },
      );
    },
    [applyPresentation, cancelHover, expand, presentationOf, setSignInWait, signInWaitNow],
  );

  /**
   * Takes the wait back. The main process withdraws the loopback and signs the
   * attempt back out; the panel returns to the gate at once rather than
   * waiting for that round trip, and the attempt's eventual rejection finds
   * itself already spent.
   */
  const cancelSignIn = useCallback(() => {
    if (signInWaitNow() === undefined) return;
    signInAttempt.current += 1;
    setSignInWait(undefined);
    tell(ACT_KIND.ACCOUNT_CANCEL_SIGN_IN);
    if (presentationOf() === PANEL_PRESENTATION.SLOT) expand();
  }, [expand, presentationOf, setSignInWait, signInWaitNow]);

  const changeSupersetAgentDefault = useCallback(
    (agent: string | undefined) =>
      updateSettingEntry(
        APP_SETTING_SCHEMA.workspaceAgentDefaults.field,
        SUPERSET_WORKSPACE_PROVIDER_ID,
        agent === undefined ? undefined : { agent },
      ),
    [],
  );
  // A Superset sign-in carried through to the end gives the panel back around
  // the newly connected service. Only the wait's own slot is answered: a
  // connection the document reports for any other reason has no slot standing
  // to come back from.
  useEffect(() => {
    if (!supersetSignInHeld.current) return;
    if (supersetSignIn.stage !== SUPERSET_SIGN_IN_STAGE.CONNECTED) return;
    supersetSignInHeld.current = false;
    if (presentationOf() === PANEL_PRESENTATION.SLOT) restorePanel();
  }, [supersetSignIn, presentationOf, restorePanel, supersetSignInHeld]);

  const reopenConsentPage = useCallback(() => {
    const waiting = consentConnect.latest()?.serviceId;
    if (!waiting) return;
    const acts = CONSENT_ACTS[waiting];
    if ("reopen" in acts) acts.reopen();
  }, [consentConnect.latest]);

  const supersetAgents = useMemo(
    () => [
      ...new Set(
        workspaceProjects
          .filter((project) => project.providerId === SUPERSET_WORKSPACE_PROVIDER_ID)
          .flatMap((project) => project.spawnableAgents ?? []),
      ),
    ],
    [workspaceProjects],
  );

  const supersetControl: SupersetControl = {
    installed: options.superset.installed,
    connected: options.superset.connected,
    held: credentialHeld.current || consentConnectHeld.current,
    connecting: supersetSignInHeld.current,
    onConnect: beginSupersetSignIn,
    onDisconnect: disconnectSuperset,
    agents: supersetAgents,
    ...(options.superset.defaultAgent
      ? { defaultAgent: options.superset.defaultAgent }
      : undefined),
    onDefaultAgentChange: changeSupersetAgentDefault,
  };

  return {
    credentials,
    credentialEntry: credentialsEntry.entry,
    beginEntry,
    cancelEntry: credentialsEntry.cancel,
    slotOccupant,
    consentEntry: consentConnect.entry,
    consentWaiting: consentConnect.latest,
    cancelConsentSignIn,
    reopenConsentPage,
    calendar: {
      choices: calendars,
      held: slotHeldExcept(CONSENT_SERVICE_ID.GOOGLE_CALENDAR),
      connecting: consentConnect.entry?.serviceId === CONSENT_SERVICE_ID.GOOGLE_CALENDAR,
      onSignIn: () => beginConsentSignIn(CONSENT_SERVICE_ID.GOOGLE_CALENDAR),
      onRemoveAccount: removeCalendarAccount,
      onToggleCalendar: toggleCalendarSelected,
      onRefresh: () => act(ACT_KIND.CALENDAR_REFRESH),
    },
    appleCalendar: {
      choices: appleCalendarObserved?.calendars ?? [],
      held: slotHeldExcept(CONSENT_SERVICE_ID.APPLE_CALENDAR),
      connecting:
        appleCalendarBusy || consentConnect.entry?.serviceId === CONSENT_SERVICE_ID.APPLE_CALENDAR,
      onSignIn: () => void connectAppleCalendar(),
      onDisconnect: disconnectAppleCalendar,
      onToggleCalendar: toggleAppleCalendarSelected,
      revoked: appleCalendarObserved?.revoked === true,
    },
    linear: {
      held: slotHeldExcept(CONSENT_SERVICE_ID.LINEAR),
      connecting: consentConnect.entry?.serviceId === CONSENT_SERVICE_ID.LINEAR,
      onSignIn: () => beginConsentSignIn(CONSENT_SERVICE_ID.LINEAR),
      onDisconnect: disconnectLinear,
    },
    supersetControl,
    beginSupersetSignIn,
    cancelSupersetSignIn,
    signInWait,
    signInWaitNow,
    signInFailure,
    beginSignIn,
    cancelSignIn,
  };
}
