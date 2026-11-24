// What the system header shows; no React.
import type { HeaderMenuItem, HeaderState } from "buckyos/app-frame";
import type { AppWindowDeclaration } from "buckyos";

export type HeaderStyle = "standard" | "compact";

export interface HeaderModel {
    style: HeaderStyle;
    title: string;
    /** The back button: unless the app says there is nothing to go back to. */
    back: boolean;
    search: { placeholder: string; value: string } | null;
    menu: HeaderMenuItem[];
    /** Only a standard header has room for it. */
    secondRow: { id: string; label: string; active: boolean }[];
}

export function headerModel(
    header: HeaderState,
    view: { title: string; app: string },
    declaration: Pick<AppWindowDeclaration, "mobile_header"> | undefined
): HeaderModel {
    const style: HeaderStyle = declaration?.mobile_header === "compact" ? "compact" : "standard";
    return {
        style,
        title: header.title?.trim() || view.title || view.app,
        back: header.back !== false,
        search: header.search ? { placeholder: header.search.placeholder ?? "", value: header.search.value ?? "" } : null,
        menu: header.menu ?? [],
        secondRow: style === "standard" ? (header.second_row ?? []).map((item) => ({ id: item.id, label: item.label, active: item.active === true })) : [],
    };
}

/** A menu picture the local pages may load; the name of an icon is not one. */
export function menuImage(icon: string | undefined): string | null {
    return icon && /^data:image\//i.test(icon) ? icon : null;
}
