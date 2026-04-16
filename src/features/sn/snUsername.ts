const SN_USERNAME_REGEX = /^[a-z][a-z0-9-]{5,}[a-z0-9]$/;

export function normalizeSnUsername(value: string): string {
    return value.trim().toLowerCase();
}

export function isLocallyValidSnUsername(value: string): boolean {
    const normalized = normalizeSnUsername(value);
    return SN_USERNAME_REGEX.test(normalized);
}
