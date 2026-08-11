import Testing
@testable import SidecarCore

@Suite("Development fixture")
struct DemoSnapshotTests {
    @Test("is stable and contains no duplicate identities")
    func stableIdentities() {
        let fixture = DemoSnapshot.development
        let identities = fixture.sessions.map(\.id)

        #expect(fixture.fixtureVersion == 1)
        #expect(Set(identities).count == identities.count)
        #expect(fixture.sessions.allSatisfy { !$0.title.isEmpty && !$0.detail.isEmpty })
    }

    @Test("summarizes attention separately from active work")
    func digest() {
        let digest = DemoSnapshot.development.digest

        #expect(digest.totalCount == 3)
        #expect(digest.activeCount == 1)
        #expect(digest.attentionCount == 1)
        #expect(digest.headline == "1 session needs attention")
    }

    @Test("does not claim attention when work is merely active")
    func activeWorkIsNotAttention() {
        let snapshot = DemoSnapshot(
            fixtureVersion: 1,
            sessions: [
                DemoSession(
                    id: "active",
                    provider: .codex,
                    title: "Active work",
                    repository: "fixture",
                    status: .working,
                    detail: "Progressing normally"
                ),
            ]
        )

        #expect(snapshot.digest.attentionCount == 0)
        #expect(snapshot.digest.headline == "Sessions are progressing")
    }
}
