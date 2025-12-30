import React from "react";
import "./Home.css";
import { useDidContext } from "../../features/did/DidContext";
import BindSn, { SnStatusSummary } from "./components/BindSn";
import BindOod from "./components/BindOod";
import { useI18n } from "../../i18n";

const Home: React.FC = () => {
    const { t } = useI18n();
    const { activeDid } = useDidContext();
    const [snStatus, setSnStatus] = React.useState<SnStatusSummary>({
        initializing: true,
        registered: false,
        checking: true,
        queryFailed: false,
        oodBound: false,
    });

    const showOodSection = !snStatus.initializing && snStatus.registered && !snStatus.queryFailed;
    return (
        <div className="home-wrapper">
            <div className="home-body">
                <BindSn activeDid={activeDid} onStatusChange={setSnStatus} />
                {showOodSection && (
                    <div className="bind-ood-wrapper">
                        {snStatus.oodBound ? (
                            <section className="did-section bind-ood-section">
                                <header className="home-header">
                                    <div>
                                        <h1>{t("ood.bound_title")}</h1>
                                        <p>{t("ood.bound_subtitle")}</p>
                                    </div>
                                </header>
                                <div className="ood-info-card bind-ood-info">
                                    <p>{t("ood.bound_desc")}</p>
                                </div>
                            </section>
                        ) : (
                            <BindOod />
                        )}
                    </div>
                )}
            </div>
        </div>
    );
};

export default Home;
