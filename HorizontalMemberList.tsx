/*
 * Vencord, a Discord client mod
 * Copyright (c) 2026 Vendicated and contributors
 * SPDX-License-Identifier: GPL-3.0-or-later
 */

import ErrorBoundary from "@components/ErrorBoundary";
import { openUserProfile } from "@utils/discord";
import { classes } from "@utils/misc";
import { LazyComponent } from "@utils/react";
import { Channel, User } from "@vencord/discord-types";
import { findCssClassesLazy } from "@webpack";
import { Avatar, ChannelMemberStore, FluxDispatcher, React, useCallback, useEffect, useLayoutEffect, useRef, useState, useStateFromStores } from "@webpack/common";
import type { CSSProperties, ReactNode } from "react";

import { cl } from "./dock";

// Themes style the member list through Discord's own class, so our version of it wears that class too
const MemberListClasses = findCssClassesLazy("membersWrap", "members", "container", "hiddenMembers");

const ROW_HEIGHT = 44;
const HEADER_HEIGHT = 40;
const COLUMN_WIDTH = 240;
// Discord hands out members in chunks of this size, and only the chunks that were asked for
const CHUNK_SIZE = 100;
// rows kept rendered above and below the visible ones
const OVERSCAN = 3;

// A role, or one of the online / offline groups. Its members are the rows right after rows[index]
interface Group {
    id: string;
    title: string;
    count: number;
    index: number;
}

interface MemberRow {
    type: "MEMBER";
    user: User;
    nick?: string | null;
    colorString?: string | null;
    // set for roles with a gradient, the secondary and tertiary colors are optional
    colorStrings?: Partial<Record<"primaryColor" | "secondaryColor" | "tertiaryColor", string | null>> | null;
    status?: string;
    isMobileOnline?: boolean;
}

type Row = MemberRow | { type: string; } | undefined;

function requestMembers(channel: Channel, chunks: number[]) {
    FluxDispatcher.dispatch({
        type: "GUILD_SUBSCRIPTIONS_CHANNEL",
        guildId: channel.guild_id,
        channelId: channel.id,
        ranges: chunks.map(chunk => [chunk * CHUNK_SIZE, (chunk + 1) * CHUNK_SIZE - 1])
    });
}

// Same colors as Discord's own list: a plain role color, or the role's gradient running through the name
function getNameStyle({ colorString, colorStrings }: MemberRow): CSSProperties {
    const { primaryColor, secondaryColor, tertiaryColor } = colorStrings ?? {};
    if (!primaryColor || !secondaryColor) return { color: colorString ?? undefined };

    const colors = [primaryColor, secondaryColor, tertiaryColor, primaryColor].filter(Boolean);
    return { backgroundImage: `linear-gradient(to right, ${colors.join(", ")})` };
}

// Memoised, because the list renders again on every presence update anywhere in the server and with every scrolled row
const Member = LazyComponent(() => React.memo(function Member({ row, guildId, top }: { row: MemberRow; guildId: string; top: number; }) {
    const { user } = row;
    const nameStyle = getNameStyle(row);

    return (
        <div
            className={cl("member")}
            style={{ top }}
            role="button"
            tabIndex={0}
            onClick={() => openUserProfile(user.id)}
            onKeyDown={e => e.key === "Enter" && openUserProfile(user.id)}
        >
            <Avatar
                src={user.getAvatarURL(guildId, 32)}
                size="SIZE_32"
                status={row.status}
                isMobile={row.isMobileOnline}
                aria-label={user.username}
            />
            <span className={cl("member-name", { "member-name-gradient": nameStyle.backgroundImage != null })} style={nameStyle}>
                {row.nick ?? user.globalName ?? user.username}
            </span>
        </div>
    );
}));

interface GroupColumnProps {
    // the group itself is taken apart, so a column only renders again when something about it really changed
    id: string;
    title: string;
    count: number;
    index: number;
    rows: Row[];
    // the rows change in place, this is what tells a column to look at them again
    version: number;
    guildId: string;
    // which members of the group are in view
    first: number;
    last: number;
    onScroll(groupId: string, firstVisibleRow: number): void;
}

const GroupColumn = LazyComponent(() => React.memo(function GroupColumn({ id, title, count, index, rows, guildId, first, last, onScroll }: GroupColumnProps) {
    const members: ReactNode[] = [];

    for (let i = first; i <= last; i++) {
        const row = rows[index + 1 + i];
        const top = i * ROW_HEIGHT;

        members.push(row?.type === "MEMBER" && "user" in row
            ? <Member key={i} row={row} guildId={guildId} top={top} />
            // not loaded yet
            : <div key={i} className={cl("member-placeholder")} style={{ top }} />
        );
    }

    return (
        <div className={cl("member-column")}>
            <div className={cl("member-group")}>{title} — {count}</div>
            <div className={cl("member-list")} onScroll={e => onScroll(id, Math.floor(e.currentTarget.scrollTop / ROW_HEIGHT))}>
                <div className={cl("member-rows")} style={{ height: count * ROW_HEIGHT }}>
                    {members}
                </div>
            </div>
        </div>
    );
}));

/**
 * The member list for wide, short spaces. Every role is a column, ordered left to right like Discord orders them
 * top to bottom, and every column scrolls through its own members
 */
export const HorizontalMemberList = ErrorBoundary.wrap(({ channel }: { channel: Channel; }) => {
    const scroller = useRef<HTMLDivElement>(null);
    const [viewport, setViewport] = useState({ width: 0, height: 0, scrollLeft: 0 });
    // the first row in view of every column that has been scrolled
    const [topRows, setTopRows] = useState<Record<string, number>>({});

    // Scrolling fires far more often than a new row comes into view, and only that needs a render
    const onColumnScroll = useCallback((groupId: string, firstVisibleRow: number) => {
        setTopRows(rows => (rows[groupId] ?? 0) === firstVisibleRow ? rows : { ...rows, [groupId]: firstVisibleRow });
    }, []);

    // the store keeps handing out the same arrays and bumps the version when they change
    const version = useStateFromStores([ChannelMemberStore], () => ChannelMemberStore.getProps(channel.guild_id, channel.id).version);
    const props = ChannelMemberStore.getProps(channel.guild_id, channel.id);
    const rows = props.rows as Row[];
    const groups = (props.groups as unknown as Group[]).filter(group => group.index != null && group.count > 0);

    useLayoutEffect(() => {
        const element = scroller.current;
        if (!element) return;

        const measure = () => setViewport({ width: element.clientWidth, height: element.clientHeight, scrollLeft: element.scrollLeft });
        const observer = new ResizeObserver(measure);

        measure();
        observer.observe(element);
        return () => observer.disconnect();
    }, []);

    const visibleRows = Math.ceil(Math.max(0, viewport.height - HEADER_HEIGHT) / ROW_HEIGHT);
    const chunks = new Set([0]);

    const columns = groups.map((group, column) => {
        const top = topRows[group.id] ?? 0;
        const first = Math.max(0, top - OVERSCAN);
        const last = Math.min(group.count - 1, top + visibleRows + OVERSCAN);

        // only columns that are on screen get to ask Discord for their members
        const left = column * COLUMN_WIDTH - viewport.scrollLeft;
        if (left < viewport.width && left + COLUMN_WIDTH > 0) {
            const firstChunk = Math.floor((group.index + first) / CHUNK_SIZE);
            const lastChunk = Math.floor((group.index + 1 + last) / CHUNK_SIZE);

            for (let chunk = firstChunk; chunk <= lastChunk; chunk++) chunks.add(chunk);
        }

        return (
            <GroupColumn
                key={group.id}
                id={group.id}
                title={group.title}
                count={group.count}
                index={group.index}
                rows={rows}
                version={version}
                guildId={channel.guild_id}
                first={first}
                last={last}
                onScroll={onColumnScroll}
            />
        );
    });

    const chunkKey = [...chunks].sort((a, b) => a - b).join(",");

    useEffect(() => {
        // nothing is measured yet on the first render
        if (viewport.height > 0) requestMembers(channel, chunkKey.split(",").map(Number));
    }, [channel.id, chunkKey, viewport.height > 0]);

    return (
        <div className={classes(MemberListClasses.container, cl("members"))}>
            <div
                ref={scroller}
                className={cl("members-scroller")}
                onScroll={e => {
                    // scroll events of the columns bubble up to here as well
                    if (e.target !== e.currentTarget) return;

                    const { scrollLeft } = e.currentTarget;
                    setViewport(v => ({ ...v, scrollLeft }));
                }}
                // The wheel scrolls the column under the mouse. Over a column with nothing to scroll, it moves through the roles instead
                onWheel={e => {
                    const list = (e.target as HTMLElement).closest<HTMLElement>("." + cl("member-list"));
                    if (!e.shiftKey && (!list || list.scrollHeight <= list.clientHeight))
                        e.currentTarget.scrollLeft += e.deltaY;
                }}
            >
                {columns}
            </div>
        </div>
    );
}, { noop: true });
