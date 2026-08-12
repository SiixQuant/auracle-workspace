/**
 * The pack's one icon surface.
 *
 * Every registry, action catalog and command list stores a plain STRING icon
 * name — the Material Symbols ligatures the product was drawn with. Nothing but
 * this component knows those names resolve to lucide-react SVGs: the strings
 * stay the contract, and the mapping lives here alone. That keeps the pack
 * self-contained (inline SVG, tree-shaken, no host icon FONT, CSP-safe and
 * offline) without asking any caller to import lucide or change what it stores.
 *
 * An unknown name renders nothing rather than throwing — a surface that hands
 * over a name this table does not carry loses its glyph, never its render.
 */
import type { CSSProperties } from 'react';
import {
  Activity,
  Bookmark,
  BookmarkMinus,
  BookmarkPlus,
  Brain,
  ChartColumn,
  ChartPie,
  ClipboardCheck,
  Clock,
  Database,
  FileText,
  History,
  LayoutGrid,
  Library,
  Lightbulb,
  NotebookPen,
  Package,
  PlaneTakeoff,
  Play,
  ReceiptText,
  Rocket,
  Search,
  Sparkles,
  Telescope,
  TrendingUp,
  TriangleAlert,
  Zap,
  type LucideIcon,
} from 'lucide-react';

/**
 * Material Symbols ligature → lucide component. The keys are exactly the
 * strings the registries store (ROOM_ICONS, the AI action catalog, the palette
 * command icons); the values are the frontier equivalents. Two Material names
 * (`warning`, `crisis_alert`) collapse to one alert triangle on purpose.
 */
const ICONS: Record<string, LucideIcon> = {
  // Room icons (grid/districts.ts · ROOM_ICONS)
  lightbulb: Lightbulb,
  library_books: Library,
  dataset: Database,
  description: FileText,
  insights: TrendingUp,
  query_stats: ChartColumn,
  fact_check: ClipboardCheck,
  crisis_alert: TriangleAlert,
  donut_small: ChartPie,
  rocket_launch: Rocket,
  receipt_long: ReceiptText,
  warning: TriangleAlert,
  schedule: Clock,
  flight_takeoff: PlaneTakeoff,
  history: History,
  monitor_heart: Activity,
  // AI action catalog (grid/gridAiActions.ts · grid/boardScan.ts)
  edit_note: NotebookPen,
  psychology: Brain,
  auto_fix_high: Sparkles,
  bolt: Zap,
  travel_explore: Telescope,
  // Workspace commands (grid/gridWorkspaceCommands.ts)
  bookmark_add: BookmarkPlus,
  bookmark: Bookmark,
  bookmark_remove: BookmarkMinus,
  // Direct button sites
  play_arrow: Play,
  search: Search,
  grid_view: LayoutGrid,
  deployed_code: Package,
};

export interface IconProps {
  /** The Material Symbols ligature name the registry stores. */
  name: string;
  /** Rendered width and height in px. Matches the old glyph's fontSize. */
  size?: number;
  className?: string;
  style?: CSSProperties;
  'aria-hidden'?: boolean;
}

/**
 * Render the lucide glyph for a stored icon name, or nothing when the name is
 * not one this table carries. Colour rides `currentColor`, so a `color` in
 * `style` (or on `className`) tints the SVG exactly as it tinted the font.
 */
export function Icon({
  name,
  size = 16,
  className,
  style,
  'aria-hidden': ariaHidden,
}: IconProps): JSX.Element | null {
  const Glyph = ICONS[name];
  if (!Glyph) return null;
  return <Glyph size={size} className={className} style={style} aria-hidden={ariaHidden} />;
}
