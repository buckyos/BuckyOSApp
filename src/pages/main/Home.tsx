import React from "react";
import "./Home.css";
import { useDidContext } from "../../features/did/DidContext";
import BindSn, { SnStatusSummary } from "./components/BindSn";
import BindOod from "./components/BindOod";

const Home: React.FC = () => {
    const { activeDid } = useDidContext();
    const [snStatus, setSnStatus] = React.useState<SnStatusSummary>({
        initializing: true,
        registered: false,
        checking: true,
        queryFailed: false,
    });

    const showBindOod = !snStatus.initializing && snStatus.registered && !snStatus.queryFailed;

    return (
        <div className="home-wrapper">
            <div className="home-body">
                <BindSn activeDid={activeDid} onStatusChange={setSnStatus} />
                {showBindOod && (
                    <div className="bind-ood-wrapper">
                        <BindOod />
                    </div>
                )}
            </div>
        </div>
    );
};

export default Home;
