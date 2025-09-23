import React from "react";

const appCards = [
  {
    key: "gateway",
    title: "智能网关",
    description: "管理本地网络、监控链路状态与设备健康。",
    accent: "linear-gradient(135deg, #6366f1 0%, #4338ca 100%)",
  },
  {
    key: "backup",
    title: "Backup Client",
    description: "为关键数据提供备份与恢复策略。",
    accent: "linear-gradient(135deg, #0ea5e9 0%, #0284c7 100%)",
  },
];

const Apps: React.FC = () => {
  return (
    <div
      style={{
        display: "flex",
        flexDirection: "column",
        gap: 16,
        padding: "0 16px 16px",
      }}
    >
      {appCards.map(({ key, title, description, accent }) => (
        <article
          key={key}
          style={{
            background: "var(--card-bg)",
            border: "1px solid var(--border)",
            borderRadius: 16,
            padding: 18,
            display: "flex",
            gap: 16,
            alignItems: "center",
            boxShadow: "0 14px 32px rgba(15, 23, 42, 0.08)",
          }}
        >
          <div
            style={{
              width: 56,
              height: 56,
              borderRadius: 16,
              background: accent,
              display: "flex",
              alignItems: "center",
              justifyContent: "center",
              color: "#fff",
              fontSize: 22,
              fontWeight: 600,
              boxShadow: "0 12px 28px rgba(67, 56, 202, 0.18)",
            }}
            aria-hidden="true"
          >
            {title.slice(0, 1)}
          </div>
          <div style={{ display: "flex", flexDirection: "column", gap: 6 }}>
            <h2 style={{ margin: 0, fontSize: 17, color: "var(--app-text)" }}>{title}</h2>
            <p style={{ margin: 0, fontSize: 14, color: "var(--muted-text)", lineHeight: 1.45 }}>
              {description}
            </p>
          </div>
        </article>
      ))}
    </div>
  );
};

export default Apps;
