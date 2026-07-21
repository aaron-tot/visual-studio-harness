/**
 * PendingActions
 *
 * Displays action chips for queued or pending operations (e.g., tool calls
 * waiting for permission, queued messages). Each chip can be clicked to
 * take action or dismissed.
 */

import { X, Clock, AlertTriangle } from "lucide-react";
import { cn } from "../../../lib/utils";

export interface PendingAction {
  id: string;
  label: string;
  type: "permission" | "config" | "waiting" | "error";
  toolName?: string;
  onAction?: () => void;
  onDismiss?: () => void;
}

interface PendingActionsProps {
  actions: PendingAction[];
  className?: string;
}

const TYPE_STYLES: Record<PendingAction["type"], string> = {
  permission: "border-amber-500/40 bg-amber-500/10 text-amber-300",
  config: "border-violet-500/40 bg-violet-500/10 text-violet-300",
  waiting: "border-blue-500/40 bg-blue-500/10 text-blue-300",
  error: "border-red-500/40 bg-red-500/10 text-red-300",
};

const TYPE_ICONS: Record<PendingAction["type"], typeof Clock> = {
  permission: AlertTriangle,
  config: Clock,
  waiting: Clock,
  error: AlertTriangle,
};

export function PendingActions({ actions, className }: PendingActionsProps) {
  if (actions.length === 0) return null;

  return (
    <div className={cn("flex flex-wrap gap-1.5 px-4 pb-2", className)}>
      {actions.map((action) => {
        const Icon = TYPE_ICONS[action.type];
        return (
          <div
            key={action.id}
            className={cn(
              "inline-flex items-center gap-1.5 px-2 py-1 rounded-full text-[10px] border transition-colors",
              TYPE_STYLES[action.type],
            )}
          >
            <Icon size={10} className="shrink-0" />
            <button
              type="button"
              onClick={action.onAction}
              className="hover:underline truncate max-w-[200px]"
            >
              {action.label}
            </button>
            {action.onDismiss && (
              <button
                type="button"
                onClick={action.onDismiss}
                className="shrink-0 opacity-60 hover:opacity-100 transition-opacity"
              >
                <X size={10} />
              </button>
            )}
          </div>
        );
      })}
    </div>
  );
}
