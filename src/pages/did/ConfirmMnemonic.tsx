import React from "react";
import { useI18n } from "../../i18n";
import MobileHeader from "../../components/ui/MobileHeader";
import GradientButton from "../../components/ui/GradientButton";

interface ConfirmMnemonicProps {
    onConfirm: () => void;
    setConfirmedMnemonic: (value: string[]) => void;
    error: string;
    confirmedMnemonic: string[];
    mnemonic: string[];
}

const shuffle = (arr: string[]) => {
    const a = [...arr];
    for (let i = a.length - 1; i > 0; i--) {
        const j = Math.floor(Math.random() * (i + 1));
        [a[i], a[j]] = [a[j], a[i]];
    }
    return a;
};

const ConfirmMnemonic: React.FC<ConfirmMnemonicProps> = ({
    onConfirm,
    setConfirmedMnemonic,
    error,
    confirmedMnemonic,
    mnemonic,
}) => {
    const { t } = useI18n();
    const [pool, setPool] = React.useState<string[]>([]);

    React.useEffect(() => {
        setConfirmedMnemonic([]);
        setPool(shuffle(mnemonic));
        // eslint-disable-next-line react-hooks/exhaustive-deps
    }, [mnemonic.join(" ")]);

    const handlePick = (index: number) => {
        const word = pool[index];
        const nextPool = [...pool];
        nextPool.splice(index, 1);
        setPool(nextPool);
        setConfirmedMnemonic([...confirmedMnemonic, word]);
    };

    const handleRemove = (index: number) => {
        const next = [...confirmedMnemonic];
        const [w] = next.splice(index, 1);
        setConfirmedMnemonic(next);
        setPool([...pool, w]);
    };

    const wrongIndex = confirmedMnemonic.findIndex((w, i) => w !== mnemonic[i]);
    const isOrderCorrect =
        confirmedMnemonic.length === mnemonic.length && wrongIndex === -1;

    return (
        <div className="did-container" style={{ position: "relative" }}>
            {/* Unified back arrow position */}
            <div style={{ position: "absolute", top: 6, left: 6, zIndex: 2 }}>
                <MobileHeader title="" showBack />
            </div>

            {/* Unified page heading */}
            <div className="page-content" style={{ textAlign: "center", margin: "6px auto 8px" }}>
                <div className="page-title">{t("confirmMnemonic.title")}</div>
                <div className="page-subtitle">{t("confirmMnemonic.tips")}</div>
            </div>

            <div
                className="selected-box"
                style={{
                    minHeight: 120,
                    border: "1px dashed var(--border)",
                    background: "var(--card-bg)",
                    borderRadius: 16,
                    padding: 12,
                }}
            >
                <div className="selected-grid">
                    {confirmedMnemonic.map((w, i) => (
                        <button
                            key={`${w}-${i}`}
                            onClick={() => handleRemove(i)}
                            className="mnemonic-word"
                            style={{
                                background: wrongIndex !== -1 ? "#ffe9e9" : "var(--chip-bg)",
                                color: wrongIndex !== -1 ? "#b42318" : "#fff",
                                border: "none",
                                cursor: "pointer",
                            }}
                        >
                            {w}
                        </button>
                    ))}
                </div>
            </div>

            <p style={{ marginTop: 8 }}>{t("confirmMnemonic.instruction")}</p>
            <div className="mnemonic-grid">
                {pool.map((w, idx) => (
                    <button
                        key={`${w}-${idx}`}
                        onClick={() => handlePick(idx)}
                        className="mnemonic-word"
                        style={{ cursor: "pointer", whiteSpace: "nowrap" }}
                    >
                        {w}
                    </button>
                ))}
            </div>

            {wrongIndex !== -1 && (
                <p className="error">{t("confirmMnemonic.error_wrong_order")}</p>
            )}

            <div className="actions">
                <GradientButton onClick={onConfirm} disabled={!isOrderCorrect}>
                    {t("common.actions.create_did")}
                </GradientButton>
            </div>

            {error && <p className="error">{error}</p>}
        </div>
    );
};

export default ConfirmMnemonic;
