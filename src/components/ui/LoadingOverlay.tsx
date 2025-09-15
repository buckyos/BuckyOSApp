import React from "react";
import { useI18n } from "../../i18n";

interface LoadingOverlayProps {
  visible: boolean;
  textKey?: string; // i18n key
}

const LoadingOverlay: React.FC<LoadingOverlayProps> = ({ visible, textKey = "common.creating" }) => {
  const { t } = useI18n();
  if (!visible) return null;
  return (
    <div style={{
      position: "fixed",
      inset: 0,
      background: "rgba(0,0,0,0.45)",
      display: "flex",
      alignItems: "center",
      justifyContent: "center",
      zIndex: 1000,
    }}>
      <div style={{
        background: "#fff",
        borderRadius: 16,
        padding: "16px 20px",
        minWidth: 220,
        display: "flex",
        alignItems: "center",
        gap: 12,
        boxShadow: "0 8px 24px rgba(20, 20, 60, 0.16)",
      }}>
        <div className="spinner" style={{
          width: 20,
          height: 20,
          border: "3px solid #e6e8f0",
          borderTopColor: "#2fc690",
          borderRadius: "50%",
          animation: "spin 1s linear infinite",
        }} />
        <span style={{ fontSize: 16 }}>{t(textKey)}</span>
      </div>
      <style>{`@keyframes spin{from{transform:rotate(0)}to{transform:rotate(360deg)}}`}</style>
    </div>
  );
};

export default LoadingOverlay;

