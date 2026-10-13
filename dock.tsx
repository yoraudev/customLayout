/*
 * Vencord, a Discord client mod
 * Copyright (c) 2026 Vendicated and contributors
 * SPDX-License-Identifier: GPL-3.0-or-later
 */

import { classNameFactory } from "@utils/css";
import { makeLazy } from "@utils/lazy";
import { findCssClassesLazy } from "@webpack";
import { ChannelRTCStore, React, ReactDOM, SelectedGuildStore, useLayoutEffect, useMemo, useRef, useStateFromStores } from "@webpack/common";
import type { PropsWithChildren, ReactNode } from "react";

import { getProfileFor, Profile, settings } from "./settings";
import { addMounted, Anchor, isMounted, useLayoutState } from "./state";
import { getExtraChatChannelId, listPanels, Panel } from "./tree";

export const cl = classNameFactory("vc-customLayout-");

const ChatClasses = findCssClassesLazy("chat", "subtitleContainer", "chatContent");

export interface LayoutContextValue {
    // whether panels are currently pulled out of Discord's layout into ours
    active: boolean;
    guildId: string | null;
    profile: Profile;
    panels: Set<string>;
}

// React is not available yet when this file is evaluated
const getLayoutContext = makeLazy(() => React.createContext<LayoutContextValue | null>(null));

export const useLayout = () => React.useContext(getLayoutContext());

export function LayoutProvider({ children }: PropsWithChildren) {
    const guildId = useStateFromStores([SelectedGuildStore], () => SelectedGuildStore.getGuildId() ?? null);
    const isFullscreen = useStateFromStores([ChannelRTCStore], () => ChannelRTCStore.isFullscreenInContext());
    const { enabled, profiles, activeProfile, guildProfiles } = settings.use(["enabled", "profiles", "activeProfile", "guildProfiles"]);
    const isReady = useLayoutState(s => !s.failed && isMounted(s.mounted, Anchor.Content) && isMounted(s.mounted, Anchor.Page));

    const value = useMemo<LayoutContextValue>(() => {
        const profile = getProfileFor(guildId);

        return {
            active: enabled && isReady && guildId != null && !isFullscreen,
            guildId,
            profile,
            panels: new Set(listPanels(profile.root))
        };
    }, [guildId, isFullscreen, enabled, isReady, profiles, activeProfile, guildProfiles]);

    const Context = getLayoutContext();
    return <Context.Provider value={value}>{children}</Context.Provider>;
}

/** Tells the layout that a panel (or a patched piece of the app) is being rendered right now */
export function useMountedMarker(id: string) {
    useLayoutEffect(() => {
        addMounted(id, 1);
        return () => addMounted(id, -1);
    }, [id]);
}

// Every panel renders into one element that lives as long as the client does.
// Layout slots adopt that element, so rearranging the layout moves DOM nodes around instead of remounting Discord's components.
const panelElements = new Map<string, HTMLDivElement>();

export function getPanelElement(id: string) {
    let element = panelElements.get(id);
    if (!element) {
        element = document.createElement("div");
        element.className = cl("panel");
        element.dataset.vcPanel = getExtraChatChannelId(id) != null ? "extraChat" : id;
        // Discord and themes style the channel header as a child of the chat, so let its panel pass for one
        if (id === Panel.Header && ChatClasses.chat) element.classList.add(ChatClasses.chat);
        panelElements.set(id, element);
    }

    return element;
}

function moveInto(parent: HTMLElement, element: HTMLElement) {
    if (element.parentElement === parent) return;

    // moveBefore keeps scroll positions, focus and media alive, but only works between connected nodes
    try {
        if ("moveBefore" in parent && element.isConnected && parent.isConnected) {
            (parent as any).moveBefore(element, null);
            return;
        }
    } catch { }

    parent.appendChild(element);
}

let parkingLot: HTMLDivElement | null = null;

// Panels wait here while their slot is replaced by another one, so they never leave the document
function park(element: HTMLElement) {
    if (!parkingLot?.isConnected) {
        parkingLot = document.createElement("div");
        parkingLot.className = cl("parking");
        document.body.appendChild(parkingLot);
    }

    moveInto(parkingLot, element);
}

export function removeParkingLot() {
    parkingLot?.remove();
    parkingLot = null;
}

/** Shows the element of a panel inside the returned ref's element */
export function usePanelSlot(id: string) {
    const ref = useRef<HTMLDivElement>(null);

    useLayoutEffect(() => {
        const slot = ref.current;
        if (!slot) return;

        const element = getPanelElement(id);
        moveInto(slot, element);

        return () => {
            if (element.parentElement === slot) park(element);
        };
    }, [id]);

    return ref;
}

interface DockProps {
    panel: string;
    children: ReactNode;
}

/** Renders its children inside the layout if the panel is part of it, and right where they are otherwise */
export function Dock({ panel, children }: DockProps) {
    const layout = useLayout();
    useMountedMarker(panel);

    if (!layout?.active || !layout.panels.has(panel)) return children;

    return ReactDOM.createPortal(children, getPanelElement(panel));
}
