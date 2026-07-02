import type { Validator } from "../validate/validator.js";
import { PayloadChecker } from "../validate/checker.js";

/**
 * `deploy.finished` — a deployment reached a terminal state.
 *
 * Payload:
 *   - `service`      (string, required)  the service that was deployed
 *   - `environment`  (string, required)  target environment, e.g. "production"
 *   - `status`       (enum, required)    succeeded | failed
 *   - `durationMs`   (int, optional)     wall-clock duration of the deploy
 */
export const deployFinishedValidator: Validator = {
  kind: "deploy.finished",
  observationType: "DeployFinished",
  schemaVersion: "1.0",
  validate(payload) {
    const check = PayloadChecker.of(payload);
    if (check === undefined) {
      return { ok: false, issues: [{ path: "payload", message: "must be an object" }] };
    }
    check.string("service");
    check.string("environment");
    check.enum("status", ["succeeded", "failed"] as const);
    check.number("durationMs", { optional: true, integer: true });
    return check.result();
  },
};
