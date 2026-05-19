"use client";

import Link from "next/link";
import { usePathname } from "next/navigation";
import { useMemo } from "react";
import {
  LayoutDashboard,
  MessageSquare,
  Shield,
  HelpCircle,
  LogOut,
  Bell,
  Settings,
  Users,
  Crown,
} from "lucide-react";
import { supabase } from "@/lib/supabase";
import { useRouter } from "next/navigation";
import { useCurrentUser } from "@/hooks/useCurrentUser";

interface NavItem {
  href: string;
  label: string;
  icon: React.ComponentType<{ className?: string }>;
}

const baseNavItems: NavItem[] = [
  { href: "/dashboard", label: "Dashboard", icon: LayoutDashboard },
  { href: "/console", label: "Workspace", icon: MessageSquare },
  { href: "/vault", label: "Vault", icon: Shield },
];

interface AppShellProps {
  children: React.ReactNode;
}

export default function AppShell({ children }: AppShellProps) {
  const pathname = usePathname();
  const router = useRouter();
  const { user } = useCurrentUser();
  const userRole = user?.role ?? null;
  const isSuperadmin = Boolean(user?.is_platform_admin || user?.role === "superadmin");
  const isLeader = userRole === "leader";

  const navItems = useMemo(() => {
    const items = [...baseNavItems];
    if (isLeader || isSuperadmin) {
      items.splice(1, 0, { href: "/org", label: "Organization", icon: Users });
    }
    if (isSuperadmin) {
      items.push({ href: "/admin", label: "Admin", icon: Crown });
    }
    return items;
  }, [isLeader, isSuperadmin]);

  async function handleLogout() {
    await supabase.auth.signOut();
    document.cookie = "sb-access-token=; path=/; max-age=0";
    router.push("/login");
  }

  return (
    <div className="min-h-screen bg-background text-on-surface flex overflow-hidden">
      {/* Sidebar */}
      <nav className="bg-surface-container-low/80 backdrop-blur-lg h-screen w-64 fixed left-0 top-0 border-r border-outline-variant/20 hidden md:flex flex-col py-8 gap-6 z-40">
        {/* Brand */}
        <div className="px-6 flex items-center gap-3">
          <div className="w-10 h-10 rounded-lg bg-surface-container-high border border-outline-variant/30 flex items-center justify-center relative overflow-hidden">
            <span className="absolute inset-0 bg-primary/20 animate-pulse" />
            <span className="w-2 h-2 rounded-full bg-secondary status-glow z-10" />
          </div>
          <div>
            <h1 className="font-sans text-xl font-semibold text-primary leading-tight">Core OS</h1>
            <p className="font-mono text-xs text-outline">v4.0.2-Stable</p>
          </div>
        </div>

        {/* New Session */}
        <Link
          href="/console"
          className="mx-6 bg-primary/10 border border-primary/30 hover:border-primary/60 text-primary font-mono text-xs font-semibold tracking-[0.1em] uppercase py-3 px-4 rounded-lg flex items-center justify-center gap-2 transition-all hover:bg-primary/20 primary-glow"
        >
          <span className="text-lg leading-none">+</span>
          New Session
        </Link>

        {/* Nav Items */}
        <div className="flex-1 flex flex-col gap-1 px-4">
          {navItems.map((item) => {
            const isActive = pathname === item.href;
            const Icon = item.icon;
            return (
              <Link
                key={item.label}
                href={item.href}
                className={`flex items-center gap-3 px-4 py-3 rounded-lg transition-all group ${
                  isActive
                    ? "bg-secondary/10 text-secondary border-r-4 border-secondary relative"
                    : "text-on-surface-variant hover:bg-surface-variant/30 hover:text-on-surface"
                }`}
              >
                {isActive && (
                  <span className="absolute inset-y-0 right-0 w-[1px] bg-secondary shadow-[0_0_10px_rgba(78,222,163,0.8)]" />
                )}
                <Icon className={`w-5 h-5 ${isActive ? "text-secondary" : "text-outline group-hover:text-on-surface"}`} />
                <span className="font-mono text-xs font-semibold tracking-[0.1em] uppercase">
                  {item.label}
                </span>
              </Link>
            );
          })}
        </div>

        {/* Bottom Nav */}
        <div className="flex flex-col gap-1 px-4 mt-auto">
          <button className="flex items-center gap-3 px-4 py-3 rounded-lg text-on-surface-variant hover:bg-surface-variant/30 hover:text-on-surface transition-all group text-left">
            <HelpCircle className="w-5 h-5 text-outline group-hover:text-on-surface" />
            <span className="font-mono text-xs font-semibold tracking-[0.1em] uppercase">Support</span>
          </button>
          <button
            onClick={handleLogout}
            className="flex items-center gap-3 px-4 py-3 rounded-lg text-on-surface-variant hover:bg-surface-variant/30 hover:text-on-surface transition-all group text-left"
          >
            <LogOut className="w-5 h-5 text-outline group-hover:text-on-surface" />
            <span className="font-mono text-xs font-semibold tracking-[0.1em] uppercase">Sign Out</span>
          </button>
        </div>
      </nav>

      {/* Main Content Wrapper */}
      <div className="flex-1 md:ml-64 flex flex-col min-h-screen relative">
        {/* TopAppBar */}
        <header className="bg-surface/60 backdrop-blur-xl fixed top-0 w-full z-50 border-b border-outline-variant/20 shadow-sm h-16 md:w-[calc(100%-16rem)] md:left-64 transition-all">
          <div className="flex justify-between items-center h-full px-8 max-w-[1440px] mx-auto">
            <div className="md:hidden">
              <span className="font-mono text-xs font-semibold tracking-[0.1em] text-primary uppercase">
                Anonymizer Core
              </span>
            </div>
            <div className="hidden md:flex items-center">
              <span className="font-mono text-xs font-semibold tracking-[0.1em] text-primary uppercase">
                Anonymizer Core
              </span>
            </div>
            <div className="flex items-center gap-3">
              <button className="text-on-surface-variant hover:text-primary transition-colors p-2 rounded-full hover:bg-surface-variant/50">
                <Bell className="w-5 h-5" />
              </button>
              <button className="text-on-surface-variant hover:text-primary transition-colors p-2 rounded-full hover:bg-surface-variant/50">
                <Settings className="w-5 h-5" />
              </button>
              <div className="w-8 h-8 rounded-full border border-outline-variant overflow-hidden bg-surface-container-high flex items-center justify-center">
                <span className="font-mono text-xs text-outline">OP</span>
              </div>
            </div>
          </div>
        </header>

        {/* Main Canvas */}
        <main className="flex-1 pt-24 pb-12 px-6 md:px-8 max-w-[1440px] mx-auto w-full">
          {children}
        </main>
      </div>
    </div>
  );
}
