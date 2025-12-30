import React from "react";
import "./Home.css";
import BindOod from "./components/BindOod";

const ActivateOod: React.FC = () => {
    return (
        <div className="home-wrapper">
            <div className="home-body">
                <div className="bind-ood-wrapper">
                    <BindOod />
                </div>
            </div>
        </div>
    );
};

export default ActivateOod;
