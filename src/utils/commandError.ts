import { CommandErrorCode, CommandErrorCodes } from "../constants/commandErrorCodes";

export interface CommandErrorPayload {
    code: CommandErrorCode;
    message: string;
}

export function parseCommandError(err: unknown): CommandErrorPayload {
    if (typeof err === "object" && err !== null) {
        const maybe = err as { code?: unknown; message?: unknown };
        if (typeof maybe.code === "number" && typeof maybe.message === "string") {
            return { code: maybe.code as CommandErrorCode, message: maybe.message };
        }
        if ("message" in maybe && typeof (maybe as any).message === "string") {
            return { code: CommandErrorCodes.Internal, message: (maybe as any).message as string };
        }
    }
    if (err instanceof Error) {
        return { code: CommandErrorCodes.Internal, message: err.message };
    }
    return { code: CommandErrorCodes.Internal, message: String(err) };
}
