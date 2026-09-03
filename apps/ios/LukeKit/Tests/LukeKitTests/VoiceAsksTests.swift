import XCTest

@testable import LukeKit

private func session(
    id: String = "s1",
    provider: String = "conductor",
    status: String = "working",
    canReceiveMessage: Bool = false,
    controls: [RosterSessionControl] = [],
    spawnableAgents: [String] = [],
    canRename: Bool = false,
    canRenameWorkspace: Bool = false
) -> RosterSession {
    RosterSession(
        providerId: provider,
        sessionId: id,
        title: "Session \(id)",
        status: status,
        canReceiveMessage: canReceiveMessage,
        controls: controls,
        spawnableAgents: spawnableAgents,
        canRename: canRename,
        canRenameWorkspace: canRenameWorkspace
    )
}

private func identity(_ id: String = "s1", provider: String = "conductor") -> [String: Any] {
    ["provider_id": provider, "provider_session_id": id]
}

private func reason<T>(_ result: Result<T, VoiceAskRefusal>) -> String? {
    if case .failure(let refusal) = result { return refusal.reason }
    return nil
}

final class VoiceAsksSessionTests: XCTestCase {
    func testAnIdentityTheRosterNeverShowedIsRefused() {
        let roster = [session()]
        XCTAssertEqual(
            reason(VoiceAsks.open(identity("other"), in: roster)),
            "No observed session matches that identity."
        )
        XCTAssertEqual(reason(VoiceAsks.open([:], in: roster)), "No observed session matches that identity.")
        XCTAssertEqual(try VoiceAsks.open(identity(), in: roster).get().sessionId, "s1")
    }

    func testAMessageNeedsAnAdvertisedInboxAndBoundedWords() throws {
        let closed = [session()]
        XCTAssertEqual(
            reason(VoiceAsks.message(identity().merging(["text": "hi"]) { $1 }, in: closed)),
            "That session does not take messages right now."
        )
        let open = [session(canReceiveMessage: true)]
        XCTAssertEqual(
            reason(VoiceAsks.message(identity().merging(["text": "   "]) { $1 }, in: open)),
            "That message is empty or too long."
        )
        let long = String(repeating: "a", count: VoiceAsks.maximumMessageLength + 1)
        XCTAssertNotNil(reason(VoiceAsks.message(identity().merging(["text": long]) { $1 }, in: open)))
        let ask = try VoiceAsks.message(identity().merging(["text": "  ship it "]) { $1 }, in: open).get()
        XCTAssertEqual(ask.text, "ship it")
        XCTAssertEqual(ask.providerId, "conductor")
    }

    func testAControlMustBeOneTheRowAdvertised() throws {
        let stop = RosterSessionControl(id: "stop", label: "Stop", kind: .stop)
        let roster = [session(controls: [stop])]
        XCTAssertEqual(
            reason(VoiceAsks.control(identity().merging(["control_id": "archive"]) { $1 }, in: roster)),
            "That session advertises no such control."
        )
        XCTAssertEqual(
            try VoiceAsks.control(identity().merging(["control_id": "stop"]) { $1 }, in: roster).get().control,
            stop
        )
    }

    func testRenamesNeedTheAdvertisementAndABoundedName() throws {
        let roster = [session(canRename: true)]
        XCTAssertEqual(
            reason(VoiceAsks.renameWorkspace(identity().merging(["name": "x"]) { $1 }, in: roster)),
            "That session's workspace cannot be renamed."
        )
        XCTAssertEqual(
            try VoiceAsks.renameSession(identity().merging(["name": " Auth "]) { $1 }, in: roster).get().name,
            "Auth"
        )
        let long = String(repeating: "n", count: VoiceAsks.maximumNameLength + 1)
        XCTAssertEqual(
            reason(VoiceAsks.renameSession(identity().merging(["name": long]) { $1 }, in: roster)),
            "A chat name has to be under 80 characters and longer than nothing."
        )
    }

    func testAddingAnAgentResolvesTheModelWithinTheNamedKind() throws {
        let roster = [session(spawnableAgents: ["claude"])]
        let table = [
            WorkspaceAgentOption(
                providerId: "conductor", agent: "claude",
                models: [WorkspaceAgentModelChoice(id: "opus-4", label: "Opus 4")],
                efforts: ["low", "high"]
            ),
            WorkspaceAgentOption(
                providerId: "conductor", agent: "codex",
                models: [WorkspaceAgentModelChoice(id: "gpt-5", label: "GPT-5")],
                efforts: []
            ),
        ]
        XCTAssertEqual(
            reason(VoiceAsks.addAgent(identity().merging(["agent": "codex"]) { $1 }, in: roster, agentModels: table)),
            "That session lists no such agent to add."
        )
        let ask = try VoiceAsks.addAgent(
            identity().merging(["agent": "claude", "model": "opus 4", "effort": "HIGH", "task": "fix it"]) { $1 },
            in: roster, agentModels: table
        ).get()
        XCTAssertEqual(ask.model, "opus-4")
        XCTAssertEqual(ask.effort, "high")
        XCTAssertEqual(ask.task, "fix it")
        XCTAssertEqual(
            reason(
                VoiceAsks.addAgent(
                    identity().merging(["agent": "claude", "model": "GPT-5"]) { $1 }, in: roster, agentModels: table
                )),
            "A claude agent runs no model by that name."
        )
        XCTAssertEqual(
            reason(
                VoiceAsks.addAgent(identity().merging(["agent": "claude", "effort": "low"]) { $1 }, in: roster, agentModels: table)
            ),
            "An effort rides a model; name the model too."
        )
        XCTAssertEqual(
            reason(
                VoiceAsks.addAgent(
                    identity().merging(["agent": "claude", "model": "opus-4", "effort": "max"]) { $1 }, in: roster,
                    agentModels: table
                )),
            "That model's effort is one of low, high."
        )
    }
}

final class VoiceAsksSessionListTests: XCTestCase {
    private let roster = [
        session(id: "a", status: "waiting"),
        session(id: "b", status: "working"),
        session(id: "c", provider: "other", status: "working"),
    ]

    func testFiltersResolveAgainstTheObservedRoster() throws {
        let ask = try VoiceAsks.sessionList(["filters": ["conductor", "waiting"]], in: roster).get()
        XCTAssertEqual(ask.filters, [.provider("conductor"), .status("waiting")])
        XCTAssertNil(ask.sort)
        XCTAssertNil(ask.query)
    }

    func testAStringNarrowsLikeAListOfOne() throws {
        let ask = try VoiceAsks.sessionList(["filters": "other"], in: roster).get()
        XCTAssertEqual(ask.filters, [.provider("other")])
    }

    func testTheWholeListClearsAndCombinesWithNothing() throws {
        XCTAssertEqual(try VoiceAsks.sessionList(["filters": ["all"]], in: roster).get().filters, [])
        XCTAssertEqual(
            reason(VoiceAsks.sessionList(["filters": ["all", "waiting"]], in: roster)),
            "all is the whole list, so it combines with nothing."
        )
    }

    func testANarrowingThatWouldShowNothingIsRefusedByTheValueThatIsWrong() {
        XCTAssertEqual(
            reason(VoiceAsks.sessionList(["filters": ["error"]], in: roster)),
            "No error sessions are observed right now."
        )
        XCTAssertEqual(
            reason(VoiceAsks.sessionList(["filters": ["codex"]], in: roster)),
            "No observed session belongs to a provider \"codex\"."
        )
        XCTAssertEqual(
            reason(VoiceAsks.sessionList(["filters": ["other", "waiting"]], in: roster)),
            "No observed session matches that combination of filters."
        )
    }

    func testSortAndQueryAreBoundedLikeTheHandsOwnControls() throws {
        let ask = try VoiceAsks.sessionList(["sort": "recency", "query": " auth "], in: roster).get()
        XCTAssertEqual(ask.sort, .recency)
        XCTAssertEqual(ask.query, "auth")
        XCTAssertNil(ask.filters)
        XCTAssertEqual(
            reason(VoiceAsks.sessionList(["sort": "alphabetical"], in: roster)),
            "The list orders by urgency or by recency."
        )
        XCTAssertEqual(
            reason(VoiceAsks.sessionList(["query": "auth"], in: [session()])),
            "The list offers a search only when more than one session is observed."
        )
    }

    func testBlankEntriesAreDroppedAndAnEmptiedListNarrowsNothing() throws {
        let ask = try VoiceAsks.sessionList(["filters": ["  ", ""]], in: roster).get()
        XCTAssertNil(ask.filters)
        XCTAssertEqual(
            reason(VoiceAsks.sessionList(["filters": 3], in: roster)),
            "filters takes a list of filter values."
        )
    }
}

final class VoiceAsksWorkspaceCreationTests: XCTestCase {
    private let answer = ProjectsAnswer(
        projects: [
            RosterProject(
                providerId: "conductor", providerProjectId: "p1", repository: "acme/web",
                taskSupport: .optional),
            RosterProject(
                providerId: "conductor", providerProjectId: "p2", repository: "acme/api",
                taskSupport: .required, namesItself: true),
        ],
        agentModels: [
            WorkspaceAgentOption(
                providerId: "conductor", agent: "claude",
                models: [
                    WorkspaceAgentModelChoice(id: "opus-4", label: "Opus 4"),
                    WorkspaceAgentModelChoice(id: "sonnet-4", label: "Sonnet 4"),
                ],
                efforts: ["low", "high"]
            ),
            WorkspaceAgentOption(
                providerId: "conductor", agent: "codex",
                models: [WorkspaceAgentModelChoice(id: "gpt-5", label: "GPT-5")],
                efforts: []
            ),
        ]
    )

    private func creation(
        _ arguments: [String: Any],
        defaultProviderId: String? = nil,
        defaultProjectIds: [String: String] = [:]
    ) -> Result<VoiceAsks.WorkspaceCreationAsk, VoiceAskRefusal> {
        VoiceAsks.workspaceCreation(
            arguments, projects: answer, defaultProviderId: defaultProviderId,
            defaultProjectIds: defaultProjectIds)
    }

    func testAnAskNamesAListedProjectOrIsSettledByTheDeviceDefaults() throws {
        XCTAssertEqual(
            reason(creation([:])), "More than one listed project matches; name the project.")
        XCTAssertEqual(
            reason(creation(["project_id": "nope"])), "No listed project matches that identity.")
        XCTAssertEqual(try creation(["project_id": "p1"]).get().project.providerProjectId, "p1")
        XCTAssertEqual(
            try creation([:], defaultProviderId: "conductor", defaultProjectIds: ["conductor": "p1"]).get()
                .project.providerProjectId,
            "p1"
        )
        // A default settles only what the ask left unnamed.
        XCTAssertEqual(
            try creation(["project_id": "p2", "task": "go"], defaultProjectIds: ["conductor": "p1"]).get()
                .project.providerProjectId,
            "p2"
        )
    }

    func testNameAndTaskFollowTheProjectsOwnWord() throws {
        XCTAssertEqual(
            reason(creation(["project_id": "p2", "task": "go", "name": "Mine"])),
            "That project names its own workspaces."
        )
        XCTAssertEqual(
            reason(creation(["project_id": "p2"])),
            "That project needs an opening task to create a workspace."
        )
        XCTAssertEqual(
            reason(creation(["project_id": "p1", "task": "  "])), "That task is empty or too long.")
        let ask = try creation(["project_id": "p1", "name": " Auth fix ", "task": "Fix auth"]).get()
        XCTAssertEqual(ask.name, "Auth fix")
        XCTAssertEqual(ask.task, "Fix auth")
        XCTAssertNil(ask.agent)
        XCTAssertNil(ask.model)
    }

    func testAnAgentNamedAloneRunsItsTablesFirstModel() throws {
        let ask = try creation(["project_id": "p1", "agent": "Claude"]).get()
        XCTAssertEqual(ask.agent, "claude")
        XCTAssertEqual(ask.model, "opus-4")
        XCTAssertNil(ask.effort)
        XCTAssertEqual(
            reason(creation(["project_id": "p1", "agent": "gemini"])),
            "That project lists no such agent to start."
        )
    }

    func testAModelNamedAloneDecidesTheAgentThatRunsIt() throws {
        let ask = try creation(["project_id": "p1", "model": "gpt-5"]).get()
        XCTAssertEqual(ask.agent, "codex")
        XCTAssertEqual(ask.model, "gpt-5")
        let withEffort = try creation(["project_id": "p1", "model": "Sonnet 4", "effort": "Low"]).get()
        XCTAssertEqual(withEffort.agent, "claude")
        XCTAssertEqual(withEffort.model, "sonnet-4")
        XCTAssertEqual(withEffort.effort, "low")
        XCTAssertEqual(
            reason(creation(["project_id": "p1", "model": "gpt-5", "effort": "low"])),
            "That model takes no effort level."
        )
        XCTAssertEqual(
            reason(creation(["project_id": "p1", "agent": "codex", "model": "Opus 4"])),
            "No documented model goes by that name here."
        )
        XCTAssertEqual(
            reason(creation(["project_id": "p1", "effort": "low"])),
            "An effort rides a model; name the model too."
        )
    }
}
