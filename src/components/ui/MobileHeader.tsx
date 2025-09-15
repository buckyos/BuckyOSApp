import React from "react";
import { useNavigate } from "react-router-dom";

interface MobileHeaderProps {
  title: string;
  showBack?: boolean;
}

const MobileHeader: React.FC<MobileHeaderProps> = ({ title, showBack = false }) => {
  const navigate = useNavigate();
  return (
    <div style={{
      display: "flex",
      alignItems: "center",
      gap: 8,
      padding: "6px 0 12px",
    }}>
      {showBack && (
        <button
          aria-label="Back"
          onClick={() => navigate(-1)}
          style={{
            width: 36,
            height: 36,
            borderRadius: 18,
            border: "1px solid #e6e8f0",
            background: "#fff",
            display: "flex",
            alignItems: "center",
            justifyContent: "center",
          }}
        >
          <span style={{ fontSize: 18 }}>←</span>
        </button>
      )}
      <h1 style={{ fontSize: 20, margin: 0 }}>{title}</h1>
    </div>
  );
};

export default MobileHeader;

