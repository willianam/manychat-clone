import {
  BarChart3,
  Home,
  Link2,
  Megaphone,
  Settings,
  Tag,
  Users,
  Workflow,
  Zap,
  type LucideIcon,
} from "lucide-react";

export type NavItem = { href: string; label: string; icon: LucideIcon };

/** The sidebar, in the order the owner works through it. */
export const NAV: NavItem[] = [
  { href: "/", label: "Início", icon: Home },
  { href: "/flows", label: "Fluxos", icon: Workflow },
  { href: "/gatilhos", label: "Gatilhos", icon: Zap },
  { href: "/contacts", label: "Contatos", icon: Users },
  { href: "/tags", label: "Etiquetas", icon: Tag },
  { href: "/broadcasts", label: "Disparos", icon: Megaphone },
  { href: "/insights", label: "Insights", icon: BarChart3 },
  { href: "/ref-links", label: "Links", icon: Link2 },
  { href: "/configuracoes", label: "Configurações", icon: Settings },
];

/** Routes that render without the app chrome: public or pre-login. */
export const BARE_ROUTES = ["/login", "/privacidade"];

/** "/" matches only itself; every other item matches its subtree (`/flows/abc`). */
export function isActive(href: string, pathname: string): boolean {
  if (href === "/") return pathname === "/";
  return pathname === href || pathname.startsWith(`${href}/`);
}

export function isBareRoute(pathname: string): boolean {
  return BARE_ROUTES.some((p) => pathname === p || pathname.startsWith(`${p}/`));
}

/** Header title for the current route, falling back to the app name. */
export function titleFor(pathname: string): string {
  return NAV.find((n) => isActive(n.href, pathname))?.label ?? "ManyChat Clone";
}
