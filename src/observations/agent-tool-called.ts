import type { Validator } from "../validate/validator.js";
import { PayloadChecker } from "../validate/checker.js";

/**
 * `agent.tool_called` — an agent invoked a tool (e.g. an MCP tool call).
 *
 * Payload:
 *   - `tool`      (string, required)  the tool name that was invoked
 *   - `protocol`  (string, optional)  invocation protocol, e.g. "mcp"
 *   - `server`    (string, optional)  the tool/MCP server the tool belongs to
 *   - `args`      (json, optional)    arguments passed to the tool
 *   - `result`    (json, optional)    result returned by the tool
 *   - `isError`   (boolean, optional) whether the call ended in an error
 *
 * The agent (actor) and the thing acted on (subject) travel on the event
 * envelope, not the payload, so they can be resolved by attribution.
 */
export const agentToolCalledValidator: Validator = {
  kind: "agent.tool_called",
  observationType: "AgentToolCalled",
  schemaVersion: "1.0",
  validate(payload) {
    const check = PayloadChecker.of(payload);
    if (check === undefined) {
      return { ok: false, issues: [{ path: "payload", message: "must be an object" }] };
    }
    check.string("tool");
    check.string("protocol", { optional: true });
    check.string("server", { optional: true });
    check.boolean("isError", { optional: true });
    check.json("args", { optional: true });
    check.json("result", { optional: true });
    return check.result();
  },
};
