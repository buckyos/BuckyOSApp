import React from "react";
import { useSearchParams } from "react-router-dom";
import { invoke } from "@tauri-apps/api/core";
import { CircleAlert, CloudOff, KeyRound, Lock } from "lucide-react";
import { Button } from "../components/ui/Button";
import { Empty, Spinner } from "../components/ui/States";
import { useI18n } from "../i18n";

export type ContentState = "loading" | "network" | "password" | "denied" | "error";

const STATES: readonly ContentState[] = ["loading", "network", "password", "denied", "error"];
/** A page that opens at once shows nothing of this. */
const LOADING_DELAY_MS = 500;

export function readContentState(value: string | null): ContentState {
    return STATES.includes(value as ContentState) ? (value as ContentState) : "error";
}

const ICONS = { network: CloudOff, password: KeyRound, denied: Lock, error: CircleAlert } as const;

interface ContentStatusViewProps {
    state: ContentState;
    detail?: string;
    onRetry: () => Promise<unknown>;
    onSignIn: () => Promise<unknown>;
}

/** Stands in for a Zone page that is on its way or cannot be shown. */
export const ContentStatusView: React.FC<ContentStatusViewProps> = ({ state, detail, onRetry, onSignIn }) => {
    const { t } = useI18n();
    const [busy, setBusy] = React.useState(false);
    const [late, setLate] = React.useState(false);

    React.useEffect(() => {
        setBusy(false);
        setLate(false);
        if (state !== "loading") return;
        const timer = window.setTimeout(() => setLate(true), LOADING_DELAY_MS);
        return () => window.clearTimeout(timer);
    }, [state, detail]);

    if (state === "loading") {
        return <div className="content-status">{late ? <Spinner label={t("ui.loading")} /> : null}</div>;
    }
    const Icon = ICONS[state];
    const run = (work: () => Promise<unknown>) => {
        setBusy(true);
        work()
            .catch((error) => console.error("[ContentStatus] failed", error))
            .finally(() => setBusy(false));
    };
    return (
        <div className="content-status" data-testid="content-status" data-state={state}>
            <Empty icon={<Icon size={28} strokeWidth={1.6} />} title={t(`content.${state}_title`)} text={t(`content.${state}_text`)}>
                {detail && (state === "error" || state === "network") ? (
                    <details className="content-detail">
                        <summary>{t("content.details")}</summary>
                        <code className="selectable">{detail}</code>
                    </details>
                ) : null}
                <div className="content-actions">
                    {state === "password" ? (
                        <Button variant="primary" busy={busy} onClick={() => run(onSignIn)}>
                            {t("zones.sign_in")}
                        </Button>
                    ) : (
                        <Button variant="primary" busy={busy} onClick={() => run(onRetry)}>
                            {t("ui.retry")}
                        </Button>
                    )}
                </div>
            </Empty>
        </div>
    );
};

const ContentStatus: React.FC = () => {
    const [params] = useSearchParams();
    return (
        <ContentStatusView
            state={readContentState(params.get("state"))}
            detail={params.get("detail") ?? ""}
            onRetry={() => invoke("content_retry")}
            onSignIn={() => invoke("content_sign_in")}
        />
    );
};

export default ContentStatus;
