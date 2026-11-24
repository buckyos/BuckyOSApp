import React from "react";

export type Tone = "ok" | "busy" | "warn" | "bad" | "idle";

const TONES: Record<Tone, string> = {
    ok: "var(--cp-success)",
    busy: "var(--cp-accent)",
    warn: "var(--cp-warning)",
    bad: "var(--cp-danger)",
    idle: "color-mix(in srgb, var(--cp-muted) 70%, transparent)",
};

export const Dot: React.FC<{ tone?: Tone; color?: string; label?: string }> = ({ tone = "idle", color, label }) => (
    <span
        className="ui-dot"
        style={{ "--ui-dot": color ?? TONES[tone] } as React.CSSProperties}
        {...(label ? { role: "img", "aria-label": label } : { "aria-hidden": true })}
    />
);

/** A 6px dot and a word. */
export const StateText: React.FC<React.PropsWithChildren<{ tone: Tone }>> = ({ tone, children }) => (
    <span className="ui-state">
        <Dot tone={tone} />
        <span>{children}</span>
    </span>
);

export const Spinner: React.FC<{ label?: string }> = ({ label }) => (
    <span className="ui-spinner" {...(label ? { role: "status", "aria-label": label } : { "aria-hidden": true })} />
);

export const Empty: React.FC<React.PropsWithChildren<{ icon?: React.ReactNode; title?: string; text?: React.ReactNode; testId?: string }>> = ({
    icon,
    title,
    text,
    testId,
    children,
}) => (
    <div className="ui-empty" data-testid={testId}>
        {icon}
        {title ? <strong>{title}</strong> : null}
        {text ? <p>{text}</p> : null}
        {children}
    </div>
);

/** A line about the Zone above a page's content, with what can be done about it. */
export const Notice: React.FC<React.PropsWithChildren<{ tone: Tone; action?: React.ReactNode; testId?: string }>> = ({
    tone,
    action,
    testId,
    children,
}) => (
    <div className="ui-notice" role="status" data-testid={testId}>
        {tone === "busy" ? <Spinner /> : <Dot tone={tone} />}
        <span className="ui-notice-text">{children}</span>
        {action}
    </div>
);
