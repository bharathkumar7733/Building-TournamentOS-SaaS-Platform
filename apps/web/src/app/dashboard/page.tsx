"use client";

import { useEffect, useState } from "react";
import Link from "next/link";
import {
  Plus,
  Trophy,
  Activity,
  Users,
  Layers,
  ArrowRight,
  ShieldCheck,
  Gamepad2,
  RefreshCw,
} from "lucide-react";
import {
  Card,
  CardContent,
  CardDescription,
  CardHeader,
  CardTitle,
} from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { tournamentApi } from "@/lib/api-client";

// ── Types ─────────────────────────────────────────────────────────────────────

interface DashboardMetrics {
  totalTournaments: number;
  liveTournaments: number;
  openRegistrations: number;
  totalTeams: number;
}

interface Tournament {
  id: string;
  name: string;
  game: string;
  status: string;
  startDate: string;
  config: {
    maxTeams: number;
    roomCapacity: number;
  };
  _count?: {
    teams: number;
    stages: number;
  };
}

// ── Status badge helper ────────────────────────────────────────────────────────

const STATUS_STYLES: Record<string, string> = {
  DRAFT:
    "bg-zinc-800 text-zinc-400 border-zinc-700 hover:bg-zinc-800",
  REGISTRATION_OPEN:
    "bg-emerald-500/10 text-emerald-400 border-emerald-500/20 hover:bg-emerald-500/10",
  REGISTRATION_CLOSED:
    "bg-amber-500/10 text-amber-400 border-amber-500/20 hover:bg-amber-500/10",
  IN_PROGRESS:
    "bg-rose-500/10 text-rose-400 border-rose-500/20 hover:bg-rose-500/10",
  COMPLETED:
    "bg-zinc-700/40 text-zinc-500 border-zinc-700/40 hover:bg-zinc-700/40",
  CANCELLED:
    "bg-red-900/20 text-red-500 border-red-900/30 hover:bg-red-900/20",
};

// ── Stat card ─────────────────────────────────────────────────────────────────

function StatCard({
  label,
  value,
  icon,
  loading,
  color,
  sub,
}: {
  label: string;
  value: number;
  icon: React.ReactNode;
  loading: boolean;
  color: string;
  sub: string;
}) {
  return (
    <Card className="bg-zinc-900/40 border-zinc-800/80 backdrop-blur-sm">
      <CardHeader className="flex flex-row items-center justify-between space-y-0 pb-2">
        <CardTitle className="text-xs font-semibold text-zinc-400 uppercase tracking-wider">
          {label}
        </CardTitle>
        <span className={color}>{icon}</span>
      </CardHeader>
      <CardContent>
        <div className="text-2xl font-bold text-zinc-100">
          {loading ? (
            <span className="inline-block w-10 h-7 bg-zinc-800 rounded animate-pulse" />
          ) : (
            value
          )}
        </div>
        <p className="text-[10px] text-zinc-500 mt-1">{sub}</p>
      </CardContent>
    </Card>
  );
}

// ── Main page ─────────────────────────────────────────────────────────────────

export default function DashboardHome() {
  const [tournaments, setTournaments] = useState<Tournament[]>([]);
  const [metrics, setMetrics] = useState<DashboardMetrics | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  const ORG_ID = "mock-org-id";

  const load = () => {
    setLoading(true);
    setError(null);

    Promise.all([
      // Fix 6: real metrics endpoint
      fetch(
        `${process.env.NEXT_PUBLIC_API_URL ?? "http://localhost:3001"}/api/v1/organizations/${ORG_ID}/tournaments/metrics/overview`
      ).then((r) => r.json()),
      tournamentApi.list({ limit: 5 }),
    ])
      .then(([metricsRes, tournamentsRes]) => {
        if (metricsRes?.success) {
          setMetrics(metricsRes.data as DashboardMetrics);
        }
        setTournaments(
          (tournamentsRes?.data as Tournament[]) ?? []
        );
      })
      .catch((err) => {
        console.error(err);
        setError(
          "Failed to load dashboard data. Ensure the backend API is running."
        );
      })
      .finally(() => {
        setLoading(false);
      });
  };

  useEffect(() => {
    load();
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  return (
    <div className="space-y-8">
      {/* Header */}
      <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-4">
        <div>
          <h1 className="text-3xl font-extrabold tracking-tight bg-clip-text text-transparent bg-gradient-to-r from-white to-zinc-400">
            Console Overview
          </h1>
          <p className="text-zinc-400 text-sm mt-1">
            Real-time analytics and management dashboard for TournamentOS.
          </p>
        </div>
        <div className="flex items-center gap-2">
          <Button
            variant="ghost"
            size="sm"
            onClick={load}
            className="text-zinc-400 hover:text-white gap-1"
            id="dashboard-refresh-btn"
          >
            <RefreshCw size={14} />
            Refresh
          </Button>
          <Link href="/dashboard/tournaments/new">
            <Button
              id="create-tournament-btn"
              className="bg-gradient-to-r from-rose-500 to-violet-600 hover:opacity-90 transition-all font-semibold gap-2 shadow-lg shadow-rose-500/10"
            >
              <Plus size={18} />
              Create Tournament
            </Button>
          </Link>
        </div>
      </div>

      {/* Stats grid — Fix 6: real metrics */}
      <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-4">
        <StatCard
          label="Total Tournaments"
          value={metrics?.totalTournaments ?? 0}
          icon={<Trophy size={18} />}
          loading={loading}
          color="text-rose-500"
          sub="All campaigns (excluding deleted)"
        />
        <StatCard
          label="Live Now"
          value={metrics?.liveTournaments ?? 0}
          icon={<Activity size={18} />}
          loading={loading}
          color="text-rose-400"
          sub="Currently IN_PROGRESS"
        />
        <StatCard
          label="Open Registrations"
          value={metrics?.openRegistrations ?? 0}
          icon={<ShieldCheck size={18} />}
          loading={loading}
          color="text-emerald-500"
          sub="Accepting team sign-ups"
        />
        <StatCard
          label="Total Teams"
          value={metrics?.totalTeams ?? 0}
          icon={<Users size={18} />}
          loading={loading}
          color="text-violet-400"
          sub="Registered across all tournaments"
        />
      </div>

      {/* Recent tournaments */}
      <Card className="bg-zinc-900/40 border-zinc-800/80 backdrop-blur-sm">
        <CardHeader className="flex flex-row items-center justify-between">
          <div>
            <CardTitle className="text-lg font-bold text-zinc-100">
              Recent Tournaments
            </CardTitle>
            <CardDescription className="text-zinc-500 text-xs">
              Recently updated campaigns in your organization.
            </CardDescription>
          </div>
          <Link
            href="/dashboard/tournaments"
            className="text-xs text-rose-500 flex items-center gap-1 hover:underline"
          >
            View All <ArrowRight size={14} />
          </Link>
        </CardHeader>
        <CardContent>
          {loading ? (
            <div className="space-y-3">
              {[1, 2, 3].map((i) => (
                <div
                  key={i}
                  className="h-14 bg-zinc-800/40 border border-zinc-800 rounded animate-pulse"
                />
              ))}
            </div>
          ) : error ? (
            <div className="py-6 text-center text-sm text-zinc-500 border border-dashed border-zinc-800 rounded-lg">
              {error}
            </div>
          ) : tournaments.length === 0 ? (
            <div className="py-12 text-center border border-dashed border-zinc-800/80 rounded-lg space-y-4">
              <Gamepad2 size={36} className="mx-auto text-zinc-700" />
              <div className="space-y-1">
                <p className="text-sm font-semibold text-zinc-300">
                  No tournaments found
                </p>
                <p className="text-xs text-zinc-500">
                  Create your first Battle Royale campaign to get started.
                </p>
              </div>
              <Link href="/dashboard/tournaments/new" className="inline-block">
                <Button
                  size="sm"
                  className="bg-rose-500/10 border border-rose-500/20 text-rose-400 hover:bg-rose-500/20"
                >
                  Create Now
                </Button>
              </Link>
            </div>
          ) : (
            <div className="space-y-3">
              {tournaments.map((tournament) => (
                <div
                  key={tournament.id}
                  className="flex items-center justify-between p-4 rounded-lg bg-zinc-950/40 border border-zinc-800/60 hover:border-zinc-700/60 transition-colors"
                >
                  <div className="flex items-center gap-3">
                    <div className="w-10 h-10 rounded bg-zinc-900 border border-zinc-800 flex items-center justify-center font-bold text-rose-500">
                      🏆
                    </div>
                    <div>
                      <Link
                        href={`/dashboard/tournaments/${tournament.id}`}
                        className="font-semibold text-sm hover:text-rose-400 transition-colors block text-zinc-200"
                      >
                        {tournament.name}
                      </Link>
                      <p className="text-xs text-zinc-500 flex items-center gap-2">
                        <span className="text-zinc-300">{tournament.game}</span>
                        {tournament.config?.maxTeams && (
                          <>
                            •{" "}
                            <Layers size={10} className="inline" />{" "}
                            <span className="text-zinc-400">
                              {tournament._count?.teams ?? 0}/
                              {tournament.config.maxTeams} teams
                            </span>
                          </>
                        )}
                      </p>
                    </div>
                  </div>
                  <div className="flex items-center gap-3">
                    <Badge
                      className={STATUS_STYLES[tournament.status] ?? ""}
                    >
                      {tournament.status.replace(/_/g, " ")}
                    </Badge>
                    <Link href={`/dashboard/tournaments/${tournament.id}`}>
                      <Button
                        size="sm"
                        variant="ghost"
                        className="text-zinc-400 hover:text-white"
                      >
                        Manage
                      </Button>
                    </Link>
                  </div>
                </div>
              ))}
            </div>
          )}
        </CardContent>
      </Card>
    </div>
  );
}
