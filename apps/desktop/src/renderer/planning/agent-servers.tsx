import type { IntegrationProvider } from "@sidecar/hosted/integration-wire";
import { McpIcon } from "@sidecar/panel";
import { useEffect, useId, useRef, useState } from "react";
import { AnchoredPopover, POPOVER_ALIGN } from "../anchored-popover";
import { IntegrationMark } from "../integration-marks";
import { useIntegrationStatuses } from "../integration-statuses";
import { Tooltip } from "../tooltip";
import {
  SERVER_ACTION,
  SERVER_ROW,
  SERVERS_LABEL,
  SERVERS_NOTE,
  type ServerRow,
  serverRows,
  switchedServers,
} from "./agent-servers-model";

/**
 * agent-servers.tsx -- the MCP button at an agent box's foot, and the popover that lists the servers the agent is handed with a switch for each.
 *
 * Between the model chip and the context ring stands the MCP mark. A press
 * opens a popover from the button's trailing edge, as the model menu and
 * the context popover hang from theirs (`../anchored-popover.tsx`), drawn
 * as the model menu is: one row per server with its mark, its name, and
 * where its connection stands in muted words (`agent-servers-model.ts`). A
 * connected server's row is a switch for this agent; one not connected
 * opens Settings › Integrations, where it is connected. Where every
 * connection stands is read as the popover opens and again when the window
 * is focused, which is how the developer comes back from the browser. A
 * draft agent keeps its choice until its first message starts it. The
 * popover closes on Escape, which stops there so the panel behind stays
 * open, on a second press of the button, and on focus leaving it.
 */

/** The servers an agent is handed, as the button changes them. */
export interface AgentServersControl {
  /** The servers switched off for this agent: the one on its way where one is, else the agent's. */
  readonly disabled: readonly IntegrationProvider[];
  /** Switches the agent's servers, the whole list of those off. */
  readonly onSwitch: (next: readonly IntegrationProvider[]) => void;
  /** Opens Settings on its Integrations page, where a server is connected. */
  readonly onOpenSettings: () => void;
}

/** What a row says at its end where it is no switch. */
function RowEnd({ row }: { row: ServerRow }): React.JSX.Element | null {
  switch (row.kind) {
    case SERVER_ROW.SWITCH:
      return (
        <span className="switch plan-compose-menu-switch">
          <span className="switch-thumb" />
        </span>
      );
    case SERVER_ROW.CONNECT:
      return <span className="plan-compose-menu-hint">{SERVER_ACTION.CONNECT}</span>;
    case SERVER_ROW.RETRY:
      return <span className="plan-compose-menu-hint">{SERVER_ACTION.RETRY}</span>;
    case SERVER_ROW.QUIET:
      return null;
  }
}

function ServersPopover({
  id,
  servers,
  onClose,
  onLeave,
}: {
  id: string;
  servers: AgentServersControl;
  /** Closes the popover and hands focus back to the button. */
  onClose: () => void;
  /** Focus left the popover for `left`; the owner closes unless that is still its own. */
  onLeave: (left: EventTarget | null) => void;
}): React.JSX.Element {
  const box = useRef<HTMLDivElement>(null);
  const statuses = useIntegrationStatuses();
  const rows = serverRows({
    statusOf: statuses.statusOf,
    readFailed: statuses.readFailed,
    disabled: servers.disabled,
  });

  // The popover takes focus as it opens, so Escape and focus leaving it are heard.
  useEffect(() => {
    box.current?.focus();
  }, []);

  const onKey = (event: React.KeyboardEvent) => {
    if (event.key !== "Escape") return;
    event.stopPropagation();
    onClose();
  };

  const press = (row: ServerRow) => {
    switch (row.kind) {
      case SERVER_ROW.SWITCH:
        servers.onSwitch(switchedServers(servers.disabled, row.provider, !row.on));
        return;
      case SERVER_ROW.CONNECT:
        onClose();
        servers.onOpenSettings();
        return;
      case SERVER_ROW.RETRY:
        void statuses.read();
        return;
      case SERVER_ROW.QUIET:
        return;
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
      <div className="plan-compose-menu-section">{SERVERS_LABEL}</div>
      <div className="agent-servers-list">
        {rows.map((row) => {
          const body = (
            <>
              <IntegrationMark provider={row.provider} />
              <span className="plan-compose-menu-name">{row.name}</span>
              <span className="plan-compose-menu-detail">{row.state}</span>
              <RowEnd row={row} />
            </>
          );
          if (row.kind === SERVER_ROW.QUIET) {
            return (
              <div key={row.provider} className="plan-compose-menu-row" aria-disabled="true">
                {body}
              </div>
            );
          }
          if (row.kind === SERVER_ROW.SWITCH) {
            return (
              <button
                key={row.provider}
                type="button"
                className="plan-compose-menu-row"
                role="switch"
                aria-checked={row.on}
                onClick={() => press(row)}
              >
                {body}
              </button>
            );
          }
          return (
            <button
              key={row.provider}
              type="button"
              className="plan-compose-menu-row"
              onClick={() => press(row)}
            >
              {body}
            </button>
          );
        })}
      </div>
      <p className="plan-compose-menu-foot-note">{SERVERS_NOTE}</p>
    </div>
  );
}

export function AgentServersButton({
  servers,
}: {
  servers: AgentServersControl;
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
            onClose={close}
            onLeave={(left) => {
              if (!(left instanceof Node && root.current?.contains(left))) setOpen(false);
            }}
          />
        </AnchoredPopover>
      ) : null}
    </div>
  );
}
