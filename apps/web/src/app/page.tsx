import Link from "next/link";
import Image from "next/image";

export default function Home() {
  return (
    <div className="min-h-screen bg-zinc-950 text-zinc-50 flex flex-col justify-between selection:bg-rose-500 selection:text-white relative overflow-hidden">
      {/* Background gradients */}
      <div className="absolute top-[-20%] left-[-10%] w-[500px] h-[500px] rounded-full bg-rose-500/10 blur-[120px] pointer-events-none" />
      <div className="absolute bottom-[-10%] right-[-10%] w-[600px] h-[600px] rounded-full bg-blue-500/10 blur-[150px] pointer-events-none" />

      {/* Header */}
      <header className="border-b border-zinc-800/50 backdrop-blur-md sticky top-0 z-50 px-6 py-4 flex items-center justify-between">
        <div className="flex items-center gap-2">
          <div className="w-9 h-9 rounded-lg bg-gradient-to-tr from-rose-500 to-violet-600 flex items-center justify-center font-black tracking-tighter text-white shadow-lg shadow-rose-500/20">
            T
          </div>
          <span className="font-bold tracking-tight text-xl bg-clip-text text-transparent bg-gradient-to-r from-white via-zinc-200 to-zinc-400">
            Tournament<span className="text-rose-500">OS</span>
          </span>
        </div>
        <nav className="hidden md:flex items-center gap-6 text-sm text-zinc-400 font-medium">
          <a href="#features" className="hover:text-white transition-colors">Features</a>
          <a href="#about" className="hover:text-white transition-colors">About</a>
        </nav>
        <div>
          <Link
            href="/dashboard"
            className="inline-flex h-9 items-center justify-center rounded-md bg-zinc-100 px-4 text-sm font-medium text-zinc-950 shadow transition-colors hover:bg-zinc-200 focus-visible:outline-none focus-visible:ring-1 focus-visible:ring-zinc-950"
          >
            Launch Console
          </Link>
        </div>
      </header>

      {/* Hero Section */}
      <main className="flex-1 flex flex-col items-center justify-center px-6 text-center max-w-4xl mx-auto py-20 relative z-10">
        <div className="inline-flex items-center gap-2 px-3 py-1 rounded-full border border-rose-500/30 bg-rose-500/5 text-rose-400 text-xs font-semibold tracking-wide uppercase mb-6 animate-pulse">
          ⚡ Production V1 Live
        </div>
        
        <h1 className="text-4xl md:text-6xl lg:text-7xl font-extrabold tracking-tight mb-6 leading-tight">
          Run Esports Tournaments <br />
          <span className="bg-clip-text text-transparent bg-gradient-to-r from-rose-500 via-violet-500 to-blue-500">
            Without Spreadsheets.
          </span>
        </h1>
        
        <p className="text-zinc-400 text-lg md:text-xl max-w-2xl mb-10 leading-relaxed">
          The production-grade SaaS platform for creators and organizers to conduct large-scale Battle Royale tournaments. Automated scoring, dynamic stages, and zero WhatsApp chaos.
        </p>

        <div className="flex flex-col sm:flex-row items-center gap-4 justify-center">
          <Link
            href="/dashboard"
            className="w-full sm:w-auto inline-flex h-12 items-center justify-center rounded-lg bg-gradient-to-r from-rose-500 to-violet-600 px-8 text-base font-semibold text-white shadow-lg shadow-rose-500/20 transition-all hover:opacity-90 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-rose-500"
          >
            Enter Admin Dashboard
          </Link>
          <a
            href="https://github.com"
            target="_blank"
            rel="noopener noreferrer"
            className="w-full sm:w-auto inline-flex h-12 items-center justify-center rounded-lg border border-zinc-800 bg-zinc-900/50 hover:bg-zinc-800/80 px-8 text-base font-semibold text-zinc-300 transition-colors"
          >
            View Docs
          </a>
        </div>
      </main>

      {/* Footer */}
      <footer className="border-t border-zinc-900/80 px-6 py-6 text-center text-xs text-zinc-500 relative z-10">
        <p>© 2026 TournamentOS. All rights reserved. Designed for professional Battle Royale events.</p>
      </footer>
    </div>
  );
}
