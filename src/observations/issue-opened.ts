import type { Validator } from "../validate/validator.js";
import { PayloadChecker } from "../validate/checker.js";

/**
 * `issue.opened` — a tracker issue was opened.
 *
 * Payload:
 *   - `issue`     (string, required)  identifier of the issue
 *   - `title`     (string, required)  human-readable title
 *   - `priority`  (enum, optional)    low | medium | high
 */
export const issueOpenedValidator: Validator = {
  kind: "issue.opened",
  observationType: "IssueOpened",
  schemaVersion: "1.0",
  validate(payload) {
    const check = PayloadChecker.of(payload);
    if (check === undefined) {
      return { ok: false, issues: [{ path: "payload", message: "must be an object" }] };
    }
    check.string("issue");
    check.string("title");
    check.enum("priority", ["low", "medium", "high"] as const, { optional: true });
    return check.result();
  },
};
