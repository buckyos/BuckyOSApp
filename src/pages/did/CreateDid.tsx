import React from "react";
import { useI18n } from "../../i18n";
import MobileHeader from "../../components/ui/MobileHeader";
import GradientButton from "../../components/ui/GradientButton";

interface CreateDidProps {
    nickname: string;
    setNickname: (value: string) => void;
    password: string;
    setPassword: (value: string) => void;
    confirmPassword: string;
    setConfirmPassword: (value: string) => void;
    onNext: () => void;
    error: string;
}

const CreateDid: React.FC<CreateDidProps> = ({
    nickname,
    setNickname,
    password,
    setPassword,
    confirmPassword,
    setConfirmPassword,
    onNext,
    error,
}) => {
    const { t } = useI18n();
    return (
        <div className="did-container">
            <MobileHeader title={t("create.title")} showBack />
            <input
                type="text"
                placeholder={t("create.nickname_placeholder")}
                value={nickname}
                onChange={(e) => setNickname(e.target.value)}
            />
            <input
                type="password"
                placeholder={t("create.password_placeholder")}
                value={password}
                onChange={(e) => setPassword(e.target.value)}
            />
            <input
                type="password"
                placeholder={t("create.confirm_password_placeholder")}
                value={confirmPassword}
                onChange={(e) => setConfirmPassword(e.target.value)}
            />
            <div className="actions">
                <GradientButton onClick={onNext} disabled={!nickname || !password || !confirmPassword}>
                    {t("common.actions.next")}
                </GradientButton>
            </div>
            {error && <p className="error">{error}</p>}
        </div>
    );
};

export default CreateDid;
