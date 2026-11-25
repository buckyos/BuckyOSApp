import React from "react";
import { FirstZone } from "../../features/home/FirstZone";
import { ShortcutsSection } from "../../features/home/ShortcutsSection";
import { StatusCard } from "../../features/home/StatusCard";
import { MusicCard } from "../../features/music/MusicCard";
import { AccountArea } from "../../features/zone/AccountArea";
import { LineNotice } from "../../features/zone/LineNotice";
import { SessionNotice } from "../../features/zone/SessionNotice";
import { useZones } from "../../features/zone/ZoneContext";

const Home: React.FC = () => {
    const { current, zones, loading } = useZones();
    return (
        <div className="shell-page ui-scroll">
            <div className="shell-page-body home-page">
                <AccountArea />
                {current ? (
                    <>
                        <SessionNotice zone={current} />
                        <LineNotice zone={current} />
                        {current.session.state === "signed_in" ? <StatusCard key={current.did} zone={current} /> : null}
                        <MusicCard key={`music-${current.did}`} zone={current} />
                        <ShortcutsSection key={`shortcuts-${current.did}`} zone={current} />
                    </>
                ) : zones.length === 0 && !loading ? (
                    <FirstZone />
                ) : null}
            </div>
        </div>
    );
};

export default Home;
