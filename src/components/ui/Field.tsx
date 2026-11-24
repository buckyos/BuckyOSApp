import React from "react";
import { ChevronDown, Eye, EyeOff, Search } from "lucide-react";
import { useI18n } from "../../i18n";
import { IconButton } from "./Button";

export const Field: React.FC<React.PropsWithChildren<{ label: string; hint?: React.ReactNode; error?: string }>> = ({
    label,
    hint,
    error,
    children,
}) => (
    <label className="ui-field">
        <span className="ui-field-label">{label}</span>
        {children}
        {error ? (
            <p className="ui-error" role="alert">
                {error}
            </p>
        ) : hint ? (
            <p className="ui-field-hint">{hint}</p>
        ) : null}
    </label>
);

export const PasswordInput: React.FC<Omit<React.InputHTMLAttributes<HTMLInputElement>, "type">> = (props) => {
    const { t } = useI18n();
    const [shown, setShown] = React.useState(false);
    return (
        <div className="ui-password">
            <input {...props} className="ui-input" type={shown ? "text" : "password"} autoCapitalize="none" autoCorrect="off" spellCheck={false} />
            <IconButton label={t(shown ? "ui.hide_password" : "ui.show_password")} onClick={() => setShown((value) => !value)} tabIndex={-1}>
                {shown ? <EyeOff size={16} /> : <Eye size={16} />}
            </IconButton>
        </div>
    );
};

export const SearchInput: React.FC<{ value: string; onChange: (value: string) => void; label: string }> = ({ value, onChange, label }) => (
    <div className="ui-search">
        <Search size={15} aria-hidden="true" />
        <input
            className="ui-input"
            type="text"
            role="searchbox"
            value={value}
            onChange={(event) => onChange(event.target.value)}
            onKeyDown={(event) => {
                if (event.key === "Escape" && value) onChange("");
            }}
            placeholder={label}
            aria-label={label}
            spellCheck={false}
        />
    </div>
);

export const Select: React.FC<React.SelectHTMLAttributes<HTMLSelectElement>> = ({ children, ...rest }) => (
    <span className="ui-select">
        <select {...rest}>{children}</select>
        <ChevronDown size={14} aria-hidden="true" />
    </span>
);

export const Switch: React.FC<{ checked: boolean; onChange: (checked: boolean) => void; label: string; disabled?: boolean; testId?: string }> = ({
    checked,
    onChange,
    label,
    disabled,
    testId,
}) => (
    <button
        type="button"
        role="switch"
        className="ui-switch"
        aria-checked={checked}
        aria-label={label}
        disabled={disabled}
        data-testid={testId}
        onClick={() => onChange(!checked)}
    />
);

export function Segmented<T extends string>({
    value,
    options,
    onChange,
    label,
}: {
    value: T;
    options: { value: T; label: string }[];
    onChange: (value: T) => void;
    label: string;
}) {
    return (
        <div className="ui-segmented" role="radiogroup" aria-label={label}>
            {options.map((option) => (
                <button key={option.value} type="button" role="radio" aria-checked={option.value === value} onClick={() => onChange(option.value)}>
                    {option.label}
                </button>
            ))}
        </div>
    );
}
