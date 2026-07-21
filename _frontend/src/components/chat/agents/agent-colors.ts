/**
 * Agent Color System
 *
 * Generates deterministic, visually distinct CSS custom properties for each agent
 * based on a hash of the agent name. Colors are theme-aware (dark-first) and
 * designed for use as left-border accents, background tints, and text highlights.
 *
 * Adapted from OpenCode's agent-colors pattern.
 * Uses a curated palette of visually pleasing hues that avoid harsh purples
 * and overly saturated tones.
 *
 * Common agent names ("assistant", "main", "user") get hardcoded neutral colors
 * so the default agent doesn't look green.
 */

export interface AgentColorTokens {
  /** Primary text color for the agent */
  text: string;
  /** Subtle background tint */
  bg: string;
  /** Hover state background */
  bgHover: string;
  /** Border color (subtle) */
  border: string;
  /** Active / emphasis border color */
  borderActive: string;
  /** Shadow color for depth */
  shadow: string;
}

/** djb2-based string hash → unsigned 32-bit integer */
function djb2Hash(str: string): number {
  let hash = 5381;
  for (let i = 0; i < str.length; i++) {
    hash = ((hash << 5) + hash + str.charCodeAt(i)) >>> 0;
  }
  return hash;
}

/**
 * Hardcoded color overrides for common agent names.
 * "assistant" is the fallback name — give it a neutral steel blue.
 */
const NAMED_COLORS: Record<string, AgentColorTokens> = {
  assistant: {
    text:          "hsl(210, 40%, 72%)",
    bg:            "hsl(210, 20%, 12%)",
    bgHover:       "hsl(210, 20%, 16%)",
    border:        "hsl(210, 20%, 26%)",
    borderActive:  "hsl(210, 35%, 50%)",
    shadow:        "hsla(210, 25%, 35%, 10%)",
  },
  main: {
    text:          "hsl(220, 45%, 70%)",
    bg:            "hsl(220, 22%, 12%)",
    bgHover:       "hsl(220, 22%, 16%)",
    border:        "hsl(220, 22%, 28%)",
    borderActive:  "hsl(220, 40%, 52%)",
    shadow:        "hsla(220, 28%, 38%, 10%)",
  },
  user: {
    text:          "hsl(190, 40%, 68%)",
    bg:            "hsl(190, 18%, 12%)",
    bgHover:       "hsl(190, 18%, 16%)",
    border:        "hsl(190, 18%, 26%)",
    borderActive:  "hsl(190, 35%, 50%)",
    shadow:        "hsla(190, 22%, 32%, 10%)",
  },
};

/**
 * Neutral grey default for unnamed agents without a color override.
 * Matches the theme's zinc palette with a subtle slate undertone.
 */
const DEFAULT_COLORS: AgentColorTokens = {
  text:          "hsl(220, 15%, 65%)",
  bg:            "hsl(220, 8%, 13%)",
  bgHover:       "hsl(220, 8%, 17%)",
  border:        "hsl(220, 8%, 26%)",
  borderActive:  "hsl(220, 15%, 48%)",
  shadow:        "hsla(220, 10%, 30%, 10%)",
};

/** Extract hue from a hex color string. Returns 0-360. */
function hexToHue(hex: string): number {
  let r = 0, g = 0, b = 0;
  const h = hex.replace(/^#/, "");
  if (h.length === 3) {
    r = parseInt(h[0] + h[0], 16);
    g = parseInt(h[1] + h[1], 16);
    b = parseInt(h[2] + h[2], 16);
  } else if (h.length >= 6) {
    r = parseInt(h.slice(0, 2), 16);
    g = parseInt(h.slice(2, 4), 16);
    b = parseInt(h.slice(4, 6), 16);
  }
  r /= 255; g /= 255; b /= 255;
  const max = Math.max(r, g, b), min = Math.min(r, g, b);
  let hue = 0;
  if (max !== min) {
    const d = max - min;
    switch (max) {
      case r: hue = ((g - b) / d + (g < b ? 6 : 0)) * 60; break;
      case g: hue = ((b - r) / d + 2) * 60; break;
      case b: hue = ((r - g) / d + 4) * 60; break;
    }
  }
  return Math.round(hue);
}

function tokensFromHue(hue: number): AgentColorTokens {
  return {
    text:          `hsl(${hue}, 45%, 65%)`,
    bg:            `hsl(${hue}, 28%, 13%)`,
    bgHover:       `hsl(${hue}, 28%, 17%)`,
    border:        `hsl(${hue}, 25%, 28%)`,
    borderActive:  `hsl(${hue}, 38%, 50%)`,
    shadow:        `hsla(${hue}, 28%, 35%, 10%)`,
  };
}

/**
 * Generate a full set of color tokens for an agent name.
 * Common names use hardcoded colors. Everything else uses the
 * neutral grey default. An optional override hex color will
 * replace the hue for all tokens.
 */
export function generateAgentColors(agentName: string, overrideColor?: string): AgentColorTokens {
  const lower = agentName.toLowerCase();
  if (!overrideColor && NAMED_COLORS[lower]) {
    return NAMED_COLORS[lower];
  }

  if (overrideColor) {
    return tokensFromHue(hexToHue(overrideColor));
  }

  return DEFAULT_COLORS;
}

/**
 * Returns CSS custom properties for an agent, suitable for inline styles.
 * Usage: <div style={agentColorStyles("my-agent")}>
 */
export function agentColorStyles(agentName: string): React.CSSProperties {
  const colors = generateAgentColors(agentName);
  return {
    "--agent-text":          colors.text,
    "--agent-bg":            colors.bg,
    "--agent-bg-hover":      colors.bgHover,
    "--agent-border":        colors.border,
    "--agent-border-active": colors.borderActive,
    "--agent-shadow":        colors.shadow,
  } as React.CSSProperties;
}

/**
 * Returns a flat object of CSS custom property strings.
 * Useful for computed style injection.
 */
export function agentColorCSS(agentName: string): Record<string, string> {
  const colors = generateAgentColors(agentName);
  return {
    "--agent-text":          colors.text,
    "--agent-bg":            colors.bg,
    "--agent-bg-hover":      colors.bgHover,
    "--agent-border":        colors.border,
    "--agent-border-active": colors.borderActive,
    "--agent-shadow":        colors.shadow,
  };
}

/**
 * Returns the first character of an agent name, uppercased.
 */
export function getAgentInitial(agentName: string): string {
  return agentName.charAt(0).toUpperCase();
}
