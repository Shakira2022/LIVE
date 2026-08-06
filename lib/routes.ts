import { Activity, Bell, Building2, ClipboardList, FileSearch, Gauge, History, MapPinned, Radio, Settings, ShieldCheck, Siren, UserRound, Users, type LucideIcon } from "lucide-react";
import type { UserRole } from "@/lib/types";
export interface NavItem { label: string; mobileLabel?: string; href: string; icon: LucideIcon; primary?: boolean; }
export const roleNavigation: Record<UserRole, NavItem[]> = {
  requester: [
    { label: "Home", href: "/app/requester", icon: Gauge },
    { label: "Request help", mobileLabel: "Help", href: "/app/requester/new", icon: Siren, primary: true },
    { label: "History", href: "/app/requester/history", icon: History },
    { label: "Notifications", mobileLabel: "Alerts", href: "/app/requester/notifications", icon: Bell },
    { label: "Profile", href: "/app/requester/profile", icon: UserRound },
  ],
  dispatcher: [
    { label: "Live operations", mobileLabel: "Live", href: "/app/dispatcher", icon: Radio },
    { label: "Request queue", mobileLabel: "Queue", href: "/app/dispatcher/requests", icon: ClipboardList },
    { label: "Resources", href: "/app/dispatcher/resources", icon: Users },
    { label: "Activity", href: "/app/dispatcher/activity", icon: Activity },
  ],
  responder: [
    { label: "Mission", href: "/app/responder", icon: MapPinned },
    { label: "History", href: "/app/responder/history", icon: History },
    { label: "Profile", href: "/app/responder/profile", icon: UserRound },
  ],
  admin: [
    { label: "Overview", href: "/app/admin", icon: Activity },
    { label: "Users", href: "/app/admin/users", icon: Users },
    { label: "Organisations", mobileLabel: "Orgs", href: "/app/admin/organisations", icon: Building2 },
    { label: "Audit", href: "/app/admin/audit", icon: ShieldCheck },
    { label: "Settings", href: "/app/admin/settings", icon: Settings },
  ],
  auditor: [
    { label: "Review", href: "/app/auditor", icon: FileSearch },
    { label: "Incidents", href: "/app/auditor/incidents", icon: ClipboardList },
    { label: "Audit logs", mobileLabel: "Logs", href: "/app/auditor/audit", icon: ShieldCheck },
    { label: "Profile", href: "/app/auditor/profile", icon: UserRound },
  ],
};
