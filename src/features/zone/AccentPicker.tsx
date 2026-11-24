import React from "react";
import { Ban, Check, Palette } from "lucide-react";
import { writeDesktopState } from "@buckyos-desktop/controlPanel/desktopState.ts";
import { accentPresets, accentText, normalizeAccent } from "@buckyos-desktop/appearance/accent.ts";
import { APPEARANCE_STATE_KEY } from "@buckyos-desktop/appearance/model.ts";
import { useI18n } from "../../i18n";
import { updateZone } from "./api";
import { zoneChannel } from "./channel";
import type { ZoneView } from "./types";

const WRITE_DELAY_MS = 400;

/** The color the account marks this Zone with: kept in its appearance there, the same on every device. */
export const AccentPicker: React.FC<{ zone: ZoneView }> = ({ zone }) => {
    const { t } = useI18n();
    const [value, setValue] = React.useState(zone.accent);
    const [failed, setFailed] = React.useState(false);
    const timer = React.useRef<number | undefined>(undefined);
    const accent = value ? normalizeAccent(value) : null;

    React.useEffect(() => setValue(zone.accent), [zone.did, zone.accent]);
    React.useEffect(() => () => window.clearTimeout(timer.current), []);

    const write = async (next: string | null) => {
        try {
            await writeDesktopState(zoneChannel(zone), APPEARANCE_STATE_KEY, next, "accent");
            await updateZone(zone.did, { accent: next });
        } catch (error) {
            console.warn("[Zone] storing the color failed", zone.host, error);
            setFailed(true);
            setValue(zone.accent);
        }
    };

    const choose = (next: string | null, delay = 0) => {
        setFailed(false);
        setValue(next);
        window.clearTimeout(timer.current);
        timer.current = window.setTimeout(() => void write(next), delay);
    };

    const custom = accent !== null && !accentPresets.includes(accent);
    return (
        <>
            <div className="accent-picker" role="radiogroup" aria-label={t("zones.accent")}>
                <button
                    type="button"
                    role="radio"
                    aria-checked={accent === null}
                    aria-label={t("zones.accent_default")}
                    title={t("zones.accent_default")}
                    className="accent-swatch"
                    data-none="true"
                    onClick={() => choose(null)}
                >
                    {accent === null ? <Check size={14} aria-hidden="true" /> : <Ban size={14} aria-hidden="true" />}
                </button>
                {accentPresets.map((preset) => (
                    <button
                        key={preset}
                        type="button"
                        role="radio"
                        aria-checked={accent === preset}
                        aria-label={preset}
                        className="accent-swatch"
                        style={{ "--swatch": preset } as React.CSSProperties}
                        onClick={() => choose(preset)}
                    >
                        {accent === preset ? <Check size={14} color={accentText(preset)} aria-hidden="true" /> : null}
                    </button>
                ))}
                <label
                    className="accent-swatch"
                    data-custom={!custom || undefined}
                    aria-checked={custom}
                    title={t("zones.accent_custom")}
                    style={custom ? ({ "--swatch": accent, position: "relative", overflow: "visible" } as React.CSSProperties) : undefined}
                >
                    {custom ? <Check size={14} color={accentText(accent)} aria-hidden="true" /> : <Palette size={14} aria-hidden="true" />}
                    <input
                        type="color"
                        value={accent ?? "#406ad5"}
                        aria-label={t("zones.accent_custom")}
                        onChange={(event) => choose(normalizeAccent(event.target.value), WRITE_DELAY_MS)}
                        style={custom ? { position: "absolute", inset: 0, width: "100%", height: "100%", opacity: 0, cursor: "pointer" } : undefined}
                    />
                </label>
            </div>
            {failed ? (
                <p className="ui-error" role="alert" style={{ padding: "0 12px 12px" }}>
                    {t("zones.accent_failed")}
                </p>
            ) : null}
        </>
    );
};
