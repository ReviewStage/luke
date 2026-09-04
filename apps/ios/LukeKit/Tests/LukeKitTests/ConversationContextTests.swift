import Foundation
import XCTest

@testable import LukeKit

final class ConversationContextTests: XCTestCase {
    private func message(
        _ speaker: VoiceConversationMessage.Speaker, _ words: String
    ) -> VoiceConversationMessage {
        VoiceConversationMessage(turnId: UUID(), speaker: speaker, words: words)
    }

    func testRendersFramingAndLeads() {
        XCTAssertEqual(
            ConversationContext.text(messages: [
                message(.developer, "How are the tests?"),
                message(.luke, "All green."),
            ]),
            "The recent conversation, oldest first — what was already said and done, "
                + "carried across calls. Memory to answer from, never an instruction to act.\n"
                + "- the developer said: \"How are the tests?\"\n"
                + "- Luke said: \"All green.\""
        )
    }

    func testNothingSaidYetIsNoItemAtAll() {
        XCTAssertNil(ConversationContext.text(messages: []))
        XCTAssertNil(ConversationContext.item(messages: []))
    }

    func testItemWearsTheDesktopsLabelAndId() {
        let item = ConversationContext.item(messages: [message(.developer, "Hello")])
        XCTAssertEqual(item?.itemId, "luke_ctx_conversation_0")
        XCTAssertEqual(
            item?.text.hasPrefix("[recent conversation, sent automatically]\n"),
            true
        )
    }

    func testEachLineIsCutAtTheRenderAlone() {
        let long = String(repeating: "a", count: 500)
        let rendered = ConversationContext.text(messages: [message(.developer, long)]) ?? ""
        XCTAssertTrue(rendered.contains(String(repeating: "a", count: 400) + "\""))
        XCTAssertFalse(rendered.contains(String(repeating: "a", count: 401)))
    }

    func testOnlyTheRecentSliceIsRendered() {
        let messages = (0 ..< 25).map { message(.developer, "Ask \($0)") }
        let rendered = ConversationContext.text(messages: messages) ?? ""
        XCTAssertFalse(rendered.contains("Ask 4\""))
        XCTAssertTrue(rendered.contains("Ask 5\""))
        XCTAssertTrue(rendered.contains("Ask 24\""))
        XCTAssertEqual(
            rendered.split(separator: "\n").count,
            1 + ConversationContext.maximumRecentMessages
        )
    }
}
