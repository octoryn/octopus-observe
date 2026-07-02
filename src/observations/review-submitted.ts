import type { Validator } from "../validate/validator.js";
import { PayloadChecker } from "../validate/checker.js";

/**
 * `review.submitted` — a code review was submitted on a change.
 *
 * Payload:
 *   - `pullRequest`  (string, required)  identifier of the change under review
 *   - `decision`     (enum, required)    approved | changes_requested | commented
 *   - `comments`     (int, optional)     number of comments left
 *
 * Actors (the reviewer) and subjects (the change) travel on the event envelope,
 * not the payload, so they can be resolved by attribution.
 */
export const reviewSubmittedValidator: Validator = {
  kind: "review.submitted",
  observationType: "ReviewSubmitted",
  schemaVersion: "1.0",
  validate(payload) {
    const check = PayloadChecker.of(payload);
    if (check === undefined) {
      return { ok: false, issues: [{ path: "payload", message: "must be an object" }] };
    }
    check.string("pullRequest");
    check.enum("decision", ["approved", "changes_requested", "commented"] as const);
    check.number("comments", { optional: true, integer: true });
    return check.result();
  },
};
