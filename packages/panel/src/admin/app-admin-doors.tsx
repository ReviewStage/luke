import type { AdminReadParams, AdminRefused } from "@repo/features/admin-wire";
import { ADMIN_UNANSWERED } from "@repo/features/admin-wire";
import { FAILURE_CONDITION, FAILURE_SURFACE } from "@repo/features/shown-failure";
import { ACT_KIND } from "@repo/host/acts";
import { COLLECTION_STATE, ERROR_STATE_PLACEMENT, ErrorState } from "@repo/ui";
import { askAct } from "../act.js";
import { failureShown } from "../failure-report.js";
import {
  type AdminDoors,
  AdminDoorsProvider,
  AdminReadRefused,
  type AdminReads,
} from "./admin-doors.js";
import { AdminCollectionPage } from "./chrome/page-header.js";

const GATE_WORDS = {
  SIGNED_OUT: "Your session with the service has ended. Sign in again to read the admin dashboard.",
  FORBIDDEN: "This account does not have the admin role, which is set in the database.",
} as const;

async function readThroughHost<T>(
  procedure: AdminReadParams["procedure"],
  query: object,
): Promise<T> {
  const params: AdminReadParams = { procedure, query: query as Record<string, string> };
  const answered = await askAct(ACT_KIND.ADMIN_READ, params);
  if ("refused" in answered) {
    if (answered.refused === ADMIN_UNANSWERED) throw new Error("The admin read was not answered.");
    throw new AdminReadRefused(answered.refused satisfies AdminRefused);
  }
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
  workspace: (query) => readThroughHost("workspace", query),
  favorite: (id, favorite) => askAct(ACT_KIND.ADMIN_FAVORITE, { id, favorite }).catch(() => false),
};

function GateRefusal({ words }: { words: string }): React.JSX.Element {
  return (
    <AdminCollectionPage
      title="Admin"
      controls={null}
      filters={undefined}
      state={COLLECTION_STATE.ERROR}
      loadingLabel="Admin"
      error={
        <ErrorState
          failure={failureShown({
            surface: FAILURE_SURFACE.ADMIN_GATE,
            cause: FAILURE_CONDITION.REFUSED,
            refused: true,
          })}
          placement={ERROR_STATE_PLACEMENT.CENTERED}
        >
          {words}
        </ErrorState>
      }
    />
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
    workspaceHref: () => undefined,
    search: () => "",
    keepSearch: () => undefined,
    onSearchMoved: () => () => undefined,
  },
};

export function AppAdminDoors({ children }: { children: React.ReactNode }): React.JSX.Element {
  return <AdminDoorsProvider value={APP_ADMIN_DOORS}>{children}</AdminDoorsProvider>;
}
