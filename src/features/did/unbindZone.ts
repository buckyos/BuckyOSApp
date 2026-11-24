// Takes a Zone off the account's owner document, with the owner's signature.
import { getCachedSnStatus, setCachedSnStatus } from "../sn/snStatusManager";
import { bnsDocumentExists, resolveBnsOwnerDocument } from "../../services/bns_client";
import { removeOwnerBoundZone } from "../../services/sn_client";
import { signJsonWithActiveDid } from "./api";
import { getIdentityDid } from "./identityView";
import {
    buildOwnerRemoveBoundZoneClaims,
    canonicalOwnerDocumentHash,
    createOwnerUnbindRequestId,
    defaultBoundZoneDid,
    ownerAuthenticationKeyId,
    resolveOwnerUnbindTarget,
    waitForOwnerZoneUnbound,
} from "./ownerZoneBinding";
import type { DidInfo, OwnerDocument } from "./types";
import { setLastZoneBindingStatus } from "./zoneBindingStatus";

export async function unbindOwnerZone(
    did: DidInfo,
    requestedZone: string,
    password: string,
    syncOwnerDocument: (didId: string, document: OwnerDocument) => Promise<void>
): Promise<void> {
    const cached = await getCachedSnStatus(did.id);
    const userName = cached?.username?.trim() || did.sn_status?.username?.trim() || "";
    if (!userName) throw new Error("unbind_missing_username");

    const owner = await resolveBnsOwnerDocument(userName);
    const zoneDid = await resolveOwnerUnbindTarget(owner.document, requestedZone, () => bnsDocumentExists(userName, "zone"));
    if (!zoneDid) {
        // Already off the document.
        await syncOwnerDocument(did.id, owner.document);
        setLastZoneBindingStatus(getIdentityDid(did), false);
        return;
    }

    const name = userName.toLowerCase();
    const expectedOwnerHash = await canonicalOwnerDocumentHash(owner.document);
    const requestId = await createOwnerUnbindRequestId(userName, zoneDid, expectedOwnerHash, owner.version);
    const claims = buildOwnerRemoveBoundZoneClaims({ name: userName, zoneDid, expectedOwnerHash, requestId });
    const [token] = await signJsonWithActiveDid(password, [claims], ownerAuthenticationKeyId(owner.document));
    if (!token) throw new Error("unbind_sign_failed");

    const submitted = await removeOwnerBoundZone({
        name,
        zone_did: zoneDid,
        expected_owner_hash: expectedOwnerHash,
        request_id: requestId,
        owner_authorization: token,
    });
    if (
        submitted.source_owner_hash !== expectedOwnerHash ||
        submitted.name !== name ||
        submitted.operation !== "owner.remove_bound_zone" ||
        submitted.request_id !== requestId ||
        !/^sha256:[0-9a-f]{64}$/.test(submitted.result_owner_hash) ||
        (owner.version !== null && submitted.source_version !== owner.version)
    ) {
        throw new Error("sn_unbind_contract_violation");
    }
    const confirmed = await waitForOwnerZoneUnbound(userName, zoneDid, submitted.result_owner_hash);
    await syncOwnerDocument(did.id, confirmed.document);
    await setCachedSnStatus(did.id, { info: { ...(cached?.info ?? {}), user_name: userName }, username: userName });
    setLastZoneBindingStatus(getIdentityDid(did), defaultBoundZoneDid(confirmed.document) !== null);
}
