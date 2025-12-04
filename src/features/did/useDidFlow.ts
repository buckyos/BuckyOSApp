import { useState } from "react";
import { useNavigate } from "react-router-dom";
import { invoke } from "@tauri-apps/api/core";
import { useI18n } from "../../i18n";
import { listDids } from "./api";
import type { DidInfo } from "./types";
import { parseCommandError } from "../../utils/commandError";
import { CommandErrorCodes } from "../../constants/commandErrorCodes";

export function useDidFlow() {
    const navigate = useNavigate();
    const { t } = useI18n();

    const [nickname, setNickname] = useState("");
    const [password, setPassword] = useState("");
    const [confirmPassword, setConfirmPassword] = useState("");
    const [mnemonic, setMnemonic] = useState<string[]>([]);
    const [confirmedMnemonic, setConfirmedMnemonic] = useState<string[]>([]);
    const [didInfo, setDidInfo] = useState<DidInfo | null>(null);
    const [error, setError] = useState("");
    const [loading, setLoading] = useState(false);

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

    const handleCreateDid = async () => {
        if (mnemonic.join(" ") !== confirmedMnemonic.join(" ")) {
            setError(t("common.error.mnemonic_mismatch"));
            return;
        }
        setError("");
        try {
            setLoading(true);
            const info: DidInfo = await invoke("create_did", {
                nickname,
                password,
                mnemonicWords: mnemonic,
            });
            setDidInfo(info);
            navigate("/main/home");
        } catch (err) {
            const { code, message } = parseCommandError(err);
            let translated = message;
            if (code === CommandErrorCodes.NicknameExists || message === "nickname_already_exists") {
                translated = t("create.error.nickname_exists");
            } else {
                translated = t("common.error.create_did_failed", { message });
            }
            setError(translated);
        } finally {
            setLoading(false);
        }
    };

    const handleImportDid = async ({
        nickname: importNickname,
        password: importPassword,
        mnemonicWords,
    }: {
        nickname: string;
        password: string;
        mnemonicWords: string[];
    }) => {
        setError("");
        try {
            setLoading(true);
            const info: DidInfo = await invoke("import_did", {
                nickname: importNickname,
                password: importPassword,
                mnemonicWords,
            });
            setDidInfo(info);
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
        navigate("/did-info");
    };

    const goToShowMnemonic = async () => {
        if (password !== confirmPassword) {
            setError(t("common.error.passwords_mismatch"));
            return;
        }
        if (password.length < 6) {
            setError(t("common.error.password_too_short"));
            return;
        }
        // Check nickname uniqueness early on the create page
        const name = nickname.trim();
        if (name) {
            try {
                const dids = await listDids();
                const exists = dids.some((d) => (d.nickname || "").toLowerCase() === name.toLowerCase());
                if (exists) {
                    setError(t("create.error.nickname_exists"));
                    return;
                }
            } catch (_) {
                // ignore network/tauri errors here; allow flow to proceed
            }
        }
        setError("");
        handleGenerateMnemonic();
    };

    const goToConfirmMnemonic = () => {
        setError("");
        navigate("/confirm-mnemonic");
    };

    const goToWelcome = () => {
        setError("");
        navigate("/");
    };

    const resetFlow = () => {
        setNickname("");
        setPassword("");
        setConfirmPassword("");
        setMnemonic([]);
        setConfirmedMnemonic([]);
        setDidInfo(null);
        setError("");
        navigate("/");
    };

    return {
        // state
        nickname,
        setNickname,
        password,
        setPassword,
        confirmPassword,
        setConfirmPassword,
        mnemonic,
        confirmedMnemonic,
        setConfirmedMnemonic,
        didInfo,
        error,
        loading,
        // actions
        goToCreateDid,
        goToShowMnemonic,
        goToConfirmMnemonic,
        handleCreateDid,
        handleImportDid,
        goToImportDid,
        goToDidInfo,
        goToWelcome,
        resetFlow,
    };
}

export type { DidInfo } from "./types";

