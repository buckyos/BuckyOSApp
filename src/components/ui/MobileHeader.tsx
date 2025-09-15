import React from "react";
import { useNavigate } from "react-router-dom";

interface MobileHeaderProps {
  title: string;
  showBack?: boolean;
}

const MobileHeader: React.FC<MobileHeaderProps> = ({ title, showBack = false }) => {
  const navigate = useNavigate();
  return (
    <div
      style={{
        display: "flex",
        alignItems: "center",
        gap: 10,
        padding: "8px 0 12px",
      }}
    >
      {showBack && (
        <button
          aria-label="Back"
          onClick={() => navigate(-1)}
          style={{
            display: "flex",
            alignItems: "center",
            justifyContent: "center",
            padding: 8,
            minWidth: 36,
            minHeight: 36,
            border: "none",
            background: "transparent",
            lineHeight: 0,
            color: "var(--header-icon)",
            cursor: "pointer",
          }}
        >
          {/* iOS-like chevron back icon (no circular bg) */}
          <svg
            width="22"
            height="22"
            viewBox="0 0 24 24"
            fill="none"
            stroke="currentColor"
            strokeWidth={2.75}
            strokeLinecap="round"
            strokeLinejoin="round"
            aria-hidden="true"
          >
            <polyline points="15 18 9 12 15 6" />
          </svg>
        </button>
      )}
      <h1
        style={{
          fontSize: 20,
          margin: 0,
          whiteSpace: "nowrap",
          overflow: "hidden",
          textOverflow: "ellipsis",
        }}
      >
        {title}
      </h1>
    </div>
  );
};

export default MobileHeader;
