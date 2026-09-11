# Merge ledger — LUKE-95's storage rework

Published from the orchestrator's own state because it is the one operational record whose loss
would cost real time: every merge, its SHA, its PR, and what it released. `plan/decisions.md` is
the authority for decisions; this is the authority for what actually landed.

Kept on this branch rather than in the repository proper, and never on `main`: CLAUDE.md says
generated state and private planning files stay untracked, and a merge ledger is a plan artifact
rather than a product one.

# Merges
| PR | Linear | SHA | target | when |
|---|---|---|---|---|
| S0 | LUKE-109 | 4210b444afe50159ea528eb4e8e81c70041914d6 | orchestration/storage-plan (#919) | 2026-09-10 |
| A5 | LUKE-115 | 1a7011cc861f1287fda97406f2c424e4301cb6df | main (#918) | 2026-09-10 |
| A1 | LUKE-110 | bbef1df007bca94145572c541030d0d0da2be49e | main (#917) | 2026-09-10 |
| A8 | LUKE-118 | 14c054238cff3e338a832be71747dc51121888b3 | main (#920) | 2026-09-10 |
| A2 | LUKE-111 | 7c699617ab9a7737fb111907d980eb9a2dec07da | main (#922) | 2026-09-10 |
| B1 | LUKE-119 | 1180b5c350f292597f8802f1ff8eaa48c4578a2a | main (#924) | 2026-09-10 |
| A7 | LUKE-117 | b7d87b2577aee8d31b32bf57ff4cb55f222f77eb | main (#925) | 2026-09-10 | fix PR outstanding (Bugbot: compact() stored reordered rows) |
| A3 | LUKE-112 | 7470a5dcca2f63a13da14292fb1bf17b411efd3b | main (#923) | 2026-09-10 |
| A7-fix | LUKE-117 | ab88bb6c6eb4ea34bc1027d8d63a3d920ecef7e5 | main (#927) | 2026-09-10 |
| B2 | LUKE-120 | cfcc4e102aa8e9af991e3a5b0a005087df5c2315 | main (#926) | 2026-09-10 |
| A1b | LUKE-147 | d17b668f1addbc75cc741e98e6219e312722aaa0 | main (#928) | 2026-09-10 |
| B3 | LUKE-121 | d6a803615351f7474a1efa322768b3b40208a15d | main (#931) | 2026-09-10 | migration 0017 |
| D1 | LUKE-133 | a014c5638b2dbccc83ea81c8d9352cbcde2f5800 | main (#930) | 2026-09-10 |
| A6 | LUKE-116 | edc5bad1ecfa038b7648df8ffaa0e49cc022318d | main (#929) | 2026-09-10 |
| A4a | LUKE-113 | 6f3109409fb0995ea51b466626e670072f912c44 | main (#935) | 2026-09-10 |
| E1 | LUKE-135 | 7291b12d9db80c9347569bcafad1ac8dbc9836f7 | main (#936) | 2026-09-10 |
| B5 | LUKE-123 | 0ee69face3d1401afb3ec552adaf9243d04b04b8 | main (#937) | 2026-09-10 |
| E2 | LUKE-136 | 8e863d684221b3b99c8e74e7253e41d1620e340f | main (#939) | 2026-09-10 |
| A4b | LUKE-114 | e3df2e6db821765f7a08cd80a4993a962a862f7c | main (#940) | 2026-09-10 | LANE A COMPLETE |
| B6 | LUKE-124 | 12e78506e806bfc42008e9a72477546e0c03e04f | main (#938) | 2026-09-11 | migration 0018 |
| B5b | LUKE-148 | 5908ebc15bdd48ba0359b63267c064714f7713a2 | main (#943) | 2026-09-11 |
| A7b | LUKE-149 | 43bc4b86d676a3fd39c3276fabddaf2277aa1173 | main (#951) | 2026-09-11 |
| B7 | LUKE-125 | 95583442e58fffac764a3349f4ccad899efdd37a | main (#947) | 2026-09-11 | LANE B COMPLETE (B4 held) |
| A7c | LUKE-150 | 982159ec22821377f0f1e94c23cf2644b11a2f64 | main (#954) | 2026-09-11 |
| C6 | LUKE-130 | e88965628ebd5dc59c1f7b8f5b9fead51bb5615e | main (#952) | 2026-09-11 |
| #881 | LUKE-99 | 34719df3e50210a4cc9bfa97a330f80dce6e3cd2 | main (#881) | 2026-09-11 | adopted; unblocks E3, G3 |
| D2 | LUKE-101 | 3ac14652b813ebd66af8f16e618269dfa1161ad3 | main (#953) | 2026-09-11 | unblocks E4, E6, F1 |
| E3 | LUKE-137 | bd9f600df66479cfbd08e07c44813a21397a282d | main (#972) | 2026-09-11 | unblocks G3 |
| F1 | LUKE-105 | 4b3eb605c28e56e6ffb29b974a26f0559648a9a3 | main (#979) | 2026-09-11 | unblocks F2, F4, F5 |
| E6 | LUKE-103 | 30ecc09d0286ccd65dfeee2d58cd2cf6ea9306b2 | main (#970) | 2026-09-11 | unblocks E4's rebase, D2b |
| chore | (no ticket) | 05c7f51d362fbd28827937bbee3596aa620869bb | main (#987) | 2026-09-11 | web vitest testTimeout 30s |
| D2b | LUKE-151 | f80f698ef5d2abe1c81a8a918950c108a6f4093e | main (#991) | 2026-09-11 | unblocks E4's client half |
| F4 | LUKE-142 | fffff26eb71d1f0cb514ae9c5b8792615b441181 | main (#990) | 2026-09-11 | unblocks F5's rebase |
| F5 | LUKE-106 | e91666478a73eb8fcf9b49c3f31ed2e9984355c7 | main (#995) | 2026-09-11 | lane F done but for F2, F3 |
| lint fix | (no ticket) | f91b152dbc4024bede15f587db94b721265f58d9 | main (#999) | 2026-09-11 | unblocked the whole graph |
| A3b | LUKE-154 | 58c92d3c9d06ceb08096e28831ca8ba6cc6958db | main (#998) | 2026-09-11 |
| D2d | LUKE-153 | 326ae2aad4f35419023c43f29394288fa9e52608 | main (#1001) | 2026-09-11 | reasoning opaque item no longer leaves the service |
| watchfix | (LUKE-106 follow-up) | 148e68853c156b5ff8139ad8054cdd89b557a800 | main (#1003) | 2026-09-11 | DisclosureGroup unavailable on watchOS |
| D2c | LUKE-152 | 5bc6fc015de818c2c30a44e0da574d933642709b | main (#997) | 2026-09-11 | rating folded into the view |
| B5c | LUKE-155 | ec078c4b11f41223d6448ac8dbb14e5be2f8f141 | main (#1011) | 2026-09-11 | C2b's precondition met |
| C1 | LUKE-100 | 0d4448456045adc2098ba6c178ae9a59df514d2b | main (#957) | 2026-09-11 | CRITICAL PATH; opens C2a/b/c |
| E4 | LUKE-102 | 1bea0b66cbc887a3c42b11157a532160f572b658 | main (#977) | 2026-09-11 | Conversation from the service; unblocked E8; G4 now needs only C5 |
| E6b | LUKE-160 | dc7850e0dd2b55fcc5fbf3ca2cd23d0c3e29ca5a | main (#1017) | 2026-09-11 | devices' three instants timestamptz, migration 0020; releases C5, then D3 |
| C2c | LUKE-158 | c903460aebc26cc821796f9dcf16718aaccd0046 | main (#1021) | 2026-09-11 | ownership guarantees named in tests, mutation-checked; route half transfers to C2b-2 |
| C2b-1 | LUKE-157 (half) | 56aec0b93fc0fc1886b8d5583604d2e1fc4f8dc9 | main (#1026) | 2026-09-11 | relay tells steps, orders reasoning; relay no longer in flux for C5/C7/C8 |
| C7 | LUKE-131 | 3449a07509af73ec8818c3f77bb146d64bc3606b | main (#1032) | 2026-09-11 | CRITICAL PATH; clears C8's last internal gate |
| E8a | LUKE-139 (half) | 62ababb19d65273a8b44de5b35a6c84ecab0faa7 | main (#1027) | 2026-09-11 | rating write path; Gateway conversation.rateMessage |
| C5a | LUKE-129 (half) | a4f42ab40841b4f470e8cb3c0fbb02c45f0e68f3 | main (#1030) | 2026-09-11 | speech events, the one door as a type, SPEECH_EXPIRY_REASON |
| E8b | LUKE-139 | 8dee048a5ea385149c5b79fc3c6ccaaf499f1546 | main (#1029) | 2026-09-11 | the control; LUKE-139 DONE, the C6→D2c→F4→E8 chain complete |
| C8-a1 | LUKE-132 (half) | bdc85e442d1c252fcbe0b67b41ada40b758a8721 | main (#1040) | 2026-09-11 | pure move: live session machinery behind @sidecar/voice/live-session |
| C5b | LUKE-129 | 63c06e5a89ac44d082f23c8f62e455de15542aa8 | main (#1034) | 2026-09-11 | the sweep; C5 whole, LUKE-129 DONE; unblocks D3 and G4 |
| C8-fix | LUKE-132 (part) | 08e5d1df99b271b7d57204f9e886feb677cb52b5 | main (#1049) | 2026-09-11 | the delegated write precedes the reply; record-precedes-speech restored |
| C2b-2a | LUKE-157 (half) | 3028e24d001914240481442660e64037791bb140 | main (#1038) | 2026-09-11 | ask wire, eve-sessions, standingMain; RELEASES C3 |
| D3a | LUKE-134 (half) | ff207cbd04edcbc3bfe64cb193514de3e444550a | main (#1054) | 2026-09-11 | a push never lands over a claim; expire-may/push-may-not asymmetry |
| C8-a2 | LUKE-132 (part) | a00d153ab838af681c5bfd7cc622925c6ea5f3a9 | main (#1041) | 2026-09-11 | the live record over voiceWriter and the upstream sideband; C8 (a) complete |
