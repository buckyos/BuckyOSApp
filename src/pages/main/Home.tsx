import React from "react";

const metrics = [
  {
    key: "cpu",
    label: "CPU",
    value: 62,
    unit: "%",
    gradient: "linear-gradient(135deg, #6366f1 0%, #7c3aed 100%)",
  },
  {
    key: "memory",
    label: "Memory",
    value: 48,
    unit: "%",
    gradient: "linear-gradient(135deg, #0ea5e9 0%, #22d3ee 100%)",
  },
  {
    key: "storage",
    label: "Storage",
    value: 73,
    unit: "%",
    gradient: "linear-gradient(135deg, #f59e0b 0%, #f97316 100%)",
  },
  {
    key: "network",
    label: "Network",
    value: 128,
    unit: "Mbps",
    gradient: "linear-gradient(135deg, #34d399 0%, #10b981 100%)",
  },
];

const Home: React.FC = () => {
  return (
    <div style={{ display: "flex", flexDirection: "column", height: "100%", padding: "0 16px 16px" }}>
      <section
        style={{
          display: "grid",
          gridTemplateColumns: "repeat(auto-fit, minmax(150px, 1fr))",
          gap: 16,
          marginTop: 8,
        }}
      >
        {metrics.map(({ key, label, value, unit, gradient }) => (
          <article
            key={key}
            style={{
              background: "var(--card-bg)",
              border: "1px solid var(--border)",
              borderRadius: 16,
              padding: 16,
              display: "flex",
              flexDirection: "column",
              gap: 14,
              boxShadow: "0 10px 24px rgba(15, 23, 42, 0.08)",
            }}
          >
            <header style={{ display: "flex", justifyContent: "space-between", alignItems: "center" }}>
              <span style={{ fontSize: 15, color: "var(--muted-text)", fontWeight: 500 }}>{label}</span>
              <span style={{ fontSize: 26, fontWeight: 600, color: "var(--app-text)" }}>
                {value}
                <span style={{ fontSize: 14, marginLeft: 4, color: "var(--muted-text)" }}>{unit}</span>
              </span>
            </header>
            <div
              style={{
                position: "relative",
                height: 110,
                display: "flex",
                alignItems: "center",
                justifyContent: "center",
              }}
            >
              <div
                style={{
                  width: 96,
                  height: 96,
                  borderRadius: "50%",
                  background: gradient,
                  position: "relative",
                  display: "flex",
                  alignItems: "center",
                  justifyContent: "center",
                  boxShadow: "0 12px 28px rgba(76, 29, 149, 0.15)",
                }}
              >
                <div
                  style={{
                    width: 76,
                    height: 76,
                    borderRadius: "50%",
                    background: "var(--app-bg)",
                    display: "flex",
                    alignItems: "center",
                    justifyContent: "center",
                    fontSize: 20,
                    fontWeight: 600,
                    color: "var(--app-text)",
                  }}
                >
                  {value}
                  <span style={{ fontSize: 11, marginLeft: 4 }}>{unit}</span>
                </div>
              </div>
            </div>
          </article>
        ))}
      </section>
    </div>
  );
};

export default Home;
