type EarlyReport<Sdk> = (sdk: Sdk) => void;

export interface EarlyReports<Sdk> {
  readonly say: (report: EarlyReport<Sdk>) => boolean;
  readonly settled: Promise<void>;
}

export function reportsOnceStarted<Sdk>(
  started: Promise<Sdk | undefined>,
  kept: number,
): EarlyReports<Sdk> {
  let standing: Sdk | undefined;
  let early: EarlyReport<Sdk>[] | undefined = [];
  const settled = started.then((sdk) => {
    const waiting = early ?? [];
    standing = sdk;
    early = undefined;
    if (sdk !== undefined) for (const report of waiting) report(sdk);
  });
  const say = (report: EarlyReport<Sdk>): boolean => {
    if (standing !== undefined) report(standing);
    else if (early !== undefined && early.length < kept) early.push(report);
    else return false;
    return true;
  };
  return { say, settled };
}
