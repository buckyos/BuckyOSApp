// The icon of an app's window: the app's picture the way its tile shows it, or its first letter on
// its color when it has none. Drawn here because the page already has the picture (with the
// client's session), reads every image format and knows the tile's look; the native side only
// gets a PNG.
import { initialOf } from "@buckyos-desktop/presentation/model.ts";
import { toneOf } from "../../components/ui/Avatar";
import { directImage, loadZoneImage } from "../zone/images";

/** Pixels; the native side scales it down by halves for the sizes a platform asks for. */
export const WINDOW_ICON_SIZE = 128;
/** The tile's corner (`.ui-avatar[data-shape='square']`). */
const CORNER = 0.24;
const FALLBACK_TONE = "#64748b";

export interface WindowIconSource {
    zone: string;
    /** An absolute https address or a data URL; null when the app has none. */
    icon: string | null;
    name: string;
    /** What the color is taken from. */
    id: string;
}

function cssValue(value: string): string {
    const variable = /^var\((--[\w-]+)\)$/.exec(value.trim());
    if (!variable) return value;
    return getComputedStyle(document.documentElement).getPropertyValue(variable[1]).trim();
}

function decode(src: string): Promise<HTMLImageElement | null> {
    return new Promise((resolve) => {
        const image = new Image();
        image.onload = () => resolve(image);
        image.onerror = () => resolve(null);
        image.src = src;
    });
}

async function picture(source: WindowIconSource): Promise<HTMLImageElement | null> {
    if (!source.icon) return null;
    const data = directImage(source.icon) ?? (await loadZoneImage(source.zone, source.icon));
    return data ? decode(data) : null;
}

function roundedSquare(context: CanvasRenderingContext2D, size: number) {
    const radius = size * CORNER;
    context.beginPath();
    context.moveTo(radius, 0);
    context.arcTo(size, 0, size, size, radius);
    context.arcTo(size, size, 0, size, radius);
    context.arcTo(0, size, 0, 0, radius);
    context.arcTo(0, 0, size, 0, radius);
    context.closePath();
}

/** Like `object-fit: cover`; a picture without a size of its own (some SVGs) fills the square. */
function drawCover(context: CanvasRenderingContext2D, image: HTMLImageElement, size: number) {
    const width = image.naturalWidth || size;
    const height = image.naturalHeight || size;
    const scale = Math.max(size / width, size / height);
    const drawnWidth = width * scale;
    const drawnHeight = height * scale;
    context.drawImage(image, (size - drawnWidth) / 2, (size - drawnHeight) / 2, drawnWidth, drawnHeight);
}

function drawLetter(context: CanvasRenderingContext2D, source: WindowIconSource, size: number) {
    context.fillStyle = FALLBACK_TONE;
    // A color the canvas does not read leaves the one before.
    context.fillStyle = cssValue(toneOf(source.id || source.name));
    context.fill();
    const family = cssValue("var(--cp-font-sans)") || "system-ui, sans-serif";
    context.font = `600 ${Math.round(size * 0.42)}px ${family}`;
    context.fillStyle = "#ffffff";
    context.textAlign = "center";
    context.textBaseline = "alphabetic";
    const letter = initialOf(source.name);
    const metrics = context.measureText(letter);
    const middle = (metrics.actualBoundingBoxAscent - metrics.actualBoundingBoxDescent) / 2;
    context.fillText(letter, size / 2, size / 2 + middle);
}

function draw(source: WindowIconSource, image: HTMLImageElement | null, size: number): string | null {
    const canvas = document.createElement("canvas");
    canvas.width = size;
    canvas.height = size;
    const context = canvas.getContext("2d");
    if (!context) return null;
    context.imageSmoothingEnabled = true;
    context.imageSmoothingQuality = "high";
    roundedSquare(context, size);
    context.save();
    context.clip();
    if (image) drawCover(context, image, size);
    else drawLetter(context, source, size);
    context.restore();
    const url = canvas.toDataURL("image/png");
    return url.startsWith("data:image/png;base64,") ? url.slice("data:image/png;base64,".length) : null;
}

/** The icon as base64 PNG; null when the page cannot draw. */
export async function renderWindowIcon(source: WindowIconSource, size = WINDOW_ICON_SIZE): Promise<string | null> {
    const image = await picture(source).catch(() => null);
    if (image) {
        try {
            return draw(source, image, size);
        } catch (error) {
            // An engine that will not let a picture out of a canvas: the letter it is.
            console.info("[Content] the app's picture cannot be a window icon", error);
        }
    }
    return draw(source, null, size);
}
