import { CommandErrorCodes } from "../../constants/commandErrorCodes";
import { isIosShell } from "../../utils/platform";
import { parseCommandError } from "../../utils/commandError";
import { OpenError, type OpenFailure } from "./types";

const REASONS: Partial<Record<CommandErrorCodes, OpenFailure>> = {
    [CommandErrorCodes.ZoneNotFound]: "zone_not_found",
    [CommandErrorCodes.ZoneNeedPassword]: "need_login",
    [CommandErrorCodes.ZoneUnreachable]: "unreachable",
    [CommandErrorCodes.Unsupported]: "not_here",
    [CommandErrorCodes.Canceled]: "canceled",
};

/** What an open request failed with, as something to tell the user. */
export function openErrorOf(error: unknown): OpenError {
    if (error instanceof OpenError) return error;
    const { code, message } = parseCommandError(error);
    return new OpenError(REASONS[code] ?? "failed", undefined, undefined, message);
}

export interface FailureTold {
    reason: OpenFailure;
    detail?: string;
}

export function failureText(t: (key: string, params?: Record<string, string>) => string, failure: FailureTold, names: { zone: string; app: string }): string {
    if (failure.reason === "not_here") return t("open.failure.not_here", { platform: isIosShell() ? "iOS" : "Android" });
    if (failure.reason === "failed" && failure.detail) return t("open.failure.failed_because", { reason: failure.detail });
    return t(`open.failure.${failure.reason}`, names);
}
