/*
 * Vencord, a Discord client mod
 * Copyright (c) 2026 Vendicated and contributors
 * SPDX-License-Identifier: GPL-3.0-or-later
 */

import { ReactDOM, useEffect, useRef, useState } from "@webpack/common";
import type { CSSProperties, PointerEvent, ReactNode, RefObject } from "react";

import { closePanel, updateLayout } from "./actions";
import { ChatPanel } from "./ChatPanel";
import { cl, getPanelElement, useLayout, usePanelSlot } from "./dock";
import { DragIndicator, EditBar, SlotOverlay } from "./EditMode";
import { Anchor, isMounted, useLayoutState } from "./state";
import { Flow, getExtraChatChannelId, isFr, isPx, LayoutNode, Panel, setSplitSizes, Size, SplitNode } from "./tree";

const MIN_CELL_SIZE = 48;

function cellStyle(size: Size): CSSProperties {
    if (size === "auto") return { flex: "0 1 auto" };
    if (isPx(size)) return { flex: `0 1 ${size.px}px` };

    return { flex: `${size.fr} 1 0px` };
}

// Sideways lists do not scroll with a normal mouse wheel, so turn vertical wheel movement into horizontal scrolling
function useHorizontalWheel(ref: RefObject<HTMLDivElement | null>, enabled: boolean) {
    useEffect(() => {
        const slot = ref.current;
        if (!slot || !enabled) return;

        const onWheel = (e: WheelEvent) => {
            if (e.deltaY === 0 || e.shiftKey) return;

            for (let element = e.target as HTMLElement | null; element && element !== slot; element = element.parentElement) {
                if (element.scrollWidth <= element.clientWidth) continue;

                const { overflowX } = getComputedStyle(element);
                if (overflowX !== "auto" && overflowX !== "scroll") continue;

                element.scrollLeft += e.deltaY;
                e.preventDefault();
                return;
            }
        };

        slot.addEventListener("wheel", onWheel, { passive: false });
        return () => slot.removeEventListener("wheel", onWheel);
    }, [enabled]);
}

interface PlacementProps {
    flow: Flow;
    // whether the space this gets is decided by the layout alone, and not by what is inside of it
    fixedSize: boolean;
}

function PanelSlot({ id, flow, fixedSize }: PlacementProps & { id: string; }) {
    const ref = usePanelSlot(id);
    const editing = useLayoutState(s => s.editing);
    useHorizontalWheel(ref, flow === "horizontal" && id === Panel.Guilds);

    return (
        <div className={cl("slot", { "slot-fixedSize": fixedSize })} data-vc-slot={id} data-vc-flow={flow}>
            <div className={cl("slot-content")} ref={ref} />
            {editing && <SlotOverlay id={id} />}
        </div>
    );
}

interface ResizeState {
    before: number;
    after: number;
    start: number;
    // size of every visible child along the split, null for hidden ones
    measured: Array<number | null>;
    // where the pointer is now, and the frame that is going to apply it
    position: number;
    frame: number;
    moved: boolean;
}

function Split({ node, path, fixedSize }: { node: SplitNode; path: number[]; fixedSize: boolean; }) {
    const editing = useLayoutState(s => s.editing);
    const mounted = useLayoutState(s => s.mounted);
    // sizes while a divider is being dragged, they are only saved once it is released
    const [liveSizes, setLiveSizes] = useState<Size[] | null>(null);
    const cells = useRef<Array<HTMLDivElement | null>>([]);
    const resize = useRef<ResizeState | null>(null);

    const isRow = node.dir === "row";
    const sizes = liveSizes?.length === node.children.length ? liveSizes : node.sizes;

    // Panels Discord is not rendering right now (like the member list while it is toggled off) give their space away
    const isVisible = (child: LayoutNode): boolean => child.type === "panel"
        ? editing || getExtraChatChannelId(child.id) != null || isMounted(mounted, child.id)
        : child.children.some(isVisible);
    const visible = node.children.map(isVisible);

    function resizedSizes({ before, after, start, measured }: ResizeState, position: number) {
        const delta = Math.max(
            Math.min(0, MIN_CELL_SIZE - measured[before]!),
            Math.min(position - start, Math.max(0, measured[after]! - MIN_CELL_SIZE))
        );

        // Flexible children are stored as their current pixel size, so they keep their proportions.
        // Hidden ones cannot be measured, so their share is converted with the same ratio
        let frTotal = 0, frPixels = 0;
        node.sizes.forEach((size, i) => {
            if (!isFr(size) || measured[i] == null) return;
            frTotal += size.fr;
            frPixels += measured[i]!;
        });
        const pixelsPerFr = frTotal > 0 ? frPixels / frTotal : 1;

        return node.sizes.map((size, i): Size => {
            let pixels = measured[i];
            if (i === before) pixels! += delta;
            if (i === after) pixels! -= delta;

            if (isFr(size)) return { fr: Math.max(1, Math.round(pixels ?? size.fr * pixelsPerFr)) };
            if (i === before || i === after) return { px: Math.round(pixels!) };
            return size;
        });
    }

    function onPointerDown(e: PointerEvent<HTMLDivElement>, before: number, after: number) {
        if (e.button !== 0) return;

        e.preventDefault();
        e.currentTarget.setPointerCapture(e.pointerId);

        resize.current = {
            before,
            after,
            start: isRow ? e.clientX : e.clientY,
            measured: node.children.map((_, i) => {
                const cell = cells.current[i];
                if (!cell || !visible[i]) return null;

                const rect = cell.getBoundingClientRect();
                return isRow ? rect.width : rect.height;
            }),
            position: 0,
            frame: 0,
            moved: false
        };
    }

    function onPointerMove(e: PointerEvent<HTMLDivElement>) {
        const state = resize.current;
        if (!state) return;

        state.position = isRow ? e.clientX : e.clientY;
        state.moved = true;

        // Every new size makes all of Discord lay itself out again, so do that once per frame and not once per mouse event
        state.frame ||= requestAnimationFrame(() => {
            state.frame = 0;
            if (resize.current === state) setLiveSizes(resizedSizes(state, state.position));
        });
    }

    function onPointerUp() {
        const state = resize.current;
        resize.current = null;
        if (!state) return;

        cancelAnimationFrame(state.frame);
        if (state.moved) {
            const newSizes = resizedSizes(state, state.position);
            updateLayout(root => setSplitSizes(root, path, newSizes));
        }
        setLiveSizes(null);
    }

    const children: ReactNode[] = [];
    let lastVisible = -1;

    node.children.forEach((child, i) => {
        if (visible[i]) {
            if (lastVisible !== -1) {
                const before = lastVisible;
                children.push(
                    <div
                        key={`divider-${i}`}
                        className={cl("divider")}
                        role="separator"
                        aria-orientation={isRow ? "vertical" : "horizontal"}
                        onPointerDown={e => onPointerDown(e, before, i)}
                        onPointerMove={onPointerMove}
                        onPointerUp={onPointerUp}
                        onPointerCancel={onPointerUp}
                    />
                );
            }
            lastVisible = i;
        }

        children.push(
            <div
                key={child.type === "panel" ? child.id : `split-${i}`}
                className={cl("cell", { "cell-hidden": !visible[i] })}
                style={cellStyle(sizes[i])}
                ref={cell => { cells.current[i] = cell; }}
            >
                <LayoutNodeView
                    node={child}
                    path={[...path, i]}
                    flow={isRow ? "vertical" : "horizontal"}
                    fixedSize={fixedSize && node.sizes[i] !== "auto"}
                />
            </div>
        );
    });

    return <div className={cl("split", isRow ? "split-row" : "split-column")}>{children}</div>;
}

function LayoutNodeView({ node, path, flow, fixedSize }: PlacementProps & { node: LayoutNode; path: number[]; }) {
    return node.type === "panel"
        ? <PanelSlot id={node.id} flow={flow} fixedSize={fixedSize} />
        : <Split node={node} path={path} fixedSize={fixedSize} />;
}

export function LayoutHost() {
    const layout = useLayout()!;
    const editing = useLayoutState(s => s.editing);
    const isSidebarDocked = useLayoutState(s => isMounted(s.mounted, Anchor.Sidebar));
    const rootRef = useRef<HTMLDivElement>(null);

    return (
        <div className={cl("host", { "host-editing": editing, "host-besideSidebar": !isSidebarDocked })}>
            {editing && <EditBar />}

            <div className={cl("root")} ref={rootRef}>
                <LayoutNodeView node={layout.profile.root} path={[]} flow="vertical" fixedSize />
                <DragIndicator rootRef={rootRef} />
            </div>

            {[...layout.panels].map(panelId => {
                const channelId = getExtraChatChannelId(panelId);
                if (channelId == null) return null;

                return ReactDOM.createPortal(
                    <ChatPanel channelId={channelId} onClose={() => closePanel(panelId)} />,
                    getPanelElement(panelId),
                    panelId
                );
            })}
        </div>
    );
}
