# Design System: Schadek Industrial Dashboard
**Project ID:** ordens-producao-enterprise

## 1. Visual Theme & Atmosphere
This is an enterprise industrial dashboard designed for production order management (PCP). The visual language combines dark mode as the default with clean, professional aesthetics suitable for manufacturing environments. The interface emphasizes data density with clear hierarchy, using an accent orange-primary (#f97316) against dark surfaces to draw attention to critical actions and KPI metrics. The design follows an information-dense pattern typical of factory floor monitoring systems, where quick status interpretation is essential. Whitespace is used strategically to separate functional groups without reducing usable screen real estate. The overall mood is operational, reliable, and industrially polished — not decorative, but purpose-built for order tracking and production oversight.

## 2. Color Palette & Roles

### Primary Foundation
- `--bg-canvas: #0c0e12` — Dark canvas background (dark theme)
- `--bg-surface: #111317` — Secondary surface panels and cards
- `--bg-container-low: #161920` — Input backgrounds, light containers
- `--bg-container: #1e222b` — KPI cards, table rows
- `--bg-container-high: #262b36` — Elevated containers, hover states
- `--bg-container-highest: #333a48` — Deep elevated states
- `--primary: #f97316` — Primary action accent (orange)
- `--primary-hover: #ea580c` — Primary hover state
- `--primary-glow: rgba(249, 115, 22, 0.35)` — Shadow/glow for primary elements
- `--primary-light: #ffb690` — Primary in lighter contexts
- `--on-primary: #ffffff` — Text on primary backgrounds

### Accent & Interactive
- `--secondary: #ffb599` — Secondary accent, disabled states
- `--tertiary: #38bdf8` — Secondary accent color (sky blue)
- `--tertiary-glow: rgba(56, 189, 248, 0.25)` — Tertiary glow effect

### Typography & Text Hierarchy
- `--text-main: #f8fafc` — Primary text on dark backgrounds
- `--text-muted: #94a3b8` — Secondary text, disabled elements
- `--text-subtle: #64748b` — Helper text, placeholders, subtle labels
- `--outline: #333a48` — Divider and border base color
- `--outline-light: rgba(255, 255, 255, 0.08)` — Light borders on dark

### Functional States
- `--status-red: #ef4444` — Errors, critical warnings
- `--status-red-bg: rgba(239, 68, 68, 0.14)` — Red background accents
- `--status-red-border: rgba(239, 68, 68, 0.3)` — Red borders
- `--status-amber: #f59e0b` — Warnings, non-critical alerts
- `--status-amber-bg: rgba(245, 158, 11, 0.14)` — Amber background accents
- `--status-amber-border: rgba(245, 158, 11, 0.3)` — Amber borders
- `--status-green: #10b981` — Success, completed items
- `--status-green-bg: rgba(16, 185, 129, 0.14)` — Green background accents
- `--status-green-border: rgba(16, 185, 129, 0.3)` — Green borders

### Light Theme Overrides (html:not(.dark))
- Light canvas: `--bg-canvas: #f1f5f9`
- Light surfaces: `--bg-surface: #f8fafc`
- Primary remains `--primary: #f97316`
- Status colors adjust for light mode visibility

## 3. Typography Rules

### Font Families
- `--font-headline: 'Space Grotesk', -apple-system, BlinkMacSystemFont, sans-serif` — Headings, strong accents
- `--font-body: 'Hanken Grotesk', -apple-system, BlinkMacSystemFont, sans-serif` — Body text, general UI
- `--font-mono: 'JetBrains Mono', monospace` — Monospace for codes, numbers, monospace contexts

### Type Scale & Hierarchy
- **Base text**: 14px, line-height 1.5, family: `--font-body`
- **KPI numbers**: 30px, family: `--font-headline`, weight 700, line-height 1
- **Section labels (kpi-label)**: 11px, family: `--font-mono`, uppercase, letter-spacing 0.05em
- **Header titles (toolbar-title)**: 22px, family: `--font-headline`, weight 700, letter-spacing -0.01em
- **Navigation items (nav-item)**: 13px, font-weight 500
- **Sector badges (btnSetor, btnTodos)**: 13px, weight 600
- **Table headers (thead th)**: 11px, family: `--font-mono`, uppercase, letter-spacing 0.05em
- **Table cells (td)**: 13px
- **Input/Select text**: 13px, inherited font
- **Badge telemetry**: 11px, family: `--font-mono`
- **Subtext labels (kpi-subtext)**: 12px, color: `--text-subtle`
- **Batch labels (batch-label)**: 11px, weight 600, family: `--font-mono`, uppercase

### Spacing Principles
- **Base rhythm**: 1.5 line-height for body text
- **Section spacing (dashboard-grid gap)**: 24px between major sections
- **KPI card padding**: 18px horizontal, 20px vertical
- **KPI number spacing**: 8px gap within kpi-value-row
- **Toolbar gap**: 16px between toolbar groups
- **Sector bar gap**: 12px between buttons
- **Bulk action gap**: 16px general, 10px form elements
- **Input padding**: 6px horizontal, 12px vertical (bulk inputs)
- **Radius scale**: `--radius-sm: 4px`, `--radius-md: 8px`, `--radius-lg: 12px`, `--radius-full: 9999px`
- **Header height**: `--header-height: 64px`
- **Sidebar width**: `--sidebar-width: 250px` (collapsed to 72px)
- **Table row border-left**: 3px solid transparent (activates on hover)

### Shadow & Transition
- **Transition curve**: `cubic-bezier(0.4, 0, 0.2, 1)` — applied consistently
- **KPI card hover shadow**: `0 6px 18px rgba(0, 0, 0, 0.3)`
- **Card base shadow**: `0 2px 10px rgba(0, 0, 0, 0.2)`
- **Sidebar shadow**: `0 4px 20px rgba(0, 0, 0, 0.35)`
- **Header shadow**: `0 4px 20px rgba(0, 0, 0, 0.35)` (dark), `0 2px 10px rgba(0, 0, 0, 0.05)` (light)
- **Input focus shadow**: `0 0 0 2px var(--primary-glow)`

## 4. Component Stylings

### Buttons
- **Primary button (btn-primary-action)**: Linear gradient `var(--primary) 0%, var(--primary-hover) 100%`, no border, white text, 8px-18px padding, `box-shadow: 0 4px 14px var(--primary-glow)`, transition on all properties,:hover adds `filter: brightness(1.1)` and `translateY(-1px)`
- **Secondary button (btnCopiar, btnGerarPrevia)**: Background `var(--bg-container)`, text `var(--text-main)`, 1px solid `var(--outline-light)`, 8px-16px padding, rounded `var(--radius-md)`, hover shifts to `var(--bg-container-high)`, adds subtle color shift
- **Tertiary button (btn-icon, btnSidebarToggle)**: Similar to secondary but with `var(--bg-container-low)`, hover to `var(--bg-container)`, color to `var(--primary)`
- **Danger button (btn-danger-action)**: Solid `--status-red`, white text, no border, radius `var(--radius-sm)`,:hover brightness 1.15 with box-shadow
- **Active state (nav-item.active)**: Linear gradient `var(--primary) 0%, var(--primary-hover) 100%`, white text, box-shadow `0 4px 14px var(--primary-glow)`
- **Hover states**: Most interactive elements shift background to `var(--bg-container)` and color to `var(--primary)` or `var(--text-main)`

### Cards & Containers
- **KPI cards (.kpi-card)**: Background `var(--bg-container-low)`, 1px border `var(--outline-light)`, radius `var(--radius-lg)`, padding 18px 20px, box-shadow `0 2px 10px rgba(0, 0, 0, 0.2)`,:hover transforms `translateY(-2px)` with enhanced shadow and border-color in primary glow
- **Card danger/warning/success variants**: Each has specific border-color mapping to status colors
- **Bulk actions bar**: Gradient background from darkest `#1e1e2d` to slightly lighter, 1px solid `var(--primary)` with box-shadow `0 4px 18px var(--primary-glow)`, radius `var(--radius-md)`
- **Table card (.table-card)**: Background `var(--bg-container-low)`, 1px border `var(--outline-light)`, radius `var(--radius-lg)`, shadow `0 4px 20px rgba(0, 0, 0, 0.25)`

### Navigation
- **Sidebar (.app-sidebar)**: Fixed left, full height, background `var(--bg-canvas)`, 1px border `var(--outline-light)`, sidebar-collapsed reduces to 72px with `.nav-text` hidden
- **Sidebar nav items**: Flex row with gap 12px, padding 10px 14px, radius `var(--radius-md)`, hover to `var(--bg-container-low)` with text to `var(--text-main)`, active state with primary gradient
- **Header (.app-header)**: Fixed top, height `var(--header-height)`, rgba background with backdrop-filter, shadow, flex layout with brand-left, center section, and right actions
- **Header brand**: Uses `--font-headline` for title, `--font-mono` for subtitle, primary color on "SCHADEK"
- **Header right actions**: Buttons with consistent sizing 38px, radius `var(--radius-md)`, hover states

### Data Tables
- **Table (#tabelaOrdens)**: Collapse separate, width 100%, border-spacing 0
- **Table headers**: Background `var(--bg-canvas)`, muted text, family `--font-mono`, size 11px, uppercase, letter-spacing 0.05em, padding 12px 16px, pointer cursor, transition on all
- **Table header hover**: Color shifts to `var(--primary)`, background to `var(--bg-container-low)`
- **Table even rows**: Subtle overlay `rgba(30, 34, 43, 0.4)`
- **Table row hover**: Background to `var(--bg-container-high)`, left border `3px solid var(--primary)`
- **Checkbox cells**: Width 44px, center-aligned, accent-color `var(--primary)` on checkboxes
- **Action column**: Width 64px, center-aligned
- **Editable cells (td[data-coluna])**: Cursor pointer, hover dashed outline in primary color
- **Material column**: Monospace font, weight 600, tertiary color
- **Situation column**: Weight 600, size 12px
- **Priority column**: Weight 600, size 12px

### Form Elements (Batch Panel)
- **Textareas (#listaOPs, #listaPecas, #listaMateriais)**: Full width, background `var(--bg-surface)`, 1px border `var(--outline)`, radius `var(--radius-md)`, padding 10px 12px, monospace font 13px, line-height 1.6, focus border `var(--primary)` with glow
- **Inputs/Selects (#dataAberturaLote, #diaAnaliseLote, #setorLote, #situacaoLote, #prioridadeLote)**: Background `var(--bg-container-low)`, 1px border `var(--outline)`, radius `var(--radius-sm)`, padding 7px 10px, size 13px, focus border `var(--primary)`
- **Select controls (.bulk-select, .bulk-input)**: Background `var(--bg-surface)`, 1px border `var(--outline)`, radius `var(--radius-sm)`, padding 6px 12px, size 13px, focus border `var(--primary)` with glow `0 0 0 2px var(--primary-glow)`

### Input Selectors & Bulk Actions
- **Bulk field container**: Dynamic form generation based on `campoMassa` selection
- **Bulk input placeholder patterns**: "Máx 8 dígitos (ex: 40005698)" for material, "Ex: 100" for total_pecas
- **Status selector**: Options "Falta Pagar", "Pago", "Encerrado"
- **Sector selector**: Options "Montagem", "Subconjunto", "Celula", "BCM", "Importada", "Usinagem"
- **Priority selector**: All 8 priority values from the system

### Badges & Status Indicators
- **Telemetry badges (.badge-telemetry)**: Background `var(--bg-container-low)`, 1px border `var(--outline-light)`, radius `var(--radius-full)`, monospace 11px, padded 5px 12px
- **Pulse dot animation**: 7px circle, primary green, 2s infinite pulse
- **Status dots (legend-dot)**: 8px radius circles, color-coded red/amber/white
- **KPI tags**: Monospace 11px, padded 2px 6px, with color-coded backgrounds matching status colors

### Feedback Messages
- **Toast notification (.toast-notification)**: Fixed bottom-right, rgba background with backdrop-filter, radius `var(--radius-lg)`, padding 14px 20px, shadow `0 10px 30px rgba(0,0,0,0.4)`, slide-up animation from `translateY(120px)` to `translateY(0)`

## 5. Layout Principles

### Grid & Structure
- **KPI grid (.kpi-grid)**: `grid-template-columns: repeat(auto-fit, minmax(240px, 1fr))` with 16px gap — auto-responsive, min 240px per card
- **Main content**: `max-width: 1600px`, centered with auto margins
- **Batch grid (.batch-grid-textareas)**: `grid-template-columns: repeat(auto-fit, minmax(280px, 1fr))` with 16px gap
- **Batch controls grid**: `grid-template-columns: repeat(auto-fit, minmax(170px, 1fr))` with 12px gap
- **Sector navigation**: Flex layout with `justify-content: space-between`, overflow-x auto on container

### Whitespace Strategy
- **Global padding**: 28px 32px on `.main-wrapper`, 24px on `#batch-panel`
- **Section margins**: 24px gap in dashboard-container, 20px gap in batch-panel
- **Table footer**: 12px 18px padding
- **Table utility bar**: 12px 18px padding with 1px bottom border

### Responsive Behavior
- **Mobile-first approach**: KPI grid auto-fits with minmax(240px, 1fr)
- **Sidebar collapse**: `.sidebar-collapsed` class reduces sidebar to 72px, hides text labels, adjusts main-wrapper margin
- **Table horizontal overflow**: `overflow-x: auto` on `.table-responsive-container`
- **Sector bar**: `overflow-x: auto` enables horizontal scrolling on narrow screens
- **Textareas**: `resize: vertical` allowed

### Alignment & Visual Balance
- **Primary CTA alignment**: Gradient buttons use `align-items: center`, `justify-content: center`
- **Header layout**: `align-items: center` with `justify-content: space-between`
- **KPI value alignment**: `align-items: center`, `justify-content: space-between`
- **Table data**: `vertical-align: middle` on all td elements
- **Priority legends**: `white-space: nowrap` to keep legend items on one line

### Touch Target Sizing
- **Minimum interactive**: 38px × 38px (btn-icon, btnSidebarToggle, nav-item)
- **Button padding**: Minimum 8px vertical padding for all action buttons
- **Checkbox size**: 16px × 16px with `accent-color: var(--primary)`
- **Input minimum width**: 150px on bulk inputs

## 6. Design System Notes for Stitch Generation

### Language to Use
- Use natural language describing mood and function, not CSS syntax
- Reference colors by descriptive names: "Deep Muted Orange Primary", "Factory Status Red", "Cool Sky Blue Accent"
- Emphasize operational clarity and data readability over decorative aesthetics
- Use industrial terminology consistent with PCP (Production Control) environments

### Color References (for Stitch prompts)
- **Primary Foundation**: Deep Muted Orange `#f97316` — CTA buttons, active navigation, focus states
- **Status Red**: Factory Error `#ef4444` — Critical alerts, error states
- **Status Amber**: Warning `#f59e0b` — Warnings, non-critical alerts  
- **Status Green**: Success `#10b981` — Completed orders, valid states
- **Cool Sky Blue Accent**: `#38bdf8` — Secondary accent, alternative CTA
- **Dark Canvas**: `#0c0e12` — Primary background
- **Industrial Slate**: `#111317` — Secondary surfaces
- **Off-White Muted**: `#64748b` — Secondary text, disabled states

### Component Prompts for Stitch
1. **Dashboard KPI Grid**: "Generate a responsive dashboard with 4 KPI cards in a grid layout. Cards have dark background with subtle shadows, orange accent highlights on hover, and display large numerical values in bold typography with smaller subtitle text. Include pulse animation on status indicator."
2. **Sector Filter Tabs**: "Create horizontal tab navigation with a primary active button and inactive buttons in muted state. Active button should have gradient background from orange to darker orange, white text, and shadow. Inactive buttons have light background with muted text. Include responsive overflow for mobile."
3. **Data Table**: "Generate a production orders table with fixed header, alternating row colors, and hover effects. Table should have a left accent bar on hover (#f97316 orange). Include checkbox column, sortable headers with sort indicator arrows, and action column with delete buttons."
4. **Batch Import Panel**: "Create a collapsible panel with three text input areas for OP numbers, piece counts, and materials (max 8 digits). Include a 5-field form for date, sector, situation, and priority. Add action buttons for generating preview and confirming batch. Use dark container with accent border."
5. **Primary Action Button**: "Generate a primary call-to-action button with gradient background from orange to darker orange, white text, no border, slight shadow, and hover effect that increases brightness and lifts slightly."

### Incremental Iteration
- When refining screens in Stitch, prioritize maintaining the dark industrial aesthetic
- Keep the orange-primary as the dominant accent for all interactive elements
- Ensure KPI numbers remain large and highly visible against dark backgrounds
- Maintain the consistent use of CSS custom properties (`var(--...) ) for all theming
- Preserve the responsive grid behavior where KPI cards adapt from 4 columns to 1 column
- Keep sidebar navigation functionality with collapse/expand toggle
- Ensure table hover states and row selection remain functional

---
*Generated from vanilla HTML/CSS/JS production orders dashboard. Design system captures the visual language for continued iteration in Google Stitch.*