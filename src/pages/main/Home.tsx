import React from "react";
import "./Home.css";
import { useDidContext } from "../../features/did/DidContext";
import BindSn, { SnStatusSummary } from "./components/BindSn";

const Home: React.FC = () => {
    const { activeDid } = useDidContext();
    return (
        <div className="home-wrapper">
            <div className="home-body">
                <BindSn activeDid={activeDid} />
            </div>
        </div>
    );
};

export default Home;
