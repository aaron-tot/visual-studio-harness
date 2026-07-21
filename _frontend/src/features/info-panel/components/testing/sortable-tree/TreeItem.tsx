import {forwardRef, type HTMLAttributes, type ReactNode} from 'react';
import {cn} from '../../../../../lib/utils';

export interface TreeItemProps extends Omit<HTMLAttributes<HTMLLIElement>, 'id'> {
  childCount?: number;
  clone?: boolean;
  collapsed?: boolean;
  depth: number;
  disableInteraction?: boolean;
  disableSelection?: boolean;
  ghost?: boolean;
  handleProps?: Record<string, unknown>;
  indicator?: boolean;
  indentationWidth: number;
  value: string;
  variant?: "default" | "session" | "group";
  renderActions?: (id: string, label: string, childCount?: number, requestRemove?: () => void, isDragOverlay?: boolean, childSessionIds?: string[]) => ReactNode;
  groupChildCount?: number;
  childSessionIds?: string[];
  itemId?: string;
  requestRemove?: () => void;
  onCollapse?(): void;
  onRemove?(): void;
  wrapperRef?(node: HTMLLIElement): void;
}

export const TreeItem = forwardRef<HTMLLIElement, TreeItemProps>(
  (
    {
      childCount,
      clone,
      depth,
      disableSelection,
      disableInteraction,
      ghost,
      handleProps,
      indentationWidth,
      indicator,
      collapsed,
      onCollapse,
      onRemove,
      renderActions,
      groupChildCount,
      childSessionIds,
      itemId,
      requestRemove,
      style,
      value,
      variant,
      wrapperRef,
      ...props
    },
    ref
  ) => {
    return (
      <li
        ref={wrapperRef}
        className={cn(
          'list-none box-content',
          clone && 'inline-block pointer-events-none p-0 pl-2.5 pt-1.5',
          clone && '[&>.tree-item]:py-1.5 [&>.tree-item]:rounded [&>.tree-item]:shadow-lg',
          ghost && indicator && 'relative z-10 mb-[-1px] opacity-100',
          ghost && !indicator && 'opacity-50',
          ghost && '[&>.tree-item]:shadow-none [&>.tree-item]:bg-transparent',
          disableInteraction && 'pointer-events-none'
        )}
        style={{
          paddingLeft: clone ? 10 : depth * indentationWidth,
          marginBottom: -1,
          ...style,
        }}
      >
        <div
          ref={ref}
          className={cn(
            'tree-item',
            'flex items-center relative',
            'box-border select-none',
            // default variant
            (!variant || variant === 'default') && 'py-2.5 px-2.5 bg-zinc-900 border border-zinc-800 text-zinc-200',
            // session variant
            variant === 'session' && 'py-1 px-2.5 text-sm text-zinc-400 hover:bg-zinc-800/20 cursor-pointer group',
            // group variant
            variant === 'group' && 'py-1 px-2 text-sm font-medium text-zinc-400 bg-zinc-800/40 border border-zinc-700 rounded group',
            ghost && indicator && 'border-blue-500 bg-blue-400 h-2 p-0',
            ghost && indicator && '[&>*]:opacity-0 [&>*]:h-0',
            ghost && indicator && 'before:content-[\'\'] before:absolute before:-left-2 before:-top-1 before:block before:w-3 before:h-3 before:rounded-full before:border before:border-blue-500 before:bg-white',
            clone && '[&_.text]:select-none',
            clone && '[&_.count]:select-none'
          )}
          {...props}
          {...handleProps}
        >
          {onCollapse && (
            <button
              className={cn(
                'flex items-center justify-center w-6 h-6 mr-1.5 shrink-0 rounded',
                'bg-transparent border-none cursor-pointer text-zinc-400',
                'hover:text-zinc-200 hover:bg-zinc-700/50 transition-colors'
              )}
              tabIndex={0}
              onClick={onCollapse}
            >
              <svg
                width="12"
                viewBox="0 0 22 22"
                className={cn(
                  'transition-transform duration-250',
                  collapsed && '-rotate-90'
                )}
                xmlns="http://www.w3.org/2000/svg"
              >
                <path
                  fill="currentColor"
                  d="M7 7L15 11L7 15V7Z"
                />
              </svg>
            </button>
          )}
          {renderActions ? (
            <div className="flex-1 flex items-center gap-1 min-w-0">
              {renderActions(itemId ?? value, value, groupChildCount, requestRemove, !!clone, childSessionIds)}
            </div>
          ) : (
            <>
              <span className="text flex-grow pl-1.5 whitespace-nowrap text-ellipsis overflow-hidden text-xs">
                {value}
              </span>
              {!clone && onRemove && (
                <button
                  className={cn(
                    'flex items-center justify-center w-4 h-4',
                    'bg-transparent border-none cursor-pointer text-zinc-500',
                    'hover:text-red-400 transition-colors'
                  )}
                  tabIndex={0}
                  onClick={onRemove}
                >
                  <svg width="8" viewBox="0 0 22 22" xmlns="http://www.w3.org/2000/svg">
                    <path
                      fill="currentColor"
                      d="M2.99998 -0.000206962C2.7441 -0.000206962 2.48794 0.0972617 2.29294 0.292762L0.292945 2.29276C-0.0980552 2.68376 -0.0980552 3.31682 0.292945 3.70682L7.58591 10.9998L0.292945 18.2928C-0.0980552 18.6838 -0.0980552 19.3168 0.292945 19.7068L2.29294 21.7068C2.68394 22.0978 3.31701 22.0978 3.70701 21.7068L11 14.4139L18.2929 21.7068C18.6829 22.0978 19.317 22.0978 19.707 21.7068L21.707 19.7068C22.098 19.3158 22.098 18.6828 21.707 18.2928L14.414 10.9998L21.707 3.70682C22.098 3.31682 22.098 2.68276 21.707 2.29276L19.707 0.292762C19.316 -0.0982383 18.6829 -0.0982383 18.2929 0.292762L11 7.58573L3.70701 0.292762C3.51151 0.0972617 3.25585 -0.000206962 2.99998 -0.000206962Z"
                    />
                  </svg>
                </button>
              )}
            </>
          )}
          {clone && childCount && childCount > 1 ? (
            <span className="count absolute -top-2.5 -right-2.5 flex items-center justify-center w-6 h-6 rounded-full bg-blue-500 text-[0.8rem] font-semibold text-white">
              {childCount}
            </span>
          ) : null}
        </div>
      </li>
    );
  }
);

TreeItem.displayName = 'TreeItem';
