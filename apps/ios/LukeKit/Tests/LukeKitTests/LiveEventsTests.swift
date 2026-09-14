import Foundation
import XCTest

@testable import LukeKit

final class LiveClientEventTests: XCTestCase {
    func testTheThreeCommandsCarryTheirTypeAndIdAndNothingElse() throws {
        let events: [(LiveClientEvent, String)] = [
            (.mute(eventId: "peer-1"), "session.input_audio.mute"),
            (.unmute(eventId: "peer-2"), "session.input_audio.unmute"),
            (.close(eventId: "peer-3"), "session.close"),
        ]
        for (event, type) in events {
            let record = try JSONSerialization.jsonObject(with: Data(event.payload.utf8)) as? [String: Any]
            XCTAssertEqual(record?.count, 2)
            XCTAssertEqual(record?["type"] as? String, type)
            XCTAssertEqual(record?["event_id"] as? String, event.eventId)
        }
    }

    func testTheDeviceSendsNoStartAndNoAppend() {
        XCTAssertEqual(
            Set(LiveClientEventType.allCases.map(\.rawValue)),
            ["session.input_audio.mute", "session.input_audio.unmute", "session.close"]
        )
    }
}

final class LiveServerEventTests: XCTestCase {
    func testSessionStartedCarriesTheSessionId() {
        let event = LiveServerEvent(
            payload: #"{"type":"session.started","event_id":"event_1","session":{"id":"live_123","model":"gpt-live-1"}}"#
        )
        XCTAssertEqual(event, .sessionStarted(eventId: "event_1", sessionId: "live_123"))
        XCTAssertEqual(event?.type, .sessionStarted)
    }

    func testSessionStartedWithoutASessionIdIsRefused() {
        XCTAssertNil(LiveServerEvent(payload: #"{"type":"session.started","event_id":"event_1","session":{}}"#))
        XCTAssertNil(LiveServerEvent(payload: #"{"type":"session.started","event_id":"event_1"}"#))
    }

    func testSessionClosedCarriesReasonAndUsage() {
        let event = LiveServerEvent(
            payload: #"{"type":"session.closed","event_id":"event_9","reason":"close_requested","usage":{"seconds":12.5},"session":{"id":"live_123"}}"#
        )
        XCTAssertEqual(event, .sessionClosed(eventId: "event_9", reason: .closeRequested, usageSeconds: 12.5))
    }

    func testSessionClosedWithAReasonThePhoneCannotNameIsRefused() {
        XCTAssertNil(
            LiveServerEvent(
                payload: #"{"type":"session.closed","event_id":"event_9","reason":"sunspots","usage":{"seconds":1}}"#
            )
        )
        XCTAssertNil(LiveServerEvent(payload: #"{"type":"session.closed","event_id":"event_9","reason":"expired"}"#))
    }

    func testTranscriptDeltasKeepTheirFragmentUntrimmed() {
        let input = LiveServerEvent(
            payload: #"{"type":"session.input_transcript.delta","event_id":"event_2","delta":" ","start_ms":1000,"end_ms":1200}"#
        )
        XCTAssertEqual(
            input,
            .inputTranscriptDelta(LiveTranscriptDelta(eventId: "event_2", delta: " ", startMs: 1000, endMs: 1200))
        )
        let output = LiveServerEvent(
            payload: #"{"type":"session.output_transcript.delta","event_id":"event_3","delta":"What is","start_ms":0,"end_ms":40}"#
        )
        XCTAssertEqual(
            output,
            .outputTranscriptDelta(LiveTranscriptDelta(eventId: "event_3", delta: "What is", startMs: 0, endMs: 40))
        )
    }

    func testATranscriptDeltaWithoutItsIntervalIsRefused() {
        XCTAssertNil(
            LiveServerEvent(payload: #"{"type":"session.input_transcript.delta","event_id":"event_2","delta":"hi"}"#)
        )
        XCTAssertNil(
            LiveServerEvent(
                payload: #"{"type":"session.input_transcript.delta","event_id":"event_2","delta":"hi","start_ms":-1,"end_ms":3}"#
            )
        )
        XCTAssertNil(
            LiveServerEvent(
                payload: #"{"type":"session.input_transcript.delta","event_id":"event_2","delta":"hi","start_ms":1.5,"end_ms":3}"#
            )
        )
    }

    func testMicrophoneAcknowledgmentsNameTheCommand() {
        XCTAssertEqual(
            LiveServerEvent(
                payload: #"{"type":"session.input_audio.muted","event_id":"event_4","client_event_id":"peer-1"}"#
            ),
            .inputAudioMuted(eventId: "event_4", clientEventId: "peer-1")
        )
        XCTAssertEqual(
            LiveServerEvent(payload: #"{"type":"session.input_audio.unmuted","event_id":"event_5"}"#),
            .inputAudioUnmuted(eventId: "event_5", clientEventId: nil)
        )
        XCTAssertEqual(
            LiveServerEvent(
                payload: #"{"type":"session.input_audio.unmuted","event_id":"event_5","client_event_id":"peer-2"}"#
            )?.clientEventId,
            "peer-2"
        )
    }

    func testAMalformedClientEventIdRefusesTheEvent() {
        XCTAssertNil(
            LiveServerEvent(payload: #"{"type":"session.input_audio.muted","event_id":"event_4","client_event_id":" "}"#)
        )
        XCTAssertNil(
            LiveServerEvent(payload: #"{"type":"session.input_audio.muted","event_id":"event_4","client_event_id":7}"#)
        )
    }

    func testUsageIsASnapshot() {
        XCTAssertEqual(
            LiveServerEvent(
                payload: #"{"type":"session.usage.updated","event_id":"event_6","usage":{"seconds":12},"context_window":{"usage_ratio":0.42}}"#
            ),
            .usageUpdated(eventId: "event_6", usageSeconds: 12)
        )
        XCTAssertNil(LiveServerEvent(payload: #"{"type":"session.usage.updated","event_id":"event_6"}"#))
    }

    func testAnErrorNamesItsCommandAtEitherLevel() {
        let nested = LiveServerEvent(
            payload: #"{"type":"error","event_id":"event_error","error":{"type":"invalid_request_error","code":"immutable_field_update","message":"The delegation type cannot change after session startup.","param":"session.delegation.type","client_event_id":"event_update"}}"#
        )
        XCTAssertEqual(
            nested,
            .error(
                eventId: "event_error",
                clientEventId: nil,
                detail: LiveErrorDetail(
                    code: "immutable_field_update",
                    message: "The delegation type cannot change after session startup.",
                    clientEventId: "event_update"
                )
            )
        )
        XCTAssertEqual(nested?.clientEventId, "event_update")
        let top = LiveServerEvent(
            payload: #"{"type":"error","event_id":"event_error","client_event_id":"peer-3","error":{"code":null,"message":"  "}}"#
        )
        XCTAssertEqual(top, .error(eventId: "event_error", clientEventId: "peer-3", detail: LiveErrorDetail()))
        XCTAssertEqual(top?.clientEventId, "peer-3")
    }

    func testAnErrorWithoutItsDetailIsRefused() {
        XCTAssertNil(LiveServerEvent(payload: #"{"type":"error","event_id":"event_error"}"#))
        XCTAssertNil(LiveServerEvent(payload: #"{"type":"error","event_id":"event_error","error":"boom"}"#))
    }

    func testInfoCarriesItsCodeAndMessageWhenTheyArrive() {
        XCTAssertEqual(
            LiveServerEvent(
                payload: #"{"type":"info","event_id":"event_7","code":"data_channel_permissions","message":"Limited."}"#
            ),
            .info(eventId: "event_7", code: "data_channel_permissions", message: "Limited.")
        )
        XCTAssertEqual(
            LiveServerEvent(payload: #"{"type":"info","event_id":"event_7"}"#),
            .info(eventId: "event_7", code: nil, message: nil)
        )
    }

    func testEventsTheDeviceIsNotShownAreDropped() {
        for payload in [
            #"{"type":"session.delegation.created","event_id":"event_8","offset_ms":10,"delegation":{"id":"dlg_1","target":"client"}}"#,
            #"{"type":"session.instructions.appended","event_id":"event_8","start_ms":0,"end_ms":1}"#,
            #"{"type":"session.output_audio.delta","event_id":"event_8","delta":"AAAA"}"#,
            #"{"type":"response.event","event_id":"event_8"}"#,
        ] {
            XCTAssertNil(LiveServerEvent(payload: payload), payload)
        }
    }

    func testMalformedPayloadsAreDropped() {
        for payload in [
            "",
            "not json",
            "[]",
            #""session.started""#,
            #"{"event_id":"event_1"}"#,
            #"{"type":"session.started","session":{"id":"live_1"}}"#,
            #"{"type":"session.started","event_id":"   ","session":{"id":"live_1"}}"#,
        ] {
            XCTAssertNil(LiveServerEvent(payload: payload), payload)
        }
    }

    func testAKeyTheDeclarationDoesNotNameIsDropped() {
        XCTAssertEqual(
            LiveServerEvent(
                payload: #"{"type":"session.input_audio.muted","event_id":"event_4","client_event_id":"peer-1","later":true}"#
            ),
            .inputAudioMuted(eventId: "event_4", clientEventId: "peer-1")
        )
    }
}
