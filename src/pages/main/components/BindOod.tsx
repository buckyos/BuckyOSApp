import React from "react";
import { fetch as tauriFetch } from "@tauri-apps/plugin-http";
import { useNavigate } from "react-router-dom";
import { useI18n } from "../../../i18n";
import GradientButton from "../../../components/ui/GradientButton";
import ConfirmDialog from "../../../components/ui/ConfirmDialog";
import InputDialog from "../../../components/ui/InputDialog";
import oodIllustration from "../../../assets/ood.png";
import { useDidContext } from "../../../features/did/DidContext";
import { signJsonWithActiveDid } from "../../../features/did/api";
import { getIdentityDid } from "../../../features/did/identityView";
import {
    buildOwnerRemoveBoundZoneClaims,
    canonicalOwnerDocumentHash,
    createOwnerUnbindRequestId,
    defaultBoundZoneDid,
    ownerAuthenticationKeyId,
    resolveOwnerUnbindTarget,
    waitForOwnerZoneUnbound,
} from "../../../features/did/ownerZoneBinding";
import {
    getLastZoneBindingStatus,
    resolveZoneBindingSnapshot,
    setLastZoneBindingStatus,
} from "../../../features/did/zoneBindingStatus";
import { getCachedSnStatus, setCachedSnStatus } from "../../../features/sn/snStatusManager";
import { bnsDocumentExists, resolveBnsOwnerDocument } from "../../../services/bns_client";
import { removeOwnerBoundZone } from "../../../services/sn_client";
import { parseCommandError } from "../../../utils/commandError";
import { CommandErrorCodes } from "../../../constants/commandErrorCodes";
import { openWebView } from "../../../utils/webview";

type RemoteOodProtocol = "http://" | "https://";
type RemoteOodNormalizeResult =
    | { ok: false; errorKey: string }
    | { ok: true; host: string; port: number; baseUrl: string };

interface RemoteOodDeviceInfo {
    active_url?: unknown;
    hostname?: unknown;
    device_name?: unknown;
    display_ip?: unknown;
    ip?: unknown;
    device_type?: unknown;
}

function isValidIpv4(host: string) {
    const parts = host.split(".");
    if (parts.length !== 4) return false;
    return parts.every((part) => {
        if (!/^\d{1,3}$/.test(part)) return false;
        if (part.length > 1 && part.startsWith("0")) return false;
        const value = Number(part);
        return Number.isInteger(value) && value >= 0 && value <= 255;
    });
}

function isValidDomain(host: string) {
    if (host.length > 253) return false;
    return host.split(".").every((label) => {
        if (!label || label.length > 63) return false;
        return /^[a-zA-Z0-9](?:[a-zA-Z0-9-]*[a-zA-Z0-9])?$/.test(label);
    });
}

function normalizeRemoteOodBase(protocol: RemoteOodProtocol, rawAddress: string): RemoteOodNormalizeResult {
    const address = rawAddress.trim();
    if (!address) {
        return { ok: false, errorKey: "ood.remote_url_error_required" };
    }
    if (/^https?:\/\//i.test(address)) {
        return { ok: false, errorKey: "ood.remote_url_error_scheme_in_input" };
    }
    if (/[/?#@]/.test(address)) {
        return { ok: false, errorKey: "ood.remote_url_error_root_only" };
    }

    const match = address.match(/^([^:]+)(?::(\d+))?$/);
    if (!match) {
        return { ok: false, errorKey: "ood.remote_url_error_invalid" };
    }

    const host = match[1].trim();
    const portText = match[2];
    if (!host || (!isValidIpv4(host) && !isValidDomain(host))) {
        return { ok: false, errorKey: "ood.remote_url_error_invalid_host" };
    }

    const port = portText ? Number(portText) : 3182;
    if (!Number.isInteger(port) || port < 1 || port > 65535) {
        return { ok: false, errorKey: "ood.remote_url_error_invalid_port" };
    }

    return {
        ok: true,
        host,
        port,
        baseUrl: `${protocol}${host}:${port}`,
    };
}

function resolveActiveUrl(baseUrl: string, activeUrl: string) {
    const trimmed = activeUrl.trim();
    if (!trimmed) return "";
    if (/^https?:\/\//i.test(trimmed)) return trimmed;
    if (/^[a-z][a-z0-9+.-]*:/i.test(trimmed)) return "";
    return `${baseUrl}${trimmed.startsWith("/") ? trimmed : `/${trimmed}`}`;
}

const BindOod: React.FC = () => {
    const { t } = useI18n();
    const navigate = useNavigate();
    const { activeDid } = useDidContext();
    const [hasBoundOod, setHasBoundOod] = React.useState(false);
    const [boundZoneDids, setBoundZoneDids] = React.useState<string[]>([]);
    const [selectedZoneDid, setSelectedZoneDid] = React.useState<string | null>(null);
    const [confirmUnbindOpen, setConfirmUnbindOpen] = React.useState(false);
    const [passwordDialogOpen, setPasswordDialogOpen] = React.useState(false);
    const [password, setPassword] = React.useState("");
    const [passwordError, setPasswordError] = React.useState("");
    const [unbindLoading, setUnbindLoading] = React.useState(false);
    const [remoteDialogOpen, setRemoteDialogOpen] = React.useState(false);
    const [remoteProtocol, setRemoteProtocol] = React.useState<RemoteOodProtocol>("http://");
    const [remoteAddress, setRemoteAddress] = React.useState("");
    const [remoteError, setRemoteError] = React.useState("");
    const [remoteLoading, setRemoteLoading] = React.useState(false);
    const [remoteProtocolMenuOpen, setRemoteProtocolMenuOpen] = React.useState(false);
    const remoteAddressInputRef = React.useRef<HTMLInputElement | null>(null);
    const [resultDialog, setResultDialog] = React.useState<{ open: boolean; title: string; message: string }>({
        open: false,
        title: "",
        message: "",
    });

    React.useEffect(() => {
        let cancelled = false;

        const loadOodBinding = async () => {
            const currentUserDid = getIdentityDid(activeDid);
            if (!currentUserDid) {
                if (!cancelled) setHasBoundOod(false);
                return;
            }

            const lastStatus = getLastZoneBindingStatus(currentUserDid);
            if (lastStatus !== null && !cancelled) {
                setHasBoundOod(lastStatus);
            }

            const snapshot = await resolveZoneBindingSnapshot(currentUserDid);
            if (!cancelled && snapshot !== null) {
                setHasBoundOod(snapshot.isBound);
                setBoundZoneDids(snapshot.zoneDids);
                setSelectedZoneDid((current) =>
                    current && snapshot.zoneDids.includes(current) ? current : snapshot.zoneDids[0] ?? null
                );
            }
        };

        void loadOodBinding();

        return () => {
            cancelled = true;
        };
    }, [activeDid]);

    const openResultDialog = React.useCallback((title: string, message: string) => {
        setResultDialog({ open: true, title, message });
    }, []);

    React.useEffect(() => {
        if (!remoteDialogOpen) return;
        const timer = window.setTimeout(() => remoteAddressInputRef.current?.focus(), 50);
        return () => window.clearTimeout(timer);
    }, [remoteDialogOpen]);

    const handleOpenRemoteDialog = React.useCallback(() => {
        setRemoteProtocol("http://");
        setRemoteAddress("");
        setRemoteError("");
        setRemoteProtocolMenuOpen(false);
        setRemoteDialogOpen(true);
    }, []);

    const handleCloseRemoteDialog = React.useCallback(() => {
        if (remoteLoading) return;
        setRemoteDialogOpen(false);
        setRemoteAddress("");
        setRemoteError("");
        setRemoteProtocol("http://");
        setRemoteProtocolMenuOpen(false);
    }, [remoteLoading]);

    const handleConfirmRemoteAddress = React.useCallback(async () => {
        const normalized = normalizeRemoteOodBase(remoteProtocol, remoteAddress);
        if (!normalized.ok) {
            setRemoteError(t(normalized.errorKey));
            return;
        }

        setRemoteLoading(true);
        setRemoteError("");
        const controller = new AbortController();
        const timeoutId = window.setTimeout(() => controller.abort(), 5000);
        try {
            const response = await tauriFetch(`${normalized.baseUrl}/device`, {
                method: "GET",
                signal: controller.signal,
            });
            if (!response.ok) {
                throw new Error("device_request_failed");
            }

            const device = (await response.json()) as RemoteOodDeviceInfo;
            const activeUrl = typeof device.active_url === "string" ? device.active_url : "";
            const target = resolveActiveUrl(normalized.baseUrl, activeUrl);
            if (!target) {
                throw new Error("missing_active_url");
            }

            const title =
                (typeof device.device_name === "string" && device.device_name.trim()) ||
                (typeof device.hostname === "string" && device.hostname.trim()) ||
                normalized.host;
            const typeLabel =
                (typeof device.device_type === "string" && device.device_type.trim()) ||
                "remote";
            const label = `active-remote-${title}-${typeLabel}-${normalized.host}-${normalized.port}`;

            await openWebView(target, title, label, { center: true });
            setRemoteDialogOpen(false);
            setRemoteAddress("");
            setRemoteProtocol("http://");
            setRemoteProtocolMenuOpen(false);
        } catch (err) {
            console.warn("[OOD] remote activation probe failed", { address: remoteAddress, err });
            setRemoteError(t("ood.remote_url_error_probe_failed"));
        } finally {
            window.clearTimeout(timeoutId);
            setRemoteLoading(false);
        }
    }, [remoteProtocol, remoteAddress, t]);

    const handleStartUnbind = React.useCallback(() => {
        setConfirmUnbindOpen(false);
        setPassword("");
        setPasswordError("");
        setPasswordDialogOpen(true);
    }, []);

    const handleConfirmPassword = React.useCallback(async () => {
        const trimmedPassword = password.trim();
        if (!trimmedPassword) {
            setPasswordError(t("ood.unbind_password_required"));
            return;
        }
        if (!activeDid?.id) {
            setPasswordDialogOpen(false);
            openResultDialog(t("ood.unbind_result_failed_title"), t("ood.unbind_no_identity"));
            return;
        }

        const cached = await getCachedSnStatus(activeDid.id);
        const userName =
            (typeof cached?.username === "string" && cached.username.trim()) ||
            (typeof activeDid.sn_status?.username === "string" && activeDid.sn_status.username.trim()) ||
            "";

        if (!userName) {
            setPasswordDialogOpen(false);
            openResultDialog(t("ood.unbind_result_failed_title"), t("ood.unbind_missing_username"));
            return;
        }

        setUnbindLoading(true);
        setPasswordError("");
        try {
            const owner = await resolveBnsOwnerDocument(userName);
            const zoneDid = await resolveOwnerUnbindTarget(
                owner.document,
                selectedZoneDid,
                () => bnsDocumentExists(userName, "zone")
            );
            if (!zoneDid) {
                setLastZoneBindingStatus(getIdentityDid(activeDid), false);
                setHasBoundOod(false);
                setBoundZoneDids([]);
                setSelectedZoneDid(null);
                setPasswordDialogOpen(false);
                setPassword("");
                openResultDialog(t("ood.unbind_result_success_title"), t("ood.unbind_result_success_message"));
                return;
            }

            const expectedOwnerHash = await canonicalOwnerDocumentHash(owner.document);
            const requestId = await createOwnerUnbindRequestId(userName, zoneDid, expectedOwnerHash);
            const claims = buildOwnerRemoveBoundZoneClaims({
                name: userName,
                zoneDid,
                expectedOwnerHash,
                requestId,
            });
            const [token] = await signJsonWithActiveDid(
                trimmedPassword,
                [claims],
                ownerAuthenticationKeyId(owner.document)
            );
            if (!token) {
                throw new Error("unbind_sign_failed");
            }

            const submitted = await removeOwnerBoundZone({
                name: userName.trim().toLowerCase(),
                zone_did: zoneDid,
                expected_owner_hash: expectedOwnerHash,
                request_id: requestId,
                owner_authorization: token,
            });
            if (
                submitted.source_owner_hash !== expectedOwnerHash ||
                submitted.name !== userName.trim().toLowerCase() ||
                submitted.operation !== "owner.remove_bound_zone" ||
                submitted.request_id !== requestId ||
                !/^sha256:[0-9a-f]{64}$/.test(submitted.result_owner_hash) ||
                (owner.version !== null && submitted.source_version !== owner.version)
            ) {
                throw new Error("sn_unbind_contract_violation");
            }
            const confirmed = await waitForOwnerZoneUnbound(userName, zoneDid, submitted.result_owner_hash);
            await setCachedSnStatus(activeDid.id, {
                info: {
                    ...(cached?.info ?? {}),
                    user_name: userName,
                },
                username: userName,
            });
            const stillBound = defaultBoundZoneDid(confirmed.document) !== null;
            const remainingZones = confirmed.document.binded_zone_list ?? [];
            setLastZoneBindingStatus(getIdentityDid(activeDid), stillBound);
            setHasBoundOod(stillBound);
            setBoundZoneDids(remainingZones);
            setSelectedZoneDid(remainingZones[0] ?? null);
            setPasswordDialogOpen(false);
            setPassword("");
            openResultDialog(t("ood.unbind_result_success_title"), t("ood.unbind_result_success_message"));
        } catch (err) {
            const { code, message } = parseCommandError(err);
            if (code === CommandErrorCodes.InvalidPassword || message.includes("invalid_password")) {
                setPasswordError(t("ood.unbind_password_invalid"));
                return;
            }
            setPasswordDialogOpen(false);
            openResultDialog(
                t("ood.unbind_result_failed_title"),
                message === "sn_unbind_timeout"
                    ? t("ood.unbind_result_timeout_message")
                    : t("ood.unbind_result_failed_message", { message })
            );
        } finally {
            setUnbindLoading(false);
        }
    }, [password, t, activeDid, openResultDialog, selectedZoneDid]);

    return (
        <section className="did-section bind-ood-section">
            <header className="home-header">
                <div>
                    <h1>{hasBoundOod ? t("ood.bound_title") : t("ood.activate_title")}</h1>
                    <p>{hasBoundOod ? t("ood.bound_subtitle") : t("ood.activate_subtitle")}</p>
                </div>
            </header>

            <div className="ood-info-card bind-ood-info">
                <p>{hasBoundOod ? t("ood.bound_desc") : t("ood.activate_desc_inline")}</p>
                {hasBoundOod && boundZoneDids.length > 0 && (
                    <label className="bind-ood-zone-field">
                        <span>{t("ood.bound_zone_label")}</span>
                        <select
                            value={selectedZoneDid ?? ""}
                            onChange={(event) => setSelectedZoneDid(event.target.value)}
                            aria-label={t("ood.bound_zone_label")}
                        >
                            {boundZoneDids.map((zoneDid) => (
                                <option key={zoneDid} value={zoneDid}>{zoneDid}</option>
                            ))}
                        </select>
                    </label>
                )}
            </div>

            <div className="bind-ood-image-wrapper">
                <img src={oodIllustration} alt="OOD illustration" className="bind-ood-image" />
            </div>

            <div className="bind-ood-flex-spacer" />

            <div className="sn-page-actions bind-ood-actions">
                {hasBoundOod ? (
                    <>
                        <GradientButton
                            fullWidth
                            onClick={() => navigate("/main/apps")}
                        >
                            {t("tabs.apps")}
                        </GradientButton>
                        <GradientButton
                            fullWidth
                            variant="secondary"
                            disabled={!selectedZoneDid}
                            onClick={() => setConfirmUnbindOpen(true)}
                        >
                            {t("ood.unbind_button")}
                        </GradientButton>
                    </>
                ) : (
                    <>
                        <GradientButton
                            fullWidth
                            onClick={() => navigate("/main/home/ood-scan")}
                        >
                            {t("ood.scan_local_button")}
                        </GradientButton>
                        <GradientButton
                            fullWidth
                            variant="secondary"
                            onClick={handleOpenRemoteDialog}
                        >
                            {t("ood.manual_url_button")}
                        </GradientButton>
                    </>
                )}
            </div>

            {remoteDialogOpen && (
                <div
                    role="dialog"
                    aria-modal
                    className="dialog-backdrop"
                    onClick={handleCloseRemoteDialog}
                >
                    <form
                        className="dialog-panel remote-ood-dialog"
                        onClick={(event) => event.stopPropagation()}
                        onSubmit={(event) => {
                            event.preventDefault();
                            if (!remoteLoading) {
                                void handleConfirmRemoteAddress();
                            }
                        }}
                    >
                        <div className="dialog-title">{t("ood.remote_url_title")}</div>
                        <div className="dialog-message">{t("ood.remote_url_message")}</div>
                        <div className="remote-ood-address-shell">
                            <div className="remote-ood-address-group">
                                <div className="remote-ood-protocol-wrap">
                                    <div
                                        role="button"
                                        className="remote-ood-protocol-button"
                                        onClick={() => {
                                            if (remoteLoading) return;
                                            setRemoteProtocolMenuOpen((open) => !open);
                                        }}
                                        onKeyDown={(event) => {
                                            if (remoteLoading) return;
                                            if (event.key === "Enter" || event.key === " ") {
                                                event.preventDefault();
                                                setRemoteProtocolMenuOpen((open) => !open);
                                            }
                                        }}
                                        tabIndex={remoteLoading ? -1 : 0}
                                        aria-label={t("ood.remote_url_protocol_label")}
                                        aria-haspopup="listbox"
                                        aria-expanded={remoteProtocolMenuOpen}
                                        aria-disabled={remoteLoading}
                                    >
                                        <span className="remote-ood-protocol-label">{remoteProtocol}</span>
                                        <span className="remote-ood-protocol-caret" aria-hidden="true" />
                                    </div>
                                </div>
                                <div className="remote-ood-address-input-frame">
                                    <input
                                        ref={remoteAddressInputRef}
                                        className="remote-ood-address-input"
                                        type="text"
                                        value={remoteAddress}
                                        onChange={(event) => {
                                            setRemoteAddress(event.target.value);
                                            setRemoteError("");
                                        }}
                                        disabled={remoteLoading}
                                        placeholder={t("ood.remote_url_placeholder")}
                                        inputMode="url"
                                        autoCapitalize="none"
                                        autoCorrect="off"
                                        onFocus={() => setRemoteProtocolMenuOpen(false)}
                                    />
                                </div>
                            </div>
                            {remoteProtocolMenuOpen && (
                                <div className="remote-ood-protocol-menu" role="listbox">
                                    {(["http://", "https://"] as RemoteOodProtocol[]).map((protocol) => (
                                        <button
                                            key={protocol}
                                            type="button"
                                            className="remote-ood-protocol-option"
                                            role="option"
                                            aria-selected={remoteProtocol === protocol}
                                            onClick={() => {
                                                setRemoteProtocol(protocol);
                                                setRemoteProtocolMenuOpen(false);
                                                setRemoteError("");
                                                remoteAddressInputRef.current?.focus();
                                            }}
                                        >
                                            {protocol}
                                        </button>
                                    ))}
                                </div>
                            )}
                        </div>
                        {remoteError && <div className="dialog-error">{remoteError}</div>}
                        <div className="dialog-actions">
                            <button
                                type="button"
                                className="dialog-action-button dialog-cancel-button"
                                onClick={handleCloseRemoteDialog}
                                disabled={remoteLoading}
                            >
                                {t("common.actions.cancel")}
                            </button>
                            <button
                                type="submit"
                                className="dialog-action-button dialog-confirm-button"
                                disabled={remoteLoading}
                            >
                                {remoteLoading ? t("ood.remote_url_loading") : t("ood.remote_url_confirm")}
                            </button>
                        </div>
                    </form>
                </div>
            )}

            <ConfirmDialog
                open={confirmUnbindOpen}
                title={t("ood.unbind_confirm_title")}
                message={selectedZoneDid
                    ? `${t("ood.unbind_confirm_message")}\n\n${t("ood.bound_zone_label")}: ${selectedZoneDid}`
                    : t("ood.unbind_confirm_message")}
                confirmText={t("ood.unbind_continue")}
                cancelText={t("common.actions.cancel")}
                confirmVariant="danger"
                onConfirm={handleStartUnbind}
                onCancel={() => setConfirmUnbindOpen(false)}
            />

            <InputDialog
                open={passwordDialogOpen}
                title={t("ood.unbind_password_title")}
                message={t("ood.unbind_password_message")}
                value={password}
                onChange={(value) => {
                    setPassword(value);
                    setPasswordError("");
                }}
                inputType="password"
                placeholder={t("ood.unbind_password_placeholder")}
                confirmText={unbindLoading ? t("ood.unbind_loading") : t("ood.unbind_continue")}
                cancelText={t("common.actions.cancel")}
                onConfirm={handleConfirmPassword}
                onCancel={() => {
                    if (unbindLoading) return;
                    setPasswordDialogOpen(false);
                    setPassword("");
                    setPasswordError("");
                }}
                loading={unbindLoading}
                error={passwordError}
            />

            <ConfirmDialog
                open={resultDialog.open}
                title={resultDialog.title}
                message={resultDialog.message}
                confirmText={t("common.actions.done")}
                showCancel={false}
                onConfirm={() => setResultDialog((prev) => ({ ...prev, open: false }))}
                onCancel={() => setResultDialog((prev) => ({ ...prev, open: false }))}
            />
        </section>
    );
};

export default BindOod;
