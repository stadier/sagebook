/* Pointer-driven board dragging — the Jira behaviour.

   The native HTML5 drag API gives a browser-drawn translucent ghost, no way to
   say where the thing will land, and nothing at all on touch. This replaces it:
   press and hold, the card lifts out under the pointer and follows it, the
   remaining cards slide apart to open the exact gap it will drop into, and the
   board auto-scrolls when the pointer nears an edge.

   Deliberately narrow rather than a general drag library: one item at a time,
   columns of vertically stacked cards, insertion index read off the cards' own
   boxes. Everything it knows about the board arrives as `columns`.

   The gap is opened by really removing the dragged card and really inserting a
   placeholder — the layout is the preview, so what you see is what you get. The
   cards then animate from where they were to where they now are (FLIP), which
   is what makes a hard layout change read as things politely making room. */

import { useCallback, useEffect, useLayoutEffect, useRef, useState } from "react";
import { createPortal } from "react-dom";

/** Where a dragged card would land if it were released right now. */
export interface DropTarget {
    columnId: string;
    index: number;
}

/** A column as the drag engine needs to see it: an id and its cards, in order. */
export interface BoardColumn {
    id: string;
    itemIds: string[];
}

/** Touch has to hold this long before the board takes the gesture from the page. */
const HOLD_MS = 180;
/** Pointer travel that starts a mouse drag outright — a hold is not required. */
const MOVE_THRESHOLD = 5;
/** How long a card takes to slide to its new place. */
const FLIP_MS = 190;
const FLIP_EASING = "cubic-bezier(0.2, 0.8, 0.2, 1)";
/** Distance from a scroll edge at which the board starts following the pointer. */
const EDGE = 72;
/** Auto-scroll speed, in px per frame, right at the edge. */
const EDGE_SPEED = 16;

interface Grab {
    id: string;
    columnId: string;
    pointerId: number;
    pointerType: string;
    startX: number;
    startY: number;
    /** Where inside the card the pointer went down, so it stays under the grab. */
    offsetX: number;
    offsetY: number;
    width: number;
    height: number;
}

interface Lifted extends Grab {
    x: number;
    y: number;
}

export interface BoardDrag {
    /** The card currently in the air, if any. */
    draggingId: string | null;
    /** Its height, so a column can size the gap it leaves behind. */
    height: number;
    /** Start watching a press. Wire to the card's `onPointerDown`. */
    press: (e: React.PointerEvent, id: string, columnId: string) => void;
    itemRef: (id: string) => (el: HTMLElement | null) => void;
    columnRef: (id: string) => (el: HTMLElement | null) => void;
    /** Index the gap sits at in this column, or null when it is elsewhere. */
    slotFor: (columnId: string) => number | null;
    /** The floating card. Render it once, anywhere. */
    overlay: (render: (id: string) => React.ReactNode) => React.ReactNode;
}

export function useBoardDrag({
    columns,
    onDrop,
}: {
    columns: BoardColumn[];
    onDrop: (args: { id: string; from: DropTarget; to: DropTarget }) => void;
}): BoardDrag {
    const [lifted, setLifted] = useState<Lifted | null>(null);
    const [target, setTarget] = useState<DropTarget | null>(null);

    const itemEls = useRef(new Map<string, HTMLElement>());
    const columnEls = useRef(new Map<string, HTMLElement>());
    /** Settled positions — where every card sits once its animation is done. */
    const rects = useRef(new Map<string, DOMRect>());

    const grab = useRef<Grab | null>(null);
    const holdTimer = useRef(0);
    const liftedRef = useRef<Lifted | null>(null);
    const targetRef = useRef<DropTarget | null>(null);
    const originRef = useRef<DropTarget | null>(null);
    const columnsRef = useRef(columns);
    const onDropRef = useRef(onDrop);
    const scroller = useRef<HTMLElement | null>(null);
    const frame = useRef(0);
    const moved = useRef(false);

    columnsRef.current = columns;
    onDropRef.current = onDrop;
    liftedRef.current = lifted;
    targetRef.current = target;

    /* --- Geometry --------------------------------------------------------- */

    /** Re-read where every card sits, settling any slide already in flight. */
    const capture = useCallback(() => {
        for (const [id, el] of itemEls.current) {
            // A running FLIP would otherwise be measured mid-flight. Finishing
            // it lands the card on its final position, which is what we want.
            for (const animation of el.getAnimations()) animation.finish();
            rects.current.set(id, el.getBoundingClientRect());
        }
    }, []);

    /** The column and index under a point, using the settled geometry. */
    const targetAt = useCallback((x: number, y: number, draggingId: string): DropTarget | null => {
        const cols = columnsRef.current;
        if (!cols.length) return null;

        let hit: BoardColumn | null = null;
        let nearest: { column: BoardColumn; distance: number } | null = null;

        for (const column of cols) {
            const el = columnEls.current.get(column.id);
            if (!el) continue;
            const r = el.getBoundingClientRect();
            if (x >= r.left && x <= r.right) {
                hit = column;
                break;
            }
            // Off the side of the board, the outermost column still takes it.
            const distance = x < r.left ? r.left - x : x - r.right;
            if (!nearest || distance < nearest.distance) nearest = { column, distance };
        }

        const column = hit ?? nearest?.column;
        if (!column) return null;

        const ids = column.itemIds.filter((id) => id !== draggingId);
        let index = ids.length;
        for (let i = 0; i < ids.length; i++) {
            const r = rects.current.get(ids[i]);
            if (!r) continue;
            if (y < r.top + r.height / 2) {
                index = i;
                break;
            }
        }
        return { columnId: column.id, index };
    }, []);

    const retarget = useCallback(
        (x: number, y: number) => {
            const current = liftedRef.current;
            if (!current) return;
            const next = targetAt(x, y, current.id);
            if (!next) return;
            const now = targetRef.current;
            if (now && now.columnId === next.columnId && now.index === next.index) return;
            setTarget(next);
        },
        [targetAt],
    );

    /* --- The drag itself --------------------------------------------------- */

    const finish = useCallback(() => {
        window.clearTimeout(holdTimer.current);
        cancelAnimationFrame(frame.current);
        grab.current = null;
        scroller.current = null;
        rects.current.clear();
        setLifted(null);
        setTarget(null);
    }, []);

    const lift = useCallback(
        (x: number, y: number) => {
            const g = grab.current;
            if (!g || liftedRef.current) return;
            window.clearTimeout(holdTimer.current);

            // Measured before the card leaves the list, so the cards that stay
            // have a "from" position to slide out of.
            capture();

            const from: DropTarget = {
                columnId: g.columnId,
                index: Math.max(
                    0,
                    (columnsRef.current.find((c) => c.id === g.columnId)?.itemIds ?? []).indexOf(g.id),
                ),
            };
            originRef.current = from;
            scroller.current = scrollableAncestor(itemEls.current.get(g.id) ?? null);
            moved.current = true;

            setLifted({ ...g, x, y });
            // Opens the gap exactly where the card already was, so lifting it
            // out shifts nothing until the pointer actually goes somewhere.
            setTarget(from);
        },
        [capture],
    );

    const drop = useCallback(() => {
        const current = liftedRef.current;
        const to = targetRef.current;
        const from = originRef.current;
        if (current && to && from && (to.columnId !== from.columnId || to.index !== from.index)) {
            onDropRef.current({ id: current.id, from, to });
        }
        finish();
    }, [finish]);

    /* Everything below the first press is bound to the window: the pointer
       leaves the card almost immediately, and a drag has to survive that. */
    useEffect(() => {
        function onMove(e: PointerEvent) {
            const g = grab.current;
            if (!g || e.pointerId !== g.pointerId) return;

            if (!liftedRef.current) {
                const far =
                    Math.abs(e.clientX - g.startX) > MOVE_THRESHOLD ||
                    Math.abs(e.clientY - g.startY) > MOVE_THRESHOLD;
                if (!far) return;
                // A finger that moves before the hold elapses is scrolling the
                // page, not picking a card up. A mouse that moves is dragging.
                if (g.pointerType === "touch") {
                    window.clearTimeout(holdTimer.current);
                    grab.current = null;
                    return;
                }
                lift(e.clientX, e.clientY);
            }

            e.preventDefault();
            setLifted((l) => (l ? { ...l, x: e.clientX, y: e.clientY } : l));
            retarget(e.clientX, e.clientY);
        }

        function onUp(e: PointerEvent) {
            if (grab.current && e.pointerId !== grab.current.pointerId) return;
            if (liftedRef.current) drop();
            else {
                window.clearTimeout(holdTimer.current);
                grab.current = null;
            }
        }

        function onKey(e: KeyboardEvent) {
            if (e.key !== "Escape" || !liftedRef.current) return;
            e.preventDefault();
            finish(); // Escape puts it back, rather than dropping it somewhere.
        }

        window.addEventListener("pointermove", onMove, { passive: false });
        window.addEventListener("pointerup", onUp);
        window.addEventListener("pointercancel", onUp);
        window.addEventListener("keydown", onKey);
        return () => {
            window.removeEventListener("pointermove", onMove);
            window.removeEventListener("pointerup", onUp);
            window.removeEventListener("pointercancel", onUp);
            window.removeEventListener("keydown", onKey);
        };
    }, [lift, drop, finish, retarget]);

    /* A finger that has picked a card up must not also scroll the page. Only
       `touchmove` can veto that, and only when it is not passive — which rules
       out React's own handler, hence the direct listener. */
    useEffect(() => {
        if (!lifted) return;
        const stop = (e: TouchEvent) => e.preventDefault();
        document.addEventListener("touchmove", stop, { passive: false });
        document.body.classList.add("sb-dragging");
        return () => {
            document.removeEventListener("touchmove", stop);
            document.body.classList.remove("sb-dragging");
        };
    }, [lifted]);

    /* Scrolling moves every card out from under the cached geometry, and the
       auto-scroll below fires it every frame — so the two go together. */
    useEffect(() => {
        if (!lifted) return;
        const onScroll = () => {
            capture();
            const l = liftedRef.current;
            if (l) retarget(l.x, l.y);
        };
        window.addEventListener("scroll", onScroll, true);
        window.addEventListener("resize", onScroll);
        return () => {
            window.removeEventListener("scroll", onScroll, true);
            window.removeEventListener("resize", onScroll);
        };
    }, [lifted, capture, retarget]);

    /* Auto-scroll: near a scrollable edge, the board keeps moving on its own so
       a column taller than the viewport is still reachable mid-drag. */
    useEffect(() => {
        if (!lifted) return;
        let running = true;
        const step = () => {
            if (!running) return;
            const l = liftedRef.current;
            if (l) {
                const box = scroller.current;
                const top = box ? box.getBoundingClientRect().top : 0;
                const bottom = box ? box.getBoundingClientRect().bottom : window.innerHeight;
                const fromTop = l.y - top;
                const fromBottom = bottom - l.y;
                let delta = 0;
                if (fromTop < EDGE) delta = -EDGE_SPEED * (1 - Math.max(0, fromTop) / EDGE);
                else if (fromBottom < EDGE) delta = EDGE_SPEED * (1 - Math.max(0, fromBottom) / EDGE);
                if (delta) (box ?? window).scrollBy(0, delta);
            }
            frame.current = requestAnimationFrame(step);
        };
        frame.current = requestAnimationFrame(step);
        return () => {
            running = false;
            cancelAnimationFrame(frame.current);
        };
    }, [lifted]);

    /* FLIP. The commit above has already moved every card to its new place; this
       runs before the browser paints, so each card can be put back where it was
       and animated forwards from there. */
    const slotKey = target ? `${target.columnId}:${target.index}` : "";
    useLayoutEffect(() => {
        if (!liftedRef.current) {
            rects.current.clear();
            return;
        }
        const before = new Map(rects.current);
        capture();
        for (const [id, el] of itemEls.current) {
            if (id === liftedRef.current.id) continue;
            const was = before.get(id);
            const now = rects.current.get(id);
            if (!was || !now) continue;
            const dx = was.left - now.left;
            const dy = was.top - now.top;
            if (!dx && !dy) continue;
            el.animate(
                [{ transform: `translate(${dx}px, ${dy}px)` }, { transform: "none" }],
                { duration: FLIP_MS, easing: FLIP_EASING },
            );
        }
    }, [slotKey, lifted?.id, capture]);

    /* --- Handles the board wires up ---------------------------------------- */

    const press = useCallback(
        (e: React.PointerEvent, id: string, columnId: string) => {
            if (e.pointerType === "mouse" && e.button !== 0) return;
            if (liftedRef.current) return;
            const el = itemEls.current.get(id);
            if (!el) return;
            const r = el.getBoundingClientRect();
            grab.current = {
                id,
                columnId,
                pointerId: e.pointerId,
                pointerType: e.pointerType,
                startX: e.clientX,
                startY: e.clientY,
                offsetX: e.clientX - r.left,
                offsetY: e.clientY - r.top,
                width: r.width,
                height: r.height,
            };
            moved.current = false;
            window.clearTimeout(holdTimer.current);
            holdTimer.current = window.setTimeout(() => {
                const g = grab.current;
                if (g) lift(g.startX, g.startY);
            }, HOLD_MS);
        },
        [lift],
    );

    /* A drag that ends on the card it started from would otherwise fire that
       card's click — so the first click after any real drag is swallowed. */
    useEffect(() => {
        if (lifted) return;
        if (!moved.current) return;
        moved.current = false;
        const swallow = (e: MouseEvent) => {
            e.stopPropagation();
            e.preventDefault();
        };
        window.addEventListener("click", swallow, { capture: true, once: true });
        const id = window.setTimeout(
            () => window.removeEventListener("click", swallow, { capture: true }),
            0,
        );
        return () => window.clearTimeout(id);
    }, [lifted]);

    const itemRef = useCallback(
        (id: string) => (el: HTMLElement | null) => {
            if (el) itemEls.current.set(id, el);
            else itemEls.current.delete(id);
        },
        [],
    );

    const columnRef = useCallback(
        (id: string) => (el: HTMLElement | null) => {
            if (el) columnEls.current.set(id, el);
            else columnEls.current.delete(id);
        },
        [],
    );

    const slotFor = useCallback(
        (columnId: string) => (target && target.columnId === columnId ? target.index : null),
        [target],
    );

    const overlay = useCallback(
        (render: (id: string) => React.ReactNode) =>
            lifted
                ? createPortal(
                      <div
                          className="sb-lift"
                          style={{
                              left: lifted.x - lifted.offsetX,
                              top: lifted.y - lifted.offsetY,
                              width: lifted.width,
                          }}
                      >
                          {render(lifted.id)}
                      </div>,
                      document.body,
                  )
                : null,
        [lifted],
    );

    return {
        draggingId: lifted?.id ?? null,
        height: lifted?.height ?? 0,
        press,
        itemRef,
        columnRef,
        slotFor,
        overlay,
    };
}

/** The gap a dragged card will drop into. */
export function DropSlot({ height }: { height: number }) {
    return <div className="sb-slot" style={{ height }} aria-hidden />;
}

/** The nearest ancestor that actually scrolls vertically, if there is one. */
function scrollableAncestor(el: HTMLElement | null): HTMLElement | null {
    for (let node = el?.parentElement ?? null; node; node = node.parentElement) {
        const overflow = getComputedStyle(node).overflowY;
        if (/(auto|scroll|overlay)/.test(overflow) && node.scrollHeight > node.clientHeight) {
            return node;
        }
    }
    return null;
}
