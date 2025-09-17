import React from "react";
import MobileHeader from "../../components/ui/MobileHeader";

const Home: React.FC = () => {
  return (
    <div style={{ display: "flex", flexDirection: "column", height: "100%" }}>
      <MobileHeader title="Header" />
      <div style={{ padding: 12, display: "flex", flexDirection: "column", gap: 12 }}>
        {/* Placeholder cards to match wireframe */}
        <div style={{ background: "var(--card-bg)", border: "1px solid var(--border)", borderRadius: 12, padding: 12 }}>
          <div style={{ display: "flex", alignItems: "center", gap: 12 }}>
            <div style={{ width: 44, height: 44, borderRadius: 8, background: "#e9ecf5" }} />
            <div style={{ fontSize: 16 }}>智能网关</div>
          </div>
        </div>
        <div style={{ background: "var(--card-bg)", border: "1px solid var(--border)", borderRadius: 12, padding: 12 }}>
          <div style={{ display: "flex", alignItems: "center", gap: 12 }}>
            <div style={{ width: 44, height: 44, borderRadius: 8, background: "#e9ecf5" }} />
            <div style={{ fontSize: 16 }}>Backup Client</div>
          </div>
        </div>
      </div>
    </div>
  );
};

export default Home;

