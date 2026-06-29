import {
  LayoutDashboard,
  Users,
  Target,
  PhoneCall,
  FolderKanban,
  ListChecks,
  ClipboardList,
  Sparkles,
  Layers,
  Settings,
  Bot,
  Inbox,
  CalendarClock,
  GraduationCap,
  PenLine,
  BrainCircuit,
  Newspaper,
  type LucideIcon,
} from "lucide-react";

export interface NavItem {
  href: string;
  label: string;
  icon: LucideIcon;
  group: "Overview" | "Pipeline" | "Delivery" | "Intelligence" | "System";
}

export const NAV: NavItem[] = [
  { href: "/", label: "Dashboard", icon: LayoutDashboard, group: "Overview" },
  { href: "/agenda", label: "Agenda", icon: CalendarClock, group: "Overview" },
  { href: "/inbox", label: "Inbox", icon: Inbox, group: "Pipeline" },
  { href: "/leads", label: "Leads", icon: Users, group: "Pipeline" },
  { href: "/targets", label: "Targets", icon: Target, group: "Pipeline" },
  { href: "/interactions", label: "Interactions", icon: PhoneCall, group: "Pipeline" },
  { href: "/pain-bank", label: "Pain Point Bank", icon: Layers, group: "Pipeline" },
  { href: "/projects", label: "Projects", icon: FolderKanban, group: "Delivery" },
  { href: "/tasks", label: "Tasks", icon: ListChecks, group: "Delivery" },
  { href: "/scorecard", label: "Daily Scorecard", icon: ClipboardList, group: "Intelligence" },
  { href: "/advisor", label: "Sales Advisor", icon: Bot, group: "Intelligence" },
  { href: "/content", label: "Content Studio", icon: PenLine, group: "Intelligence" },
  { href: "/brain", label: "Brain", icon: BrainCircuit, group: "Intelligence" },
  { href: "/news", label: "News", icon: Newspaper, group: "Intelligence" },
  { href: "/prep", label: "Meeting Prep", icon: GraduationCap, group: "Intelligence" },
  { href: "/review", label: "AI Business Review", icon: Sparkles, group: "Intelligence" },
  { href: "/settings", label: "Settings", icon: Settings, group: "System" },
];

export const NAV_GROUPS: NavItem["group"][] = [
  "Overview",
  "Pipeline",
  "Delivery",
  "Intelligence",
  "System",
];
