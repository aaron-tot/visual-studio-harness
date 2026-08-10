import {PointerSensor} from '@dnd-kit/core';
import type {PointerSensorOptions} from '@dnd-kit/core';
import type {PointerEvent as ReactPointerEvent} from 'react';

/**
 * PointerSensor for the session sortable tree.
 *
 * @dnd-kit/core@6.3.1 lets a drag start from anywhere on a sortable row and
 * never terminates it when the pointer is released outside the window,
 * because it does not capture the pointer. The session rename gesture
 * (double-click on the title) and the row's buttons sit on the same drag
 * surface, so an 8px drift while double-clicking (or while pressing a
 * button) starts an accidental drag that can leave the tree stuck: frozen
 * DragOverlay, grabbing cursor, all further drags rejected until reload.
 *
 * This sensor fixes that by:
 *  1. capturing the pointer on the pointerdown target, so a release outside
 *     the window still dispatches pointerup and the drag always ends;
 *  2. ignoring pointerdown on interactive elements (rename input, buttons,
 *     etc.) — those are click targets, not drag targets;
 *  3. ignoring the second press of a double-click gesture (the rename
 *     entry), so a slightly drifting double-click can't lift the row.
 */

const DOUBLE_CLICK_WINDOW_MS = 400;
const DOUBLE_CLICK_RADIUS_PX = 8;

let lastPress: {time: number; x: number; y: number} | null = null;

function isInteractiveTarget(target: EventTarget | null): boolean {
  return (
    target instanceof Element &&
    target.closest('input, button, select, textarea, a[href]') !== null
  );
}

/** True when this press is the second press of a double-click gesture. */
function isDoubleClickPress(event: PointerEvent): boolean {
  const prev = lastPress;
  lastPress = {time: event.timeStamp, x: event.clientX, y: event.clientY};
  if (!prev) return false;
  return (
    event.timeStamp - prev.time < DOUBLE_CLICK_WINDOW_MS &&
    Math.abs(event.clientX - prev.x) < DOUBLE_CLICK_RADIUS_PX &&
    Math.abs(event.clientY - prev.y) < DOUBLE_CLICK_RADIUS_PX
  );
}

export class SessionTreePointerSensor extends PointerSensor {
  static activators: {
    eventName: 'onPointerDown';
    handler: (event: ReactPointerEvent, options: PointerSensorOptions) => boolean;
  }[] = [
    {
      eventName: 'onPointerDown',
      handler: ({nativeEvent: event}, {onActivation}) => {
        if (!event.isPrimary || event.button !== 0) return false;
        if (isInteractiveTarget(event.target)) return false;
        if (isDoubleClickPress(event)) return false;

        // Capture the pointer so pointerup always terminates the drag, even
        // when released outside the window. Harmless when the press never
        // becomes a drag — the capture is released automatically on pointerup.
        const target = event.target as Element | null;
        try {
          target?.setPointerCapture?.(event.pointerId);
        } catch {
          // Pointer already inactive — the drag simply won't start.
        }

        onActivation?.({event});
        return true;
      },
    },
  ];
}
