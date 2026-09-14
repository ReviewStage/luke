import Foundation
import XCTest

@testable import LukeKit

/// The sessions-socket frames the phone writes and reads, held to the JSON
/// Schema goldens `packages/hosted/fixtures/json-schema/live-contract-*.json`
/// commits for `packages/hosted/src/live-contract.ts`: every frame the phone
/// sends validates against the schema the service reads it by, and every
/// frame the phone reads is decoded from a document that validates against
/// the schema the service writes it by. The bytes are the point, so the
/// goldens are read as they stand rather than restated here.
final class VoiceServiceContractFixtureTests: XCTestCase {
    private enum Golden {
        static let create = "live-contract-sessionCreateFrameSchema.json"
        static let created = "live-contract-sessionCreatedFrameSchema.json"
        static let attach = "live-contract-sessionAttachFrameSchema.json"
        static let attached = "live-contract-sessionAttachedFrameSchema.json"
        static let activity = "live-contract-sessionActivityFrameSchema.json"
        static let stop = "live-contract-sessionStopFrameSchema.json"
        static let spoken = "live-contract-sessionSpokenFrameSchema.json"
        static let report = "live-contract-sessionReportFrameSchema.json"
        static let opening = "live-contract-sessionOpeningFrameSchema.json"
        static let hostedError = "service-wire-hostedErrorSchema.json"
        static let quota = "service-wire-hostedQuotaSchema.json"
    }

    private static let sdpOffer = "v=0\r\no=- 1 1 IN IP4 127.0.0.1\r\ns=-\r\nt=0 0\r\nm=audio 9 UDP/TLS/RTP/SAVPF 111\r\n"
    private static let sdpAnswer = "v=0\r\no=- 2 2 IN IP4 127.0.0.1\r\ns=-\r\nt=0 0\r\nm=audio 9 UDP/TLS/RTP/SAVPF 111\r\n"
    private static let sessionId = "ls_123"

    private func schema(_ name: String) throws -> [String: Any] {
        try RepositoryFixtures.json(RepositoryFixtures.jsonSchema, name)
    }

    private func document(_ text: String) throws -> Any {
        try JSONSerialization.jsonObject(with: Data(text.utf8))
    }

    private func assertConforms(_ text: String, to golden: String, file: StaticString = #filePath, line: UInt = #line) throws {
        let violations = JSONSchemaCheck.violations(try document(text), against: try schema(golden))
        XCTAssertEqual(violations, [], "\(golden) refuses \(text)", file: file, line: line)
    }

    private func text(_ object: [String: Any]) throws -> String {
        String(decoding: try JSONSerialization.data(withJSONObject: object, options: [.sortedKeys]), as: UTF8.self)
    }

    // MARK: - Frames the phone sends

    func testTheCreateFrameIsTheOfferTheVoiceAndAnEmptySeed() throws {
        let frame = VoiceServiceOutgoingFrame.create(SessionCreateFrame(sdp: Self.sdpOffer, voice: .marin))
        try assertConforms(frame.text, to: Golden.create)
        try assertConforms(frame.text, to: Golden.opening)
        let object = try XCTUnwrap(try document(frame.text) as? [String: Any])
        XCTAssertEqual(object["type"] as? String, "session.create")
        XCTAssertEqual(object["sdp"] as? String, Self.sdpOffer)
        XCTAssertEqual(object["voice"] as? String, "marin")
        XCTAssertEqual((object["input"] as? [Any])?.count, 0)
        XCTAssertEqual(Set(object.keys), ["type", "sdp", "voice", "input"])
    }

    func testEveryLiveVoiceIsOneTheCreateGoldenAdmits() throws {
        let voices = try XCTUnwrap(
            ((try schema(Golden.create)["properties"] as? [String: Any])?["voice"] as? [String: Any])?["enum"] as? [String]
        )
        XCTAssertEqual(Set(LiveVoice.allCases.map(\.rawValue)), Set(voices))
    }

    func testTheAttachFrameNamesTheSessionAlone() throws {
        let frame = VoiceServiceOutgoingFrame.attach(SessionAttachFrame(sessionId: Self.sessionId))
        try assertConforms(frame.text, to: Golden.attach)
        try assertConforms(frame.text, to: Golden.opening)
        XCTAssertEqual(
            try document(frame.text) as? [String: String],
            ["type": "session.attach", "sessionId": Self.sessionId]
        )
    }

    func testTheActivityAndStopFramesAreReportsTheServiceReads() throws {
        for idle in [true, false] {
            let frame = VoiceServiceOutgoingFrame.activity(SessionActivityFrame(idle: idle))
            try assertConforms(frame.text, to: Golden.activity)
            try assertConforms(frame.text, to: Golden.report)
            let object = try XCTUnwrap(try document(frame.text) as? [String: Any])
            XCTAssertEqual(object["type"] as? String, "session.activity")
            XCTAssertEqual(object["idle"] as? Bool, idle)
        }
        try assertConforms(VoiceServiceOutgoingFrame.stop.text, to: Golden.stop)
        try assertConforms(VoiceServiceOutgoingFrame.stop.text, to: Golden.report)
        XCTAssertEqual(try document(VoiceServiceOutgoingFrame.stop.text) as? [String: String], ["type": "session.stop"])
    }

    func testTheHangUpIsTheLiveCloseEventAndNothingMore() throws {
        XCTAssertEqual(
            try document(VoiceServiceOutgoingFrame.liveClose.text) as? [String: String],
            ["type": LiveClientEventName.close.rawValue]
        )
    }

    func testTheFrameSetIsEveryTypeTheGoldensName() throws {
        var types: Set<String> = []
        for name in try RepositoryFixtures.names(in: RepositoryFixtures.jsonSchema) where name.hasPrefix("live-contract-") {
            types.formUnion(JSONSchemaCheck.typeLiterals(in: try schema(name)))
        }
        XCTAssertEqual(types, Set(VoiceServiceFrame.allCases.map(\.rawValue)))
    }

    // MARK: - Frames the phone reads

    func testSessionCreatedIsReadFromTheShapeTheGoldenWrites() throws {
        let quota: [String: Any] = ["used": 3, "limit": 50, "resetsAt": 1_800_003_600_000]
        let full = try text([
            "type": "session.created", "sessionId": Self.sessionId, "sdpAnswer": Self.sdpAnswer, "quota": quota,
        ])
        try assertConforms(full, to: Golden.created)
        try assertConforms(try text(quota), to: Golden.quota)
        XCTAssertEqual(
            VoiceServiceIncomingFrame(text: full),
            .created(
                SessionCreatedFrame(
                    sessionId: Self.sessionId, sdpAnswer: Self.sdpAnswer,
                    quota: HostedQuota(json: .object([
                        "used": .number(3), "limit": .number(50), "resetsAt": .number(1_800_003_600_000),
                    ]))
                )
            )
        )
        let bare = try text(["type": "session.created", "sessionId": Self.sessionId, "sdpAnswer": Self.sdpAnswer])
        try assertConforms(bare, to: Golden.created)
        XCTAssertEqual(
            VoiceServiceIncomingFrame(text: bare),
            .created(SessionCreatedFrame(sessionId: Self.sessionId, sdpAnswer: Self.sdpAnswer, quota: nil))
        )
    }

    func testAnAnswerDropsWhatANewerServiceAddedAndAQuotaItCannotRead() throws {
        let widened = try text([
            "type": "session.created", "sessionId": Self.sessionId, "sdpAnswer": Self.sdpAnswer,
            "quota": ["used": -1, "limit": 50, "resetsAt": 1], "later": true,
        ])
        XCTAssertEqual(
            VoiceServiceIncomingFrame(text: widened),
            .created(SessionCreatedFrame(sessionId: Self.sessionId, sdpAnswer: Self.sdpAnswer, quota: nil))
        )
    }

    func testAnAnswerOutsideTheGoldensBoundsIsUnreadable() throws {
        let longId = String(repeating: "x", count: 257)
        // 13108 lines of five UTF-16 units each: 65540, over the bound by a line's `\r\n` that Swift counts as one grapheme.
        let longAnswer = String(repeating: "a=x\r\n", count: 13108)
        for object: [String: Any] in [
            ["type": "session.created", "sessionId": longId, "sdpAnswer": Self.sdpAnswer],
            ["type": "session.created", "sessionId": Self.sessionId, "sdpAnswer": longAnswer],
            ["type": "session.created", "sessionId": Self.sessionId],
            ["type": "session.attached", "sessionId": ""],
            ["type": "session.attached"],
            ["type": "session.spoken", "kind": "toast"],
        ] {
            let text = try text(object)
            XCTAssertNotEqual(JSONSchemaCheck.violations(try document(text), against: try schema(Self.golden(for: object))), [])
            XCTAssertEqual(VoiceServiceIncomingFrame(text: text), .unreadable, text)
        }
    }

    /// The contract trims a session id and refuses whitespace standing in for
    /// an SDP, filters JSON Schema cannot state; the reader keeps them all the same.
    func testWhatTheContractRefusesBeyondItsGoldenIsUnreadableToo() throws {
        for object: [String: Any] in [
            ["type": "session.created", "sessionId": "  ", "sdpAnswer": Self.sdpAnswer],
            ["type": "session.created", "sessionId": Self.sessionId, "sdpAnswer": " \n"],
            ["type": "session.attached", "sessionId": " \t"],
        ] {
            let text = try text(object)
            XCTAssertEqual(JSONSchemaCheck.violations(try document(text), against: try schema(Self.golden(for: object))), [])
            XCTAssertEqual(VoiceServiceIncomingFrame(text: text), .unreadable, text)
        }
    }

    private static func golden(for object: [String: Any]) -> String {
        switch object["type"] as? String {
        case "session.created": Golden.created
        case "session.attached": Golden.attached
        default: Golden.spoken
        }
    }

    func testSessionAttachedIsReadFromTheShapeTheGoldenWrites() throws {
        let frame = try text(["type": "session.attached", "sessionId": " \(Self.sessionId) "])
        XCTAssertEqual(VoiceServiceIncomingFrame(text: frame), .attached(SessionAttachedFrame(sessionId: Self.sessionId)))
        try assertConforms(try text(["type": "session.attached", "sessionId": Self.sessionId]), to: Golden.attached)
    }

    func testSessionSpokenNamesEveryKindTheGoldenDoes() throws {
        let kinds = try XCTUnwrap(
            ((try schema(Golden.spoken)["properties"] as? [String: Any])?["kind"] as? [String: Any])?["enum"] as? [String]
        )
        XCTAssertEqual(Set(kinds), Set(ProactiveSpeechKind.allCases.map(\.rawValue)))
        for kind in ProactiveSpeechKind.allCases {
            let frame = try text(["type": "session.spoken", "kind": kind.rawValue])
            try assertConforms(frame, to: Golden.spoken)
            XCTAssertEqual(VoiceServiceIncomingFrame(text: frame), .spoken(kind))
        }
    }

    func testARefusalIsTheHostedErrorDocument() throws {
        let refusal = try text(["error": "quota-exhausted"])
        try assertConforms(refusal, to: Golden.hostedError)
        XCTAssertEqual(VoiceServiceIncomingFrame(text: refusal), .refused(.quotaExhausted, quota: nil))
        let withQuota = try text(["error": " invalid-token ", "quota": ["used": 50, "limit": 50, "resetsAt": 7]])
        XCTAssertEqual(
            VoiceServiceIncomingFrame(text: withQuota),
            .refused(
                .invalidToken,
                quota: HostedQuota(json: .object(["used": .number(50), "limit": .number(50), "resetsAt": .number(7)]))
            )
        )
        let errors = try XCTUnwrap(
            ((try schema(Golden.hostedError)["properties"] as? [String: Any])?["error"] as? [String: Any])?["enum"] as? [String]
        )
        for error in errors {
            XCTAssertNotNil(HostedAPIError(rawValue: error), error)
        }
        XCTAssertEqual(VoiceServiceIncomingFrame(text: try text(["error": "something-newer"])), .unreadable)
    }

    func testEverythingElseNamingATypeIsARelayedLiveEvent() throws {
        let delta = try text([
            "type": "session.output_transcript.delta", "event_id": "e2", "delta": "session.spoken", "start_ms": 0,
        ])
        guard case .liveEvent(let event) = VoiceServiceIncomingFrame(text: delta) else {
            return XCTFail("a transcript delta is a live event")
        }
        XCTAssertEqual(event.type, "session.output_transcript.delta")
        XCTAssertEqual(event.payload["delta"]?.stringValue, "session.spoken")
        XCTAssertEqual(event.payload["event_id"]?.stringValue, "e2")
    }

    func testWhatIsNeitherADocumentNorATypedFrameIsUnreadable() throws {
        XCTAssertEqual(VoiceServiceIncomingFrame(text: "not a document"), .unreadable)
        XCTAssertEqual(VoiceServiceIncomingFrame(text: "[1, 2]"), .unreadable)
        XCTAssertEqual(VoiceServiceIncomingFrame(text: try text(["delta": "hi"])), .unreadable)
        for own in [VoiceServiceOutgoingFrame.stop, .activity(SessionActivityFrame(idle: true))] {
            XCTAssertEqual(VoiceServiceIncomingFrame(text: own.text), .unreadable)
        }
    }
}

/// The part of JSON Schema the goldens use, checked directly: object shapes
/// with required and closed property sets, string bounds and enums, arrays
/// with item bounds, non-negative numbers, and `anyOf` unions. A golden's
/// keyword outside this set fails loudly rather than passing by omission.
enum JSONSchemaCheck {
    private static let known: Set<String> = [
        "type", "properties", "required", "additionalProperties", "enum", "minLength", "maxLength", "minimum",
        "items", "minItems", "maxItems", "anyOf",
    ]

    static func violations(_ value: Any, against schema: [String: Any], at path: String = "$") -> [String] {
        let unknown = Set(schema.keys).subtracting(known)
        precondition(unknown.isEmpty, "\(path): the golden uses \(unknown.sorted()), which this check does not read")
        if let branches = schema["anyOf"] as? [[String: Any]] {
            let attempts = branches.map { violations(value, against: $0, at: path) }
            return attempts.contains(where: \.isEmpty) ? [] : ["\(path): matches no anyOf branch: \(attempts)"]
        }
        var found: [String] = []
        switch schema["type"] as? String {
        case "object":
            guard let object = value as? [String: Any] else { return ["\(path): not an object"] }
            let properties = schema["properties"] as? [String: [String: Any]] ?? [:]
            for key in schema["required"] as? [String] ?? [] where object[key] == nil {
                found.append("\(path).\(key): required")
            }
            for (key, member) in object {
                if let property = properties[key] {
                    found += violations(member, against: property, at: "\(path).\(key)")
                } else if schema["additionalProperties"] as? Bool == false {
                    found.append("\(path).\(key): not a property")
                }
            }
        case "string":
            guard let string = value as? String else { return ["\(path): not a string"] }
            // Lengths are UTF-16 units, as the service measures a JavaScript string.
            let length = string.utf16.count
            if let minimum = schema["minLength"] as? Int, length < minimum { found.append("\(path): shorter than \(minimum)") }
            if let maximum = schema["maxLength"] as? Int, length > maximum { found.append("\(path): longer than \(maximum)") }
            if let members = schema["enum"] as? [String], !members.contains(string) { found.append("\(path): \(string) not in \(members)") }
        case "array":
            guard let array = value as? [Any] else { return ["\(path): not an array"] }
            if let minimum = schema["minItems"] as? Int, array.count < minimum { found.append("\(path): fewer than \(minimum) items") }
            if let maximum = schema["maxItems"] as? Int, array.count > maximum { found.append("\(path): more than \(maximum) items") }
            if let items = schema["items"] as? [String: Any] {
                for (index, item) in array.enumerated() { found += violations(item, against: items, at: "\(path)[\(index)]") }
            }
        case "number", "integer":
            // A boolean is an NSNumber too, of the `c` (`char`) type; a count is never one.
            guard let number = value as? NSNumber, number.objCType.pointee != 99 else {
                return ["\(path): not a number"]
            }
            if let minimum = schema["minimum"] as? Double, number.doubleValue < minimum { found.append("\(path): below \(minimum)") }
        case "boolean":
            if !(value is Bool) { found.append("\(path): not a boolean") }
        default:
            preconditionFailure("\(path): the golden's type \(schema["type"] ?? "none") is not one this check reads")
        }
        return found
    }

    /// Every literal a `type` property's enum names, at any depth of the schema.
    static func typeLiterals(in schema: [String: Any]) -> Set<String> {
        var literals: Set<String> = []
        if let branches = schema["anyOf"] as? [[String: Any]] {
            for branch in branches { literals.formUnion(typeLiterals(in: branch)) }
        }
        if let type = (schema["properties"] as? [String: Any])?["type"] as? [String: Any],
           let members = type["enum"] as? [String]
        {
            literals.formUnion(members)
        }
        return literals
    }
}
