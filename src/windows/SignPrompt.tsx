import React from "react";
import { invoke } from "@tauri-apps/api/core";
import { Button } from "../components/ui/Button";
import { Field, PasswordInput } from "../components/ui/Field";
import { Dot } from "../components/ui/States";
import { CommandErrorCodes } from "../constants/commandErrorCodes";
import { useI18n } from "../i18n";
import { parseCommandError } from "../utils/commandError";
import { payloadText } from "./payload";

interface PromptView {
    zone: string;
    zoneLabel: string;
    /** Of the Zone or the device. Names are theirs to choose, this is not. */
    host: string;
    activation: boolean;
    /** Who signs. */
    identity: string;
    app: string;
    appTitle: string;
    payloads: unknown[];
}

/** An app asks for a signature: who asks, what is signed, and the wallet password. */
const SignPrompt: React.FC = () => {
    const { t } = useI18n();
    const [prompt, setPrompt] = React.useState<PromptView | null>(null);
    const [gone, setGone] = React.useState(false);
    const [password, setPassword] = React.useState("");
    const [busy, setBusy] = React.useState(false);
    const [error, setError] = React.useState("");

    React.useEffect(() => {
        let stopped = false;
        invoke<PromptView>("prompt_get")
            .then((view) => {
                if (!stopped) setPrompt(view);
            })
            .catch((failure) => {
                console.warn("[Sign] nothing to sign", failure);
                if (!stopped) setGone(true);
            });
        return () => {
            stopped = true;
        };
    }, []);

    const cancel = React.useCallback(() => {
        invoke("prompt_cancel").catch((failure) => console.warn("[Sign] canceling failed", failure));
    }, []);

    React.useEffect(() => {
        const onKey = (event: KeyboardEvent) => {
            if (event.key === "Escape" && !busy) cancel();
        };
        window.addEventListener("keydown", onKey);
        return () => window.removeEventListener("keydown", onKey);
    }, [busy, cancel]);

    const submit = async () => {
        if (!password || busy) return;
        setBusy(true);
        setError("");
        try {
            await invoke("prompt_submit", { password });
        } catch (failure) {
            const { code, message } = parseCommandError(failure);
            setError(t(code === CommandErrorCodes.InvalidPassword ? "sign.wrong_password" : "sign.failed", { message }));
            setBusy(false);
        }
    };

    if (gone) {
        return (
            <div className="sign-window">
                <p className="sign-gone">{t("sign.gone")}</p>
                <div className="ui-dialog-actions">
                    <Button onClick={cancel}>{t("ui.close")}</Button>
                </div>
            </div>
        );
    }
    if (!prompt) return <div className="sign-window" />;

    const app = prompt.appTitle || prompt.app;
    return (
        <form
            className="sign-window"
            data-testid="sign-prompt"
            noValidate
            onSubmit={(event) => {
                event.preventDefault();
                void submit();
            }}
        >
            <div className="sign-head">
                <h1>{prompt.activation ? t("sign.title_device") : t("sign.title", { app })}</h1>
                <span className="ui-state">
                    <Dot tone="idle" />
                    <span>{prompt.zoneLabel && prompt.zoneLabel !== prompt.host ? `${prompt.zoneLabel} · ${prompt.host}` : prompt.host}</span>
                </span>
                {prompt.identity ? <span className="sign-identity">{t("sign.identity", { identity: prompt.identity })}</span> : null}
            </div>
            <div className="sign-payload">
                <span className="ui-field-label">{t(prompt.payloads.length > 1 ? "sign.contents" : "sign.content", { count: prompt.payloads.length })}</span>
                <pre className="ui-scroll selectable" tabIndex={0}>
                    {prompt.payloads.map(payloadText).join("\n\n")}
                </pre>
            </div>
            <Field label={t("sign.password")} hint={t("sign.password_hint")} error={error || undefined}>
                <PasswordInput
                    value={password}
                    onChange={(event) => {
                        setPassword(event.target.value);
                        setError("");
                    }}
                    disabled={busy}
                    autoFocus
                />
            </Field>
            <div className="ui-dialog-actions">
                <Button onClick={cancel} disabled={busy}>
                    {t("common.actions.cancel")}
                </Button>
                <Button type="submit" variant="primary" busy={busy} disabled={!password}>
                    {t("sign.submit")}
                </Button>
            </div>
        </form>
    );
};

export default SignPrompt;
