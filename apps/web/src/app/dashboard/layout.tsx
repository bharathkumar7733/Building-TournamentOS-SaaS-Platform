"use client";

import React, { useState } from "react";
import Link from "next/link";
import { usePathname } from "next/navigation";
import { 
  Trophy, 
  LayoutDashboard, 
  Users, 
  Home, 
  Settings, 
  LogOut, 
  Menu, 
  X,
  ChevronRight,
  Shield
} from "lucide-react";
import { TooltipProvider } from "@/components/ui/tooltip";

interface NavItem {
  name: string;
  href: string;
  icon: React.ComponentType<any>;
}

const navItems: NavItem[] = [
  { name: "Overview", href: "/dashboard", icon: LayoutDashboard },
  { name: "Tournaments", href: "/dashboard/tournaments", icon: Trophy },
  { name: "Teams (Stub)", href: "/dashboard/teams", icon: Users },
  { name: "Settings (Stub)", href: "/dashboard/settings", icon: Settings },
];

export default function DashboardLayout({ children }: { children: React.ReactNode }) {
  const pathname = usePathname();
  const [sidebarOpen, setSidebarOpen] = useState(false);

  return (
    <TooltipProvider>
      <div className="min-h-screen bg-zinc-950 text-zinc-50 flex flex-col md:flex-row relative">
        {/* Mobile Header */}
        <header className="md:hidden flex items-center justify-between px-6 py-4 bg-zinc-900 border-b border-zinc-800 sticky top-0 z-40">
          <div className="flex items-center gap-2">
            <div className="w-8 h-8 rounded bg-gradient-to-tr from-rose-500 to-violet-600 flex items-center justify-center font-black tracking-tighter text-white">
              T
            </div>
            <span className="font-bold tracking-tight text-lg">TournamentOS</span>
          </div>
          <button 
            onClick={() => setSidebarOpen(!sidebarOpen)}
            className="p-1.5 rounded-md hover:bg-zinc-800 text-zinc-400 hover:text-white"
          >
            {sidebarOpen ? <X size={20} /> : <Menu size={20} />}
          </button>
        </header>

        {/* Sidebar Container */}
        <aside className={`
          fixed inset-y-0 left-0 z-50 w-64 bg-zinc-900 border-r border-zinc-800/60 flex flex-col justify-between
          transform transition-transform duration-200 ease-in-out md:translate-x-0 md:static md:h-screen
          ${sidebarOpen ? "translate-x-0" : "-translate-x-full"}
        `}>
          <div>
            {/* Header logo */}
            <div className="hidden md:flex items-center gap-2 px-6 py-5 border-b border-zinc-800/60">
              <div className="w-8 h-8 rounded bg-gradient-to-tr from-rose-500 to-violet-600 flex items-center justify-center font-black tracking-tighter text-white shadow-md shadow-rose-500/10">
                T
              </div>
              <span className="font-bold tracking-tight text-lg">
                Tournament<span className="text-rose-500">OS</span>
              </span>
            </div>

            {/* Nav items */}
            <nav className="px-3 py-6 space-y-1">
              {navItems.map((item) => {
                const isActive = pathname === item.href || (item.href !== "/dashboard" && pathname.startsWith(item.href));
                const Icon = item.icon;
                return (
                  <Link
                    key={item.name}
                    href={item.href}
                    onClick={() => setSidebarOpen(false)}
                    className={`
                      flex items-center gap-3 px-3 py-2.5 rounded-md text-sm font-medium transition-all group
                      ${isActive 
                        ? "bg-rose-500/10 text-rose-400 border-l-2 border-rose-500" 
                        : "text-zinc-400 hover:text-zinc-50 hover:bg-zinc-800/40"}
                    `}
                  >
                    <Icon size={18} className={isActive ? "text-rose-400" : "text-zinc-400 group-hover:text-zinc-200"} />
                    <span>{item.name}</span>
                    {isActive && <ChevronRight size={14} className="ml-auto text-rose-400/80" />}
                  </Link>
                );
              })}
            </nav>
          </div>

          {/* User profile / organization stub */}
          <div className="p-4 border-t border-zinc-800/60">
            <div className="flex items-center gap-3 px-2 py-2 rounded-lg bg-zinc-950/40 border border-zinc-800/40">
              <div className="w-9 h-9 rounded-full bg-zinc-800 flex items-center justify-center font-bold text-sm text-zinc-300">
                MA
              </div>
              <div className="flex-1 min-w-0">
                <p className="text-xs font-semibold text-zinc-200 truncate">Mock Admin</p>
                <p className="text-[10px] text-zinc-500 truncate flex items-center gap-1">
                  <Shield size={10} className="text-rose-500" />
                  Super Admin
                </p>
              </div>
              <Link href="/" title="Sign Out">
                <LogOut size={16} className="text-zinc-500 hover:text-rose-400 transition-colors" />
              </Link>
            </div>
          </div>
        </aside>

        {/* Overlay for mobile sidebar */}
        {sidebarOpen && (
          <div 
            onClick={() => setSidebarOpen(false)}
            className="fixed inset-0 z-40 bg-black/60 md:hidden"
          />
        )}

        {/* Main Content Area */}
        <div className="flex-1 flex flex-col overflow-y-auto h-screen">
          {/* Top Navbar */}
          <header className="hidden md:flex items-center justify-between px-8 py-4 border-b border-zinc-800/40 bg-zinc-950/20 sticky top-0 backdrop-blur-sm z-30">
            <div className="text-sm text-zinc-500 font-medium">
              Org Workspace: <span className="text-zinc-200 font-semibold">mock-org-id</span>
            </div>
            <div className="flex items-center gap-4">
              <div className="text-xs px-2.5 py-1 rounded bg-zinc-800 border border-zinc-700/60 text-zinc-400">
                Environment: <span className="text-rose-400 font-mono font-bold">Local-Dev</span>
              </div>
            </div>
          </header>

          {/* Render page children */}
          <main className="flex-1 p-6 md:p-8 max-w-7xl w-full mx-auto">
            {children}
          </main>
        </div>
      </div>
    </TooltipProvider>
  );
}
