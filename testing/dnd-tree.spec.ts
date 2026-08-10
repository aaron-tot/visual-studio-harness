import { test, expect } from '@playwright/test';

/**
 * Focused runtime verification that the SortableTree drag-and-drop actually
 * reorders items. Mounted standalone at /dnd-demo.html (no backend required).
 */
test('sortable tree: drag reorders items', async ({ page }) => {
  await page.goto('/dnd-demo.html');

  const rows = page.locator('ul.list-none > li');
  await expect(rows.first()).toBeVisible();

  const order = () =>
    rows.locator('.tree-item .text').allTextContents();

  const before = await order();
  console.log('[dnd] order before:', JSON.stringify(before));

  const row0 = rows.nth(0).locator('.tree-item');
  const row1 = rows.nth(1).locator('.tree-item');
  const b0 = await row0.boundingBox();
  const b1 = await row1.boundingBox();
  if (!b0 || !b1) throw new Error('row bounding boxes not found');

  // Press on first row, move >8px to satisfy PointerSensor activation, then
  // drag onto the second row to trigger a reorder.
  const cx = b0.x + b0.width / 2;
  const cy = b0.y + b0.height / 2;
  await page.mouse.move(cx, cy);
  await page.mouse.down();
  await page.mouse.move(cx, cy + 12, { steps: 5 });
  await page.mouse.move(b1.x + b1.width / 2, b1.y + b1.height * 0.8, {
    steps: 20,
  });
  await page.waitForTimeout(250);
  await page.mouse.up();
  await page.waitForTimeout(500);

  const after = await order();
  console.log('[dnd] order after: ', JSON.stringify(after));

  expect(after).not.toEqual(before);
  expect(after[0]).not.toEqual(before[0]);
});

// The session-tree PointerSensor (sessionTreePointerSensor.ts) must hold
// pointer capture during a drag: a release outside the window then still
// dispatches pointerup, so the drag always terminates (no stuck overlay,
// grabbing cursor, or blocked drags).
test.use({slowMo: 0} as any);
test('pointer capture is active during a drag', async ({ page }) => {
  await page.goto('/dnd-demo.html');

  const row0 = page.locator('ul.list-none > li').nth(0).locator('.tree-item');
  await expect(row0).toBeVisible();
  const b0 = await row0.boundingBox();
  if (!b0) throw new Error('row bounding box not found');

  const cx = b0.x + b0.width / 2;
  const cy = b0.y + b0.height / 2;
  await page.mouse.move(cx, cy);
  await page.mouse.down();
  await page.mouse.move(cx, cy + 12, { steps: 5 }); // activate the sensor

  // Chromium mouse pointers use pointerId 1; the pointerdown target must
  // hold capture while the drag is active.
  const captured = await page.evaluate(() =>
    Array.from(document.querySelectorAll('*')).some(
      (el) => (el as Element).hasPointerCapture?.(1) === true
    )
  );
  await page.mouse.up();

  expect(captured).toBe(true);
});

// Renaming a session is a double-click on the row; the second press must
// never start a drag, even when the mouse drifts while held.
test('double-click with drift does not start a drag', async ({ page }) => {
  await page.goto('/dnd-demo.html');

  const rows = page.locator('ul.list-none > li');
  await expect(rows.first()).toBeVisible();
  const order = () => rows.locator('.tree-item .text').allTextContents();
  const before = await order();

  const row0 = rows.nth(0).locator('.tree-item');
  const b0 = await row0.boundingBox();
  if (!b0) throw new Error('row bounding box not found');
  const cx = b0.x + b0.width / 2;
  const cy = b0.y + b0.height / 2;

  // Two quick presses 3px apart (double-click), then a 19px drag movement
  // while holding the button on the second press.
  await page.mouse.move(cx, cy);
  await page.mouse.down();
  await page.mouse.up();
  await page.mouse.move(cx + 3, cy + 3);
  await page.mouse.down();
  await page.mouse.move(cx + 3, cy + 22, { steps: 5 });
  await page.mouse.up();
  await page.waitForTimeout(250);

  const cursor = await page.evaluate(() => document.body.style.cursor);
  const after = await order();

  expect(cursor).not.toBe('grabbing');
  expect(after).toEqual(before);
});
