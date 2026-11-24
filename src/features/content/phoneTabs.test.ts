import { describe, expect, it } from "vitest";
import { appWindowId } from "buckyos/open-app";
import { tabOfView, tabViewId } from "./phoneTabs";

describe("the tabs of the phone that show a Zone page", () => {
    it("own the app's main window and nothing else", () => {
        expect(tabOfView(tabViewId("did:bns:a", "messagehub"))).toBe("messagehub");
        expect(tabOfView(tabViewId("did:bns:b", "homestation"))).toBe("homestation");
        expect(tabOfView(appWindowId("did:bns:a", "messagehub", "extra"))).toBeNull();
        expect(tabOfView(appWindowId("did:bns:a", "files", ""))).toBeNull();
        expect(tabOfView(appWindowId("did:bns:a", "messagehub@bob", ""))).toBeNull();
        expect(tabOfView("not an id")).toBeNull();
    });
});
