import type { DidInfo } from "./types";

export function getIdentityDisplayName(did: DidInfo | null | undefined): string {
    return did?.owner_document?.display_name?.trim() || did?.owner_document?.name?.trim() || "";
}

export function getIdentityBnsName(did: DidInfo | null | undefined): string {
    return did?.owner_document?.name?.trim() || "";
}

export function getIdentityDid(did: DidInfo | null | undefined): string {
    return did?.owner_document?.id?.trim() || "";
}

export function getIdentityAvatar(did: DidInfo | null | undefined): string {
    return did?.owner_document?.avatar?.trim() || "";
}
