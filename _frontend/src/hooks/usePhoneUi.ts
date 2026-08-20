import { useEffect } from "react";
import { useConfigStore } from "../stores/config";
import { useIsMobile } from "./useIsMobile";

/**
 * Applies phone UI config as CSS custom properties on the document root.
 * Only takes effect when isMobile is true (below lg breakpoint).
 * Values are read from config.phoneUi with sensible defaults.
 */
export function usePhoneUi(): void {
  const isMobile = useIsMobile();
  const phoneUi = useConfigStore((s) => s.config.phoneUi);

  useEffect(() => {
    if (!isMobile) {
      // Clear custom properties on desktop so they don't leak
      document.documentElement.style.removeProperty("--phone-message-scale");
      document.documentElement.style.removeProperty("--phone-ui-scale");
      document.documentElement.style.removeProperty("--phone-input-height-scale");
      document.documentElement.style.removeProperty("--phone-touch-scale");
      return;
    }

    const {
      enabled = true,
      messageFontScale = 1.3,
      uiFontScale = 1.2,
      inputHeightScale = 1.5,
      touchTargetScale = 1.2,
    } = phoneUi ?? {};

    if (!enabled) {
      document.documentElement.style.removeProperty("--phone-message-scale");
      document.documentElement.style.removeProperty("--phone-ui-scale");
      document.documentElement.style.removeProperty("--phone-input-height-scale");
      document.documentElement.style.removeProperty("--phone-touch-scale");
      return;
    }

    document.documentElement.style.setProperty("--phone-message-scale", String(messageFontScale));
    document.documentElement.style.setProperty("--phone-ui-scale", String(uiFontScale));
    document.documentElement.style.setProperty("--phone-input-height-scale", String(inputHeightScale));
    document.documentElement.style.setProperty("--phone-touch-scale", String(touchTargetScale));
  }, [isMobile, phoneUi]);
}
