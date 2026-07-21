# Visual Studio Harness UI Design Standards

The UI uses a **dark atmospheric glassmorphism** design built on Tailwind's zinc palette.

## Color Palette

All colors use Tailwind's `zinc-*` family.

| Role | Class | Usage |
|------|-------|-------|
| Page background | `bg-zinc-950` | body default |
| Glass card | `bg-zinc-900/40` | card, sidebar panels |
| Solid surface | `bg-zinc-900` | dropdowns, modals |
| Hover surface | `bg-zinc-800` | dropdown items, buttons |
| Elevated hover | `bg-zinc-800/80` | workspace picker items |
| Subtle hover | `bg-zinc-800/50` | sidebar session items |
| Glass border | `border-zinc-700/20` | cards, sidebar |
| Strong border | `border-zinc-700` | dropdowns, inputs |

## Text Color Hierarchy

| Level | Class | Where |
|-------|-------|-------|
| Highest | `text-zinc-100` | body default, primary content |
| Active | `text-zinc-200` | selected dropdown items |
| Body | `text-zinc-300` | chat text, sidebar titles, dropdown items |
| Muted | `text-zinc-400` | compact triggers default state |
| Subtle | `text-zinc-500` | pill triggers, search icons, secondary info |
| Dim | `text-zinc-600` | placeholders, labels, empty states, "no results" |
| Disabled | `opacity-25` or `text-zinc-600` | disabled buttons |

### Placeholders

- **NewChat textarea**: `placeholder-zinc-600`
- **Inline input / PromptInput**: `placeholder-zinc-500`
- **Search input**: `placeholder-zinc-500`

## Divider / Separator

- **Inside glass panels (toolbar, header/footer)**: `border-white/[0.04]` — extremely subtle, transparent white
- **Between major sections**: `border-zinc-800` or `border-zinc-800/50`

## Frosted Glass Card

```
rounded-2xl border border-zinc-700/20 bg-zinc-900/40 backdrop-blur-2xl
```

- Has a **rim light**: `h-px bg-gradient-to-r from-transparent via-white/10 to-transparent` along the top edge
- **Box shadow** (idle): `0 0 56px rgba(59,130,246,0.17), 0 0 42px rgba(255,255,255,0.08), 0 25px 50px -12px rgba(0,0,0,0.4)`
- **Box shadow** (hover): `0 0 80px rgba(59,130,246,0.24), 0 0 60px rgba(255,255,255,0.12), 0 25px 50px -12px rgba(0,0,0,0.4)`

## Background Effects

- **Dot grid**: 5% opacity, `radial-gradient(rgba(255,255,255,0.6) 1px, transparent 1px)`, 32px grid
- **Glow orbs**: large blurred circles (`blur-[140px]` to `blur-[160px]`) with low-opacity colors (blue, violet, zinc)
- Wrap in `pointer-events-none` container

## Buttons

### Pill trigger (toolbar)
```
text-sm text-zinc-500 px-2 py-1 rounded-md border border-transparent
hover:text-zinc-500 hover:border-zinc-700/30 transition-colors
```
Text stays `text-zinc-500` on hover (only border reveals).

### Compact pill trigger (chat input)
```
text-xs border border-zinc-700 text-zinc-400 hover:text-zinc-200 hover:border-zinc-600
```
Text brightens on hover.

### Ghost send button
```
bg-transparent hover:bg-white/10 text-zinc-500 hover:text-zinc-300
hover:scale-105 active:scale-95 disabled:opacity-25
```

### Solid send/stop
```
px-3 py-2 rounded-lg bg-zinc-700 hover:bg-zinc-600 text-zinc-300 hover:text-white
```

### Stop button
```
bg-red-600/60 hover:bg-red-500 text-white
```

## Dropdowns

```
rounded-lg border border-zinc-700 bg-zinc-900 shadow-xl
```
- Items: `text-xs text-zinc-300 hover:bg-zinc-800 px-2 py-1.5 rounded`
- Selected: `bg-zinc-800 text-zinc-200`
- Header: `text-[10px] uppercase tracking-wide text-zinc-600 font-medium`

## Inputs

- **Chat textarea**: `bg-transparent text-sm text-zinc-300 placeholder-zinc-600 resize-none min-h-[44px] focus:outline-none`
- **Regular input**: `bg-zinc-800 border border-zinc-700 text-sm text-zinc-100 placeholder-zinc-500 focus:outline-none focus:border-zinc-500 rounded-lg`

## Scrollbar

Scrollbars should be visually minimal:
```
scrollbar-width: thin;
scrollbar-color: rgba(113, 113, 122, 0.15) transparent;
```
Hover state: `scrollbar-color: rgba(113, 113, 122, 0.3) transparent;`

## Sidebar Specific

- Uses the same frosted glass as the NewChat card: `bg-zinc-900/40 backdrop-blur-2xl`
- Right-side rim light: vertical gradient `w-px bg-gradient-to-b from-transparent via-white/10 to-transparent`
- Dividers: `border-white/[0.04]` (matching `cardToolbar`)
- Session titles: `text-zinc-300` (matching body-level active text)
- Session subtitles: `text-zinc-500` (matching subtle/trigger text)
- Active item: `bg-zinc-700/50` with `border-zinc-600/20`
- Hover item: `hover:bg-zinc-800/50` with `hover:border-zinc-700/20`
- Search input: `bg-zinc-800/50 border-zinc-700/30 text-zinc-300 placeholder-zinc-500`
