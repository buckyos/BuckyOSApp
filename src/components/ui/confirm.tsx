import React from "react";
import { useI18n } from "../../i18n";
import ConfirmDialog from "./ConfirmDialog";

export interface Question {
    title: string;
    message?: string;
    confirmText: string;
    danger?: boolean;
}

interface Asked extends Question {
    id: number;
    answer: (yes: boolean) => void;
}

let current: Asked | null = null;
let counter = 0;
const listeners = new Set<() => void>();

function put(next: Asked | null) {
    current = next;
    listeners.forEach((listener) => listener());
}

/** Asks in a dialog from code that is not a component. A newer question answers the older one with no. */
export function askConfirm(question: Question): Promise<boolean> {
    current?.answer(false);
    return new Promise((resolve) => {
        const id = ++counter;
        put({
            ...question,
            id,
            answer: (yes) => {
                if (current?.id === id) put(null);
                resolve(yes);
            },
        });
    });
}

export const ConfirmHost: React.FC = () => {
    const { t } = useI18n();
    const asked = React.useSyncExternalStore(
        (listener) => {
            listeners.add(listener);
            return () => {
                listeners.delete(listener);
            };
        },
        () => current
    );
    if (!asked) return null;
    return (
        <ConfirmDialog
            key={asked.id}
            open
            title={asked.title}
            message={asked.message}
            confirmText={asked.confirmText}
            cancelText={t("common.actions.cancel")}
            confirmVariant={asked.danger ? "danger" : "primary"}
            onConfirm={() => asked.answer(true)}
            onCancel={() => asked.answer(false)}
        />
    );
};
