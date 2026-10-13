---
name: Industrial OP Operations
colors:
  surface: '#111317'
  surface-dim: '#111317'
  surface-bright: '#37393e'
  surface-container-lowest: '#0c0e12'
  surface-container-low: '#1a1c20'
  surface-container: '#1e2024'
  surface-container-high: '#282a2e'
  surface-container-highest: '#333539'
  on-surface: '#e2e2e8'
  on-surface-variant: '#e0c0b1'
  inverse-surface: '#e2e2e8'
  inverse-on-surface: '#2f3035'
  outline: '#a78b7d'
  outline-variant: '#584237'
  surface-tint: '#ffb690'
  primary: '#ffb690'
  on-primary: '#552100'
  primary-container: '#f97316'
  on-primary-container: '#582200'
  inverse-primary: '#9d4300'
  secondary: '#ffb599'
  on-secondary: '#5a1c00'
  secondary-container: '#f66018'
  on-secondary-container: '#4f1700'
  tertiary: '#7bd0ff'
  on-tertiary: '#00354a'
  tertiary-container: '#00a6df'
  on-tertiary-container: '#00374d'
  error: '#ffb4ab'
  on-error: '#690005'
  error-container: '#93000a'
  on-error-container: '#ffdad6'
  primary-fixed: '#ffdbca'
  primary-fixed-dim: '#ffb690'
  on-primary-fixed: '#341100'
  on-primary-fixed-variant: '#783200'
  secondary-fixed: '#ffdbce'
  secondary-fixed-dim: '#ffb599'
  on-secondary-fixed: '#370e00'
  on-secondary-fixed-variant: '#7f2b00'
  tertiary-fixed: '#c4e7ff'
  tertiary-fixed-dim: '#7bd0ff'
  on-tertiary-fixed: '#001e2c'
  on-tertiary-fixed-variant: '#004c69'
  background: '#111317'
  on-background: '#e2e2e8'
  surface-variant: '#333539'
typography:
  headline-xl:
    fontFamily: Space Grotesk
    fontSize: 36px
    fontWeight: '700'
    lineHeight: 44px
    letterSpacing: -0.02em
  headline-lg:
    fontFamily: Space Grotesk
    fontSize: 28px
    fontWeight: '700'
    lineHeight: 36px
    letterSpacing: -0.015em
  headline-md:
    fontFamily: Space Grotesk
    fontSize: 22px
    fontWeight: '600'
    lineHeight: 28px
  headline-sm:
    fontFamily: Space Grotesk
    fontSize: 18px
    fontWeight: '600'
    lineHeight: 24px
  body-lg:
    fontFamily: Hanken Grotesk
    fontSize: 16px
    fontWeight: '400'
    lineHeight: 24px
  body-md:
    fontFamily: Hanken Grotesk
    fontSize: 14px
    fontWeight: '400'
    lineHeight: 20px
  body-sm:
    fontFamily: Hanken Grotesk
    fontSize: 12px
    fontWeight: '400'
    lineHeight: 16px
  label-lg:
    fontFamily: JetBrains Mono
    fontSize: 14px
    fontWeight: '500'
    lineHeight: 20px
  label-md:
    fontFamily: JetBrains Mono
    fontSize: 12px
    fontWeight: '500'
    lineHeight: 16px
  label-sm:
    fontFamily: JetBrains Mono
    fontSize: 11px
    fontWeight: '500'
    lineHeight: 14px
    letterSpacing: 0.04em
  headline-xl-mobile:
    fontFamily: Space Grotesk
    fontSize: 28px
    fontWeight: '700'
    lineHeight: 34px
  headline-lg-mobile:
    fontFamily: Space Grotesk
    fontSize: 22px
    fontWeight: '700'
    lineHeight: 28px
rounded:
  sm: 0.125rem
  DEFAULT: 0.25rem
  md: 0.375rem
  lg: 0.5rem
  xl: 0.75rem
  full: 9999px
spacing:
  gutter: 1rem
  margin: 1.5rem
  space-xs: 0.25rem
  space-sm: 0.5rem
  space-md: 0.75rem
  space-lg: 1.25rem
  space-xl: 2rem
---

## Brand & Style

This design system is tailored for mission-critical industrial manufacturing management, specifically tracking and controlling Production Orders (Ordens de Produção - OPs), assembly lines, materials, and shop floor throughput. The brand personality conveys mechanical precision, uncompromising reliability, industrial durability, and modern engineering excellence.

The target audience comprises production managers, floor supervisors, logistics planners, and ERP system operators who interact with massive amounts of dense operational data under high-pressure circumstances. The interface evokes feelings of command, swift efficiency, structural clarity, and zero-error confidence.

The design movement synthesizes **Industrial High-Density Modernism** with subtle **Frosted Glassmorphism**:
- Deep obsidian foundation layers paired with industrial safety orange accents derived from automotive manufacturing cues.
- Sleek, semi-translucent backdrop filters on floating drawers, fly-out filter panels, and collapsible navigation bars.
- Razor-sharp utility with micro-rounded structural edges that balance industrial equipment sturdiness with contemporary digital sophistication.

## Colors

The palette directly honors the industrial heritage of automotive component manufacturing—combining oil-and-carbon dark neutrals with high-visibility safety orange.

- **Primary (`#F97316` / `#EA580C`)**: High-visibility Industrial Orange reserved strictly for primary execution hooks (e.g., "Confirmar e Cadastrar", "Gerar Prévia", "Copiar OPs para SAP"), active navigation badges, and critical batch triggers.
- **Secondary (`#EA580C`)**: Deeper mechanical orange used for hover states, focused outlines, and active filter tabs.
- **Tertiary (`#38BDF8`)**: Electric Cyan indicator for system statuses, telemetry, processing states, and active data filter badges.
- **Neutral Core (`#0F1115` & `#161920`)**: Deep anthracite bases engineered to eliminate visual fatigue during long terminal shifts, contrasting with structural surfaces (`#1E222B`), card containers (`#262B36`), and borders (`#333A48`).
- **Typography & High-Contrast Accents**: Clean Crisp Light Slate (`#F8FAFC`) for primary headers, `#E2E8F0` for general labels, and `#94A3B8` for secondary tabular metadata.
- **Mode Adaptation**: Default is optimized for deep dark industrial terminals. When transitioning to light mode, backgrounds invert to `#F8FAFC` and `#FFFFFF`, borders switch to `#CBD5E1`, with the primary orange remaining authoritative and vibrant.

## Typography

The typographic hierarchy is engineered around industrial ergonomics:
- **Headlines (`Space Grotesk`)**: Technical, geometric, and assertive. Provides strong structural anchoring for panel headers, operational titles, and summary KPIs without taking up excessive vertical footprint.
- **Body (`Hanken Grotesk`)**: Clean, contemporary grotesque with exceptional legibility across dense form controls, select menus, input arrays, and multi-line batch fields.
- **Data & Codes (`JetBrains Mono`)**: Applied to all production order numbers (OPs), material codes, part counts, batch lots, timestamps, and column header keys. Monospaced tabular figures guarantee exact vertical optical alignment across extensive enterprise grids.

## Layout & Spacing

This design system uses a high-density, flexible workbench layout tailored for heavy data entry and real-time monitoring.

- **Grid Architecture**: A 12-column adaptive grid with a fixed collapsible left navigation rail (64px collapsed, 260px expanded) and a main content viewport containing persistent control toolbars and modular card panes.
- **Spatial Rhythm**: An ultra-compact scale optimized for enterprise data throughput. Row spacing and component margins default to condensed formats (`space-xs` = 4px, `space-sm` = 8px, `space-md` = 12px) to maximize on-screen records without requiring scroll on standard 1080p industrial displays.
- **Form Layouts**: Multi-textarea batch inputs (OP numbers, quantities, material codes) are structured in an aligned 3-column synchronized matrix on desktop screens, collapsing cleanly into stacked steps on narrower viewports.
- **Breakpoints**: 
  - `Desktop Wide` (≥1440px): 12 columns, multi-pane side-by-side data table + preview drawer.
  - `Desktop Standard` (1024px–1439px): Collapsible sidebar with sticky action header.
  - `Tablet / Mobile Terminal` (&lt;1023px): Off-canvas flyout drawer with horizontal table scrolling and stacked form controls.

## Elevation & Depth

Visual hierarchy combines calibrated tonal layering with precision glassmorphism to preserve clarity over dense backgrounds:

- **Level 0 (Canvas)**: Solid foundational tone `#0F1115` providing extreme contrast with pure tabular figures.
- **Level 1 (Panels & Table Surfaces)**: Elevated dark charcoal `#161920` with a 1px crisp low-contrast perimeter outline (`rgba(255, 255, 255, 0.08)`).
- **Level 2 (Active Modals, Drawers & Glass Filters)**: Semi-translucent obsidian base (`rgba(22, 25, 32, 0.78)`) combined with a `backdrop-blur(16px)` and delicate ambient drop shadow (`0 20px 40px rgba(0, 0, 0, 0.45)`). This delivers modern glass aesthetics without sacrificing text legibility.
- **Level 3 (Dropdowns, Context Menus, Tooltips)**: Elevated `#1E222B` with a sharp top highlight border (`border-t: 1px solid rgba(249, 115, 22, 0.4)`) indicating active machine state.

## Shapes

The design system adopts a sturdy, machine-tooled corner radius (Level 1 - Soft):
- **Base Components**: Inputs, action buttons, table cell badges, and chips feature a compact `0.25rem` (4px) corner radius, conveying technical precision and modular enterprise efficiency.
- **Containers & Glass Panels**: Elevated drawers, modals, and major card groupings use `0.5rem` (8px) to soften panel boundaries while maintaining industrial sharpness.
- **Pill Exceptions**: Small status indicator pills ("Concluído", "Falta Pagar", "Em Produção") maintain a pill shape (`9999px`) purely for quick visual scanning against squared tabular cells.

## Components

### Buttons
- **Primary Industrial Button**: Vibrant industrial orange background (`#F97316`), bold font, dark label (`#0F1115` or `#FFFFFF` bold), micro-radius (4px), 36px standard height. Hover triggers `#EA580C` with a micro-glow (`box-shadow: 0 0 12px rgba(249, 115, 22, 0.35)`).
- **Secondary / Utility Button**: Dark surface (`#1E222B`) with a 1px border (`#333A48`) and `#E2E8F0` text. Used for "Copiar OPs para o SAP" or "Exportar XLS".
- **Ghost Action Button**: Transparent background, hovering reveals `rgba(255, 255, 255, 0.05)`. Used for table row actions (edit, delete, view history).

### Data Tables (High-Density Enterprise)
- **Header Cell**: Monospaced small label (`label-sm`), uppercase, tracking, `#94A3B8`, with embedded inline sort icons and quick-column filter inputs embedded directly below the label.
- **Data Rows**: 38px compact row height. Subtle alternating background (`#161920` vs `#191D25`). Hover shifts row to `#212631` with a 2px left border accent in `#F97316`.
- **Status Dots & Chips**: Colored indicators (Green for Concluído/Liberado, Amber for Pendente/Análise, Red for Bloqueado/Atrasado, Orange for Prioridade Alta).
- **Pagination & Footer**: Sticky bottom toolbar housing record counters, per-page selectors (25, 50, 100), and compact numeric step controls.

### Batch Import Forms & Multi-Line Textareas
- **Synchronized Triad Fields**: Triplet layout for "Números das OPs", "Total de Peças", and "Materiais". Uses `JetBrains Mono` at 13px with active line numbering on the left edge.
- **Form Controls (Selects & Dates)**: 34px compact height, `#1E222B` surface, `#333A48` border, focus ring with orange border glow.
- **Instant Preview Matrix**: Pre-submission validation table showing row-by-row mapping errors (e.g., mismatching line counts) highlighted in subtle red translucent bars.

### Collapsible Sidebar & Glass Drawers
- **Collapsible Rail**: 64px icon-only state expanding to 260px full navigation tree. Smooth 200ms cubic-bezier transition.
- **Active Navigation Item**: Solid `#F97316` left edge indicator with subtle orange gradient wash across the active item tile.
- **Filter Fly-Out Drawer**: Floating glass panel anchored to the right, utilizing `backdrop-filter: blur(16px)` over table content, enabling live filtering by Setor (Montagem, Usinagem, BCM, Célula, Subconjunto) and Prioridade.

### Checkboxes & Bulk Selectors
- Custom 16x16px checkbox with sharp 2px radius, `#1E222B` unselected background with `#475569` border. Checked state fills with `#F97316` accompanied by an industrial white checkmark. Indeterminate state shows a centered horizontal bar.