import { buckyos } from "buckyos";

// SN kRPC client via buckyos-websdk
let SN_API_URL = "https://sn.buckyos.ai/kapi/sn";

export function setSnApiUrl(url: string) {
  SN_API_URL = url;
}

type JsonValue = Record<string, any>;

async function snCall<T = any>(method: string, params: JsonValue): Promise<T> {
  const client = new buckyos.kRPCClient(SN_API_URL);
  const data = await client.call(method, params);
  return data as T;
}

export async function checkBuckyUsername(username: string): Promise<boolean> {
  const data = await snCall<{ valid?: boolean; code?: number }>("check_username", { username });
  if (typeof data?.valid === "boolean") return data.valid;
  if (typeof data?.code === "number") return data.code === 0;
  return false;
}

export async function checkSnActiveCode(activeCode: string): Promise<boolean> {
  const data = await snCall<{ valid?: boolean; code?: number }>("check_active_code", { active_code: activeCode });
  if (typeof data?.valid === "boolean") return data.valid;
  if (typeof data?.code === "number") return data.code === 0;
  return false;
}

export async function registerSnUser(args: {
  userName: string;
  activeCode: string;
  publicKeyJwk: string; // stringified JWK
  zoneConfigJwt: string;
  userDomain?: string | null;
}): Promise<{ ok: boolean; raw: any }> {
  const params: JsonValue = {
    user_name: args.userName,
    active_code: args.activeCode,
    public_key: args.publicKeyJwk,
    zone_config: args.zoneConfigJwt,
  };
  if (args.userDomain) params["user_domain"] = args.userDomain;
  const data = await snCall<{ code?: number }>("register_user", params);
  return { ok: (data?.code ?? -1) === 0, raw: data };
}

export async function getUserByPublicKey(publicKeyJwk: string, deviceName = "ood1"): Promise<{ ok: boolean; raw: any }> {
  // logging for SN query process
  const start = Date.now();

  console.debug("[SN] get_by_pk: start", { deviceName, pk: publicKeyJwk });
  try {
    const data = await snCall<{ code?: number }>("get_by_pk", { public_key: publicKeyJwk, device_name: deviceName });
    const code = (data as any)?.code;
    console.debug("[SN] get_by_pk: done", { code, durationMs: Date.now() - start });
    return { ok: (code ?? -1) === 0, raw: data };
  } catch (e) {
    const message = e instanceof Error ? e.message : String(e);
    console.error("[SN] get_by_pk: error", { message, durationMs: Date.now() - start });
    throw e;
  }
}
