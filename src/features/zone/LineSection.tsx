import React from "react";
import { Button } from "../../components/ui/Button";
import { Segmented } from "../../components/ui/Field";
import { Card, Row, Section } from "../../components/ui/Rows";
import { useI18n } from "../../i18n";
import { routeStatus } from "../route/api";
import { findZone, updateZone } from "./api";
import { lineLabelKey } from "./lineView";
import type { LineMode, ZoneView } from "./types";

/** How the Zone is reached, and which ways may be taken. */
export const LineSection: React.FC<{ zone: ZoneView }> = ({ zone }) => {
    const { t } = useI18n();
    const [finding, setFinding] = React.useState(false);
    const [found, setFound] = React.useState<boolean | null>(null);
    const [pages, setPages] = React.useState(true);
    const key = lineLabelKey(zone);
    const line = zone.line?.line ?? null;
    const mode = zone.route.mode;

    React.useEffect(() => {
        let stopped = false;
        routeStatus()
            .then((status) => {
                if (!stopped) setPages(status.pages);
            })
            .catch((error) => console.info("[Zone] no route status", error));
        return () => {
            stopped = true;
        };
    }, []);

    const find = async () => {
        setFinding(true);
        setFound(null);
        try {
            setFound(await findZone(zone.did));
        } catch (error) {
            console.warn("[Zone] looking in this network failed", error);
            setFound(false);
        } finally {
            setFinding(false);
        }
    };

    const note = !pages ? t("zones.line.unsupported") : found === false ? t("zones.line.not_found") : mode === "internet" ? t("zones.line.mode_note") : undefined;
    return (
        <Section title={t("zones.line.title")} note={note}>
            <Card testId="zone-line">
                <Row
                    title={t("zones.line.now")}
                    sub={line?.kind === "lan" ? <span className="selectable">{line.address}</span> : undefined}
                    value={key ? t(key) : "–"}
                />
                <Row
                    title={t("zones.line.mode")}
                    end={
                        <Segmented<LineMode>
                            label={t("zones.line.mode")}
                            value={mode}
                            onChange={(line_mode) => void updateZone(zone.did, { line_mode }).catch((error) => console.error("[Zone] line mode", error))}
                            options={[
                                { value: "auto", label: t("zones.line.mode_auto") },
                                { value: "internet", label: t("zones.line.mode_internet") },
                            ]}
                        />
                    }
                />
                {mode === "auto" && line?.kind === "internet" ? (
                    <Row
                        title={t("zones.line.find")}
                        sub={t("zones.line.find_sub")}
                        wrapSub
                        end={
                            <Button size="sm" busy={finding} onClick={() => void find()}>
                                {t("zones.line.find_go")}
                            </Button>
                        }
                    />
                ) : null}
            </Card>
        </Section>
    );
};
