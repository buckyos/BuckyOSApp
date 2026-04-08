import React from "react";
import { Routes, Route, useLocation } from "react-router-dom";
import Welcome from "../../pages/did/Welcome";
import CreateDid from "../../pages/did/CreateDid";
import BindSn from "../../pages/did/BindSn";
import ShowMnemonic from "../../pages/did/ShowMnemonic";
import ConfirmMnemonic from "../../pages/did/ConfirmMnemonic";
import Success from "../../pages/did/Success";
import LoadingOverlay from "../../components/ui/LoadingOverlay";
import { useDidFlow } from "./useDidFlow";
import "./DidFlowRoutes.css";
import SnIntro from "../../pages/did/SnIntro";
import ImportDid from "../../pages/did/ImportDid";
import DidInfo from "../../pages/did/DidInfo";
import { useI18n } from "../../i18n";

const DidFlowRoutes: React.FC = () => {
    const { t } = useI18n();
    const location = useLocation();
    const {
        password,
        setPassword,
        confirmPassword,
        setConfirmPassword,
        snName,
        setSnName,
        activeCode,
        setActiveCode,
        mnemonic,
        confirmedMnemonic,
        setConfirmedMnemonic,
        didInfo,
        error,
        loading,
        goToCreateDid,
        goToImportDid,
        goToShowMnemonic,
        goToConfirmMnemonic,
        goToBindSn,
        handleBindSnAndCreateDid,
        handleImportDid,
        goToWelcome,
        goToDidInfo,
        goToSnInfo,
        resetFlow,
    } = useDidFlow();

    const loadingTextKey = location.pathname === "/import" ? "common.importing" : "common.creating";

    return (
        <div className="App">
            <LoadingOverlay visible={loading} textKey={loadingTextKey} />
            <Routes>
                <Route
                    path="/"
                    element={<Welcome onStart={goToCreateDid} onImport={goToImportDid} />}
                />
                <Route path="/did-info" element={<DidInfo onBack={goToWelcome} />} />
                <Route path="/sn" element={<SnIntro />} />
                <Route
                    path="/import"
                    element={
                        <ImportDid
                            loading={loading}
                            error={error}
                            onImport={handleImportDid}
                            onBack={goToWelcome}
                        />
                    }
                />
                <Route
                    path="/create"
                    element={
                        <CreateDid
                            onNext={goToShowMnemonic}
                            onShowDidInfo={goToDidInfo}
                            onShowSnInfo={goToSnInfo}
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
                            onConfirm={goToBindSn}
                            setConfirmedMnemonic={setConfirmedMnemonic}
                            error={error}
                            confirmedMnemonic={confirmedMnemonic}
                            mnemonic={mnemonic}
                            confirmLabel={t("common.actions.next")}
                        />
                    }
                />
                <Route
                    path="/bind-sn"
                    element={
                        <BindSn
                            snName={snName}
                            setSnName={setSnName}
                            password={password}
                            setPassword={setPassword}
                            confirmPassword={confirmPassword}
                            setConfirmPassword={setConfirmPassword}
                            activeCode={activeCode}
                            setActiveCode={setActiveCode}
                            loading={loading}
                            error={error}
                            onSubmit={handleBindSnAndCreateDid}
                            onShowSnInfo={goToSnInfo}
                        />
                    }
                />
                <Route path="/success" element={<Success didInfo={didInfo} onDone={resetFlow} />} />
            </Routes>
        </div>
    );
};

export default DidFlowRoutes;
