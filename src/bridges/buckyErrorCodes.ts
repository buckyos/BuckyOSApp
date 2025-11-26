export const BuckyErrorCodes = {
    Success: 0,
    UnknownAction: 1,
    NativeError: 2,
    NoKey: 3,
    NoActiveDid: 4,
    NoMessage: 5,
    InvalidPassword: 6,
    Cancelled: 7,
} as const;

export type BuckyErrorCode = typeof BuckyErrorCodes[keyof typeof BuckyErrorCodes];
