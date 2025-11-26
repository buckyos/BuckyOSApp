export const BuckyErrorCodes = {
    success: 0,
    unknownAction: 1000,
    nativeError: 1001,
    noKey: 2000,
    noActiveDid: 2001,
    noMessage: 2002,
    invalidPassword: 2003,
    cancelled: 2004,
} as const;

export type BuckyErrorCode = typeof BuckyErrorCodes[keyof typeof BuckyErrorCodes];
