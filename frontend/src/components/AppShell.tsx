"use client";

import Link from "next/link";
import { usePathname } from "next/navigation";
import { useMemo, useState, useEffect } from "react";
import {
  LayoutDashboard,
  MessageSquare,
  HelpCircle,
  LogOut,
  Settings,
  Users,
  Crown,
  X,
  Send,
  Sun,
  Moon,
} from "lucide-react";
import { logout } from "@/lib/auth";
import { toast } from "@/lib/toast";
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
  const [supportOpen, setSupportOpen] = useState(false);
  const [supportSubject, setSupportSubject] = useState("");
  const [supportMessage, setSupportMessage] = useState("");
  const [supportSent, setSupportSent] = useState(false);
  const [theme, setTheme] = useState<"dark" | "light">("dark");

  // Load theme on mount
  useEffect(() => {
    const saved = localStorage.getItem("theme") as "dark" | "light" | null;
    const t = saved || "dark";
    setTheme(t);
    document.documentElement.setAttribute("data-theme", t);
  }, []);

  function toggleTheme() {
    const next = theme === "dark" ? "light" : "dark";
    setTheme(next);
    localStorage.setItem("theme", next);
    document.documentElement.setAttribute("data-theme", next);
  }

  const navItems = useMemo(() => {
    const items = [...baseNavItems];
    if (isLeader) {
      items.splice(1, 0, { href: "/org", label: "Organization", icon: Users });
    }
    if (isSuperadmin) {
      items.push({ href: "/admin", label: "Admin", icon: Crown });
    }
    items.push({ href: "/settings", label: "Settings", icon: Settings });
    return items;
  }, [isLeader, isSuperadmin]);

  async function handleLogout() {
    try {
      await logout();
    } catch (err) {
      toast.error("Sign-out failed", err);
    }
    window.location.href = "/login";
  }

  function handleSupportSubmit(e: React.FormEvent) {
    e.preventDefault();
    setSupportSent(true);
    setTimeout(() => { setSupportOpen(false); setSupportSent(false); setSupportSubject(""); setSupportMessage(""); }, 2000);
  }

  return (
    <div className="min-h-screen bg-background text-on-surface flex overflow-hidden">
      {/* Sidebar */}
      <nav className="bg-surface-container-low/80 backdrop-blur-lg h-screen w-64 fixed left-0 top-0 border-r border-outline-variant/20 hidden md:flex flex-col py-6 z-40">
        {/* Brand */}
        <div className="px-6 mb-6">
          <div className="flex items-center gap-2.5">
            <img src="/logo.png" alt="Quintal AI" className="w-9 h-9 object-contain" />
            <span className="font-sans text-base font-semibold text-on-surface">Quintal AI</span>
          </div>
        </div>

        {/* Nav Items */}
        <div className="flex-1 flex flex-col gap-1 px-4">
          {navItems.map((item) => {
            const isActive = pathname === item.href || (item.href === "/console" && pathname.startsWith("/console"));
            const Icon = item.icon;
            return (
              <Link
                key={item.label}
                href={item.href}
                className={`flex items-center gap-3 px-4 py-2.5 rounded-lg transition-all group ${
                  isActive
                    ? "bg-primary/10 text-primary"
                    : "text-on-surface-variant hover:bg-surface-variant/30 hover:text-on-surface"
                }`}
              >
                <Icon className={`w-4.5 h-4.5 ${isActive ? "text-primary" : "text-outline group-hover:text-on-surface"}`} />
                <span className="text-sm font-medium">{item.label}</span>
              </Link>
            );
          })}
        </div>

        {/* Bottom Nav */}
        <div className="flex flex-col gap-1 px-4 mt-auto">
          <button
            onClick={toggleTheme}
            className="flex items-center gap-3 px-4 py-2.5 rounded-lg text-on-surface-variant hover:bg-surface-variant/30 hover:text-on-surface transition-all group text-left"
          >
            {theme === "dark" ? <Sun className="w-4.5 h-4.5 text-outline group-hover:text-on-surface" /> : <Moon className="w-4.5 h-4.5 text-outline group-hover:text-on-surface" />}
            <span className="text-sm font-medium">{theme === "dark" ? "Light Mode" : "Dark Mode"}</span>
          </button>
          <button
            onClick={() => setSupportOpen(true)}
            className="flex items-center gap-3 px-4 py-2.5 rounded-lg text-on-surface-variant hover:bg-surface-variant/30 hover:text-on-surface transition-all group text-left"
          >
            <HelpCircle className="w-4.5 h-4.5 text-outline group-hover:text-on-surface" />
            <span className="text-sm font-medium">Support</span>
          </button>
          <button
            onClick={handleLogout}
            className="flex items-center gap-3 px-4 py-2.5 rounded-lg text-on-surface-variant hover:bg-surface-variant/30 hover:text-on-surface transition-all group text-left"
          >
            <LogOut className="w-4.5 h-4.5 text-outline group-hover:text-on-surface" />
            <span className="text-sm font-medium">Sign Out</span>
          </button>
        </div>
      </nav>

      {/* Main Content Wrapper */}
      <div className="flex-1 md:ml-64 flex flex-col min-h-screen relative">
        {/* Main Canvas */}
        <main className="flex-1 pt-6 pb-8 px-6 md:px-8 max-w-[1440px] mx-auto w-full">
          {children}
        </main>
      </div>

      {/* Support Modal */}
      {supportOpen && (
        <div className="fixed inset-0 bg-black/50 backdrop-blur-sm z-[60] flex items-center justify-center p-4">
          <div className="bg-surface border border-outline-variant/30 rounded-xl w-full max-w-md p-6 space-y-4 shadow-2xl">
            <div className="flex items-center justify-between">
              <h3 className="text-lg font-semibold text-on-surface">Contact Support</h3>
              <button onClick={() => { setSupportOpen(false); setSupportSent(false); }} className="text-outline-variant hover:text-on-surface transition-colors">
                <X className="w-5 h-5" />
              </button>
            </div>
            {supportSent ? (
              <div className="text-center py-8 space-y-2">
                <div className="w-12 h-12 rounded-full bg-secondary/10 flex items-center justify-center mx-auto">
                  <Send className="w-5 h-5 text-secondary" />
                </div>
                <p className="text-sm font-medium text-on-surface">Request submitted</p>
                <p className="text-xs text-outline">Our team will get back to you within 24 hours.</p>
              </div>
            ) : (
              <form onSubmit={handleSupportSubmit} className="space-y-4">
                <div>
                  <label className="text-xs font-medium text-outline-variant block mb-1.5">Subject</label>
                  <input value={supportSubject} onChange={(e) => setSupportSubject(e.target.value)} required placeholder="Brief description of your issue"
                    className="w-full bg-surface-container-low/50 border border-outline-variant/20 rounded-lg px-3 py-2.5 text-sm text-on-surface placeholder:text-outline-variant/40 focus:outline-none focus:border-primary" />
                </div>
                <div>
                  <label className="text-xs font-medium text-outline-variant block mb-1.5">Message</label>
                  <textarea value={supportMessage} onChange={(e) => setSupportMessage(e.target.value)} required placeholder="Describe what you need help with..." rows={4}
                    className="w-full bg-surface-container-low/50 border border-outline-variant/20 rounded-lg px-3 py-2.5 text-sm text-on-surface placeholder:text-outline-variant/40 focus:outline-none focus:border-primary resize-none" />
                </div>
                <button type="submit" className="w-full py-2.5 rounded-lg text-sm font-medium bg-primary text-on-primary hover:bg-primary/90 transition-all">
                  Submit Request
                </button>
              </form>
            )}
          </div>
        </div>
      )}
    </div>
  );
}
