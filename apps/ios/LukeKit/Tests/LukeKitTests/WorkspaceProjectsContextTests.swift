import XCTest

@testable import LukeKit

final class WorkspaceProjectsContextTests: XCTestCase {
    private func project(
        _ id: String, repository: String, support: ProjectTaskSupport = .optional,
        target: String? = nil, namesItself: Bool = false
    ) -> RosterProject {
        RosterProject(
            providerId: "conductor", providerProjectId: id, repository: repository,
            taskSupport: support, targetName: target, namesItself: namesItself)
    }

    func testAnEmptyListIsSaidInWords() {
        XCTAssertEqual(
            WorkspaceProjectsContext.text(
                answer: ProjectsAnswer(projects: [], agentModels: []), defaultProviderId: nil,
                defaultProjectIds: [:]),
            "No provider currently offers workspace creation."
        )
    }

    func testEachProjectCarriesTheIdentityACallNamesItByAndWhatItTakes() {
        let answer = ProjectsAnswer(
            projects: [
                project("p1", repository: "acme/web", support: .required, target: "Mac mini"),
                project("p2", repository: "acme/api", support: .none, namesItself: true),
            ],
            agentModels: [
                WorkspaceAgentOption(
                    providerId: "conductor", agent: "claude",
                    models: [
                        WorkspaceAgentModelChoice(id: "fable-5-1", label: "Fable 5.1"),
                        WorkspaceAgentModelChoice(id: "opus-4", label: "Opus 4"),
                    ],
                    efforts: ["low", "high"]
                )
            ]
        )
        let text = WorkspaceProjectsContext.text(
            answer: answer, defaultProviderId: "conductor", defaultProjectIds: ["conductor": "p2"])
        let lines = text.split(separator: "\n").map(String.init)
        XCTAssertEqual(lines[0], "Projects a new workspace can be created in:")
        XCTAssertEqual(
            lines[1],
            "- Conductor — acme/web on Mac mini [provider_id=conductor project_id=p1]; needs an opening task"
        )
        XCTAssertEqual(
            lines[2],
            "- Conductor — acme/api [provider_id=conductor project_id=p2]; takes no task; names its own workspaces; the provider's default project"
        )
        XCTAssertTrue(
            lines[3].contains(
                "claude — models Fable 5.1 (fable-5-1), Opus 4 (opus-4); efforts low, high"
            )
        )
        XCTAssertEqual(
            lines[4],
            "An ask that names no provider creates in Conductor [provider_id=conductor]; do not ask which provider unless the ask names a different one."
        )
    }

    func testTheDefaultSentenceFollowsWhetherADefaultStandsAndOffers() {
        let answer = ProjectsAnswer(projects: [project("p1", repository: "acme/web")], agentModels: [])
        XCTAssertTrue(
            WorkspaceProjectsContext.text(answer: answer, defaultProviderId: nil, defaultProjectIds: [:])
                .hasSuffix("the first workspace created saves its provider as the default.")
        )
        XCTAssertTrue(
            WorkspaceProjectsContext.text(answer: answer, defaultProviderId: "other", defaultProjectIds: [:])
                .contains("The chosen default provider is not currently offering")
        )
    }

    func testAgentOptionsRenderGPT6AstraForPhoneAndWatchVoiceContext() {
        let answer = ProjectsAnswer(
            projects: [project("p1", repository: "acme/web")],
            agentModels: [
                WorkspaceAgentOption(
                    providerId: "conductor", agent: "codex",
                    models: [WorkspaceAgentModelChoice(id: "gpt-6-astra", label: "GPT-6 Astra")],
                    efforts: ["ultra"]
                )
            ]
        )

        let text = WorkspaceProjectsContext.text(
            answer: answer, defaultProviderId: nil, defaultProjectIds: [:])
        XCTAssertTrue(text.contains("codex — models GPT-6 Astra (gpt-6-astra); efforts ultra"))
    }

    func testTheSavedAgentSelectionIsSaidOnlyWhileItIsListed() {
        let answer = ProjectsAnswer(
            projects: [project("p1", repository: "acme/web")],
            agentModels: [
                WorkspaceAgentOption(
                    providerId: "conductor", agent: "claude",
                    models: [WorkspaceAgentModelChoice(id: "opus-4", label: "Opus 4")],
                    efforts: ["low", "high"]
                )
            ]
        )
        XCTAssertTrue(
            WorkspaceProjectsContext.text(
                answer: answer, defaultProviderId: "conductor", defaultProjectIds: [:],
                defaultAgentDefaults: [
                    "conductor": WorkspaceAgentDefault(agent: "claude", model: "opus-4", effort: "high")
                ])
                .contains(
                    "Omitted, the saved default agent selection starts: claude with Opus 4 (opus-4), effort high."
                )
        )
        XCTAssertFalse(
            WorkspaceProjectsContext.text(
                answer: answer, defaultProviderId: "conductor", defaultProjectIds: [:],
                defaultAgentDefaults: [
                    "conductor": WorkspaceAgentDefault(agent: "claude", model: "missing", effort: "high")
                ])
                .contains("saved default agent selection")
        )
    }

    func testKindOnlyAgentSelectionIsSaidOnlyWhileItIsListed() {
        let answer = ProjectsAnswer(
            projects: [
                RosterProject(
                    providerId: "superset", providerProjectId: "p1", repository: "acme/web",
                    taskSupport: .optional)
            ],
            agentModels: [
                WorkspaceAgentOption(providerId: "superset", agent: "composer", models: [], efforts: [])
            ]
        )

        let text = WorkspaceProjectsContext.text(
            answer: answer,
            defaultProviderId: "superset",
            defaultProjectIds: [:],
            defaultAgentDefaults: ["superset": WorkspaceAgentDefault(agent: "composer")]
        )
        XCTAssertTrue(text.contains("composer — no model choice"))
        XCTAssertTrue(
            text.contains("Omitted, the saved default agent selection starts: composer.")
        )
        XCTAssertFalse(
            WorkspaceProjectsContext.text(
                answer: answer,
                defaultProviderId: "superset",
                defaultProjectIds: [:],
                defaultAgentDefaults: [
                    "superset": WorkspaceAgentDefault(agent: "composer", model: "unexpected")
                ]
            )
            .contains("saved default agent selection")
        )
    }

    func testTheCapKeepsTheDefaultProjectPastTheCut() {
        let projects = (0 ..< 12).map { project("p\($0)", repository: "repo-\($0)") }
        let listed = WorkspaceProjectsContext.listedProjects(projects, defaultProjectIds: ["conductor": "p11"])
        XCTAssertEqual(listed.count, WorkspaceProjectsContext.maximumProjects + 1)
        XCTAssertEqual(listed.last?.providerProjectId, "p11")
        XCTAssertFalse(listed.contains { $0.providerProjectId == "p10" })
    }

    func testTheItemIsLabelledAsData() {
        let item = WorkspaceProjectsContext.item(
            answer: ProjectsAnswer(projects: [], agentModels: []), defaultProviderId: nil,
            defaultProjectIds: [:])
        XCTAssertEqual(item.itemId, "luke_ctx_workspace-projects_0")
        XCTAssertEqual(
            item.text,
            "[workspace projects, sent automatically]\nNo provider currently offers workspace creation."
        )
    }
}
