import XCTest

@testable import LukeKit

final class VoiceToolAvailabilityTests: XCTestCase {
    private let phoneTools = VoiceToolName.allCases.map(\.rawValue)

    private func standing(_ name: String, in report: VoiceToolReport) -> VoiceToolStanding? {
        report.standings.first { $0.name == name }
    }

    func testTheListIsTheDesktopsTableRowForRow() {
        let report = VoiceToolAvailability.report(mintedTools: nil, sessions: [], projects: nil)
        XCTAssertEqual(report.standings.count, 16)
        XCTAssertEqual(report.standings.first?.name, "send_session_message")
        XCTAssertEqual(report.standings.last?.name, "forget_fact")
        XCTAssertFalse(report.mintedKnown)
        for tool in phoneTools {
            XCTAssertNotNil(standing(tool, in: report), tool)
        }
    }

    func testToolsThePhoneNeverCarriesSayWhy() {
        let report = VoiceToolAvailability.report(mintedTools: phoneTools, sessions: [], projects: nil)
        for name in [
            "read_session_transcript", "update_issue_state", "comment_on_issue", "change_app_setting",
            "open_feedback_composer", "run_update_action", "remember_fact", "forget_fact",
        ] {
            XCTAssertFalse(standing(name, in: report)?.isAvailable ?? true, name)
        }
        XCTAssertEqual(
            standing("remember_fact", in: report)?.unavailableReason,
            "Luke's memory lives on the Mac alone."
        )
    }

    func testAToolTheServiceDidNotMintIsNotLukes() {
        let roster = [
            RosterSession(providerId: "conductor", sessionId: "s", title: "T", status: "working", canReceiveMessage: true)
        ]
        let minted = ["send_session_message", "run_session_control"]
        let report = VoiceToolAvailability.report(mintedTools: minted, sessions: roster, projects: nil)
        XCTAssertTrue(report.mintedKnown)
        XCTAssertTrue(standing("send_session_message", in: report)?.isAvailable == true)
        XCTAssertEqual(
            standing("open_session", in: report)?.unavailableReason,
            "The service did not mint this tool for the current call; it may predate this build."
        )
    }

    func testPhoneToolsFollowWhatTheRosterAndProjectsOffer() {
        let empty = VoiceToolAvailability.report(mintedTools: phoneTools, sessions: [], projects: nil)
        XCTAssertEqual(standing("open_session", in: empty)?.unavailableReason, "No sessions are observed.")
        XCTAssertEqual(
            standing("create_workspace", in: empty)?.unavailableReason,
            "The projects a workspace can be created in have not loaded."
        )

        let roster = [
            RosterSession(
                providerId: "conductor", sessionId: "s", title: "T", status: "working",
                controls: [RosterSessionControl(id: "stop", label: "Stop", kind: .stop)],
                canRename: true
            )
        ]
        let report = VoiceToolAvailability.report(
            mintedTools: phoneTools, sessions: roster,
            projects: ProjectsAnswer(projects: [], agentModels: [])
        )
        XCTAssertTrue(standing("open_session", in: report)?.isAvailable == true)
        XCTAssertTrue(standing("show_panel", in: report)?.isAvailable == true)
        XCTAssertTrue(standing("run_session_control", in: report)?.isAvailable == true)
        XCTAssertTrue(standing("rename_session", in: report)?.isAvailable == true)
        XCTAssertEqual(
            standing("send_session_message", in: report)?.unavailableReason,
            "No observed session takes messages right now."
        )
        XCTAssertEqual(
            standing("add_workspace_agent", in: report)?.unavailableReason,
            "No observed session lists an agent to add."
        )
        XCTAssertEqual(
            standing("rename_workspace", in: report)?.unavailableReason,
            "No observed session advertises renaming its workspace."
        )
        XCTAssertEqual(
            standing("create_workspace", in: report)?.unavailableReason,
            "No provider reported a project to create in."
        )
    }
}
