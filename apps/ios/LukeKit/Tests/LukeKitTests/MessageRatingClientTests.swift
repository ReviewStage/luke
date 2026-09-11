import Foundation
import XCTest

@testable import LukeKit

/// The rating write against a stub that answers as the route does.
final class MessageRatingClientTests: XCTestCase {
    private final class StubHTTP: HTTPClient, @unchecked Sendable {
        var requests: [URLRequest] = []
        var status = 200
        var body = Data()

        func data(for request: URLRequest) async throws -> (Data, URLResponse) {
            requests.append(request)
            let response = HTTPURLResponse(
                url: request.url!, statusCode: status, httpVersion: nil, headerFields: nil
            )!
            return (body, response)
        }
    }

    private let serviceURL = URL(string: "https://example.invalid")!
    private let messageId = "2b000000-0000-4000-8000-000000000012"
    private let deviceId = "7c9e6679-7425-40de-944b-e07fc1f90ae7"

    func testARatingIsPutToTheMessagesPathWithTheVerdictAndTheDevice() async throws {
        let http = StubHTTP()
        http.body = Data(#"{"id":"4d000000-0000-4000-8000-000000000009","seq":9}"#.utf8)
        let client = MessageRatingClient(serviceURL: serviceURL, http: http)
        let answer = try await client.rate(messageId: messageId, .down, deviceId: deviceId, accessToken: "token")
        XCTAssertEqual(answer, MessageRatingAnswer(id: "4d000000-0000-4000-8000-000000000009", seq: 9))
        let request = try XCTUnwrap(http.requests.first)
        XCTAssertEqual(request.httpMethod, "PUT")
        XCTAssertEqual(request.url?.path, "/api/conversation/messages/\(messageId)/rating")
        XCTAssertEqual(request.value(forHTTPHeaderField: "Authorization"), "Bearer token")
        let body = try XCTUnwrap(
            JSONSerialization.jsonObject(with: try XCTUnwrap(request.httpBody)) as? [String: String]
        )
        XCTAssertEqual(body, ["rating": "down", "deviceId": deviceId])
    }

    private func refusal(status: Int, body: String) async throws -> MessageRatingError? {
        let http = StubHTTP()
        http.status = status
        http.body = Data(body.utf8)
        let client = MessageRatingClient(serviceURL: serviceURL, http: http)
        do {
            _ = try await client.rate(messageId: messageId, .up, deviceId: deviceId, accessToken: "token")
            return nil
        } catch let error as MessageRatingError {
            return error
        }
    }

    func testTheRoutesTwoRefusalsAreTwoErrors() async throws {
        let notFound = try await refusal(status: 404, body: #"{"error":"not-found"}"#)
        XCTAssertEqual(notFound, .notFound)
        let notRateable = try await refusal(status: 403, body: #"{"error":"not-rateable"}"#)
        XCTAssertEqual(notRateable, .notRateable)
    }

    func testAnUnauthorizedAnswerSignalsForTheRetry() async throws {
        let unauthorized = try await refusal(status: 401, body: "")
        XCTAssertEqual(unauthorized, .unauthorized)
        XCTAssertEqual(unauthorized?.isUnauthorized, true)
    }

    func testAnyOtherRefusalCarriesItsStatusAndSlug() async throws {
        let throttled = try await refusal(status: 429, body: #"{"error":"quota-exhausted"}"#)
        XCTAssertEqual(throttled, .serverError(status: 429, apiError: .quotaExhausted))
    }

    func testAMalformedAnswerIsDiscarded() async throws {
        let malformed = try await refusal(status: 200, body: #"{"id":"x"}"#)
        XCTAssertEqual(malformed, .invalidResponse)
    }
}
