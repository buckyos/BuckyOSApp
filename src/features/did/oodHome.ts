import { namelib } from "buckyos";
import { resolveDid } from "./api";

export async function resolveOodHomeUrl(zoneDid: string): Promise<string> {
    const encoded = await resolveDid(zoneDid, "zone");
    const document = namelib.encodedDocumentToJsonValue(encoded);
    if (!document || document.id !== zoneDid || typeof document.hostname !== "string") {
        throw new Error("invalid_zone_home");
    }
    const hostname = document.hostname.trim();
    // ZoneDocument.hostname is an access hostname, not an activation URL or path.
    if (!hostname || /[\s/?#@\\]/.test(hostname)) throw new Error("invalid_zone_home");
    const url = new URL(`https://${hostname}/`);
    if (!url.hostname || url.username || url.password || url.pathname !== "/") {
        throw new Error("invalid_zone_home");
    }
    return url.href;
}
