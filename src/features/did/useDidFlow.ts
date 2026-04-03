import { useState } from "react";
import { useNavigate } from "react-router-dom";
import { invoke } from "@tauri-apps/api/core";
import { buckyos } from "buckyos";
import { useI18n } from "../../i18n";
import { importDid } from "./api";
import { fetchSnStatus, registerSnAccount, setCachedSnStatus } from "../sn/snStatusManager";
import type { DidInfo } from "./types";
import { parseCommandError } from "../../utils/commandError";
import { CommandErrorCodes } from "../../constants/commandErrorCodes";
import { checkBuckyUsername, checkSnActiveCode, getUserByPublicKey } from "../../services/sn";
import { openWebView } from "../../utils/webview";

function normalizeName(value: string) {
    return value.trim().toLowerCase();
}

export function useDidFlow() {
    const navigate = useNavigate();
    const { t } = useI18n();

    const [password, setPassword] = useState("");
    const [confirmPassword, setConfirmPassword] = useState("");
    const [snName, setSnName] = useState("");
    const [activeCode, setActiveCode] = useState("");
    const [mnemonic, setMnemonic] = useState<string[]>([]);
    const [confirmedMnemonic, setConfirmedMnemonic] = useState<string[]>([]);
    const [didInfo, setDidInfo] = useState<DidInfo | null>(null);
    const [error, setError] = useState("");
    const [loading, setLoading] = useState(false);

    const clearCreateFlowSensitiveState = () => {
        setPassword("");
        setConfirmPassword("");
        setSnName("");
        setActiveCode("");
        setMnemonic([]);
        setConfirmedMnemonic([]);
    };

    const handleGenerateMnemonic = async () => {
        try {
            const generatedMnemonic: string[] = await invoke("generate_mnemonic");
            setMnemonic(generatedMnemonic);
            setConfirmedMnemonic(Array(generatedMnemonic.length).fill(""));
            navigate("/show-mnemonic");
        } catch (err) {
            const { message } = parseCommandError(err);
            setError(t("common.error.generate_mnemonic_failed", { message }));
        }
    };

    const handleBindSnAndCreateDid = async () => {
        if (mnemonic.join(" ") !== confirmedMnemonic.join(" ")) {
            setError(t("common.error.mnemonic_mismatch"));
            return;
        }

        const normalizedName = normalizeName(snName);
        if (normalizedName.length < 7) {
            setError(t("sn.error.username_too_short"));
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

        try {
            const [usernameValid, activeCodeValid, publicKey] = await Promise.all([
                checkBuckyUsername(normalizedName),
                checkSnActiveCode(activeCode.trim()),
                invoke<Record<string, unknown>>("derive_bucky_public_key", {
                    mnemonicWords: mnemonic,
                }),
            ]);

            if (!usernameValid) {
                setError(t("sn.username_taken"));
                return;
            }
            if (!activeCodeValid) {
                setError(t("sn.invite_bad"));
                return;
            }

            const publicKeyJwk = JSON.stringify(publicKey);
            const passwordHash = buckyos.hashPassword(normalizedName, password);
            const record = await registerSnAccount({
                username: normalizedName,
                passwordHash,
                inviteCode: activeCode.trim(),
                publicKeyJwk,
            });

            const createdDid = await invoke<DidInfo>("create_did", {
                nickname: normalizedName,
                password,
                mnemonicWords: mnemonic,
            });
            await setCachedSnStatus(createdDid.id, record);

            setDidInfo({
                ...createdDid,
                nickname: record.username || normalizedName,
                sn_status: {
                    username: record.username || normalizedName,
                },
            });
            clearCreateFlowSensitiveState();
            navigate("/success");
        } catch (err) {
            const { code, message } = parseCommandError(err);
            let translated = message;
            if (code === CommandErrorCodes.NicknameExists || message === "nickname_already_exists") {
                translated = t("sn.error.username_exists_local");
            } else if (message === "register_sn_user_failed") {
                translated = t("sn.error.register_failed");
            } else if (message === "sn_bind_timeout") {
                translated = t("sn.error.poll_timeout");
            } else {
                translated = t("sn.error.bind_failed", { message });
            }
            setError(translated);
        } finally {
            setLoading(false);
        }
    };

    const handleImportDid = async ({
        password: importPassword,
        mnemonicWords,
    }: {
        password: string;
        mnemonicWords: string[];
    }) => {
        setError("");
        try {
            setLoading(true);
            const publicKey = await invoke<Record<string, unknown>>("derive_bucky_public_key", {
                mnemonicWords,
            });
            const publicKeyJwk = JSON.stringify(publicKey);
            const snRecord = await getUserByPublicKey(publicKeyJwk);

            if (!snRecord.ok || typeof snRecord.raw?.user_name !== "string") {
                setError(t("import.error.sn_not_found"));
                return;
            }

            const importedDid = await importDid(
                snRecord.raw.user_name.trim(),
                importPassword,
                mnemonicWords
            );

            await fetchSnStatus(importedDid.id, publicKeyJwk);
            setDidInfo(importedDid);
            navigate("/main/home");
        } catch (err) {
            const { code, message } = parseCommandError(err);
            let translated = message;
            if (code === CommandErrorCodes.NicknameExists || message === "nickname_already_exists") {
                translated = t("import.error.nickname_exists");
            } else if (code === CommandErrorCodes.MnemonicRequired || message === "mnemonic_required") {
                translated = t("import.error.mnemonic_required");
            } else if (code === CommandErrorCodes.IdentityExists || message === "identity_already_exists") {
                translated = t("import.error.identity_exists");
            } else {
                translated = t("common.error.import_did_failed", { message });
            }
            setError(translated);
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

    const goToShowMnemonic = async () => {
        setError("");
        handleGenerateMnemonic();
    };

    const goToBindSn = () => {
        if (mnemonic.join(" ") !== confirmedMnemonic.join(" ")) {
            setError(t("common.error.mnemonic_mismatch"));
            return;
        }
        setError("");
        navigate("/bind-sn");
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
        activeCode,
        setActiveCode,
        mnemonic,
        confirmedMnemonic,
        setConfirmedMnemonic,
        didInfo,
        error,
        loading,
        goToCreateDid,
        goToShowMnemonic,
        goToConfirmMnemonic,
        goToBindSn,
        handleBindSnAndCreateDid,
        handleImportDid,
        goToImportDid,
        goToDidInfo,
        goToSnInfo,
        goToWelcome,
        resetFlow,
    };
}

export type { DidInfo } from "./types";
