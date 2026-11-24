// Characters that reorder or hide text: a page must not make what is signed look like something else.
const HIDDEN = /[\u0000-\u0008\u000b-\u001f\u007f-\u009f\u00ad\u200b-\u200f\u2028-\u202e\u2060-\u206f\ufeff]/g;

/** What is signed, readable and without characters that hide or reorder it. */
export function payloadText(payload: unknown): string {
    let text: string;
    try {
        text = JSON.stringify(payload, null, 2) ?? String(payload);
    } catch {
        text = String(payload);
    }
    return text.replace(HIDDEN, (char) => `\\u${char.charCodeAt(0).toString(16).padStart(4, "0")}`);
}
