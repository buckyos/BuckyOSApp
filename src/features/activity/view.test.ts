import { describe, expect, it } from "vitest";
import type { ActivityEntry } from "@buckyos-desktop/activity/model.ts";
import { canMarkAll, changedSources, dayTitle, groupByDay, isUnread, labelKey, rowActions, rowTime } from "./view";

const at = (day: number, hour = 12, minute = 0) => new Date(2026, 10, day, hour, minute).getTime();
const now = at(23, 15);

const message = (timestamp: number, unreadCount = 1): ActivityEntry => ({
    kind: "message",
    key: `message-${timestamp}`,
    timestamp,
    item: { sessionId: "s", entityId: "e", title: "Bob", isGroup: false, text: "hi", unreadCount, timestamp },
});
const notify = (timestamp: number, kind: "notice" | "input", status: "open" | "read" = "open"): ActivityEntry => ({
    kind: "notify",
    key: `notify-${timestamp}`,
    timestamp,
    item: { notifyId: "n", title: "Backup", category: "app", kind, level: "normal", status, needsAnswer: kind === "input" && status === "open", timestamp },
});
const task = (timestamp: number, state: "running" | "completed"): ActivityEntry => ({
    kind: "task",
    key: `task-${timestamp}`,
    timestamp,
    item: { taskId: "t", title: "Upload", state, progress: null, timestamp },
});

describe("the Activity page", () => {
    it("puts rows under their days", () => {
        const days = groupByDay([message(at(23, 9)), task(at(23, 1), "running"), notify(at(22, 23), "notice"), message(at(10))], now);
        expect(days.map((day) => [day.ago, day.entries.length])).toEqual([
            [0, 2],
            [1, 1],
            [13, 1],
        ]);
        expect(dayTitle(days[0], "en")).toBe("Today");
        expect(dayTitle(days[1], "en")).toBe("Yesterday");
        expect(dayTitle(days[2], "en")).toContain("Nov");
        expect(groupByDay([], now)).toEqual([]);
    });

    it("says how long ago, then when", () => {
        expect(rowTime(now - 30_000, now, "en")).toBe("now");
        expect(rowTime(now - 5 * 60_000, now, "en")).toBe("5m ago");
        expect(rowTime(at(23, 9, 5), now, "en")).toMatch(/9:05/);
    });

    it("offers what can be done with a row", () => {
        expect(rowActions(message(now))).toEqual(["read"]);
        expect(rowActions(notify(now, "notice"))).toEqual(["read"]);
        expect(rowActions(notify(now, "input"))).toEqual(["dismiss"]);
        expect(rowActions(notify(now, "notice", "read"))).toEqual([]);
        expect(rowActions(task(now, "running"))).toEqual([]);
        expect(rowActions(task(now, "completed"))).toEqual(["dismiss"]);
        expect(isUnread(notify(now, "input"))).toBe(true);
        expect(isUnread(task(now, "completed"))).toBe(false);
    });

    it("only offers to mark all when something would change", () => {
        expect(canMarkAll([notify(now, "input"), task(now, "running")])).toBe(false);
        expect(canMarkAll([notify(now, "input"), notify(now, "notice")])).toBe(true);
        expect(canMarkAll([task(now, "completed")])).toBe(true);
    });

    it("maps the shared labels to this client's keys", () => {
        expect(labelKey({ key: "tray.notify.todo", text: "" })).toBe("activity.label.notify_todo");
        expect(labelKey({ key: "tray.task.failedWith", text: "" })).toBe("activity.label.task_failed_with");
        expect(labelKey({ key: "tray.messages.noPreview", text: "" })).toBe("activity.label.messages_no_preview");
    });

    it("reads again what an event is about", () => {
        expect(changedSources("message")).toEqual(["message", "notify"]);
        expect(changedSources("task")).toEqual(["task"]);
        expect(changedSources("all")).toBeNull();
    });
});
