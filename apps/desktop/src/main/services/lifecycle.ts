import type { DesktopService } from "./service";

/**
 * Every concern gives back what it began, in the reverse of the order it
 * began in. One that cannot must not strand the rest: a window teardown that
 * throws would otherwise leave the runtime undrained, which is the one thing
 * a quit may not do.
 */
export async function stopInReverse(
  services: readonly DesktopService[],
  report: (message: string) => void,
): Promise<void> {
  for (const service of [...services].reverse()) {
    await service.stop().catch((error: Error) => {
      report(`the ${service.name} service did not stop cleanly: ${error.message}`);
    });
  }
}
