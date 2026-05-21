"use client";

import Link from "next/link";
import { usePathname, useRouter } from "next/navigation";
import { useMemo, useState, useEffect, type ComponentType } from "react";
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
  Menu,
} from "lucide-react";
import { logout } from "@/lib/auth";
import { toast } from "@/lib/toast";
import { useCurrentUser } from "@/hooks/useCurrentUser";

interface NavItem {
  href: string;
  label: string;
  icon: ComponentType<{ className?: string }>;
}

const baseNavItems: NavItem[] = [
  { href: "/dashboard", label: "Dashboard", icon: LayoutDashboard },
  { href: "/console", label: "Workspace", icon: MessageSquare },
];

interface AppShellProps {
  children: React.ReactNode;
}

/**
 * Renders the shared navigation body (brand + nav links + bottom actions).
 * Module-scoped so it isn't recreated on each AppShell render — React's
 * `react-hooks/static-components` rule (and re-mount/state-reset behaviour)
 * requires this.
 */
function NavBody({
  navItems,
  pathname,
  theme,
  onToggleTheme,
  onSupport,
  onLogout,
  onItemClick,
}: {
  navItems: NavItem[];
  pathname: string;
  theme: "dark" | "light";
  onToggleTheme: () => void;
  onSupport: () => void;
  onLogout: () => void;
  onItemClick?: () => void;
}) {
  return (
    <>
      <div className="px-6 mb-6">
        <div className="flex items-center gap-2.5">
          <img src="/logo.png" alt="Quintal AI" className="w-9 h-9 object-contain" />
          <span className="font-sans text-base font-semibold text-on-surface">Quintal AI</span>
        </div>
      </div>

      <div className="flex-1 flex flex-col gap-1 px-4 overflow-y-auto">
        {navItems.map((item) => {
          const isActive =
            pathname === item.href ||
            (item.href === "/console" && pathname.startsWith("/console"));
          const Icon = item.icon;
          return (
            <Link
              key={item.label}
              href={item.href}
              onClick={onItemClick}
              className={`flex items-center gap-3 px-4 py-3 rounded-lg transition-all group ${
                isActive
                  ? "bg-primary/10 text-primary"
                  : "text-on-surface-variant hover:bg-surface-variant/30 hover:text-on-surface"
              }`}
            >
              <Icon
                className={`w-5 h-5 ${isActive ? "text-primary" : "text-outline group-hover:text-on-surface"}`}
              />
              <span className="text-sm font-medium">{item.label}</span>
            </Link>
          );
        })}
      </div>

      <div className="flex flex-col gap-1 px-4 mt-auto pb-safe">
        <button
          onClick={onToggleTheme}
          className="flex items-center gap-3 px-4 py-3 rounded-lg text-on-surface-variant hover:bg-surface-variant/30 hover:text-on-surface transition-all group text-left"
        >
          {theme === "dark" ? (
            <Sun className="w-5 h-5 text-outline group-hover:text-on-surface" />
          ) : (
            <Moon className="w-5 h-5 text-outline group-hover:text-on-surface" />
          )}
          <span className="text-sm font-medium">
            {theme === "dark" ? "Light Mode" : "Dark Mode"}
          </span>
        </button>
        <button
          onClick={onSupport}
          className="flex items-center gap-3 px-4 py-3 rounded-lg text-on-surface-variant hover:bg-surface-variant/30 hover:text-on-surface transition-all group text-left"
        >
          <HelpCircle className="w-5 h-5 text-outline group-hover:text-on-surface" />
          <span className="text-sm font-medium">Support</span>
        </button>
        <button
          onClick={onLogout}
          className="flex items-center gap-3 px-4 py-3 rounded-lg text-on-surface-variant hover:bg-surface-variant/30 hover:text-on-surface transition-all group text-left"
        >
          <LogOut className="w-5 h-5 text-outline group-hover:text-on-surface" />
          <span className="text-sm font-medium">Sign Out</span>
        </button>
      </div>
    </>
  );
}

export default function AppShell({ children }: AppShellProps) {
  const pathname = usePathname();
  const _router = useRouter();
  void _router;
  const { user } = useCurrentUser();
  const userRole = user?.role ?? null;
  const isSuperadmin = Boolean(user?.is_platform_admin || user?.role === "superadmin");
  const isLeader = userRole === "leader";
  const [supportOpen, setSupportOpen] = useState(false);
  const [supportSubject, setSupportSubject] = useState("");
  const [supportMessage, setSupportMessage] = useState("");
  const [supportSent, setSupportSent] = useState(false);
  const [theme, setTheme] = useState<"dark" | "light">("dark");
  const [mobileNavOpen, setMobileNavOpen] = useState(false);

  // Load theme on mount.
  useEffect(() => {
    const saved = localStorage.getItem("theme") as "dark" | "light" | null;
    const t = saved || "dark";
    setTheme(t);
    document.documentElement.setAttribute("data-theme", t);
  }, []);

  // Close mobile drawer on route change.
  useEffect(() => {
    setMobileNavOpen(false);
  }, [pathname]);

  // Close drawer on Escape key.
  useEffect(() => {
    if (!mobileNavOpen) return;
    function onKey(e: KeyboardEvent) {
      if (e.key === "Escape") setMobileNavOpen(false);
    }
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [mobileNavOpen]);

  // Lock body scroll while drawer is open so the page underneath doesn't move.
  useEffect(() => {
    if (mobileNavOpen) {
      const prev = document.body.style.overflow;
      document.body.style.overflow = "hidden";
      return () => {
        document.body.style.overflow = prev;
      };
    }
  }, [mobileNavOpen]);

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

  const currentTitle = useMemo(() => {
    const match = navItems.find(
      (n) =>
        pathname === n.href ||
        (n.href === "/console" && pathname.startsWith("/console")),
    );
    return match?.label ?? "Quintal AI";
  }, [navItems, pathname]);

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
    setTimeout(() => {
      setSupportOpen(false);
      setSupportSent(false);
      setSupportSubject("");
      setSupportMessage("");
    }, 2000);
  }

  return (
    <div className="min-h-dvh bg-background text-on-surface flex">
      {/* Desktop sidebar — hidden on phones. */}
      <nav className="bg-surface-container-low/80 backdrop-blur-lg h-screen w-64 fixed left-0 top-0 border-r border-outline-variant/20 hidden md:flex flex-col py-6 z-40">
        <NavBody
          navItems={navItems}
          pathname={pathname}
          theme={theme}
          onToggleTheme={toggleTheme}
          onSupport={() => setSupportOpen(true)}
          onLogout={handleLogout}
        />
      </nav>

      {/* Mobile top bar — replaces the sidebar on phones. */}
      <header className="md:hidden fixed top-0 inset-x-0 z-40 h-14 pt-safe bg-surface-container-low/80 backdrop-blur-lg border-b border-outline-variant/20 flex items-center justify-between px-4">
        <div className="flex items-center gap-2.5">
          <img src="/logo.png" alt="Quintal AI" className="w-7 h-7 object-contain" />
          <span className="font-sans text-sm font-semibold text-on-surface truncate max-w-[40vw]">
            {currentTitle}
          </span>
        </div>
        <button
          onClick={() => setMobileNavOpen(true)}
          aria-label="Open navigation"
          className="w-11 h-11 -mr-2 flex items-center justify-center rounded-lg hover:bg-surface-variant/30 active:bg-surface-variant/50 transition-colors text-on-surface"
        >
          <Menu className="w-5 h-5" />
        </button>
      </header>

      {/* Mobile drawer overlay. */}
      {mobileNavOpen && (
        <div className="md:hidden fixed inset-0 z-50">
          <div
            className="absolute inset-0 bg-black/50 backdrop-blur-sm"
            onClick={() => setMobileNavOpen(false)}
            aria-hidden="true"
          />
          <aside
            className="absolute left-0 top-0 bottom-0 w-72 max-w-[85vw] bg-surface-container-low border-r border-outline-variant/20 flex flex-col py-6 pt-[max(env(safe-area-inset-top),1.5rem)] shadow-2xl animate-[slideInLeft_0.2s_ease-out]"
            role="dialog"
            aria-modal="true"
          >
            <div className="absolute top-3 right-3 pt-safe">
              <button
                onClick={() => setMobileNavOpen(false)}
                aria-label="Close navigation"
                className="w-9 h-9 flex items-center justify-center rounded-lg hover:bg-surface-variant/30 text-on-surface-variant"
              >
                <X className="w-5 h-5" />
              </button>
            </div>
            <NavBody
              navItems={navItems}
              pathname={pathname}
              theme={theme}
              onToggleTheme={toggleTheme}
              onSupport={() => {
                setSupportOpen(true);
                setMobileNavOpen(false);
              }}
              onLogout={handleLogout}
              onItemClick={() => setMobileNavOpen(false)}
            />
          </aside>
        </div>
      )}

      {/* Main content — pushed right on desktop, pushed down on mobile. */}
      <div className="flex-1 md:ml-64 flex flex-col min-h-dvh relative">
        <main className="flex-1 pt-[calc(3.5rem+env(safe-area-inset-top))] md:pt-6 pb-8 px-4 sm:px-6 md:px-8 max-w-[1440px] mx-auto w-full">
          {children}
        </main>
      </div>

      {/* Support Modal */}
      {supportOpen && (
        <div className="fixed inset-0 bg-black/50 backdrop-blur-sm z-[60] flex items-center justify-center p-4">
          <div className="bg-surface border border-outline-variant/30 rounded-xl w-full max-w-md p-6 space-y-4 shadow-2xl">
            <div className="flex items-center justify-between">
              <h3 className="text-lg font-semibold text-on-surface">Contact Support</h3>
              <button
                onClick={() => {
                  setSupportOpen(false);
                  setSupportSent(false);
                }}
                className="w-9 h-9 flex items-center justify-center rounded-lg text-outline-variant hover:text-on-surface hover:bg-surface-variant/30 transition-colors"
                aria-label="Close support"
              >
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
                  <input
                    value={supportSubject}
                    onChange={(e) => setSupportSubject(e.target.value)}
                    required
                    placeholder="Brief description of your issue"
                    className="w-full bg-surface-container-low/50 border border-outline-variant/20 rounded-lg px-3 py-2.5 text-sm text-on-surface placeholder:text-outline-variant/40 focus:outline-none focus:border-primary"
                  />
                </div>
                <div>
                  <label className="text-xs font-medium text-outline-variant block mb-1.5">Message</label>
                  <textarea
                    value={supportMessage}
                    onChange={(e) => setSupportMessage(e.target.value)}
                    required
                    placeholder="Describe what you need help with..."
                    rows={4}
                    className="w-full bg-surface-container-low/50 border border-outline-variant/20 rounded-lg px-3 py-2.5 text-sm text-on-surface placeholder:text-outline-variant/40 focus:outline-none focus:border-primary resize-none"
                  />
                </div>
                <button
                  type="submit"
                  className="w-full py-2.5 rounded-lg text-sm font-medium bg-primary text-on-primary hover:bg-primary/90 transition-all"
                >
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
