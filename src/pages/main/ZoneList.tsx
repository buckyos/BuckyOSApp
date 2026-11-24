import React from "react";
import { useNavigate } from "react-router-dom";
import { Plus } from "lucide-react";
import { PageHeader } from "../../app/PageHeader";
import { Button } from "../../components/ui/Button";
import { Card, Section } from "../../components/ui/Rows";
import { Empty, StateText } from "../../components/ui/States";
import { sessionLabelKey, sessionTone } from "../../features/zone/sessionView";
import { useZones } from "../../features/zone/ZoneContext";
import { zoneTitle } from "../../features/zone/types";
import { ZoneMark } from "../../features/zone/ZoneMark";
import { useI18n } from "../../i18n";

const ZoneList: React.FC = () => {
    const { t } = useI18n();
    const navigate = useNavigate();
    const { zones, current } = useZones();
    return (
        <div className="shell-page">
            <PageHeader title={t("zones.title")} back="/main/setting" />
            <div className="shell-page-body ui-scroll">
                {zones.length > 0 ? (
                    <Section note={t("zones.list_note")}>
                        <Card testId="zone-list">
                            {zones.map((zone) => (
                                <button
                                    key={zone.did}
                                    type="button"
                                    className="ui-row"
                                    data-zone={zone.did}
                                    onClick={() => navigate(`/main/setting/zones/${encodeURIComponent(zone.did)}`)}
                                >
                                    <ZoneMark zone={zone} size={34} />
                                    <span className="ui-row-text">
                                        <span className="ui-row-title">{zoneTitle(zone)}</span>
                                        <StateText tone={sessionTone(zone.session)}>{t(sessionLabelKey(zone.session))}</StateText>
                                    </span>
                                    {zone.did === current?.did ? <span className="ui-row-value">{t("zones.current")}</span> : null}
                                </button>
                            ))}
                        </Card>
                    </Section>
                ) : (
                    <div className="shell-fill">
                        <Empty title={t("zones.none")} text={t("start.zone_text")} />
                    </div>
                )}
                <Button fullWidth onClick={() => navigate("/main/setting/zones/add")}>
                    <Plus size={16} aria-hidden="true" />
                    {t("zones.add")}
                </Button>
            </div>
        </div>
    );
};

export default ZoneList;
