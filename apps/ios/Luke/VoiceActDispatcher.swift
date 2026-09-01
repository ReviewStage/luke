import Foundation
import LukeKit

/// Maps the Realtime tool names the mobile session receives to the hosted act
/// endpoints that carry them, mirroring `HOSTED_SERVICE_PATH` in `@sidecar/hosted`.
///
/// The model's tool call arguments use snake_case (`provider_id`,
/// `provider_session_id`). The act endpoints accept camelCase body keys
/// (`providerId`, `providerSessionId`). This function translates between them.
@MainActor
func dispatchVoiceToolCall(
    name: String,
    arguments: [String: Any],
    callId: String,
    accessToken: String,
    serviceURL: URL,
    http: HTTPClient = URLSession.shared
) async -> String {
    guard let path = actPath(for: name) else {
        return #"{"error":"unsupported tool"}"#
    }
    let body = actBody(toolName: name, arguments: arguments)
    guard let bodyData = try? JSONSerialization.data(withJSONObject: body) else {
        return #"{"error":"invalid arguments"}"#
    }
    var request = URLRequest(url: serviceURL.appendingPathComponent(path))
    request.httpMethod = "POST"
    request.setValue("Bearer \(accessToken)", forHTTPHeaderField: "Authorization")
    request.setValue("application/json", forHTTPHeaderField: "Content-Type")
    request.httpBody = bodyData
    do {
        let (data, response) = try await http.data(for: request)
        let status = (response as? HTTPURLResponse)?.statusCode ?? 0
        // Return the raw JSON response body as the function_call_output. The
        // server's act result is already a bounded JSON object, so the model
        // receives {"result":"sent"} or {"result":"rejected","reason":"..."}.
        if (200 ..< 300).contains(status) || (400 ..< 500).contains(status) {
            return String(data: data, encoding: .utf8) ?? #"{"error":"empty response"}"#
        }
        return #"{"error":"server error \#(status)"}"#
    } catch {
        return #"{"error":"network error"}"#
    }
}

// Maps the snake_case tool name from the model to the act endpoint path.
private func actPath(for toolName: String) -> String? {
    switch toolName {
    case "send_session_message": return "api/acts/message"
    case "run_session_control": return "api/acts/control"
    case "add_workspace_agent": return "api/acts/agent"
    case "create_workspace": return "api/acts/workspace"
    case "rename_workspace": return "api/acts/rename-workspace"
    case "rename_session": return "api/acts/rename-session"
    default: return nil
    }
}

// Translates snake_case tool arguments to the camelCase body the act endpoints expect.
private func actBody(toolName: String, arguments: [String: Any]) -> [String: Any] {
    func str(_ key: String) -> String? { arguments[key] as? String }
    var body: [String: Any] = [:]

    switch toolName {
    case "create_workspace":
        if let v = str("provider_id") { body["providerId"] = v }
        if let v = str("project_id") { body["providerProjectId"] = v }
        if let v = str("name") { body["name"] = v }
        if let v = str("task") { body["task"] = v }
        if let v = str("model") { body["model"] = v }
        if let v = str("effort") { body["effort"] = v }
    default:
        if let v = str("provider_id") { body["providerId"] = v }
        if let v = str("provider_session_id") { body["providerSessionId"] = v }
        switch toolName {
        case "send_session_message":
            if let v = str("text") { body["text"] = v }
        case "run_session_control":
            if let v = str("control_id") { body["controlId"] = v }
        case "add_workspace_agent":
            if let v = str("agent") { body["agent"] = v }
            if let v = str("name") { body["name"] = v }
            if let v = str("task") { body["task"] = v }
            if let v = str("model") { body["model"] = v }
            if let v = str("effort") { body["effort"] = v }
        case "rename_workspace", "rename_session":
            if let v = str("name") { body["name"] = v }
        default:
            break
        }
    }
    return body
}
