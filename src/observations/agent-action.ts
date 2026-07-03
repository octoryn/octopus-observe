import type { Validator } from "../validate/validator.js";
import { PayloadChecker } from "../validate/checker.js";

/**
 * `agent.action` — an agent took a generic, named action.
 *
 * A deliberately open shape for any agent step that is not a tool call: a
 * planning decision, a message, a file edit, a hand-off. The `action` names
 * what happened; `status` records how it ended; `detail` carries whatever
 * structured context the emitter has.
 *
 * Payload:
 *   - `action`   (string, required)  what the agent did, e.g. "plan", "message"
 *   - `status`   (enum, optional)    ok | error | pending
 *   - `detail`   (json, optional)    open-ended structured context
 *
 * The agent (actor) and the thing acted on (subject) travel on the event
 * envelope, not the payload, so they can be resolved by attribution.
 */
export const agentActionValidator: Validator = {
  kind: "agent.action",
  observationType: "AgentAction",
  schemaVersion: "1.0",
  validate(payload) {
    const check = PayloadChecker.of(payload);
    if (check === undefined) {
      return { ok: false, issues: [{ path: "payload", message: "must be an object" }] };
    }
    check.string("action");
    check.enum("status", ["ok", "error", "pending"] as const, { optional: true });
    check.json("detail", { optional: true });
    return check.result();
  },
};
