import type { IntegrationToolsView } from "@sidecar/hosted/integration-view";
import type { IntegrationProvider } from "@sidecar/hosted/integration-wire";
import { GearIcon, McpIcon } from "@sidecar/panel";
import { useEffect, useId, useRef, useState } from "react";
import { AnchoredPopover, POPOVER_ALIGN } from "../anchored-popover";
import { IntegrationMark } from "../integration-marks";
import type { IntegrationStatuses } from "../integration-statuses";
import { useIntegrationTools } from "../integration-tools";
import { Tooltip } from "../tooltip";
import {
  SERVER_ACTION,
  SERVER_ROW,
  SERVERS_LABEL,
  type ServerRow,
  serverRows,
  switchedServers,
  toolsCount,
} from "./agent-servers-model";

/**
 * agent-servers.tsx -- the MCP button at an agent box's foot, and the popover that lists the servers the agent is handed with a switch for each.
 *
 * Between the model chip and the context ring stands the MCP mark. A press
 * opens a popover from the button's trailing edge, as the model menu and
 * the context popover hang from theirs (`../anchored-popover.tsx`), drawn
 * as the model menu is: one row per server with its mark and its name
 * (`agent-servers-model.ts`). A connected server's row names how many tools
 * it offers, a count that opens the list of them beside the popover on
 * hover or focus, and ends with this agent's switch. One not connected, or
 * whose sign-in expired, ends with Open Settings, which leaves for Settings ›
 * Integrations, the one place a server is connected; the gear beside the
 * title goes there too. Where
 * every connection stands is the composer's read (`../integration-statuses.ts`),
 * taken as it is drawn and again when the window is focused, which is how
 * the developer comes back from the browser, so the popover stays open while
 * the window is away. A draft agent keeps its choice until
 * its first message starts it. The popover closes on Escape, which stops
 * there so the panel behind stays open, on a second press of the button,
 * and on focus leaving it for another part of the window.
 */
/** One tool a server offers, as its read answered it. */
type IntegrationTool = Extract<IntegrationToolsView, { tools: unknown }>["tools"][number];

/** The tools a read answered, where it answered tools; nothing for a failure or a server's own problem. */
function toolsOf(read: IntegrationToolsView | undefined): readonly IntegrationTool[] | undefined {
  return read !== undefined && "tools" in read ? read.tools : undefined;
}

/** The servers an agent is handed, as the button changes them. */
export interface AgentServersControl {
  /** The servers switched off for this agent: the one on its way where one is, else the agent's. */
  readonly disabled: readonly IntegrationProvider[];
  /** Switches the agent's servers, the whole list of those off. */
  readonly onSwitch: (next: readonly IntegrationProvider[]) => void;
  /** Opens Settings on its Integrations page, where a server is connected and disconnected. */
  readonly onOpenSettings: () => void;
}

/** What the gear beside the popover's title is named, which opens Settings › Integrations. */
const SERVERS_SETTINGS = "Manage in Settings";

/**
 * A connected server's count of tools, and the list of them beside the
 * popover, drawn while the server's row is hovered or the count holds the
 * focus, as a menu row opens its submenu: the list stands in the page
 * throughout and the stylesheet shows it, so a pointer crossing from the row
 * into the list keeps it open.
 */
function ToolsCount({
  name,
  tools,
}: {
  name: string;
  tools: readonly IntegrationTool[];
}): React.JSX.Element {
  const listId = useId();
  return (
    <span className="agent-servers-tools">
      <button
        type="button"
        className="agent-servers-tools-count"
        aria-label={`${name}: ${toolsCount(tools.length)}`}
        aria-describedby={tools.length > 0 ? listId : undefined}
      >
        {toolsCount(tools.length)}
      </button>
      {tools.length > 0 ? (
        <ul
          id={listId}
          className="plan-compose-submenu agent-servers-tools-menu"
          data-side="left"
          data-stand="up"
          aria-label={`${name} tools`}
        >
          {tools.map((tool) => (
            <li key={tool.name} className="agent-servers-tool">
              <span className="agent-servers-tool-name">{tool.name}</span>
              {tool.description !== "" ? (
                <span className="agent-servers-tool-description">{tool.description}</span>
              ) : null}
            </li>
          ))}
        </ul>
      ) : null}
    </span>
  );
}

function ServersPopover({
  id,
  servers,
  statuses,
  onClose,
  onLeave,
}: {
  id: string;
  servers: AgentServersControl;
  statuses: IntegrationStatuses;
  /** Closes the popover and hands focus back to the button. */
  onClose: () => void;
  /** Focus left the popover for `left`; the owner closes unless that is still its own. */
  onLeave: (left: EventTarget | null) => void;
}): React.JSX.Element {
  const box = useRef<HTMLDivElement>(null);
  const rows = serverRows({
    statusOf: statuses.statusOf,
    readFailed: statuses.readFailed,
    disabled: servers.disabled,
  });
  const tools = useIntegrationTools(
    rows.filter((row) => row.kind === SERVER_ROW.SWITCH).map((row) => row.provider),
  );
  // The popover takes focus as it opens, so Escape and focus leaving it are heard.
  useEffect(() => {
    box.current?.focus();
  }, []);

  const onKey = (event: React.KeyboardEvent) => {
    if (event.key !== "Escape") return;
    event.stopPropagation();
    onClose();
  };

  const openSettings = () => {
    onClose();
    servers.onOpenSettings();
  };

  const end = (row: ServerRow): React.JSX.Element | null => {
    switch (row.kind) {
      case SERVER_ROW.SWITCH:
        return (
          <>
            {toolsOf(tools[row.provider]) !== undefined ? (
              <ToolsCount name={row.name} tools={toolsOf(tools[row.provider]) ?? []} />
            ) : null}
            <button
              type="button"
              className="agent-servers-switch"
              role="switch"
              aria-checked={row.on}
              aria-label={`${row.name} for this agent`}
              onClick={() =>
                servers.onSwitch(switchedServers(servers.disabled, row.provider, !row.on))
              }
            >
              <span className="switch plan-compose-menu-switch">
                <span className="switch-thumb" />
              </span>
            </button>
          </>
        );
      case SERVER_ROW.SETTINGS:
        return (
          <button
            type="button"
            className="toolbar-button bordered-button agent-servers-connect"
            title={`Connect ${row.name} in Settings`}
            onClick={openSettings}
          >
            {SERVER_ACTION.SETTINGS}
          </button>
        );
      case SERVER_ROW.RETRY:
        return (
          <button
            type="button"
            className="toolbar-button agent-servers-connect"
            onClick={() => void statuses.read()}
          >
            {SERVER_ACTION.RETRY}
          </button>
        );
      case SERVER_ROW.QUIET:
        return null;
    }
  };

  return (
    <div
      ref={box}
      id={id}
      className="plan-compose-menu agent-servers-menu"
      role="dialog"
      aria-label={SERVERS_LABEL}
      tabIndex={-1}
      onKeyDown={onKey}
      onBlur={(event) => onLeave(event.relatedTarget)}
    >
      <div className="plan-compose-menu-section agent-servers-head">
        {SERVERS_LABEL}
        <Tooltip label={SERVERS_SETTINGS}>
          <button
            type="button"
            className="icon-button agent-servers-settings"
            aria-label={SERVERS_SETTINGS}
            onClick={openSettings}
          >
            <GearIcon />
          </button>
        </Tooltip>
      </div>
      <div className="agent-servers-list">
        {rows.map((row) => (
          <div
            key={row.provider}
            className="plan-compose-menu-row plan-compose-menu-branch agent-servers-row"
            aria-disabled={row.kind === SERVER_ROW.QUIET ? "true" : undefined}
          >
            <IntegrationMark provider={row.provider} />
            <span className="plan-compose-menu-name">{row.name}</span>
            {end(row)}
          </div>
        ))}
      </div>
    </div>
  );
}

export function AgentServersButton({
  servers,
  statuses,
}: {
  servers: AgentServersControl;
  /** Where every connection stands, as the composer around the button reads it. */
  statuses: IntegrationStatuses;
}): React.JSX.Element {
  const [open, setOpen] = useState(false);
  const popoverId = useId();
  const root = useRef<HTMLDivElement>(null);
  const trigger = useRef<HTMLButtonElement>(null);

  // Note that we hand focus back to the button, as a menu returns it to its
  // trigger, because closing takes the focused popover away with it.
  const close = () => {
    setOpen(false);
    trigger.current?.focus();
  };

  return (
    <div className="agent-servers" ref={root}>
      <Tooltip label={SERVERS_LABEL}>
        <button
          ref={trigger}
          type="button"
          className="icon-button agent-servers-button"
          aria-label={SERVERS_LABEL}
          aria-haspopup="dialog"
          aria-expanded={open}
          aria-controls={open ? popoverId : undefined}
          onClick={() => setOpen(!open)}
        >
          <McpIcon />
        </button>
      </Tooltip>
      {open ? (
        <AnchoredPopover align={POPOVER_ALIGN.END}>
          <ServersPopover
            id={popoverId}
            servers={servers}
            statuses={statuses}
            onClose={close}
            onLeave={(left) => {
              // The window losing focus leaves the popover standing for the developer's return.
              if (!document.hasFocus()) return;
              if (!(left instanceof Node && root.current?.contains(left))) setOpen(false);
            }}
          />
        </AnchoredPopover>
      ) : null}
    </div>
  );
}
