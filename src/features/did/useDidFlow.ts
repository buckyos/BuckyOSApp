import { useRef, useState } from "react";
import { useNavigate } from "react-router-dom";
import { invoke } from "@tauri-apps/api/core";
import { buckyos } from "buckyos";
import { useI18n } from "../../i18n";
import { importDid } from "./api";
import { primeCachedSnStatus } from "../sn/snStatusManager";
import type {
    BnsIdentityCandidate,
    DidInfo,
    OwnerDocument,
    RegistrationMaterial,
    RegistrationPhase,
} from "./types";
import { parseCommandError } from "../../utils/commandError";
import { CommandErrorCodes } from "../../constants/commandErrorCodes";
import {
    checkSnActiveCode,
    checkSnUsername,
    isLocallyValidEmail,
    registerSnIdentity,
    snRegistrationErrorMessageKey,
    SnServiceError,
} from "../../services/sn_client";
import { findBnsIdentitiesForMaterial } from "../../services/bns_client";
import { openWebView } from "../../utils/webview";
import { isLocallyValidSnUsername, normalizeSnUsername } from "../sn/snUsername";
import {
    buildOwnerDocument,
    serializeOwnerDocumentForRegistration,
} from "./ownerDocument";

interface RegistrationAttempt {
    fingerprint: string;
    material: RegistrationMaterial;
    ownerDocument: OwnerDocument;
    ownerDocumentJson: string;
    requestId: string;
}

interface PendingImport {
    password: string;
    mnemonicWords: string[];
}

function randomAvatarSeed(): string {
    const values = new Uint32Array(2);
    crypto.getRandomValues(values);
    return `${values[0].toString(16).padStart(8, "0")}${values[1].toString(16).padStart(8, "0")}`;
}

function isImportTimeoutError(message: string) {
    const normalized = message.trim().toLowerCase();
    return (
        normalized === "bns_import_timeout" ||
        normalized.includes("failed to fetch") ||
        normalized.includes("networkerror") ||
        normalized.includes("load failed") ||
        normalized.includes("timed out") ||
        normalized.includes("timeout") ||
        normalized.includes("aborterror")
    );
}

function registrationFingerprint(
    normalizedName: string,
    trimmedFullName: string,
    normalizedEmail: string,
    avatarSeed: string,
    material: RegistrationMaterial
): string {
    return JSON.stringify({
        normalizedName,
        trimmedFullName,
        normalizedEmail,
        avatar: `dicebear:${avatarSeed}`,
        ownerKey: material.owner_public_jwk.x,
        evmAddress: material.evm_address.toLowerCase(),
    });
}

export function useDidFlow() {
    const navigate = useNavigate();
    const { t } = useI18n();

    const [password, setPassword] = useState("");
    const [confirmPassword, setConfirmPassword] = useState("");
    const [snName, setSnName] = useState("");
    const [fullName, setFullName] = useState("");
    const [email, setEmail] = useState("");
    const [avatarSeed, setAvatarSeed] = useState(randomAvatarSeed);
    const [activeCode, setActiveCode] = useState("");
    const [mnemonic, setMnemonic] = useState<string[]>([]);
    const [confirmedMnemonic, setConfirmedMnemonic] = useState<string[]>([]);
    const [registrationMaterial, setRegistrationMaterial] = useState<RegistrationMaterial | null>(null);
    const [registrationPhase, setRegistrationPhase] = useState<RegistrationPhase>("idle");
    const [importCandidates, setImportCandidates] = useState<BnsIdentityCandidate[]>([]);
    const [didInfo, setDidInfo] = useState<DidInfo | null>(null);
    const [error, setError] = useState("");
    const [loading, setLoading] = useState(false);
    const registrationAttemptRef = useRef<RegistrationAttempt | null>(null);
    const pendingImportRef = useRef<PendingImport | null>(null);

    const clearCreateFlowSensitiveState = () => {
        setPassword("");
        setConfirmPassword("");
        setSnName("");
        setFullName("");
        setEmail("");
        setAvatarSeed(randomAvatarSeed());
        setActiveCode("");
        setMnemonic([]);
        setConfirmedMnemonic([]);
        setRegistrationMaterial(null);
        setRegistrationPhase("idle");
        setImportCandidates([]);
        registrationAttemptRef.current = null;
        pendingImportRef.current = null;
    };

    const handleGenerateMnemonic = async () => {
        try {
            const generatedMnemonic: string[] = await invoke("generate_mnemonic");
            setMnemonic(generatedMnemonic);
            setConfirmedMnemonic(Array(generatedMnemonic.length).fill(""));
            setAvatarSeed(randomAvatarSeed());
            navigate("/show-mnemonic");
        } catch (err) {
            const { message } = parseCommandError(err);
            setError(t("common.error.generate_mnemonic_failed", { message }));
        }
    };

    const getRegistrationAttempt = (
        normalizedName: string,
        trimmedFullName: string,
        normalizedEmail: string,
        material: RegistrationMaterial
    ): RegistrationAttempt => {
        const avatar = `dicebear:${avatarSeed}`;
        const fingerprint = registrationFingerprint(
            normalizedName,
            trimmedFullName,
            normalizedEmail,
            avatarSeed,
            material
        );
        if (registrationAttemptRef.current?.fingerprint === fingerprint) {
            return registrationAttemptRef.current;
        }

        const ownerDocument = buildOwnerDocument({
            normalizedName,
            displayName: trimmedFullName,
            avatar,
            ownerPublicJwk: material.owner_public_jwk,
            evmAddress: material.evm_address,
        });
        const ownerDocumentJson = serializeOwnerDocumentForRegistration(
            ownerDocument,
            material.evm_address
        );
        const attempt: RegistrationAttempt = {
            fingerprint,
            material,
            ownerDocument,
            ownerDocumentJson,
            requestId: `sn:register:${normalizedName}`,
        };
        registrationAttemptRef.current = attempt;
        return attempt;
    };

    const handleBindSnAndCreateDid = async () => {
        if (mnemonic.join(" ") !== confirmedMnemonic.join(" ")) {
            setError(t("common.error.mnemonic_mismatch"));
            return;
        }

        const requestedName = normalizeSnUsername(snName);
        const trimmedFullName = fullName.trim();
        const normalizedEmail = email.trim();
        if (!isLocallyValidSnUsername(requestedName)) {
            setError(t("sn.username_format_hint"));
            return;
        }
        if (!trimmedFullName) {
            setError(t("sn.error.full_name_required"));
            return;
        }
        if (!normalizedEmail || !isLocallyValidEmail(normalizedEmail)) {
            setError(t("sn.error.invalid_email"));
            return;
        }
        if (password !== confirmPassword) {
            setError(t("common.error.passwords_mismatch"));
            return;
        }
        if (password.length < 6) {
            setError(t("common.error.password_too_short"));
            return;
        }
        if (!activeCode.trim()) {
            setError(t("sn.error.active_code_required"));
            return;
        }

        setError("");
        setLoading(true);
        setRegistrationPhase("preparing");

        try {
            const [usernameCheck, activeCodeValid, initialMaterial] = await Promise.all([
                checkSnUsername(requestedName),
                checkSnActiveCode(activeCode.trim()),
                invoke<RegistrationMaterial>("derive_registration_material", {
                    mnemonicWords: mnemonic,
                    normalizedName: requestedName,
                }),
            ]);

            const existingAttempt = registrationAttemptRef.current;
            const isIdempotentRetry = Boolean(
                existingAttempt &&
                    existingAttempt.material.normalized_name === requestedName &&
                    existingAttempt.fingerprint ===
                        registrationFingerprint(
                            requestedName,
                            trimmedFullName,
                            normalizedEmail,
                            avatarSeed,
                            existingAttempt.material
                        )
            );
            if (!usernameCheck.valid && !isIdempotentRetry) {
                setError(t("sn.username_taken"));
                setRegistrationPhase("failed");
                return;
            }
            if (!activeCodeValid && !isIdempotentRetry) {
                setError(t("sn.invite_bad"));
                setRegistrationPhase("failed");
                return;
            }

            const normalizedName = isIdempotentRetry
                ? requestedName
                : usernameCheck.normalized_name.trim().toLowerCase();
            const material =
                normalizedName === initialMaterial.normalized_name
                    ? initialMaterial
                    : await invoke<RegistrationMaterial>("derive_registration_material", {
                          mnemonicWords: mnemonic,
                          normalizedName,
                      });
            setRegistrationMaterial(material);
            const attempt = getRegistrationAttempt(
                normalizedName,
                trimmedFullName,
                normalizedEmail,
                material
            );

            setRegistrationPhase("submitting");
            const passwordHash = buckyos.hashPassword(normalizedName, password);
            await registerSnIdentity({
                name: normalizedName,
                email: normalizedEmail,
                passwordHash,
                activeCode: activeCode.trim(),
                requestId: attempt.requestId,
                assetOwner: attempt.material.evm_address,
                ownerDocument: attempt.ownerDocument,
            });

            const createdDid = await invoke<DidInfo>("create_did", {
                password,
                mnemonicWords: mnemonic,
                ownerDocumentJson: attempt.ownerDocumentJson,
            });
            await primeCachedSnStatus(createdDid.id, normalizedName);
            setDidInfo(createdDid);
            setRegistrationPhase("succeeded");
            clearCreateFlowSensitiveState();
            navigate("/success");
        } catch (err) {
            setRegistrationPhase("failed");
            const { code, message } = parseCommandError(err);
            let translated: string;
            if (err instanceof SnServiceError) {
                const messageKey = snRegistrationErrorMessageKey(err.codeName);
                translated = messageKey
                    ? t(messageKey)
                    : t("sn.error.register_failed_with_reason", { message: err.message });
            } else if (code === CommandErrorCodes.NicknameExists || message === "nickname_already_exists") {
                translated = t("sn.error.username_exists_local");
            } else if (message.startsWith("owner_") || message.startsWith("invalid_owner") || message === "asset_owner_mismatch") {
                translated = t("sn.error.owner_document_invalid");
            } else {
                translated = t("sn.error.register_failed_with_reason", { message });
            }
            setError(translated);
        } finally {
            setLoading(false);
        }
    };

    const finalizeImport = async (
        candidate: BnsIdentityCandidate,
        credentials: PendingImport
    ): Promise<void> => {
        const importedDid = await importDid(
            credentials.password,
            credentials.mnemonicWords,
            candidate.ownerDocumentJson
        );
        setDidInfo(importedDid);
        setImportCandidates([]);
        pendingImportRef.current = null;
        navigate("/main/home");
    };

    const handleImportDid = async ({
        password: importPassword,
        mnemonicWords,
    }: {
        password: string;
        mnemonicWords: string[];
    }) => {
        setError("");
        setImportCandidates([]);
        setLoading(true);
        try {
            const material = await invoke<RegistrationMaterial>("derive_registration_material", {
                mnemonicWords,
                normalizedName: "imported",
            });
            const candidates = await findBnsIdentitiesForMaterial(material);
            if (candidates.length === 0) throw new Error("bns_identity_not_found");

            const credentials = { password: importPassword, mnemonicWords };
            if (candidates.length === 1) {
                await finalizeImport(candidates[0], credentials);
            } else {
                pendingImportRef.current = credentials;
                setImportCandidates(candidates);
            }
        } catch (err) {
            const { code, message } = parseCommandError(err);
            let translated = message;
            if (code === CommandErrorCodes.NicknameExists || message === "nickname_already_exists") {
                translated = t("import.error.nickname_exists");
            } else if (code === CommandErrorCodes.MnemonicRequired || message === "mnemonic_required") {
                translated = t("import.error.mnemonic_required");
            } else if (code === CommandErrorCodes.IdentityExists || message === "identity_already_exists") {
                translated = t("import.error.identity_exists");
            } else if (message === "bns_identity_not_found") {
                translated = t("import.error.bns_not_found");
            } else if (message === "owner_document_key_mismatch") {
                translated = t("import.error.owner_key_mismatch");
            } else if (isImportTimeoutError(message)) {
                translated = t("import.error.timeout");
            } else {
                translated = t("common.error.import_did_failed", { message });
            }
            setError(translated);
        } finally {
            setLoading(false);
        }
    };

    const handleSelectImportCandidate = async (candidate: BnsIdentityCandidate) => {
        const credentials = pendingImportRef.current;
        if (!credentials) return;
        setError("");
        setLoading(true);
        try {
            await finalizeImport(candidate, credentials);
        } catch (err) {
            const { message } = parseCommandError(err);
            setError(t("common.error.import_did_failed", { message }));
        } finally {
            setLoading(false);
        }
    };

    const goToCreateDid = () => {
        setError("");
        navigate("/create");
    };

    const goToImportDid = () => {
        setError("");
        setImportCandidates([]);
        navigate("/import");
    };

    const goToDidInfo = () => {
        setError("");
        navigate("/did-info", { state: { backTo: "/create" } });
    };

    const goToSnInfo = async () => {
        setError("");
        try {
            await openWebView("https://sn.buckyos.ai/", "SN", "sn-intro");
        } catch (err) {
            console.error("[WebView] failed to open SN intro", err);
        }
    };

    const goToShowMnemonic = () => {
        setError("");
        void handleGenerateMnemonic();
    };

    const goToBindSn = async () => {
        if (mnemonic.join(" ") !== confirmedMnemonic.join(" ")) {
            setError(t("common.error.mnemonic_mismatch"));
            return;
        }
        setError("");
        setLoading(true);
        setRegistrationPhase("preparing");
        try {
            const material = await invoke<RegistrationMaterial>("derive_registration_material", {
                mnemonicWords: mnemonic,
                normalizedName: "pending",
            });
            setRegistrationMaterial(material);
            setRegistrationPhase("idle");
            navigate("/bind-sn");
        } catch (err) {
            const { message } = parseCommandError(err);
            setRegistrationPhase("failed");
            setError(t("sn.error.prepare_failed", { message }));
        } finally {
            setLoading(false);
        }
    };

    const goToConfirmMnemonic = () => {
        setError("");
        navigate("/confirm-mnemonic");
    };

    const goToWelcome = () => {
        clearCreateFlowSensitiveState();
        setError("");
        setDidInfo(null);
        navigate("/");
    };

    const resetFlow = () => {
        clearCreateFlowSensitiveState();
        setDidInfo(null);
        setError("");
        navigate("/main/home/ood-activate");
    };

    return {
        password,
        setPassword,
        confirmPassword,
        setConfirmPassword,
        snName,
        setSnName,
        fullName,
        setFullName,
        email,
        setEmail,
        avatarSeed,
        setAvatarSeed,
        activeCode,
        setActiveCode,
        mnemonic,
        confirmedMnemonic,
        setConfirmedMnemonic,
        registrationMaterial,
        registrationPhase,
        importCandidates,
        didInfo,
        error,
        loading,
        goToCreateDid,
        goToShowMnemonic,
        goToConfirmMnemonic,
        goToBindSn,
        handleBindSnAndCreateDid,
        handleImportDid,
        handleSelectImportCandidate,
        goToImportDid,
        goToDidInfo,
        goToSnInfo,
        goToWelcome,
        resetFlow,
    };
}

export type { DidInfo } from "./types";
