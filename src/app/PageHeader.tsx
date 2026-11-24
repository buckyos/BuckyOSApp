import React from "react";
import { useNavigate } from "react-router-dom";
import { ChevronLeft } from "lucide-react";
import { IconButton } from "../components/ui/Button";
import { Dot } from "../components/ui/States";
import { useZones } from "../features/zone/ZoneContext";
import { zoneTitle } from "../features/zone/types";
import { useI18n } from "../i18n";

interface PageHeaderProps {
    title: string;
    /** The page shows one Zone's content: names it when there are several. */
    zone?: boolean;
    back?: boolean | string;
    actions?: React.ReactNode;
}

export const PageHeader: React.FC<PageHeaderProps> = ({ title, zone = false, back = false, actions }) => {
    const { t } = useI18n();
    const navigate = useNavigate();
    const { zones, current } = useZones();
    return (
        <header className="shell-header" data-back={back ? true : undefined}>
            {back ? (
                <IconButton label={t("common.back")} onClick={() => (typeof back === "string" ? navigate(back) : navigate(-1))}>
                    <ChevronLeft size={20} />
                </IconButton>
            ) : null}
            <h1>{title}</h1>
            {zone && current && zones.length > 1 ? (
                <span className="zone-chip" title={zoneTitle(current)}>
                    <Dot color="var(--zone-mark)" />
                    <span>{zoneTitle(current)}</span>
                </span>
            ) : null}
            {actions}
        </header>
    );
};
