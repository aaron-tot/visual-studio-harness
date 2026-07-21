import {useEffect, useMemo, useRef, useState} from 'react';
import type {ReactNode} from 'react';
import {createPortal} from 'react-dom';
import {
  type Announcements,
  DndContext,
  closestCenter,
  KeyboardSensor,
  PointerSensor,
  useSensor,
  useSensors,
  type DragStartEvent,
  DragOverlay,
  type DragMoveEvent,
  type DragEndEvent,
  type DragOverEvent,
  MeasuringStrategy,
  type DropAnimation,
  type Modifier,
  defaultDropAnimation,
  type UniqueIdentifier,
} from '@dnd-kit/core';
import {
  SortableContext,
  arrayMove,
  verticalListSortingStrategy,
} from '@dnd-kit/sortable';
import {CSS} from '@dnd-kit/utilities';

import {
  buildTree,
  flattenTree,
  getProjection,
  getChildCount,
  removeItem,
  removeChildrenOf,
  setProperty,
} from './utilities';
import type {FlattenedItem, SensorContext, TreeItem, TreeItems} from './types';
import {sortableTreeKeyboardCoordinates} from './keyboardCoordinates';
import {SortableTreeItem} from './SortableTreeItem';

function isGroupItem(id: UniqueIdentifier | null): boolean {
  if (id == null) return false;
  const str = String(id).toLowerCase();
  if (str.startsWith('group')) return true;
  return false;
}

// Lookup variant-checking isGroupItem that also uses childrenVariants
function isGroupItemV2(id: UniqueIdentifier | null, variants: Map<string, string> | undefined): boolean {
  if (id == null) return false;
  if (isGroupItem(id)) return true;
  return variants?.get(String(id)) === "group";
}

const initialItems: TreeItems = [
  {
    id: 'Home',
    children: [],
  },
  {
    id: 'Collections',
    children: [
      {id: 'Spring', children: []},
      {id: 'Summer', children: []},
      {id: 'Fall', children: []},
      {id: 'Winter', children: []},
    ],
  },
  {
    id: 'About Us',
    children: [],
  },
  {
    id: 'My Account',
    children: [
      {id: 'Addresses', children: []},
      {id: 'Order History', children: []},
    ],
  },
  {id: 'Group 1', children: []},
  {id: 'Group 2', children: []},
  {id: 'Group 3', children: []},
];

const measuring = {
  droppable: {
    strategy: MeasuringStrategy.Always,
  },
};

const dropAnimationConfig: DropAnimation = {
  keyframes({transform}) {
    return [
      {opacity: 1, transform: CSS.Translate.toString(transform.initial)},
      {
        opacity: 0,
        transform: CSS.Translate.toString({
          ...transform.final,
          x: transform.final.x + 5,
          y: transform.final.y + 5,
        }),
      },
    ];
  },
  easing: 'ease-out',
  sideEffects({active}) {
    active.node.animate([{opacity: 0}, {opacity: 1}], {
      duration: defaultDropAnimation.duration,
      easing: defaultDropAnimation.easing,
    });
  },
};

interface SortableTreeProps {
  collapsible?: boolean;
  defaultItems?: TreeItems;
  indentationWidth?: number;
  indicator?: boolean;
  removable?: boolean;
  renderActions?: (itemId: string, label: string, childCount?: number, requestRemove?: () => void, isDragOverlay?: boolean, childSessionIds?: string[]) => React.ReactNode;
  onItemsChange?: (items: TreeItems) => void;
}

export function SortableTree({
  collapsible,
  defaultItems = initialItems,
  indicator = false,
  indentationWidth = 50,
  removable,
  renderActions,
  onItemsChange,
}: SortableTreeProps) {
  const [items, setItems] = useState(() => defaultItems);
  const [activeId, setActiveId] = useState<UniqueIdentifier | null>(null);
  const prevDefaultRef = useRef(defaultItems);
  const prevItemsRef = useRef(defaultItems);
  const isMountedRef = useRef(false);
  const isSavingRef = useRef(false);

  useEffect(() => {
    if (!isMountedRef.current) {
      isMountedRef.current = true;
      prevItemsRef.current = items;
      return;
    }
    // Only fire onItemsChange if items actually changed (user action)
    const prev = prevItemsRef.current;
    const changed = prev.length !== items.length || prev.some((p, i) => p.id !== items[i]?.id);
    if (changed) {
      prevItemsRef.current = items;
      onItemsChange?.(items);
    }
  }, [items, onItemsChange]);

  // Re-sync from defaultItems when props change (new sessions, backend reload)
  // but only when not actively dragging and content actually changed.
  useEffect(() => {
    if (activeId != null) return;
    if (isSavingRef.current) return;
    if (prevDefaultRef.current === defaultItems) return;
    // Compare flattened IDs to avoid infinite loop from optimistic saves
    const prevFlat = flattenTree(prevDefaultRef.current).map((i) => String(i.id));
    const currFlat = flattenTree(defaultItems).map((i) => String(i.id));
    const changed =
      prevFlat.length !== currFlat.length ||
      prevFlat.some((id, i) => id !== currFlat[i]);
    prevDefaultRef.current = defaultItems;
    if (changed) {
      isSavingRef.current = true;
      setItems(defaultItems);
      // Update prevItemsRef so onItemsChange doesn't fire for this programmatic change
      prevItemsRef.current = defaultItems;
      queueMicrotask(() => { isSavingRef.current = false; });
    }
  }, [defaultItems, activeId]);
  const [overId, setOverId] = useState<UniqueIdentifier | null>(null);
  const [offsetLeft, setOffsetLeft] = useState(0);
  const [currentPosition, setCurrentPosition] = useState<{
    parentId: UniqueIdentifier | null;
    overId: UniqueIdentifier;
  } | null>(null);

  const flattenedItems = useMemo(() => {
    const flattenedTree = flattenTree(items);
    const collapsedItems = flattenedTree.reduce<string[]>(
      (acc, {children, collapsed, id}) =>
        collapsed && children.length ? [...acc, id as string] : acc,
      []
    );

    return removeChildrenOf(
      flattenedTree,
      activeId != null ? [activeId, ...collapsedItems] : collapsedItems
    );
  }, [activeId, items]);

  const childrenLabels = useMemo(() => {
    const map = new Map<string, string>();
    function walk(list: TreeItems) {
      for (const item of list) {
        if (item.label) map.set(String(item.id), item.label);
        walk(item.children);
      }
    }
    walk(items);
    return map;
  }, [items]);

  const childrenVariants = useMemo(() => {
    const map = new Map<string, "default" | "session" | "group">();
    function walk(list: TreeItems) {
      for (const item of list) {
        if (item.variant) map.set(String(item.id), item.variant);
        walk(item.children);
      }
    }
    walk(items);
    return map;
  }, [items]);

  const childrenSessionIds = useMemo(() => {
    const map = new Map<string, string[]>();
    function walk(list: TreeItems): string[] {
      const ids: string[] = [];
      for (const item of list) {
        if (item.variant === "session") {
          ids.push(String(item.id));
        } else {
          ids.push(...walk(item.children));
        }
      }
      return ids;
    }
    for (const item of items) {
      map.set(String(item.id), walk(item.children));
    }
    return map;
  }, [items]);

  const projected =
    activeId && overId
      ? getProjection(
          flattenedItems,
          activeId,
          overId,
          offsetLeft,
          indentationWidth
        )
      : null;

  // Clamp visual indicator: only show nesting depth when parent is a group.
  // Sessions can't nest inside other sessions.
  const shouldClamp = projected && projected.depth > 0 && (
    projected.parentId != null && !isGroupItemV2(projected.parentId, childrenVariants)
  );
  const clampedProjected =
    shouldClamp
      ? { ...projected!, depth: 0, parentId: null }
      : projected;

  const sensorContext: SensorContext = useRef({
    items: flattenedItems,
    offset: offsetLeft,
  });

  const [coordinateGetter] = useState(() =>
    sortableTreeKeyboardCoordinates(sensorContext, indicator, indentationWidth)
  );

  const sensors = useSensors(
    useSensor(PointerSensor, {
      activationConstraint: {
        distance: 8,
      },
    }),
    useSensor(KeyboardSensor, {
      coordinateGetter,
    })
  );

  const sortedIds = useMemo(
    () => flattenedItems.map(({id}) => id),
    [flattenedItems]
  );

  const activeItem = activeId
    ? flattenedItems.find(({id}) => id === activeId)
    : null;

  useEffect(() => {
    sensorContext.current = {
      items: flattenedItems,
      offset: offsetLeft,
    };
  }, [flattenedItems, offsetLeft]);

  const announcements: Announcements = {
    onDragStart({active}) {
      return `Picked up ${active.id}.`;
    },
    onDragMove({active, over}) {
      return getMovementAnnouncement('onDragMove', active.id, over?.id);
    },
    onDragOver({active, over}) {
      return getMovementAnnouncement('onDragOver', active.id, over?.id);
    },
    onDragEnd({active, over}) {
      return getMovementAnnouncement('onDragEnd', active.id, over?.id);
    },
    onDragCancel({active}) {
      return `Moving was cancelled. ${active.id} was dropped in its original position.`;
    },
  };

  return (
    <DndContext
      accessibility={{announcements}}
      sensors={sensors}
      collisionDetection={closestCenter}
      measuring={measuring}
      onDragStart={handleDragStart}
      onDragMove={handleDragMove}
      onDragOver={handleDragOver}
      onDragEnd={handleDragEnd}
      onDragCancel={handleDragCancel}
    >
      <SortableContext items={sortedIds} strategy={verticalListSortingStrategy}>
        <ul className="list-none p-0 m-0">
          {flattenedItems.map(({id, children, collapsed, depth}) => (
            <SortableTreeItem
              key={id}
              id={id}
              itemId={id as string}
              value={childrenLabels.get(id) ?? (id as string)}
              variant={childrenVariants.get(id)}
              renderActions={renderActions}
              childSessionIds={childrenSessionIds.get(String(id))}
              requestRemove={() => handleRemove(id)}
              groupChildCount={getChildCount(items, id)}
              depth={id === activeId && clampedProjected ? clampedProjected.depth : depth}
              indentationWidth={indentationWidth}
              indicator={indicator}
              collapsed={Boolean(collapsed && children.length)}
              onCollapse={
                collapsible && children.length
                  ? () => handleCollapse(id)
                  : undefined
              }
              onRemove={removable ? () => handleRemove(id) : undefined}
            />
          ))}
        </ul>
        {createPortal(
          <DragOverlay
            dropAnimation={dropAnimationConfig}
            modifiers={indicator ? [adjustTranslate] : undefined}
          >
            {activeId && activeItem ? (
              <SortableTreeItem
                id={activeId}
                depth={activeItem.depth}
                clone
                childCount={getChildCount(items, activeId) + 1}
                value={childrenLabels.get(activeId) ?? activeId.toString()}
                variant={childrenVariants.get(activeId)}
                renderActions={renderActions}
                childSessionIds={childrenSessionIds.get(String(activeId))}
                requestRemove={() => handleRemove(activeId)}
                groupChildCount={getChildCount(items, activeId)}
                itemId={activeId.toString()}
                indentationWidth={indentationWidth}
              />
            ) : null}
          </DragOverlay>,
          document.body
        )}
      </SortableContext>
    </DndContext>
  );

  function handleDragStart({active: {id: activeId}}: DragStartEvent) {
    setActiveId(activeId);
    setOverId(activeId);

    const activeItem = flattenedItems.find(({id}) => id === activeId);

    if (activeItem) {
      setCurrentPosition({
        parentId: activeItem.parentId,
        overId: activeId,
      });
    }

    document.body.style.setProperty('cursor', 'grabbing');
  }

  function handleDragMove({delta}: DragMoveEvent) {
    setOffsetLeft(delta.x);
  }

  function handleDragOver({over}: DragOverEvent) {
    setOverId(over?.id ?? null);
  }

  function handleDragEnd({active, over}: DragEndEvent) {
    resetState();

    if (clampedProjected && over) {
      let {depth, parentId} = clampedProjected;
      // Edge case: depth > 0 with no parent (list boundary) — force root
      if (depth > 0 && parentId == null) depth = 0;

      // Get full flattened tree (including children of active item)
      const flattenedTree = flattenTree(items);

      // Find active item and its descendants
      const activeIndex = flattenedTree.findIndex(({id}) => id === active.id);
      const activeItem = flattenedTree[activeIndex];
      const activeItemChildren = flattenedTree.filter(
        (item) => item.parentId === active.id
      );

      // Remove active item and its children from the array
      const itemsWithoutActive = flattenedTree.filter(
        (item) => item.id !== active.id && item.parentId !== active.id
      );

      // Find the new index for the active item (based on over item position)
      const overIndex = itemsWithoutActive.findIndex(({id}) => id === over.id);

      // Insert active item at new position with new depth/parentId
      const movedActiveItem = {...activeItem, depth, parentId};
      const newFlattened = arrayMove(
        [...itemsWithoutActive, movedActiveItem],
        itemsWithoutActive.length,
        overIndex === -1 ? itemsWithoutActive.length : overIndex
      );

      // Re-insert children of active item right after it, with updated depths
      const activeItemNewIndex = newFlattened.findIndex(
        ({id}) => id === active.id
      );
      const childrenWithUpdatedDepth = activeItemChildren.map((child) => ({
        ...child,
        depth: child.depth - activeItem.depth + depth,
        parentId: child.parentId === active.id ? active.id : child.parentId,
      }));

      const finalFlattened = [
        ...newFlattened.slice(0, activeItemNewIndex + 1),
        ...childrenWithUpdatedDepth,
        ...newFlattened.slice(activeItemNewIndex + 1),
      ];

      const newItems = buildTree(finalFlattened);
      setItems(newItems);
    }
  }

  function handleDragCancel() {
    resetState();
  }

  function resetState() {
    setOverId(null);
    setActiveId(null);
    setOffsetLeft(0);
    setCurrentPosition(null);

    document.body.style.setProperty('cursor', '');
  }

  function handleRemove(id: UniqueIdentifier) {
    setItems((items) => removeItem(items, id));
  }

  function handleCollapse(id: UniqueIdentifier) {
    setItems((items) =>
      setProperty(items, id, 'collapsed', (value) => {
        return !value;
      })
    );
  }

  function getMovementAnnouncement(
    eventName: string,
    activeId: UniqueIdentifier,
    overId?: UniqueIdentifier
  ) {
    if (overId && clampedProjected) {
      if (eventName !== 'onDragEnd') {
        if (
          currentPosition &&
          clampedProjected.parentId === currentPosition.parentId &&
          overId === currentPosition.overId
        ) {
          return;
        } else {
          setCurrentPosition({
            parentId: clampedProjected.parentId,
            overId,
          });
        }
      }

      const clonedItems: FlattenedItem[] = JSON.parse(
        JSON.stringify(flattenTree(items))
      );
      const overIndex = clonedItems.findIndex(({id}) => id === overId);
      const activeIndex = clonedItems.findIndex(({id}) => id === activeId);
      const sortedItems = arrayMove(clonedItems, activeIndex, overIndex);

      const previousItem = sortedItems[overIndex - 1];

      let announcement;
      const movedVerb = eventName === 'onDragEnd' ? 'dropped' : 'moved';
      const nestedVerb = eventName === 'onDragEnd' ? 'dropped' : 'nested';

      if (!previousItem) {
        const nextItem = sortedItems[overIndex + 1];
        announcement = `${activeId} was ${movedVerb} before ${nextItem.id}.`;
      } else {
        if (clampedProjected.depth > previousItem.depth) {
          announcement = `${activeId} was ${nestedVerb} under ${previousItem.id}.`;
        } else {
          let previousSibling: FlattenedItem | undefined = previousItem;
          while (previousSibling && clampedProjected.depth < previousSibling.depth) {
            const parentId: UniqueIdentifier | null = previousSibling.parentId;
            previousSibling = sortedItems.find(({id}) => id === parentId);
          }

          if (previousSibling) {
            announcement = `${activeId} was ${movedVerb} after ${previousSibling.id}.`;
          }
        }
      }

      return announcement;
    }

    return;
  }
}

const adjustTranslate: Modifier = ({transform}) => {
  return {
    ...transform,
    y: transform.y - 25,
  };
};
