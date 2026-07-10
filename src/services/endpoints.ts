import { invoke } from "@tauri-apps/api/core";

export interface ServiceEndpoints {
    sn_host: string;
    sn_api_url: string;
    bns_api_url: string;
}

let endpointOverride: ServiceEndpoints | null = null;
let endpointPromise: Promise<ServiceEndpoints> | null = null;

export function setServiceEndpointsForTests(endpoints: ServiceEndpoints | null): void {
    endpointOverride = endpoints;
    endpointPromise = endpoints ? Promise.resolve(endpoints) : null;
}

export async function getServiceEndpoints(): Promise<ServiceEndpoints> {
    if (endpointOverride) return endpointOverride;
    if (!endpointPromise) endpointPromise = invoke<ServiceEndpoints>("get_service_endpoints");
    return endpointPromise;
}
