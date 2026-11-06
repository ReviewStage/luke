import { LINK_ORIGIN } from "@repo/features/link-home";
import { type GatewayEventKind, NODE_CAPABILITY_STATUS, NodeRegistry } from "@repo/gateway";
import type { WireValue } from "@repo/wire";
import { Effect } from "effect";
import { HOST_NODE_CAPABILITY } from "./node-capabilities.js";
import type { RunMode } from "./run-mode.js";

export interface HostKernel {
  readonly runMode: RunMode;
  readonly stateRoot: string;
  readonly now: () => number;
  readonly createId: () => string;
  readonly report: (message: string) => void;
  readonly accountBaseUrl: string;
  readonly hostedServiceBaseUrl: string;
  readonly nodes: NodeRegistry;
  emit: (kind: GatewayEventKind, payload: WireValue) => void;
  openExternalThroughNode: (url: string) => Promise<void>;
}

export const ACCOUNT_BASE_URL_VARIABLE = "APP_ACCOUNT_BASE_URL";

const ACCOUNT_BASE_URL = `${LINK_ORIGIN}/api/auth`;

export function accountBaseUrlFor(input: {
  readonly packaged: boolean;
  readonly override: string | undefined;
  readonly serviceOrigin: string | undefined;
}): string {
  if (input.serviceOrigin !== undefined) return `${input.serviceOrigin}/api/auth`;
  return (input.packaged ? undefined : input.override) ?? ACCOUNT_BASE_URL;
}

function hostedServiceBaseUrlFor(accountBaseUrl: string): string {
  return accountBaseUrl.replace(/\/api\/auth\/?$/, "");
}

export interface HostKernelParts {
  readonly stateRoot: string;
  readonly runMode: RunMode;
  readonly accountBaseUrl: string;
  readonly now: () => number;
  readonly createId: () => string;
  readonly report: (message: string) => void;
  readonly emit: (kind: GatewayEventKind, payload: WireValue) => void;
}

export function hostKernelOver(parts: HostKernelParts): HostKernel {
  const { stateRoot, runMode, accountBaseUrl, now, createId, report, emit } = parts;
  const nodes = new NodeRegistry();

  return {
    runMode,
    stateRoot,
    now,
    createId,
    report,
    accountBaseUrl,
    hostedServiceBaseUrl: hostedServiceBaseUrlFor(accountBaseUrl),
    nodes,
    emit,
    openExternalThroughNode: async (url) => {
      const result = await Effect.runPromise(
        nodes.invoke(HOST_NODE_CAPABILITY.OPEN_EXTERNAL, { url }),
      );
      if (result.status === NODE_CAPABILITY_STATUS.OK) return;
      throw new Error(result.reason);
    },
  };
}
