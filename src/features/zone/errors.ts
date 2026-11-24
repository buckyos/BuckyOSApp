import { parseCommandError } from "../../utils/commandError";
import { CommandErrorCodes } from "../../constants/commandErrorCodes";

/** Why a Zone could not be found or signed in to, as the user needs to tell them apart. */
export type ZoneFailure =
    | "address"
    | "not_zone"
    | "unreachable"
    | "password"
    | "no_password"
    | "clock"
    | "denied"
    | "failed";

/** A reason the session status carries (`SessionStatus.reason`). */
export function failureOfReason(reason: string | null | undefined): ZoneFailure | null {
    switch (reason) {
        case "password":
        case "no_password":
        case "clock":
        case "denied":
            return reason;
        default:
            return null;
    }
}

/** The client puts why verify-hub refused the sign-in before its message (`password: …`). */
function refusedSignIn(message: string): ZoneFailure {
    const reason = failureOfReason(/^(\w+): /.exec(message)?.[1]);
    if (reason) return reason;
    return /access denied|no permission/i.test(message) ? "denied" : "failed";
}

export function zoneFailureOf(error: unknown): ZoneFailure {
    const { code, message } = parseCommandError(error);
    switch (code) {
        case CommandErrorCodes.ZoneUnreachable:
            return "unreachable";
        case CommandErrorCodes.ZoneNeedPassword:
            return "password";
        case CommandErrorCodes.ZoneLoginFailed:
            return refusedSignIn(message);
        case CommandErrorCodes.ZoneRequestFailed:
            return message === "invalid_zone_address" ? "address" : "not_zone";
        default:
            return /invalid_did|did_not_found|not_found|unsupported_did/i.test(message) ? "address" : "failed";
    }
}
