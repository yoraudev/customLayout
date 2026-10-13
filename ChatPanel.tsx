/*
 * Vencord, a Discord client mod
 * Copyright (c) 2026 Vendicated and contributors
 * SPDX-License-Identifier: GPL-3.0-or-later
 */

import ErrorBoundary from "@components/ErrorBoundary";
import { findByPropsLazy, findComponentByCodeLazy } from "@webpack";
import { ChannelStore, GuildStore, MessageActions, useEffect, UserStore, useStateFromStores } from "@webpack/common";

import { getChannelLabel } from "./actions";
import { cl } from "./dock";

// The chat Discord itself puts into the thread sidebar: messages plus the message box of any channel
const Chat = findComponentByCodeLazy("filterAfterTimestamp:", "chatInputType");
const ChatInputTypes = findByPropsLazy("FORM", "USER_PROFILE");

interface ChatPanelProps {
    channelId: string;
    onClose(): void;
}

export const ChatPanel = ErrorBoundary.wrap(({ channelId, onClose }: ChatPanelProps) => {
    const channel = useStateFromStores([ChannelStore], () => ChannelStore.getChannel(channelId));
    const guild = useStateFromStores([GuildStore], () => GuildStore.getGuild(channel?.guild_id));
    const label = useStateFromStores([ChannelStore, UserStore], () => getChannelLabel(ChannelStore.getChannel(channelId)));
    const hasChannel = channel != null;

    useEffect(() => {
        // only the selected channel gets its messages loaded by Discord
        if (hasChannel) MessageActions.fetchMessages({ channelId, limit: 50 });
    }, [channelId, hasChannel]);

    return (
        <div className={cl("chat")}>
            <div className={cl("chat-header")}>
                <span className={cl("chat-title")}>{label}</span>
                <button className={cl("chat-close")} aria-label="Close panel" title="Close panel" onClick={onClose}>✕</button>
            </div>
            {hasChannel
                ? <Chat channel={channel} guild={guild} chatInputType={ChatInputTypes.SIDEBAR} />
                : <div className={cl("chat-empty")}>This chat is not available right now</div>
            }
        </div>
    );
}, { noop: true });
