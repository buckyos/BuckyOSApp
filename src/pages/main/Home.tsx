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
            <BindSn activeDid={activeDid} onStatusChange={setSnStatus} />
            {showBindOod && <BindOod />}
        </div>
    );
};

export default Home;
