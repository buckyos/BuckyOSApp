import React from "react";
import { Button } from "../../components/ui/Button";
import { Dialog } from "../../components/ui/Dialog";
import { Empty } from "../../components/ui/States";
import { useI18n } from "../../i18n";
import type { ChoicePrompt } from "./clientRuntime";

/** Which app to open some content with. */
export const ChooseAppDialog: React.FC<{ choice: ChoicePrompt }> = ({ choice }) => {
    const { t } = useI18n();
    return (
        <Dialog
            open
            title={t("open.choose_title")}
            message={choice.name}
            onClose={() => choice.answer(null)}
            testId="choose-app-dialog"
            actions={<Button onClick={() => choice.answer(null)}>{t("common.actions.cancel")}</Button>}
        >
            {choice.handlers.length > 0 ? (
                <div className="ui-card">
                    {choice.handlers.map((handler) => (
                        <button key={handler.key} type="button" className="ui-row" onClick={() => choice.answer(handler.key)}>
                            <span className="ui-row-text">
                                <span className="ui-row-title">{handler.label}</span>
                            </span>
                        </button>
                    ))}
                </div>
            ) : (
                <Empty text={t("open.choose_none")} />
            )}
        </Dialog>
    );
};
