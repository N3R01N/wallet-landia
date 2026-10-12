/**
 * Pointer, wheel, touch and keyboard input for the town: drag to pan (or
 * orbit), pinch and twist, hover tooltips, clicks, and the shortcuts.
 */

import type { HitTarget, ViewKind, WorldView } from '../render/view.js';

export interface InputHost {
  stage: HTMLElement;
  tooltip: HTMLElement;
  /** The view on screen now (it changes with the view buttons). */
  renderer(): WorldView;
  tooltipContent(t: HitTarget): Node[];
  /** A click on the town (not a drag). */
  click(e: PointerEvent): void;
  togglePlay(): void;
  setView(v: ViewKind): void;
  toggleSound(): void;
  closeInspector(): void;
}

/** Listen for good: the app lives as long as the page. */
export function bindInput(host: InputHost): void {
  const { stage, tooltip } = host;
  // the Realm Map sits over the town inside the stage: its clicks, wheel and keys are its own
  const inMap = (e: Event): boolean => e.target instanceof Element && e.target.closest('.realm-map') !== null;
  const onStage = (e: Event): boolean => e.target instanceof Node && stage.contains(e.target) && !inMap(e);
  // Left-drag pans; right-drag or shift-drag orbits (3D only).
  let drag: { x: number; y: number; moved: boolean; orbit: boolean } | null = null;
  // Touch: two fingers pinch to zoom and twist to orbit.
  const touches = new Map<number, { x: number; y: number }>();
  let pinch: { dist: number; angle: number } | null = null;
  const twoFinger = (): { dist: number; angle: number; cx: number; cy: number } | null => {
    const [a, b] = [...touches.values()];
    if (!a || !b) return null;
    return { dist: Math.hypot(b.x - a.x, b.y - a.y), angle: Math.atan2(b.y - a.y, b.x - a.x), cx: (a.x + b.x) / 2, cy: (a.y + b.y) / 2 };
  };
  stage.addEventListener('pointerdown', (e) => {
    if (inMap(e)) return;
    if (e.pointerType === 'touch') touches.set(e.pointerId, { x: e.clientX, y: e.clientY });
    if (touches.size >= 2) {
      drag = null;
      const t = twoFinger();
      pinch = t ? { dist: t.dist, angle: t.angle } : null;
      return;
    }
    drag = { x: e.clientX, y: e.clientY, moved: false, orbit: e.button === 2 || e.shiftKey };
  });
  const release = (e: PointerEvent): void => {
    touches.delete(e.pointerId);
    if (touches.size < 2) pinch = null;
  };
  window.addEventListener('pointercancel', release);
  window.addEventListener('pointermove', (e) => {
    if (touches.has(e.pointerId)) touches.set(e.pointerId, { x: e.clientX, y: e.clientY });
    if (pinch !== null) {
      const t = twoFinger();
      if (t) {
        const r = stage.getBoundingClientRect();
        host.renderer().zoomAt(t.cx - r.left, t.cy - r.top, t.dist / Math.max(1, pinch.dist));
        host.renderer().rotate((t.angle - pinch.angle) * 160, 0);
        pinch = { dist: t.dist, angle: t.angle };
      }
    }
  });
  stage.addEventListener('contextmenu', (e) => e.preventDefault());
  let hoverAt: PointerEvent | null = null;
  let hoverQueued = false;
  window.addEventListener('pointermove', (e) => {
    if (drag !== null) {
      const dx = e.clientX - drag.x;
      const dy = e.clientY - drag.y;
      if (Math.abs(dx) + Math.abs(dy) > 3) drag.moved = true;
      if (drag.moved) {
        if (drag.orbit) host.renderer().rotate(dx, dy);
        else host.renderer().pan(dx, dy);
        drag.x = e.clientX;
        drag.y = e.clientY;
      }
    }
    // hover at most once a frame: a hit test, a layout read and a tooltip rebuild per pointer event add up
    hoverAt = onStage(e) ? e : null;
    if (!hoverQueued) {
      hoverQueued = true;
      requestAnimationFrame(() => {
        hoverQueued = false;
        if (hoverAt !== null) hover(host, hoverAt);
        else if (host.renderer().hover !== null || !tooltip.hidden) {
          tooltip.hidden = true;
          host.renderer().hover = null;
        }
      });
    }
  });
  window.addEventListener('pointerup', (e) => {
    if (drag !== null && !drag.moved && !drag.orbit && onStage(e)) host.click(e);
    drag = null;
    release(e);
  });
  stage.addEventListener(
    'wheel',
    (e) => {
      if (inMap(e)) return;
      e.preventDefault();
      const r = stage.getBoundingClientRect();
      host.renderer().zoomAt(e.clientX - r.left, e.clientY - r.top, e.deltaY < 0 ? 1.15 : 1 / 1.15);
    },
    { passive: false },
  );
  stage.addEventListener('pointerleave', () => {
    tooltip.hidden = true;
    host.renderer().hover = null;
  });
  // the control last pressed with the mouse: it keeps focus, but Space should still play and pause
  const CONTROL = 'button, a[href], summary, [role="button"]';
  let clicked: Element | null = null;
  window.addEventListener('pointerdown', (e) => (clicked = e.target instanceof Element ? e.target.closest(CONTROL) : null), true);
  window.addEventListener('focusin', (e) => {
    if (e.target !== clicked) clicked = null;
  });
  window.addEventListener('keydown', (e) => {
    // not while typing, not shortcuts of the browser or system (ctrl/cmd/alt), and the Realm Map has its own keys
    if (e.ctrlKey || e.metaKey || e.altKey || inMap(e)) return;
    const t = e.target;
    if (t instanceof HTMLElement && (t.isContentEditable || t.matches('input, select, textarea'))) return;
    // Space and Enter press a button or follow a link reached with the keyboard
    if ((e.key === ' ' || e.key === 'Enter') && t instanceof HTMLElement && t !== clicked && t.matches(CONTROL)) return;
    if (e.key === ' ') {
      e.preventDefault();
      host.togglePlay();
    } else if (e.key === 't') host.setView('top');
    else if (e.key === 'i') host.setView('iso');
    else if (e.key === 'm') host.toggleSound();
    else if (e.key === '3') host.setView('3d');
    else if (e.key === 'q') host.renderer().rotate(-60, 0);
    else if (e.key === 'e') host.renderer().rotate(60, 0);
    else if (e.key === '0') host.renderer().fit();
    else if (e.key === 'Escape') host.closeInspector();
  });
  window.addEventListener('resize', () => host.renderer().fit());
}

/** What is under the pointer: highlighted, with a tooltip beside it. */
function hover(host: InputHost, e: PointerEvent): void {
  const { stage, tooltip } = host;
  const renderer = host.renderer();
  const r = stage.getBoundingClientRect();
  const target = renderer.hitTest(e.clientX - r.left, e.clientY - r.top);
  renderer.hover = target;
  stage.style.cursor = target ? 'pointer' : 'grab';
  if (target === null) {
    tooltip.hidden = true;
    return;
  }
  tooltip.hidden = false;
  tooltip.replaceChildren(...host.tooltipContent(target));
  tooltip.style.left = `${e.clientX - r.left + 14}px`;
  tooltip.style.top = `${e.clientY - r.top + 14}px`;
}
