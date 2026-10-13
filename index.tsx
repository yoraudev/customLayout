/*
 * Vencord, a Discord client mod
 * Copyright (c) 2026 Vendicated and contributors
 * SPDX-License-Identifier: GPL-3.0-or-later
 */

import { NavContextMenuPatchCallback } from "@api/ContextMenu";
import ErrorBoundary from "@components/ErrorBoundary";
import { Logger } from "@utils/Logger";
import definePlugin from "@utils/types";
import { Channel, User } from "@vencord/discord-types";
import { ChannelActionCreators, ChannelStore, Menu, React } from "@webpack/common";
import type { ComponentType, HTMLAttributes, ReactElement, ReactNode } from "react";

import { openChatPanel, toggleEditing } from "./actions";
import { Dock, LayoutProvider, removeParkingLot, useLayout, useMountedMarker } from "./dock";
import { HorizontalMemberList } from "./HorizontalMemberList";
import { LayoutHost } from "./LayoutHost";
import { matchesKeybind, settings } from "./settings";
import { Anchor, getLayoutState, resetLayoutState, setEditing, setFailed } from "./state";
import managedStyle from "./styles.css?managed";
import { getPanelFlow, Panel } from "./tree";

const logger = new Logger("CustomLayout");

type DivProps = HTMLAttributes<HTMLDivElement>;

// Our replacements for some of Discord's layout divs. If one of them breaks, the plain div comes back
const wrapDiv = (Component: ComponentType<DivProps>) => ErrorBoundary.wrap(Component, {
    fallback: ({ wrappedProps }) => <div {...wrappedProps} />
});

function onHostError() {
    logger.error("The layout crashed, falling back to Discord's own layout");
    setFailed();
}

function Content({ children, ...props }: DivProps) {
    const layout = useLayout();
    useMountedMarker(Anchor.Content);

    return (
        <div {...props}>
            {children}
            {layout?.active && (
                <ErrorBoundary noop onError={onHostError}>
                    <LayoutHost />
                </ErrorBoundary>
            )}
        </div>
    );
}

const ContentRoot = wrapDiv(props => (
    <LayoutProvider>
        <Content {...props} />
    </LayoutProvider>
));

// The sidebar renders [server list, ...things other plugins added, <>channel list, resize handle, user panel</>]
function dockSidebarChildren(children: ReactNode) {
    if (!Array.isArray(children)) return children;

    const guilds: ReactNode[] = [];
    const rest = children.map((child: ReactElement<any> | null | false) => {
        if (!child) return null;
        if (child.type !== React.Fragment) {
            guilds.push(child);
            return null;
        }

        const inner = React.Children.toArray(child.props.children);
        if (inner.length < 2) return child;

        const channelList = inner.shift();
        const userPanel = inner.pop();

        return (
            <React.Fragment key="vc-customLayout-rest">
                <Dock panel={Panel.Channels}>{channelList}</Dock>
                {inner}
                <Dock panel={Panel.User}>{userPanel}</Dock>
            </React.Fragment>
        );
    });

    return [
        guilds.length > 0 && <Dock key="vc-customLayout-guilds" panel={Panel.Guilds}>{React.Children.toArray(guilds)}</Dock>,
        ...rest
    ];
}

const SidebarRoot = wrapDiv(({ children, style, ...props }) => {
    const layout = useLayout();
    useMountedMarker(Anchor.Sidebar);

    return (
        <div {...props} style={layout?.active ? { ...style, display: "none" } : style}>
            {dockSidebarChildren(children)}
        </div>
    );
});

const PageRoot = wrapDiv(({ style, ...props }) => {
    const layout = useLayout();
    useMountedMarker(Anchor.Page);

    // without a chat panel in the layout the page stays where it is, hidden but still running
    const isHidden = layout?.active && !layout.panels.has(Panel.Chat);

    return (
        <Dock panel={Panel.Chat}>
            <div {...props} style={isHidden ? { ...style, display: "none" } : style} />
        </Dock>
    );
});

// Discord keys the member list of a server channel like this. The thread member list also gets a guild
const isGuildMemberList = (node: ReactElement<any>) =>
    String(node.key).startsWith("channel-members-") && node.props?.channel != null && node.props.guild == null;

// Discord only builds its member list as one column. Lying flat, it is swapped for a version that fills the width
function ChannelSidebar({ node }: { node: ReactElement<any>; }) {
    const layout = useLayout();
    const isFlat = layout?.active
        && isGuildMemberList(node)
        && getPanelFlow(layout.profile.root, Panel.Members) === "horizontal";

    return (
        <Dock panel={Panel.Members}>
            {isFlat ? <HorizontalMemberList channel={node.props.channel} /> : node}
        </Dock>
    );
}

function dock(panel: string, node: ReactElement<any> | null) {
    if (!node) return node;

    return (
        <ErrorBoundary fallback={() => node}>
            {panel === Panel.Members ? <ChannelSidebar node={node} /> : <Dock panel={panel}>{node}</Dock>}
        </ErrorBoundary>
    );
}

const openInPanelItem = (action: () => void) => (
    <Menu.MenuItem
        id="vc-customLayout-open"
        label="Open in Layout Panel"
        action={action}
    />
);

const channelContextMenuPatch: NavContextMenuPatchCallback = (children, { channel }: { channel?: Channel; }) => {
    if (!channel || channel.isCategory?.() || channel.isGuildVocal?.()) return;

    children.push(openInPanelItem(() => openChatPanel(channel.id)));
};

const userContextMenuPatch: NavContextMenuPatchCallback = (children, { user }: { user?: User; }) => {
    if (!user) return;

    children.push(openInPanelItem(async () => {
        try {
            const channelId = ChannelStore.getDMFromUserId(user.id) ?? await ChannelActionCreators.getOrEnsurePrivateChannel(user.id);
            if (channelId) openChatPanel(channelId);
        } catch (e) {
            logger.error("Failed to open a DM with", user.id, e);
        }
    }));
};

const guildContextMenuPatch: NavContextMenuPatchCallback = children => {
    children.push(
        <Menu.MenuItem
            id="vc-customLayout-edit"
            label="Edit Layout"
            action={toggleEditing}
        />
    );
};

function onKeyDown(e: KeyboardEvent) {
    if (matchesKeybind(e)) {
        e.preventDefault();
        toggleEditing();
    } else if (e.key === "Escape" && getLayoutState().editing) {
        setEditing(false);
    }
}

export default definePlugin({
    name: "CustomLayout",
    description: "Rearrange, split and resize the parts of the Discord window while in a server, and add extra chats next to them",
    tags: ["Appearance", "Customisation"],
    authors: [{ name: "yoraudev", id: 0n }],
    settings,
    managedStyle,

    patches: [
        {
            // The app view: server list, channel list, user panel and the page
            find: "APPLICATION_LIBRARY,render:",
            replacement: [
                {
                    // the div holding the sidebar and the page, our layout is added to it
                    match: /(?<=\(0,\i\.jsxs\)\()"div"(?=,\{className:\i\.\i,children:\[\(0,\i\.jsx\)\(\i,\{\}\),\(0,\i\.jsx\)\(\i,\{isSidebarOpen:)/,
                    replace: "$self.ContentRoot"
                },
                {
                    match: /(?<=\(0,\i\.jsxs\)\()"div"(?=,\{ref:\i,"data-collapsed":\i,className:)/,
                    replace: "$self.SidebarRoot"
                },
                {
                    match: /(?<=\(0,\i\.jsx\)\()"div"(?=,\{className:\i\.\i,"data-collapsed":!1,children:)/,
                    replace: "$self.PageRoot"
                }
            ]
        },
        {
            // The channel view: header, chat and whatever is shown next to it (member list, search results, ...)
            find: "Missing channel in Channel.renderHeaderToolbar",
            replacement: [
                {
                    match: /(?<=\?null:)this\.renderHeaderBar\(\)(?=,this\.renderCall\(\))/,
                    replace: '$self.dock("header",$&)'
                },
                {
                    match: /(?<=this\.renderChat\(\),)this\.renderSidebar\(\)/,
                    replace: '$self.dock("members",$&)'
                }
            ]
        }
    ],

    contextMenus: {
        "channel-context": channelContextMenuPatch,
        "thread-context": channelContextMenuPatch,
        "gdm-context": channelContextMenuPatch,
        "user-context": userContextMenuPatch,
        "guild-context": guildContextMenuPatch
    },

    toolboxActions: {
        "Edit Layout": toggleEditing
    },

    ContentRoot,
    SidebarRoot,
    PageRoot,
    dock,

    start() {
        document.addEventListener("keydown", onKeyDown);
    },

    stop() {
        document.removeEventListener("keydown", onKeyDown);
        resetLayoutState();
        removeParkingLot();
    }
});
