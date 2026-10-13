/**
 * What the 2D and 3D house interiors share: looking around by dragging or
 * wheeling a scrolling view, telling a click from a drag, and keeping a
 * speech bubble inside the view.
 */

/** Drag to look around, and a wheel turns it sideways, for a horizontally scrolling view. */
export function panWith(pan: HTMLElement): void {
  let from: { x: number; left: number } | null = null;
  pan.addEventListener('pointerdown', (e) => {
    from = { x: e.clientX, left: pan.scrollLeft };
    pan.setPointerCapture(e.pointerId);
    pan.classList.add('dragging');
  });
  pan.addEventListener('pointermove', (e) => {
    if (from !== null) pan.scrollLeft = from.left - (e.clientX - from.x);
  });
  const release = (): void => {
    from = null;
    pan.classList.remove('dragging');
  };
  pan.addEventListener('pointerup', release);
  pan.addEventListener('pointercancel', release);
  pan.addEventListener(
    'wheel',
    (e) => {
      e.preventDefault();
      pan.scrollLeft += e.deltaY + e.deltaX;
    },
    { passive: false },
  );
}

/** Whether a press and a release are a click (they stay where they were, within `slop` px). */
export function isClick(press: { x: number; y: number } | null, release: { x: number; y: number }, slop = 5): boolean {
  return press !== null && Math.hypot(release.x - press.x, release.y - press.y) <= slop;
}

/** The x for something `width` wide centred on `x`, kept `margin` px inside a view `viewWidth` wide. */
export function keepInside(x: number, width: number, viewWidth: number, margin = 6): number {
  const half = width / 2;
  return Math.min(Math.max(x, half + margin), viewWidth - half - margin);
}
