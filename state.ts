/*
 * Vencord, a Discord client mod
 * Copyright (c) 2026 Vendicated and contributors
 * SPDX-License-Identifier: GPL-3.0-or-later
 */

import { React } from "@webpack/common";

import { Edge } from "./tree";

export interface DropTarget {
    // null means an edge of the whole layout
    panel: string | null;
    edge: Edge;
    rect: DOMRect;
}

export interface DragState {
    panel: string;
    x: number;
    y: number;
    target: DropTarget | null;
}

interface LayoutState {
    editing: boolean;
    // how many docks are currently rendered for each panel
    mounted: Record<string, number>;
    drag: DragState | null;
    // set when our layout crashed, so Discord gets its own layout back until the next reload
    failed: boolean;
}

// Not panels, but pieces of the app layout we patch. The layout only turns on once they are all there
export const enum Anchor {
    Content = "$content",
    Sidebar = "$sidebar",
    Page = "$page"
}

let state: LayoutState = { editing: false, mounted: {}, drag: null, failed: false };
const listeners = new Set<() => void>();

const subscribe = (listener: () => void) => {
    listeners.add(listener);
    return () => void listeners.delete(listener);
};

function setState(partial: Partial<LayoutState>) {
    state = { ...state, ...partial };
    listeners.forEach(listener => listener());
}

export const getLayoutState = () => state;

export function useLayoutState<T>(selector: (state: LayoutState) => T): T {
    return React.useSyncExternalStore(subscribe, () => selector(state));
}

export const isMounted = (mounted: LayoutState["mounted"], id: string) => (mounted[id] ?? 0) > 0;

export function addMounted(id: string, delta: 1 | -1) {
    setState({ mounted: { ...state.mounted, [id]: (state.mounted[id] ?? 0) + delta } });
}

export function setEditing(editing: boolean) {
    setState({ editing, drag: null });
}

export const setDrag = (drag: DragState | null) => setState({ drag });

export const setFailed = () => setState({ failed: true, editing: false, drag: null });

export function resetLayoutState() {
    setState({ editing: false, drag: null, failed: false });
}
