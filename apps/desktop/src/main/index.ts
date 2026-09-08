import { isGatewayProcess } from "./gateway/process-mode";

// One executable, two modes: the Gateway hosts and draws nothing; the desktop
// draws and attaches. Each module is loaded only in its own mode, because
// loading the desktop's names the app and points its paths at the desktop's
// state before a line of the Gateway's could say otherwise.
if (isGatewayProcess(process.argv)) {
  void import("./gateway/gateway-process").then(({ startGatewayProcess }) =>
    startGatewayProcess(process.argv),
  );
} else {
  void import("./desktop-app").then(({ startDesktopApp }) => startDesktopApp());
}
