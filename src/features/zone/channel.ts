// Requests to one Zone from a local page. They go through the client's own session in Rust: no
// token reaches the page, and every one names its Zone.
import { invoke } from "@tauri-apps/api/core";
import { createZoneClients, type ZoneClients } from "buckyos";
import type { ZoneChannel } from "@buckyos-desktop/channel.ts";
import { parseCommandError } from "../../utils/commandError";

interface FetchResponse {
    status: number;
    headers: [string, string][];
    body_base64: string;
}

function toBase64(bytes: Uint8Array): string {
    let text = "";
    for (let offset = 0; offset < bytes.length; offset += 0x8000) {
        text += String.fromCharCode(...bytes.subarray(offset, offset + 0x8000));
    }
    return btoa(text);
}

function fromBase64(text: string): Uint8Array<ArrayBuffer> {
    const binary = atob(text);
    const bytes = new Uint8Array(binary.length);
    for (let index = 0; index < binary.length; index += 1) bytes[index] = binary.charCodeAt(index);
    return bytes;
}

async function bodyBytes(body: BodyInit | null | undefined): Promise<Uint8Array | null> {
    if (body === null || body === undefined) return null;
    if (typeof body === "string") return new TextEncoder().encode(body);
    return new Uint8Array(await new Response(body).arrayBuffer());
}

/** A failed command as the Error a fetch would have thrown. */
function asError(error: unknown): Error {
    const { message } = parseCommandError(error);
    return new TypeError(message || String(error));
}

/** `fetch` on the Zone root, with this client's session. */
async function zoneFetch(zone: string, path: string, init: RequestInit = {}): Promise<Response> {
    const bytes = await bodyBytes(init.body);
    const headers: [string, string][] = [];
    new Headers(init.headers).forEach((value, name) => headers.push([name, value]));
    const answer = await invoke<FetchResponse>("zone_fetch", {
        zone,
        request: { path, method: init.method ?? "GET", headers, body_base64: bytes ? toBase64(bytes) : null },
    }).catch((error) => {
        throw asError(error);
    });
    const empty = answer.status === 204 || answer.status === 304;
    return new Response(empty ? null : fromBase64(answer.body_base64), { status: answer.status, headers: answer.headers });
}

/** The WebSDK kRPC client's transport. */
function krpcFetcher(zone: string) {
    return async (input: RequestInfo | URL, init?: RequestInit): Promise<Response> => {
        const url = new URL(typeof input === "string" ? input : input instanceof URL ? input.href : input.url);
        const service = /^\/kapi\/([^/]+)\/?$/.exec(url.pathname)?.[1];
        if (!service || typeof init?.body !== "string") throw new TypeError(`not a kRPC request: ${url.pathname}`);
        const body = await invoke<string>("zone_rpc", { zone, service, body: init.body }).catch((error) => {
            throw asError(error);
        });
        return new Response(body, { status: 200, headers: { "Content-Type": "application/json" } });
    };
}

const clients = new Map<string, ZoneClients>();

/** The WebSDK's typed clients of one Zone. */
export function zoneClients(zone: { did: string; host: string }, identity?: { user_id: string; did: string } | null): ZoneClients {
    const key = `${zone.did}|${zone.host}|${identity?.user_id ?? ""}`;
    let found = clients.get(key);
    if (!found) {
        found = createZoneClients({
            zoneHost: zone.host,
            userId: identity?.user_id,
            ownerDid: identity?.did,
            fetcher: krpcFetcher(zone.did),
        });
        clients.set(key, found);
    }
    return found;
}

const channels = new Map<string, ZoneChannel>();

/** The request channel the shared Desktop modules take. */
export function zoneChannel(zone: { did: string; host: string }): ZoneChannel {
    const key = `${zone.did}|${zone.host}`;
    let found = channels.get(key);
    if (!found) {
        found = {
            rpc: <T,>(service: string, method: string, params: Record<string, unknown> = {}) =>
                zoneClients(zone).rpc(service).call<T, Record<string, unknown>>(method, params),
            fetch: (path: string, init?: RequestInit) => zoneFetch(zone.did, path, init),
        };
        channels.set(key, found);
    }
    return found;
}
