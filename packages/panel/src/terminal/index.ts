import type { TerminalModule } from "./contract.js";
import "./index.css";
import { mountTerminal } from "./terminal-surface.js";

export const terminal: TerminalModule = { mount: mountTerminal };
