import { create } from "zustand";

let _hideTimer: ReturnType<typeof setTimeout> | null = null;

interface ToastState {
  visible: boolean;
  message: string;
  /** Show a transient confirmation (e.g. "Saved") for a short moment. Calling
   * repeatedly (e.g. per-input-keystroke saves) just resets the timer. */
  notify: (message?: string) => void;
}

export const useToastStore = create<ToastState>((set) => ({
  visible: false,
  message: "Saved",
  notify: (message = "Saved") => {
    if (_hideTimer) clearTimeout(_hideTimer);
    set({ visible: true, message });
    _hideTimer = setTimeout(() => set({ visible: false }), 1600);
  },
}));
