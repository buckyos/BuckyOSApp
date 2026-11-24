import React from "react";
import { ChevronRight } from "lucide-react";

export const Section: React.FC<React.PropsWithChildren<{ title?: string; note?: React.ReactNode }>> = ({ title, note, children }) => (
    <section className="ui-section">
        {title ? <h2 className="ui-section-title">{title}</h2> : null}
        {children}
        {note ? <p className="ui-section-note">{note}</p> : null}
    </section>
);

export const Card: React.FC<React.PropsWithChildren<{ className?: string; testId?: string }>> = ({ className, testId, children }) => (
    <div className={className ? `ui-card ${className}` : "ui-card"} data-testid={testId}>
        {children}
    </div>
);

interface RowProps {
    icon?: React.ReactNode;
    title: React.ReactNode;
    sub?: React.ReactNode;
    wrapSub?: boolean;
    value?: React.ReactNode;
    /** Anything at the end of the row: a switch, a select, a button. */
    end?: React.ReactNode;
    tone?: "danger";
    onClick?: () => void;
    chevron?: boolean;
    disabled?: boolean;
    testId?: string;
}

/** One line of a settings card; a button when it can be clicked. */
export const Row: React.FC<RowProps> = ({ icon, title, sub, wrapSub, value, end, tone, onClick, chevron = Boolean(onClick), disabled, testId }) => {
    const content = (
        <>
            {icon}
            <span className="ui-row-text">
                <span className="ui-row-title">{title}</span>
                {sub ? (
                    <span className="ui-row-sub" data-wrap={wrapSub || undefined}>
                        {sub}
                    </span>
                ) : null}
            </span>
            {value !== undefined ? <span className="ui-row-value">{value}</span> : null}
            {end}
            {chevron ? <ChevronRight size={16} aria-hidden="true" /> : null}
        </>
    );
    return onClick ? (
        <button type="button" className="ui-row" data-tone={tone} onClick={onClick} disabled={disabled} data-testid={testId}>
            {content}
        </button>
    ) : (
        <div className="ui-row" data-tone={tone} data-testid={testId}>
            {content}
        </div>
    );
};
