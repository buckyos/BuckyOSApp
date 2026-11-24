import { describe, expect, it, vi } from "vitest";
import { FrameHosts, type FrameHostsOptions } from "./frameHosts";

const view = { id: "v1", zone: "did:bns:bob", app: "notes", appInstance: "notes@bob" };

function setup(patch: Partial<FrameHostsOptions> = {}) {
    const sent: { view: string; event: string; payload: { type: string; payload: any; id?: string } }[] = [];
    const options: FrameHostsOptions = {
        formFactor: "desktop",
        container: "desktop-app",
        emit: async (viewId, event, payload) => {
            sent.push({ view: viewId, event, payload: payload as any });
        },
        look: () => ({ mode: "dark", locale: "zh" }),
        accent: () => "#112233",
        presentation: () => "window",
        onAppOpen: vi.fn(async () => ({ ok: true as const })),
        onContentOpen: vi.fn(),
        onTitle: vi.fn(),
        onRequestClose: vi.fn(),
        ...patch,
    };
    const hosts = new FrameHosts(options);
    hosts.open(view);
    const message = (type: string, payload: unknown, extra: object = {}) =>
        hosts.receive(view.id, { protocol: "buckyos.app-frame", version: 1, type, payload, ...extra });
    const hello = () => message("frame.hello", { nonce: "n1", appCapabilities: ["open", "beforeClose", "back"] });
    return { hosts, sent, options, message, hello };
}

describe("frame hosts", () => {
    it("answer a page's hello with what the client knows about the view", () => {
        const { sent, hello } = setup();
        hello();
        expect(sent[0]).toMatchObject({
            view: "v1",
            event: "frame.message",
            payload: {
                type: "frame.init",
                payload: {
                    nonce: "n1",
                    windowId: "v1",
                    container: "desktop-app",
                    theme: { mode: "dark", accent: "#112233" },
                    locale: "zh",
                },
            },
        });
        expect(sent[0].payload.payload.shellCapabilities).toContain("app.open");
        expect(sent[0].payload.payload.shellCapabilities).not.toContain("sysdlg/select");
    });

    it("pass an app's open request on and answer it", async () => {
        const { sent, options, message, hello } = setup();
        hello();
        message("app.open", { app: "files", path: "/a" }, { id: "r1" });
        await vi.waitFor(() => expect(sent.some((entry) => entry.payload.type === "app.openResult")).toBe(true));
        expect(options.onAppOpen).toHaveBeenCalledWith(view, expect.objectContaining({ app: "files", path: "/a" }));
    });

    it("say nothing to a page before its hello", () => {
        const { hosts, sent } = setup();
        hosts.lookChanged();
        expect(sent).toEqual([]);
    });

    it("tell running pages about a new theme", () => {
        const { hosts, sent, hello } = setup();
        hello();
        hosts.lookChanged();
        expect(sent.map((entry) => entry.payload.type)).toEqual(["frame.init", "frame.themeChanged", "frame.localeChanged"]);
        expect(sent[1].payload.payload).toEqual({ mode: "dark", accent: "#112233" });
    });

    it("let a view close that does not care, and ask one that does", async () => {
        const { hosts, sent, message, hello } = setup();
        expect(await hosts.mayClose("v1")).toBe(true);
        expect(await hosts.mayClose("nobody")).toBe(true);
        hello();
        const answer = hosts.mayClose("v1");
        const asked = sent.find((entry) => entry.payload.type === "frame.beforeClose")!;
        message("frame.beforeCloseResult", { decision: "deny" }, { replyTo: asked.payload.id });
        expect(await answer).toBe(false);
    });

    it("hand content to a running page and take its answer", async () => {
        const { hosts, sent, message, hello } = setup();
        const request = { requestId: "q", source: { kind: "cyfs-path" as const, path: "cyfs:///a.txt" } };
        expect(await hosts.sendOpen("v1", request)).toBe("refused");
        hello();
        const answer = hosts.sendOpen("v1", request);
        const asked = sent.find((entry) => entry.payload.type === "frame.open")!;
        message("frame.openResult", { accepted: true }, { replyTo: asked.payload.id });
        expect(await answer).toBe("accepted");
    });
});
