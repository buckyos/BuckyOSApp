import { buckyos } from "buckyos";

// SN kRPC client via buckyos-websdk
let SN_API_URL = "http://sn.buckyos.ai/kapi/sn";

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
  console.debug("[SN] check_username: done", { data });

  if (typeof data?.valid === "boolean") return data.valid;
  if (typeof data?.code === "number") return data.code === 0;
  return false;
}

export async function checkSnActiveCode(activeCode: string): Promise<boolean> {
  const data = await snCall<{ valid?: boolean; code?: number }>("check_active_code", { active_code: activeCode });
  console.debug("[SN] check_active_code: done", { activeCode, data });

  if (typeof data?.valid === "boolean") return data.valid;
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

export async function getUserByPublicKey(publicKeyJwk: string): Promise<{ ok: boolean; raw: any }> {
  console.debug("[SN] get_by_pk: start", { public_key: publicKeyJwk });
  try {
    const data = await snCall<{
      device_info?: string | null;
      device_name?: string | null;
      device_sn_ip?: string | null;
      found?: boolean | null;
      public_key?: string | null;
      reason?: string | null;
      sn_ips?: string[] | null;
      user_name?: string | null;
      zone_config?: string | null;
    }>("get_by_pk", { public_key: publicKeyJwk });
    /*
    data:{
      device_info:null,
      device_name:"ood1",
      device_sn_ip:null,
      found:false,
      public_key:publicKeyJwk,
      reason:"user not found",
      sn_ips:[],
      user_name:null,
      zone_config:null,
    }
    */
    console.debug("[SN] get_by_pk: done", { data });
    return { ok: (data?.user_name !== null), raw: data };
  } catch (e) {
    const message = e instanceof Error ? e.message : String(e);
    console.error("[SN] get_by_pk: error", { message });
    throw e;
  }
}
