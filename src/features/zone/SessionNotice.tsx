import React from "react";
import { Button } from "../../components/ui/Button";
import { Notice } from "../../components/ui/States";
import { useI18n } from "../../i18n";
import { sessionNotice } from "./sessionView";
import { zoneTitle, type ZoneView } from "./types";
import { useZoneActions } from "./useZoneActions";

/** Why the Zone's content is not there, and what to do about it. Nothing while it is signed in. */
export const SessionNotice: React.FC<{ zone: ZoneView }> = ({ zone }) => {
    const { t } = useI18n();
    const { busy, signIn, reconnect } = useZoneActions();
    const notice = sessionNotice(zone);
    if (!notice) return null;
    return (
        <Notice
            tone={notice.tone}
            testId="session-notice"
            action={
                notice.action ? (
                    <Button
                        size="sm"
                        variant={notice.action === "sign_in" ? "primary" : "secondary"}
                        busy={busy === zone.did}
                        onClick={() => void (notice.action === "sign_in" ? signIn(zone) : reconnect(zone))}
                    >
                        {t(notice.action === "sign_in" ? "zones.sign_in" : "ui.retry")}
                    </Button>
                ) : null
            }
        >
            {t(notice.key, { zone: zoneTitle(zone) })}
        </Notice>
    );
};
