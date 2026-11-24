import React from "react";
import { initialOf } from "@buckyos-desktop/presentation/model.ts";

const TONES = [
    "var(--cp-app-blue)",
    "var(--cp-app-green)",
    "var(--cp-app-amber)",
    "var(--cp-app-red)",
    "var(--cp-app-violet)",
    "var(--cp-app-slate)",
];

/** The color of something without a picture: always the same for the same id. */
export function toneOf(id: string): string {
    let hash = 0;
    for (const char of id) hash = (hash * 31 + (char.codePointAt(0) ?? 0)) >>> 0;
    return TONES[hash % TONES.length];
}

interface AvatarProps {
    /** Best first; null while not known. */
    src: string | null | undefined;
    name: string;
    /** What the color is taken from; the name when left out. */
    id?: string;
    color?: string;
    textColor?: string;
    size: number;
    shape?: "round" | "square";
}

/** A picture, or the first letter on a plain color when there is none or it does not load. */
export const Avatar: React.FC<AvatarProps> = ({ src, name, id, color, textColor = "#ffffff", size, shape = "round" }) => {
    const [broken, setBroken] = React.useState<string | null>(null);
    const shown = src && src !== broken ? src : null;
    return (
        <span
            className="ui-avatar"
            data-shape={shape}
            aria-hidden="true"
            style={
                {
                    width: size,
                    height: size,
                    fontSize: Math.round(size * 0.42),
                    ...(shown
                        ? { "--ui-avatar-bg": "transparent" }
                        : { "--ui-avatar-bg": color ?? toneOf(id ?? name), "--ui-avatar-text": textColor }),
                } as React.CSSProperties
            }
        >
            {shown ? <img src={shown} alt="" draggable={false} onError={() => setBroken(shown)} /> : initialOf(name)}
        </span>
    );
};
