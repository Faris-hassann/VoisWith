import Link from "next/link";
import { BarChart3, History, Info, PlayCircle, Settings, BookOpen } from "lucide-react";
import { env } from "@/lib/environment/env";

const nav = [
  { href: "/testing/new", label: "New Test", icon: PlayCircle },
  { href: "/testing/history", label: "Test History", icon: History },
  { href: "/testing/results/latest", label: "Reports", icon: BarChart3 },
  { href: "/settings", label: "Settings", icon: Settings },
  { href: "/about", label: "About", icon: Info },
];

export function AppSidebar() {
  return (
    <aside className="hidden min-h-screen w-64 shrink-0 border-r bg-slate-950 text-slate-100 lg:block">
      <div className="border-b border-slate-800 p-5">
        <div className="text-lg font-semibold">{env.appName}</div>
        <div className="mt-1 text-xs text-slate-400">Functional web testing</div>
      </div>
      <nav className="space-y-1 p-3">
        {nav.map((item) => (
          <Link key={item.href} href={item.href} className="flex items-center gap-3 rounded-md px-3 py-2 text-sm text-slate-300 hover:bg-slate-900 hover:text-white">
            <item.icon className="h-4 w-4" />
            {item.label}
          </Link>
        ))}
        <a href={env.apiDocsUrl} target="_blank" rel="noreferrer" className="flex items-center gap-3 rounded-md px-3 py-2 text-sm text-slate-300 hover:bg-slate-900 hover:text-white">
          <BookOpen className="h-4 w-4" />
          API Documentation
        </a>
      </nav>
    </aside>
  );
}
