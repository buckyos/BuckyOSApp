import { useState } from "react";
import { useNavigate } from "react-router-dom";
import { invoke } from "@tauri-apps/api/core";
import { useI18n } from "../../i18n";

export interface DidInfo {
    nickname: string;
    btc_address: string;
    eth_address: string;
}

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
            const message = err instanceof Error ? err.message : String(err);
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
            navigate("/success");
        } catch (err) {
            const message = err instanceof Error ? err.message : String(err);
            setError(t("common.error.create_did_failed", { message }));
        } finally {
            setLoading(false);
        }
    };

    const goToCreateDid = () => {
        setError("");
        navigate("/create");
    };

    const goToShowMnemonic = () => {
        if (password !== confirmPassword) {
            setError(t("common.error.passwords_mismatch"));
            return;
        }
        if (password.length < 8) {
            setError(t("common.error.password_too_short"));
            return;
        }
        setError("");
        handleGenerateMnemonic();
    };

    const goToConfirmMnemonic = () => {
        setError("");
        navigate("/confirm-mnemonic");
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
        resetFlow,
    };
}

