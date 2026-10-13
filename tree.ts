/*
 * Vencord, a Discord client mod
 * Copyright (c) 2026 Vendicated and contributors
 * SPDX-License-Identifier: GPL-3.0-or-later
 */

export type Direction = "row" | "column";
export type Edge = "left" | "right" | "top" | "bottom";

// px: fixed size, fr: share of the remaining space, auto: as big as the content wants to be
export type Size = { px: number; } | { fr: number; } | "auto";

export interface PanelNode {
    type: "panel";
    id: string;
}

export interface SplitNode {
    type: "split";
    dir: Direction;
    children: LayoutNode[];
    sizes: Size[];
}

export type LayoutNode = PanelNode | SplitNode;

export const enum Panel {
    Guilds = "guilds",
    Channels = "channels",
    User = "user",
    Header = "header",
    Chat = "chat",
    Members = "members"
}

export const BUILT_IN_PANELS: readonly string[] = [Panel.Guilds, Panel.Channels, Panel.User, Panel.Header, Panel.Chat, Panel.Members];

const EXTRA_CHAT_PREFIX = "chat:";

export const extraChatPanelId = (channelId: string) => EXTRA_CHAT_PREFIX + channelId;
export const getExtraChatChannelId = (panelId: string) => panelId.startsWith(EXTRA_CHAT_PREFIX) ? panelId.slice(EXTRA_CHAT_PREFIX.length) : null;

export const isFr = (size: Size): size is { fr: number; } => typeof size === "object" && "fr" in size;
export const isPx = (size: Size): size is { px: number; } => typeof size === "object" && "px" in size;

const panel = (id: string): PanelNode => ({ type: "panel", id });
const split = (dir: Direction, children: LayoutNode[], sizes: Size[]): SplitNode => ({ type: "split", dir, children, sizes });

// Mirrors the stock Discord layout
export function makeDefaultLayout(): LayoutNode {
    return split("row", [
        split("column", [
            split("row", [panel(Panel.Guilds), panel(Panel.Channels)], ["auto", { fr: 1 }]),
            panel(Panel.User)
        ], [{ fr: 1 }, "auto"]),
        split("column", [
            panel(Panel.Header),
            split("row", [panel(Panel.Chat), panel(Panel.Members)], [{ fr: 1 }, "auto"])
        ], ["auto", { fr: 1 }])
    ], [{ px: 360 }, { fr: 1 }]);
}

function defaultSize(id: string, dir: Direction): Size {
    const isRow = dir === "row";

    switch (id) {
        case Panel.Guilds:
            return "auto";
        case Panel.Members:
            return isRow ? "auto" : { fr: 1 };
        case Panel.Channels:
            return isRow ? { px: 260 } : { fr: 1 };
        case Panel.User:
            return "auto";
        case Panel.Header:
            return isRow ? { fr: 1 } : "auto";
        default:
            return { fr: 1 };
    }
}

export function listPanels(node: LayoutNode, out: string[] = []): string[] {
    if (node.type === "panel") out.push(node.id);
    else node.children.forEach(child => listPanels(child, out));

    return out;
}

export const hasPanel = (node: LayoutNode, id: string) => listPanels(node).includes(id);

// A panel between left and right neighbours stands upright, one between top and bottom neighbours lies flat
export type Flow = "vertical" | "horizontal";

export function getPanelFlow(node: LayoutNode, id: string, flow: Flow = "vertical"): Flow | null {
    if (node.type === "panel") return node.id === id ? flow : null;

    const childFlow: Flow = node.dir === "row" ? "vertical" : "horizontal";
    for (const child of node.children) {
        const found = getPanelFlow(child, id, childFlow);
        if (found) return found;
    }

    return null;
}

// A split always needs something that takes up the remaining space
function withFlexibleChild(sizes: Size[]): Size[] {
    if (!sizes.length || sizes.some(isFr)) return sizes;

    return sizes.map((size, i) => i === sizes.length - 1 ? { fr: 1 } : size);
}

function normalize(node: LayoutNode): LayoutNode {
    if (node.type === "panel") return node;

    const children: LayoutNode[] = [];
    const sizes: Size[] = [];

    node.children.forEach((rawChild, i) => {
        const child = normalize(rawChild);
        const size = node.sizes[i] ?? { fr: 1 };

        // merge nested splits going the same way, as long as that does not change how the space is shared
        if (child.type === "split" && child.dir === node.dir && isFr(size)) {
            const total = child.sizes.reduce((sum, s) => sum + (isFr(s) ? s.fr : 0), 0) || 1;
            child.children.forEach((grandChild, j) => {
                const grandSize = child.sizes[j];
                children.push(grandChild);
                sizes.push(isFr(grandSize) ? { fr: size.fr * grandSize.fr / total } : grandSize);
            });
            return;
        }

        children.push(child);
        sizes.push(size);
    });

    if (children.length === 1) return children[0];

    return split(node.dir, children, withFlexibleChild(sizes));
}

function removeNode(node: LayoutNode, id: string): LayoutNode | null {
    if (node.type === "panel") return node.id === id ? null : node;

    const children: LayoutNode[] = [];
    const sizes: Size[] = [];

    node.children.forEach((child, i) => {
        const kept = removeNode(child, id);
        if (!kept) return;

        children.push(kept);
        sizes.push(node.sizes[i]);
    });

    if (!children.length) return null;

    return split(node.dir, children, sizes);
}

/** Returns null if this would leave the layout empty */
export function removePanel(root: LayoutNode, id: string): LayoutNode | null {
    const result = removeNode(root, id);
    return result && normalize(result);
}

const edgeDirection = (edge: Edge): Direction => edge === "left" || edge === "right" ? "row" : "column";
const isLeadingEdge = (edge: Edge) => edge === "left" || edge === "top";

function insertNode(node: LayoutNode, targetId: string, edge: Edge, id: string): LayoutNode {
    const dir = edgeDirection(edge);
    const ordered = (target: LayoutNode): LayoutNode[] => isLeadingEdge(edge) ? [panel(id), target] : [target, panel(id)];
    const orderedSizes = (targetSize: Size): Size[] => isLeadingEdge(edge) ? [defaultSize(id, dir), targetSize] : [targetSize, defaultSize(id, dir)];

    if (node.type === "panel") {
        if (node.id !== targetId) return node;
        return split(dir, ordered(node), orderedSizes({ fr: 1 }));
    }

    const children: LayoutNode[] = [];
    const sizes: Size[] = [];

    node.children.forEach((child, i) => {
        if (child.type === "panel" && child.id === targetId && node.dir === dir) {
            children.push(...ordered(child));
            sizes.push(...orderedSizes(node.sizes[i]));
            return;
        }

        children.push(insertNode(child, targetId, edge, id));
        sizes.push(node.sizes[i]);
    });

    return split(node.dir, children, sizes);
}

/** Puts a panel next to another one, removing it from wherever it was before */
export function insertPanel(root: LayoutNode, targetId: string, edge: Edge, id: string): LayoutNode {
    if (targetId === id) return root;

    const without = removePanel(root, id);
    if (!without || !hasPanel(without, targetId)) return root;

    return normalize(insertNode(without, targetId, edge, id));
}

/** Puts a panel along an edge of the whole layout, removing it from wherever it was before */
export function insertPanelAtRoot(root: LayoutNode, edge: Edge, id: string): LayoutNode {
    const without = removePanel(root, id);
    if (!without) return root;

    const dir = edgeDirection(edge);
    const size = defaultSize(id, dir);

    return normalize(isLeadingEdge(edge)
        ? split(dir, [panel(id), without], [size, { fr: 1 }])
        : split(dir, [without, panel(id)], [{ fr: 1 }, size])
    );
}

/** Replaces the sizes of the split found by following the child indexes in path */
export function setSplitSizes(root: LayoutNode, path: number[], sizes: Size[]): LayoutNode {
    if (root.type === "panel") return root;
    if (!path.length) return split(root.dir, root.children, withFlexibleChild(sizes));

    const [index, ...rest] = path;
    return split(
        root.dir,
        root.children.map((child, i) => i === index ? setSplitSizes(child, rest, sizes) : child),
        root.sizes
    );
}

function isValidSize(size: any): size is Size {
    if (size === "auto") return true;
    if (size == null || typeof size !== "object") return false;

    const value = size.px ?? size.fr;
    return typeof value === "number" && Number.isFinite(value) && value >= 0;
}

function isValidNode(node: any, seen: Set<string>): node is LayoutNode {
    if (node?.type === "panel") {
        if (typeof node.id !== "string" || seen.has(node.id)) return false;

        seen.add(node.id);
        return true;
    }

    return node?.type === "split"
        && (node.dir === "row" || node.dir === "column")
        && Array.isArray(node.children)
        && Array.isArray(node.sizes)
        && node.children.length > 0
        && node.children.length === node.sizes.length
        && node.sizes.every(isValidSize)
        && node.children.every((child: any) => isValidNode(child, seen));
}

export const isValidLayout = (node: unknown): node is LayoutNode => isValidNode(node, new Set());
