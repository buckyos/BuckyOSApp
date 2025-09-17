import React from "react";
import MobileHeader from "../../components/ui/MobileHeader";

const Apps: React.FC = () => {
  return (
    <div style={{ display: "flex", flexDirection: "column", height: "100%" }}>
      <MobileHeader title="Apps" />
      <div style={{ padding: 12, color: "var(--muted-text)" }}>
        {/* Placeholder content */}
        Coming soon…
      </div>
    </div>
  );
};

export default Apps;

