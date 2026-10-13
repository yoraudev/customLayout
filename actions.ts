/*
 * Vencord, a Discord client mod
 * Copyright (c) 2026 Vendicated and contributors
 * SPDX-License-Identifier: GPL-3.0-or-later
 */

import { Channel } from "@vencord/discord-types";
import { ChannelStore, SelectedGuildStore, showToast, UserStore } from "@webpack/common";

import { getProfileFor, setProfileRoot, settings } from "./settings";
import { DropTarget, getLayoutState, setEditing } from "./state";
import { extraChatPanelId, getExtraChatChannelId, hasPanel, insertPanel, insertPanelAtRoot, LayoutNode, Panel, removePanel } from "./tree";

const PANEL_LABELS: Record<string, string> = {
    [Panel.Guilds]: "Server list",
    [Panel.Channels]: "Channel list",
    [Panel.User]: "User panel",
    [Panel.Header]: "Channel header",
    [Panel.Chat]: "Chat",
    [Panel.Members]: "Member list"
};

export function getChannelLabel(channel: Channel | undefined) {
    if (!channel) return "Unknown channel";

    if (channel.isDM()) {
        const user = UserStore.getUser(channel.recipients[0]);
        return user?.globalName ?? user?.username ?? "Direct Message";
    }

    if (channel.isGroupDM())
        return channel.name || channel.recipients.map(id => UserStore.getUser(id)?.username).filter(Boolean).join(", ") || "Group DM";

    return `#${channel.name}`;
}

export function getPanelLabel(panelId: string) {
    const channelId = getExtraChatChannelId(panelId);
    if (channelId != null) return getChannelLabel(ChannelStore.getChannel(channelId));

    return PANEL_LABELS[panelId] ?? panelId;
}

const getCurrentProfile = () => getProfileFor(SelectedGuildStore.getGuildId());

/** Changes the layout of the profile that is in use right now. Returning null from the callback leaves it as it is */
export function updateLayout(update: (root: LayoutNode) => LayoutNode | null) {
    const profile = getCurrentProfile();
    const root = update(profile.root);

    if (root) setProfileRoot(profile.id, root);
}

export function movePanel(panelId: string, target: DropTarget) {
    updateLayout(root => target.panel == null
        ? insertPanelAtRoot(root, target.edge, panelId)
        : insertPanel(root, target.panel, target.edge, panelId)
    );
}

export function addPanel(panelId: string) {
    updateLayout(root => hasPanel(root, panelId) ? null : insertPanelAtRoot(root, "right", panelId));
}

export function closePanel(panelId: string) {
    updateLayout(root => removePanel(root, panelId));
}

export function openChatPanel(channelId: string) {
    const panelId = extraChatPanelId(channelId);

    updateLayout(root => {
        if (hasPanel(root, panelId)) return null;

        return hasPanel(root, Panel.Chat)
            ? insertPanel(root, Panel.Chat, "right", panelId)
            : insertPanelAtRoot(root, "right", panelId);
    });

    if (SelectedGuildStore.getGuildId() == null)
        showToast("Added to your layout. It shows up once you open a server", "message");
}

export function toggleEditing() {
    const { editing } = getLayoutState();

    if (!editing && !settings.store.enabled)
        return showToast("The custom layout is turned off in the plugin settings", "failure");
    if (!editing && SelectedGuildStore.getGuildId() == null)
        return showToast("Open a server to edit your layout", "message");

    setEditing(!editing);
}
