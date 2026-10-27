/**
 * app-admin-doors.tsx -- the app's doors into the admin screens: the service's admin reads and its star asked through the window's host, and the gate's refusals in the app's own words.
 *
 * The window acts through its act port alone, so each read is `admin.read`
 * on it, which the host asks of the service under the account's session
 * (`@luke/features/admin-client`), and the star is `admin.favorite`. The
 * port carries no signal, so a read the screen stopped waiting on runs to
 * its end, and the read hook drops its answer (`use-admin-read.ts`), as it
 * drops any read it aborted. The app is signed in before it
 * draws, so nothing is held at the gate up front, and a refusal stands in
 * the page as the app's centred failure rather than a sign-in card. The app
 * keeps its places in its own history, whose step for each view has a Luke
 * link of its own (`links-at-hand.ts`), so a screen here keeps its search
 * to itself and an account opens on a press, as a step of that history.
 */

import type { AdminReadParams, AdminRefused } from "@luke/features/admin-wire";
import { ADMIN_UNANSWERED } from "@luke/features/admin-wire";
import { ACT_KIND } from "@luke/host/acts";
import { ERROR_STATE_PLACEMENT, ErrorState, PageToolbar } from "@luke/ui";
import { askAct } from "../act.js";
import {
  type AdminDoors,
  AdminDoorsProvider,
  AdminReadRefused,
  type AdminReads,
} from "./admin-doors.js";
import { useAdminToolbarLead } from "./chrome/page-header.js";

/** What the page says where the gate refused the read, in place of the view. */
const GATE_WORDS = {
  SIGNED_OUT: "Your session with the service has ended. Sign in again to read the admin dashboard.",
  FORBIDDEN: "This account does not have the admin role, which is set in the database.",
} as const;

/**
 * One admin read through the host: the service's answer, the shape the
 * procedure answers, or a refusal by its word; a read that failed for any
 * other reason rejects as the screen's own failure.
 */
async function readThroughHost<T>(
  procedure: AdminReadParams["procedure"],
  query: object,
): Promise<T> {
  // SAFETY: every admin query is a set of optional string parameters (`admin-wire.ts`).
  const params: AdminReadParams = { procedure, query: query as Record<string, string> };
  const answered = await askAct(ACT_KIND.ADMIN_READ, params);
  if ("refused" in answered) {
    if (answered.refused === ADMIN_UNANSWERED) throw new Error("The admin read was not answered.");
    throw new AdminReadRefused(answered.refused satisfies AdminRefused);
  }
  // SAFETY: the host passes the service's answer through as it came, which is the shape `admin-answer-wire.ts` names for this procedure.
  return answered.answer as T;
}

const APP_ADMIN_READS: AdminReads = {
  metrics: (query) => readThroughHost("metrics", query),
  cost: (query) => readThroughHost("cost", query),
  reliability: (query) => readThroughHost("reliability", query),
  users: (query) => readThroughHost("users", query),
  user: (query) => readThroughHost("user", query),
  day: (query) => readThroughHost("day", query),
  workspaces: (query) => readThroughHost("workspaces", query),
  favorite: (id, favorite) => askAct(ACT_KIND.ADMIN_FAVORITE, { id, favorite }).catch(() => false),
};

/** A refusal standing in the view's place, as the app's centred failure, under the toolbar's lead where one stands. */
function GateRefusal({ words }: { words: string }): React.JSX.Element {
  const lead = useAdminToolbarLead();
  return (
    <div className="flex min-h-0 flex-1 flex-col">
      {lead === undefined ? null : <PageToolbar lead={lead} />}
      <ErrorState placement={ERROR_STATE_PLACEMENT.CENTRED}>{words}</ErrorState>
    </div>
  );
}

const APP_ADMIN_DOORS: AdminDoors = {
  reads: APP_ADMIN_READS,
  gate: {
    heldAtGate: () => false,
    signedOut: () => <GateRefusal words={GATE_WORDS.SIGNED_OUT} />,
    forbidden: () => <GateRefusal words={GATE_WORDS.FORBIDDEN} />,
  },
  address: {
    accountHref: () => undefined,
    search: () => "",
    keepSearch: () => undefined,
    onSearchMoved: () => () => undefined,
  },
};

/** The app's doors, handed to every admin screen under it. */
export function AppAdminDoors({ children }: { children: React.ReactNode }): React.JSX.Element {
  return <AdminDoorsProvider value={APP_ADMIN_DOORS}>{children}</AdminDoorsProvider>;
}
