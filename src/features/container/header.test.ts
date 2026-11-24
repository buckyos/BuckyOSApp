import { describe, expect, it } from "vitest";
import { headerModel, menuImage } from "./header";

const view = { title: "Files", app: "files" };

describe("the system header", () => {
    it("has a title and a back button for an app that says nothing", () => {
        expect(headerModel({}, view, undefined)).toEqual({ style: "standard", title: "Files", back: true, search: null, menu: [], secondRow: [] });
        expect(headerModel({}, { title: "", app: "files" }, undefined).title).toBe("files");
    });

    it("takes what the app declares", () => {
        const model = headerModel(
            {
                title: "Photos",
                back: false,
                search: { placeholder: "Search photos" },
                menu: [{ id: "new", label: "New album" }],
                second_row: [{ id: "all", label: "All", active: true }, { id: "fav", label: "Favourites" }],
            },
            view,
            { mobile_header: "standard" }
        );
        expect(model).toMatchObject({ title: "Photos", back: false, search: { placeholder: "Search photos", value: "" } });
        expect(model.menu.map((item) => item.id)).toEqual(["new"]);
        expect(model.secondRow).toEqual([
            { id: "all", label: "All", active: true },
            { id: "fav", label: "Favourites", active: false },
        ]);
    });

    it("has no second row in the see-through style, and no search once it is taken back", () => {
        const model = headerModel({ search: null, second_row: [{ id: "a", label: "A" }] }, view, { mobile_header: "compact" });
        expect(model.style).toBe("compact");
        expect(model.secondRow).toEqual([]);
        expect(model.search).toBeNull();
    });

    it("loads only pictures that came with the message", () => {
        expect(menuImage("data:image/svg+xml;base64,AA")).toBe("data:image/svg+xml;base64,AA");
        expect(menuImage("https://a.example/x.png")).toBeNull();
        expect(menuImage("trash")).toBeNull();
        expect(menuImage(undefined)).toBeNull();
    });
});
