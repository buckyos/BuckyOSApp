import React from "react";
import { FirstZone } from "../../features/home/FirstZone";
import { Shortcuts } from "../../features/home/Shortcuts";
import { StatusCard } from "../../features/home/StatusCard";
import { MusicCard } from "../../features/music/MusicCard";
import { AccountArea } from "../../features/zone/AccountArea";
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
                        {current.session.state === "signed_in" ? <StatusCard key={current.did} zone={current} /> : null}
                        <MusicCard key={`music-${current.did}`} zone={current} />
                        <Shortcuts key={`shortcuts-${current.did}`} zone={current} />
                    </>
                ) : zones.length === 0 && !loading ? (
                    <FirstZone />
                ) : null}
            </div>
        </div>
    );
};

export default Home;
