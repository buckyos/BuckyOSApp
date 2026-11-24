import React from "react";
import { accentText } from "@buckyos-desktop/appearance/accent.ts";
import { Avatar } from "../../components/ui/Avatar";
import { useZoneImage } from "./images";
import { zoneTitle, type ZoneView } from "./types";

/** A Zone's picture, or its first letter on the color the account gave the Zone. */
export const ZoneMark: React.FC<{ zone: Pick<ZoneView, "did" | "host" | "name" | "icon" | "accent">; size: number }> = ({ zone, size }) => {
    const image = useZoneImage(zone.did, zone.host, zone.icon);
    return (
        <Avatar
            src={image}
            name={zoneTitle(zone)}
            color={zone.accent ?? "var(--cp-app-slate)"}
            textColor={zone.accent ? accentText(zone.accent) : undefined}
            size={size}
            shape="square"
        />
    );
};
