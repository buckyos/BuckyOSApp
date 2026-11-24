import React from "react";
import { AppWindow, Ban, Bot, Check, CircleCheck, CircleX, ListTodo, Loader, CirclePause, Users, X } from "lucide-react";
import {
    badgeLabel,
    isTaskFinished,
    messagePreview,
    notifyCategoryLabel,
    taskStateLabel,
    type ActivityEntry,
    type ActivityLabel,
    type ActivityTaskState,
} from "@buckyos-desktop/activity/model.ts";
import { Avatar } from "../../components/ui/Avatar";
import { IconButton } from "../../components/ui/Button";
import { Dot, StateText, type Tone } from "../../components/ui/States";
import { useI18n } from "../../i18n";
import { useZoneImage } from "../zone/images";
import type { ZoneView } from "../zone/types";
import { isUnread, labelKey, rowActions, rowTime, type RowAction } from "./view";
import "./activity.css";

const TASK_TONES: Record<ActivityTaskState, Tone> = {
    running: "busy",
    waiting: "warn",
    paused: "warn",
    completed: "ok",
    failed: "bad",
    canceled: "idle",
};

const TASK_ICONS = {
    running: Loader,
    waiting: CirclePause,
    paused: CirclePause,
    completed: CircleCheck,
    failed: CircleX,
    canceled: Ban,
} as const;

const CATEGORY_ICONS = { todo: ListTodo, agent: Bot, app: AppWindow } as const;

function useLabel() {
    const { t } = useI18n();
    return (label: ActivityLabel | string) => (typeof label === "string" ? label : t(labelKey(label), label.values));
}

const MessageAvatar: React.FC<{ zone: ZoneView; entry: Extract<ActivityEntry, { kind: "message" }> }> = ({ zone, entry }) => {
    const image = useZoneImage(zone.did, zone.host, entry.item.avatar);
    if (entry.item.isGroup && !image) {
        return (
            <span className="activity-icon">
                <Users size={17} strokeWidth={1.8} />
            </span>
        );
    }
    return <Avatar src={image} name={entry.item.title} id={entry.item.entityId} size={34} />;
};

interface ActivityRowProps {
    zone: ZoneView;
    entry: ActivityEntry;
    now: number;
    onOpen: () => void;
    onAction: (action: RowAction) => void;
}

export const ActivityRow: React.FC<ActivityRowProps> = ({ zone, entry, now, onOpen, onAction }) => {
    const { t, locale } = useI18n();
    const label = useLabel();
    const unread = isUnread(entry);
    const actions = rowActions(entry);

    const icon = (() => {
        if (entry.kind === "message") return <MessageAvatar zone={zone} entry={entry} />;
        const Icon = entry.kind === "notify" ? CATEGORY_ICONS[entry.item.category] ?? AppWindow : TASK_ICONS[entry.item.state];
        return (
            <span className="activity-icon">
                <Icon size={17} strokeWidth={1.8} aria-hidden="true" />
            </span>
        );
    })();

    const text = (() => {
        if (entry.kind === "message") {
            const preview = messagePreview(entry.item);
            return preview.sender ? `${preview.sender}: ${label(preview.text)}` : label(preview.text);
        }
        return entry.kind === "notify" ? entry.item.message : undefined;
    })();

    return (
        <div className="activity-row" data-unread={unread || undefined} data-actions={actions.length > 0 || undefined} data-kind={entry.kind} data-testid="activity-row">
            <button type="button" className="activity-open" onClick={onOpen}>
                {icon}
                <span className="activity-text">
                    <span className="activity-title">
                        <span>{entry.item.title}</span>
                        {entry.kind === "message" && entry.item.unreadCount > 0 ? (
                            <span className="ui-badge">{badgeLabel(entry.item.unreadCount)}</span>
                        ) : unread ? (
                            <Dot color="var(--zone-mark)" label={t("activity.unread")} />
                        ) : null}
                    </span>
                    {text ? <span className="activity-message">{text}</span> : null}
                    {entry.kind === "task" ? (
                        <>
                            <StateText tone={TASK_TONES[entry.item.state]}>{label(taskStateLabel(entry.item))}</StateText>
                            {!isTaskFinished(entry.item.state) && entry.item.progress !== null ? (
                                <span
                                    className="ui-meter"
                                    role="progressbar"
                                    aria-label={entry.item.title}
                                    aria-valuemin={0}
                                    aria-valuemax={100}
                                    aria-valuenow={entry.item.progress}
                                >
                                    <span style={{ width: `${entry.item.progress}%`, "--ui-meter": "var(--cp-accent)" } as React.CSSProperties} />
                                </span>
                            ) : null}
                        </>
                    ) : null}
                    {entry.kind === "notify" ? (
                        <span className="activity-meta">
                            <span>{label(notifyCategoryLabel(entry.item.category))}</span>
                            {entry.item.needsAnswer ? <StateText tone="warn">{t("activity.needs_answer")}</StateText> : null}
                            {entry.item.status === "open" && entry.item.level === "urgent" ? <StateText tone="bad">{t("activity.urgent")}</StateText> : null}
                        </span>
                    ) : null}
                </span>
                <span className="activity-time">{rowTime(entry.timestamp, now, locale)}</span>
            </button>
            {actions.length > 0 ? (
                <span className="activity-actions">
                    {actions.map((action) => (
                        <IconButton key={action} label={t(action === "read" ? "activity.mark_read" : "activity.dismiss")} onClick={() => onAction(action)}>
                            {action === "read" ? <Check size={15} /> : <X size={15} />}
                        </IconButton>
                    ))}
                </span>
            ) : null}
        </div>
    );
};
