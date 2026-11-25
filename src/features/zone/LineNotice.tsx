import React from "react";
import { Notice } from "../../components/ui/States";
import { useI18n } from "../../i18n";
import { certificateNotice } from "./lineView";
import { zoneTitle, type ZoneView } from "./types";

/** What is about to keep the Zone from being reached without the internet. */
export const LineNotice: React.FC<{ zone: ZoneView }> = ({ zone }) => {
    const { t } = useI18n();
    const notice = certificateNotice(zone);
    if (!notice) return null;
    return (
        <Notice tone="warn" testId="line-notice">
            {t(notice.key, { zone: zoneTitle(zone), days: notice.days })}
        </Notice>
    );
};
