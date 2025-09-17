import React from "react";
import { Routes, Route } from "react-router-dom";
import Welcome from "../../pages/did/Welcome";
import CreateDid from "../../pages/did/CreateDid";
import ShowMnemonic from "../../pages/did/ShowMnemonic";
import ConfirmMnemonic from "../../pages/did/ConfirmMnemonic";
import Success from "../../pages/did/Success";
import LoadingOverlay from "../../components/ui/LoadingOverlay";
import { useDidFlow } from "./useDidFlow";
import "./DidFlowRoutes.css";
import SnIntro from "../../pages/did/SnIntro";

const DidFlowRoutes: React.FC = () => {
    const {
        nickname,
        setNickname,
        password,
        setPassword,
        confirmPassword,
        setConfirmPassword,
        mnemonic,
        confirmedMnemonic,
        setConfirmedMnemonic,
        didInfo,
        error,
        loading,
        goToCreateDid,
        goToShowMnemonic,
        goToConfirmMnemonic,
        handleCreateDid,
        resetFlow,
    } = useDidFlow();

    return (
        <div className="App">
            <LoadingOverlay visible={loading} textKey="common.creating" />
            <Routes>
                <Route path="/" element={<Welcome onStart={goToCreateDid} />} />
                <Route path="/sn" element={<SnIntro />} />
                <Route
                    path="/create"
                    element={
                        <CreateDid
                            nickname={nickname}
                            setNickname={setNickname}
                            password={password}
                            setPassword={setPassword}
                            confirmPassword={confirmPassword}
                            setConfirmPassword={setConfirmPassword}
                            onNext={goToShowMnemonic}
                            error={error}
                        />
                    }
                />
                <Route
                    path="/show-mnemonic"
                    element={<ShowMnemonic mnemonic={mnemonic} onNext={goToConfirmMnemonic} />}
                />
                <Route
                    path="/confirm-mnemonic"
                    element={
                        <ConfirmMnemonic
                            onConfirm={handleCreateDid}
                            setConfirmedMnemonic={setConfirmedMnemonic}
                            error={error}
                            confirmedMnemonic={confirmedMnemonic}
                            mnemonic={mnemonic}
                        />
                    }
                />
                <Route path="/success" element={<Success didInfo={didInfo} onDone={resetFlow} />} />
            </Routes>
        </div>
    );
};

export default DidFlowRoutes;
