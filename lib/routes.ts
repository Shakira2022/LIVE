import { Activity, Bell, Building2, CircleDot, ClipboardList, History, House, LifeBuoy, Radio, ShieldCheck, Siren, Users, type LucideIcon } from "lucide-react";
import type { UserRole } from "@/lib/types";
export interface NavItem { label: string; mobileLabel?: string; href: string; icon: LucideIcon; primary?: boolean; }
export const roleNavigation: Record<UserRole, NavItem[]> = {
  requester: [
    { label: "Home", href: "/app/requester", icon: House },
    { label: "Request help", mobileLabel: "Help", href: "/app/requester/new", icon: Siren, primary: true },
    { label: "History", href: "/app/requester/history", icon: History },
    { label: "Notifications", mobileLabel: "Notifications", href: "/app/requester/notifications", icon: Bell },
  ],
  dispatcher: [
    { label: "Live operations", mobileLabel: "Live", href: "/app/dispatcher", icon: House },
    { label: "Request queue", mobileLabel: "Queue", href: "/app/dispatcher/requests", icon: ClipboardList },
    { label: "Resources", href: "/app/dispatcher/resources", icon: Users },
    { label: "Notifications", href: "/app/dispatcher/notifications", icon: Bell },
  ],
  responder: [
    { label: "Mission", href: "/app/responder", icon: House },
    { label: "History", href: "/app/responder/history", icon: History },
    { label: "Notifications", mobileLabel: "Notifications", href: "/app/responder/notifications", icon: Bell },
    { label: "Availability", mobileLabel: "Status", href: "/app/responder/profile", icon: CircleDot },
  ],
  admin: [
    { label: "Overview", href: "/app/admin", icon: House },
    { label: "Reports", mobileLabel: "Reports", href: "/app/admin/reports", icon: Bell },
    { label: "Users", href: "/app/admin/users", icon: Users },
    { label: "Organisations", mobileLabel: "Orgs", href: "/app/admin/organisations", icon: Building2 },
    { label: "Support", href: "/app/admin/support", icon: LifeBuoy },
  ],
  auditor: [
    { label: "Review", href: "/app/auditor", icon: House },
    { label: "Incidents", href: "/app/auditor/incidents", icon: ClipboardList },
    { label: "Audit logs", mobileLabel: "Logs", href: "/app/auditor/audit", icon: ShieldCheck },
    { label: "Security logs", mobileLabel: "Security", href: "/app/auditor/security", icon: ShieldCheck },
    { label: "Application logs", mobileLabel: "Application", href: "/app/auditor/application", icon: Activity },
    { label: "Integration logs", mobileLabel: "Integration", href: "/app/auditor/integration", icon: Radio },
  ],
  manager: [
    { label: "Overview", href: "/app/manager", icon: House },
    { label: "Incidents", href: "/app/manager/incidents", icon: ClipboardList },
    { label: "Security", href: "/app/manager/security", icon: ShieldCheck },
  ],
};
