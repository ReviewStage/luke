export const HOST_CAPABILITY = {
  UPDATES: "updates",
  MICROPHONE: "microphone",
  MAC_COMMANDS: "macCommands",
  MAC_TERMINAL: "macTerminal",
  TERMINALS: "terminals",
  LOCAL_TERMINALS: "localTerminals",
  PORT_FORWARDS: "portForwards",
  CLI_INSTALL: "cliInstall",
  DESKTOP_APP: "desktopApp",
} as const;

export type HostCapability = (typeof HOST_CAPABILITY)[keyof typeof HOST_CAPABILITY];
