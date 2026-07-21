import React, {forwardRef, HTMLAttributes} from 'react';

export interface Props extends Omit<HTMLAttributes<HTMLLIElement>, 'id'> {
  childCount?: number;
  clone?: boolean;
  collapsed?: boolean;
  depth: number;
  disableInteraction?: boolean;
  disableSelection?: boolean;
  ghost?: boolean;
  handleProps?: any;
  indicator?: boolean;
  indentationWidth: number;
  value: string;
  onCollapse?(): void;
  onRemove?(): void;
  wrapperRef?(node: HTMLLIElement): void;
}

export const TreeItem = forwardRef<HTMLLIElement, Props>(
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
      style,
      value,
      wrapperRef,
      ...props
    },
    ref
  ) => {
    return (
      <li
        ref={wrapperRef}
        style={{
          paddingLeft: `${indentationWidth * depth}px`,
          listStyle: 'none',
          marginBottom: '-1px',
          ...(clone
            ? {
                display: 'inline-block',
                pointerEvents: 'none',
                padding: 0,
                paddingLeft: 10,
                paddingTop: 5,
              }
            : undefined),
          ...(ghost
            ? indicator
              ? {
                  opacity: 1,
                  position: 'relative',
                  zIndex: 1,
                  marginBottom: -1,
                }
              : {opacity: 0.5}
            : undefined),
          ...style,
        }}
        {...props}
      >
        <div
          className="relative flex items-center py-2.5 px-2.5 bg-white border border-zinc-200 text-zinc-800 box-border dark:bg-zinc-900 dark:border-zinc-700 dark:text-zinc-200"
          style={
            clone
              ? {
                  borderRadius: 4,
                  boxShadow: '0px 15px 15px 0 rgba(34, 33, 81, 0.1)',
                }
              : undefined
          }
        >
          <Handle
            {...handleProps}
            style={disableSelection ? {userSelect: 'none'} : undefined}
          />
          {onCollapse && (
            <button
              className="flex items-center justify-center w-5 h-5 mr-1 rounded cursor-pointer hover:bg-zinc-100 dark:hover:bg-zinc-800 border-0 bg-transparent"
              onClick={onCollapse}
              aria-label={collapsed ? 'Expand' : 'Collapse'}
            >
              <svg
                className={`transition-transform duration-250 ease ${
                  collapsed ? '-rotate-90' : ''
                }`}
                width="8"
                viewBox="0 0 8 8"
                fill="currentColor"
              >
                <path d="M1.5 0L6.5 4L1.5 8V0Z" />
              </svg>
            </button>
          )}
          <span
            className="flex-1 pl-1 whitespace-nowrap overflow-hidden text-ellipsis text-[13px]"
            style={disableSelection ? {userSelect: 'none'} : undefined}
          >
            {value}
          </span>
          {!clone && onRemove && (
            <button
              className="flex items-center justify-center w-5 h-5 ml-1 rounded cursor-pointer hover:bg-red-50 dark:hover:bg-red-900/30 border-0 bg-transparent text-zinc-400 hover:text-red-500"
              onClick={onRemove}
              aria-label="Remove"
            >
              <svg
                width="8"
                viewBox="0 0 22 22"
                fill="currentColor"
              >
                <path d="M2.99998 -0.000206962C2.7441 -0.000206962 2.48794 0.0972617 2.29294 0.292762L0.292945 2.29276C-0.0980552 2.68376 -0.0980552 3.31682 0.292945 3.70682L7.58591 10.9998L0.292945 18.2928C-0.0980552 18.6838 -0.0980552 19.3168 0.292945 19.7068L2.29294 21.7068C2.68394 22.0978 3.31701 22.0978 3.70701 21.7068L11 14.4139L18.2929 21.7068C18.6829 22.0978 19.317 22.0978 19.707 21.7068L21.707 19.7068C22.098 19.3158 22.098 18.6828 21.707 18.2928L14.414 10.9998L21.707 3.70682C22.098 3.31682 22.098 2.68276 21.707 2.29276L19.707 0.292762C19.316 -0.0982383 18.6829 -0.0982383 18.2929 0.292762L11 7.58573L3.70701 0.292762C3.51151 0.0972617 3.25585 -0.000206962 2.99998 -0.000206962Z" />
              </svg>
            </button>
          )}
          {clone && childCount && childCount > 1 ? (
            <span className="absolute -top-2.5 -right-2.5 flex items-center justify-center w-6 h-6 rounded-full bg-blue-500 text-[11px] font-semibold text-white">
              {childCount}
            </span>
          ) : null}
        </div>
      </li>
    );
  }
);

TreeItem.displayName = 'TreeItem';

function Handle(props: React.HTMLAttributes<HTMLDivElement>) {
  return (
    <svg
      className="cursor-grab touch-none inline-block flex-shrink-0 w-3 h-5 text-zinc-400 hover:text-zinc-600 dark:hover:text-zinc-300"
      viewBox="0 0 10 18"
      xmlns="http://www.w3.org/2000/svg"
      {...props}
    >
      <path
        d="M1 1L9 1M1 9L9 9M1 17L9 17"
        stroke="currentColor"
        strokeWidth="2"
        strokeLinecap="round"
        fill="none"
      />
    </svg>
  );
}
