import { SANDBOX_STATE_FOLDER } from "./sandbox-state-folder.js";

export const REPOSITORY_SANDBOX_CONTRACT = {
  PATH: {
    WORKSPACE: "/workspace",
    CHECKOUT: "/workspace/repository",
    CHECKOUT_RECORD: `${SANDBOX_STATE_FOLDER}/repository`,
  },
  VARIABLE: {
    REPOSITORY: "APP_REPOSITORY",
    BRANCH: "APP_BRANCH",
    URL: "APP_CLONE_URL",
    DEPTH: "APP_CLONE_DEPTH",
    COMMAND: "APP_COMMAND",
    DEEPEN: "APP_DEEPEN",
    REFRESH: "APP_REFRESH",
    FOLDER: "APP_CHECKOUT_FOLDER",
  },
} as const;

const TAKEN_FOLDERS = new Set(
  [REPOSITORY_SANDBOX_CONTRACT.PATH.CHECKOUT.split("/").pop(), SANDBOX_STATE_FOLDER].map((folder) =>
    folder?.toLowerCase(),
  ),
);

export function extraCheckoutPaths(repositories: readonly string[]): readonly string[] {
  const nameOf = (repository: string) => repository.split("/").pop() ?? repository;
  const named = repositories.map((repository) => nameOf(repository).toLowerCase());
  const taken = new Set(TAKEN_FOLDERS);
  return repositories.map((repository, index) => {
    const name = nameOf(repository);
    const shared = named.filter((each) => each === name.toLowerCase()).length > 1;
    const candidates = [
      ...(shared ? [] : [name]),
      repository.replace("/", "-"),
      `${repository.replace("/", "-")}-${index + 1}`,
    ];
    const folder =
      candidates.find((candidate) => !taken.has(candidate.toLowerCase())) ?? candidates.at(-1);
    taken.add(folder?.toLowerCase());
    return `${REPOSITORY_SANDBOX_CONTRACT.PATH.WORKSPACE}/${folder}`;
  });
}

export const DEEPEN_STEP = {
  FETCH: "fetch",
} as const;
