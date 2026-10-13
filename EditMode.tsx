/*
 * Vencord, a Discord client mod
 * Copyright (c) 2026 Vendicated and contributors
 * SPDX-License-Identifier: GPL-3.0-or-later
 */

import { ChannelStore, ContextMenuApi, GuildChannelStore, Menu, PrivateChannelSortStore, useRef } from "@webpack/common";
import type { CSSProperties, MouseEvent, PointerEvent, RefObject } from "react";

import { addPanel, closePanel, getChannelLabel, getPanelLabel, movePanel, openChatPanel } from "./actions";
import { cl, useLayout } from "./dock";
import { createProfile, deleteProfile, getProfiles, isAssignedTo, renameProfile, selectProfile, setGuildAssignment, setProfileRoot } from "./settings";
import { DropTarget, isMounted, setDrag, setEditing, useLayoutState } from "./state";
import { BUILT_IN_PANELS, Edge, extraChatPanelId, getExtraChatChannelId, makeDefaultLayout } from "./tree";

const DRAG_THRESHOLD = 6;
// how close to the border of the layout a panel has to be dropped to span that whole side
const ROOT_EDGE_SIZE = 24;
const MAX_MENU_CHANNELS = 30;

function findDropTarget(root: Element, panelId: string, x: number, y: number): DropTarget | null {
    const rootRect = root.getBoundingClientRect();

    if (x - rootRect.left < ROOT_EDGE_SIZE) return { panel: null, edge: "left", rect: rootRect };
    if (rootRect.right - x < ROOT_EDGE_SIZE) return { panel: null, edge: "right", rect: rootRect };
    if (y - rootRect.top < ROOT_EDGE_SIZE) return { panel: null, edge: "top", rect: rootRect };
    if (rootRect.bottom - y < ROOT_EDGE_SIZE) return { panel: null, edge: "bottom", rect: rootRect };

    for (const element of document.elementsFromPoint(x, y)) {
        const slot = element.closest<HTMLElement>("[data-vc-slot]");
        if (!slot || !root.contains(slot)) continue;

        const target = slot.dataset.vcSlot!;
        if (target === panelId) return null;

        const rect = slot.getBoundingClientRect();
        const distances: Array<[Edge, number]> = [
            ["left", (x - rect.left) / rect.width],
            ["right", (rect.right - x) / rect.width],
            ["top", (y - rect.top) / rect.height],
            ["bottom", (rect.bottom - y) / rect.height]
        ];
        const [edge] = distances.reduce((closest, entry) => entry[1] < closest[1] ? entry : closest);

        return { panel: target, edge, rect };
    }

    return null;
}

export function SlotOverlay({ id }: { id: string; }) {
    const layout = useLayout()!;
    const isDragged = useLayoutState(s => s.drag?.panel === id);
    const isRendered = useLayoutState(s => isMounted(s.mounted, id)) || getExtraChatChannelId(id) != null;
    const press = useRef<{ startX: number; startY: number; x: number; y: number; dragging: boolean; frame: number; } | null>(null);

    function onPointerDown(e: PointerEvent<HTMLDivElement>) {
        if (e.button !== 0) return;

        e.currentTarget.setPointerCapture(e.pointerId);
        press.current = { startX: e.clientX, startY: e.clientY, x: e.clientX, y: e.clientY, dragging: false, frame: 0 };
    }

    function onPointerMove(e: PointerEvent<HTMLDivElement>) {
        const state = press.current;
        if (!state) return;

        state.x = e.clientX;
        state.y = e.clientY;
        if (!state.dragging && Math.hypot(state.x - state.startX, state.y - state.startY) < DRAG_THRESHOLD) return;

        const root = e.currentTarget.closest("." + cl("root"));
        if (!root) return;

        state.dragging = true;
        // Finding what is under the pointer makes the browser measure the page, so do it once per frame and not once per mouse event
        state.frame ||= requestAnimationFrame(() => {
            state.frame = 0;
            if (press.current === state)
                setDrag({ panel: id, x: state.x, y: state.y, target: findDropTarget(root, id, state.x, state.y) });
        });
    }

    function onPointerUp(e: PointerEvent<HTMLDivElement>) {
        const state = press.current;
        press.current = null;
        if (!state) return;

        cancelAnimationFrame(state.frame);
        setDrag(null);

        const root = e.currentTarget.closest("." + cl("root"));
        const target = state.dragging && root ? findDropTarget(root, id, state.x, state.y) : null;
        if (target) movePanel(id, target);
    }

    return (
        <div
            className={cl("overlay", { "overlay-dragged": isDragged })}
            onPointerDown={onPointerDown}
            onPointerMove={onPointerMove}
            onPointerUp={onPointerUp}
            onPointerCancel={onPointerUp}
        >
            <span className={cl("overlay-label")}>{getPanelLabel(id)}</span>
            {!isRendered && <span className={cl("overlay-hint")}>Not shown on this page</span>}
            {layout.panels.size > 1 && (
                <button
                    className={cl("overlay-close")}
                    aria-label="Remove panel"
                    title="Remove panel"
                    onPointerDown={e => e.stopPropagation()}
                    onClick={() => closePanel(id)}
                >
                    ✕
                </button>
            )}
        </div>
    );
}

function indicatorStyle({ edge, rect, panel }: DropTarget, rootRect: DOMRect): CSSProperties {
    // a panel dropped on another one takes half of it, one dropped on the layout border takes a strip of that side
    const share = panel == null ? 0.2 : 0.5;
    const isHorizontal = edge === "left" || edge === "right";
    const width = isHorizontal ? rect.width * share : rect.width;
    const height = isHorizontal ? rect.height : rect.height * share;

    return {
        left: (edge === "right" ? rect.right - width : rect.left) - rootRect.left,
        top: (edge === "bottom" ? rect.bottom - height : rect.top) - rootRect.top,
        width,
        height
    };
}

export function DragIndicator({ rootRef }: { rootRef: RefObject<HTMLDivElement | null>; }) {
    const drag = useLayoutState(s => s.drag);
    const rootRect = rootRef.current?.getBoundingClientRect();
    if (!drag || !rootRect) return null;

    return (
        <>
            {drag.target && <div className={cl("drop-indicator")} style={indicatorStyle(drag.target, rootRect)} />}
            <div className={cl("drag-ghost")} style={{ transform: `translate(${drag.x - rootRect.left + 12}px, ${drag.y - rootRect.top + 12}px)` }}>
                {getPanelLabel(drag.panel)}
            </div>
        </>
    );
}

function AddPanelMenu({ guildId, panels }: { guildId: string | null; panels: Set<string>; }) {
    const missingPanels = BUILT_IN_PANELS.filter(id => !panels.has(id));
    const isAvailable = (channelId: string) => !panels.has(extraChatPanelId(channelId));

    const privateChannels = PrivateChannelSortStore.getPrivateChannelIds()
        .filter(isAvailable)
        .slice(0, MAX_MENU_CHANNELS)
        .map(id => ChannelStore.getChannel(id))
        .filter(Boolean);

    const guildChannels = guildId == null ? [] : GuildChannelStore.getSelectableChannels(guildId)
        .map(({ channel }) => channel)
        .filter(channel => isAvailable(channel.id))
        .slice(0, MAX_MENU_CHANNELS);

    return (
        <Menu.Menu navId="vc-customLayout-add-panel" onClose={ContextMenuApi.closeContextMenu} aria-label="Add panel">
            {missingPanels.length > 0 && (
                <Menu.MenuGroup>
                    {missingPanels.map(id => (
                        <Menu.MenuItem key={id} id={id} label={getPanelLabel(id)} action={() => addPanel(id)} />
                    ))}
                </Menu.MenuGroup>
            )}
            <Menu.MenuGroup>
                {privateChannels.length > 0 && (
                    <Menu.MenuItem id="direct-messages" label="Direct message">
                        {privateChannels.map(channel => (
                            <Menu.MenuItem key={channel.id} id={`dm-${channel.id}`} label={getChannelLabel(channel)} action={() => openChatPanel(channel.id)} />
                        ))}
                    </Menu.MenuItem>
                )}
                {guildChannels.length > 0 && (
                    <Menu.MenuItem id="server-channels" label="Channel in this server">
                        {guildChannels.map(channel => (
                            <Menu.MenuItem key={channel.id} id={`channel-${channel.id}`} label={getChannelLabel(channel)} action={() => openChatPanel(channel.id)} />
                        ))}
                    </Menu.MenuItem>
                )}
            </Menu.MenuGroup>
        </Menu.Menu>
    );
}

export function EditBar() {
    const { profile, guildId, panels } = useLayout()!;
    const profiles = getProfiles();

    const openAddPanelMenu = (e: MouseEvent) =>
        ContextMenuApi.openContextMenu(e, () => <AddPanelMenu guildId={guildId} panels={panels} />);

    return (
        // keep typing in the name field from triggering Discord's keybinds
        <div className={cl("bar")} onKeyDown={e => e.stopPropagation()}>
            <select
                className={cl("bar-select")}
                aria-label="Layout profile"
                value={profile.id}
                onChange={e => selectProfile(e.currentTarget.value, guildId)}
            >
                {profiles.map(p => <option key={p.id} value={p.id}>{p.name || "Unnamed"}</option>)}
            </select>
            <input
                className={cl("bar-input")}
                aria-label="Profile name"
                placeholder="Profile name"
                maxLength={32}
                value={profile.name}
                onChange={e => renameProfile(profile.id, e.currentTarget.value)}
            />
            <button className={cl("bar-button")} onClick={() => selectProfile(createProfile().id, guildId)}>New</button>
            <button className={cl("bar-button")} onClick={() => selectProfile(createProfile(profile).id, guildId)}>Duplicate</button>
            <button className={cl("bar-button")} disabled={profiles.length < 2} onClick={() => deleteProfile(profile.id)}>Delete</button>
            {guildId != null && (
                <label className={cl("bar-check")} title="This server always uses this profile, whichever one is selected elsewhere">
                    <input
                        type="checkbox"
                        checked={isAssignedTo(guildId, profile.id)}
                        onChange={e => setGuildAssignment(guildId, e.currentTarget.checked ? profile.id : null)}
                    />
                    Pin to this server
                </label>
            )}
            <span className={cl("bar-separator")} />
            <button className={cl("bar-button")} onClick={openAddPanelMenu}>Add panel</button>
            <button className={cl("bar-button")} onClick={() => setProfileRoot(profile.id, makeDefaultLayout())}>Reset</button>
            <button className={cl("bar-button", "bar-button-primary")} onClick={() => setEditing(false)}>Done</button>
            <span className={cl("bar-hint")}>Drag a panel onto the edge of another one to move it. Drag the space between panels to resize</span>
        </div>
    );
}
