"use client";

import { useEffect, useState } from "react";
import Link from "next/link";
import { Plus, Search, Trophy, Calendar, Gamepad2 } from "lucide-react";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Card, CardContent } from "@/components/ui/card";
import { tournamentApi } from "@/lib/api-client";

export default function TournamentsListPage() {
  const [tournaments, setTournaments] = useState<any[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [search, setSearch] = useState("");
  const [status, setStatus] = useState<string>("ALL");

  const loadData = () => {
    setLoading(true);
    tournamentApi
      .list({
        search: search || undefined,
        status: status === "ALL" ? undefined : status,
      })
      .then((res) => {
        setTournaments(res.data || []);
      })
      .catch((err) => {
        console.error(err);
        setError("Failed to load tournaments. Is the backend running?");
      })
      .finally(() => {
        setLoading(false);
      });
  };

  useEffect(() => {
    const delayDebounce = setTimeout(() => {
      loadData();
    }, 300);

    return () => clearTimeout(delayDebounce);
  }, [search, status]);

  return (
    <div className="space-y-6">
      {/* Title */}
      <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-4">
        <div>
          <h1 className="text-3xl font-extrabold tracking-tight bg-clip-text text-transparent bg-gradient-to-r from-white to-zinc-400">
            Tournaments
          </h1>
          <p className="text-zinc-400 text-sm mt-1">Manage existing campaigns or create new ones.</p>
        </div>
        <Link href="/dashboard/tournaments/new">
          <Button className="bg-gradient-to-r from-rose-500 to-violet-600 hover:opacity-90 transition-all font-semibold gap-2 shadow-lg shadow-rose-500/10">
            <Plus size={18} />
            New Tournament
          </Button>
        </Link>
      </div>

      {/* Filters bar */}
      <div className="flex flex-col sm:flex-row items-center gap-3">
        <div className="relative w-full sm:max-w-xs">
          <Search className="absolute left-3 top-1/2 -translate-y-1/2 text-zinc-500" size={16} />
          <Input
            placeholder="Search campaigns..."
            value={search}
            onChange={(e) => setSearch(e.target.value)}
            className="pl-9 bg-zinc-900/50 border-zinc-800 focus-visible:ring-rose-500 text-zinc-200"
          />
        </div>
        <Select value={status} onValueChange={(val) => setStatus(val || "ALL")}>
          <SelectTrigger className="w-full sm:w-[180px] bg-zinc-900/50 border-zinc-800 text-zinc-300">
            <SelectValue placeholder="Filter by status" />
          </SelectTrigger>
          <SelectContent className="bg-zinc-900 border-zinc-800 text-zinc-300">
            <SelectItem value="ALL">All Statuses</SelectItem>
            <SelectItem value="DRAFT">Draft</SelectItem>
            <SelectItem value="REGISTRATION_OPEN">Registration Open</SelectItem>
            <SelectItem value="REGISTRATION_CLOSED">Registration Closed</SelectItem>
            <SelectItem value="IN_PROGRESS">In Progress</SelectItem>
            <SelectItem value="COMPLETED">Completed</SelectItem>
            <SelectItem value="CANCELLED">Cancelled</SelectItem>
          </SelectContent>
        </Select>
      </div>

      {/* Grid listing */}
      {loading ? (
        <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-3">
          {[1, 2, 3, 4, 5, 6].map((i) => (
            <div key={i} className="h-44 bg-zinc-850 border border-zinc-800/80 rounded-xl animate-pulse" />
          ))}
        </div>
      ) : error ? (
        <div className="py-12 text-center text-sm text-zinc-500 border border-dashed border-zinc-800 rounded-xl">
          {error}
        </div>
      ) : tournaments.length === 0 ? (
        <div className="py-16 text-center border border-dashed border-zinc-800/80 rounded-xl space-y-4 max-w-md mx-auto">
          <Gamepad2 size={40} className="mx-auto text-zinc-700 animate-bounce" />
          <div className="space-y-1">
            <p className="text-sm font-semibold text-zinc-300">No campaigns match your filters</p>
            <p className="text-xs text-zinc-500">Try adjusting your search criteria or create a new campaign.</p>
          </div>
        </div>
      ) : (
        <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-3">
          {tournaments.map((tournament) => (
            <Card
              key={tournament.id}
              className="bg-zinc-900/40 border-zinc-800/80 hover:border-zinc-700/80 transition-all hover:shadow-lg hover:shadow-zinc-950 flex flex-col justify-between overflow-hidden group"
            >
              <CardContent className="p-5 flex flex-col justify-between h-full space-y-4">
                <div className="space-y-2">
                  <div className="flex items-center justify-between">
                    <Badge
                      className={`
                        text-[10px] uppercase font-bold
                        ${
                          tournament.status === "DRAFT"
                            ? "bg-zinc-800 text-zinc-400 hover:bg-zinc-800"
                            : tournament.status === "REGISTRATION_OPEN"
                            ? "bg-emerald-500/10 text-emerald-400 border border-emerald-500/20"
                            : "bg-rose-500/10 text-rose-400 border border-rose-500/20"
                        }
                      `}
                    >
                      {tournament.status}
                    </Badge>
                    <span className="text-[10px] text-zinc-500 font-mono">ID: {tournament.id.slice(0, 8)}</span>
                  </div>
                  <h3 className="font-bold text-base text-zinc-200 group-hover:text-rose-400 transition-colors line-clamp-1">
                    {tournament.name}
                  </h3>
                  <div className="space-y-1 text-xs text-zinc-400">
                    <p>
                      Game: <span className="text-zinc-300 font-semibold">{tournament.game}</span>
                    </p>
                    <p>
                      Room Cap: <span className="text-zinc-300">{tournament.roomCapacity} teams</span>
                    </p>
                    <p>
                      Max Teams: <span className="text-zinc-300">{tournament.maxTeams}</span>
                    </p>
                  </div>
                </div>

                <div className="pt-4 border-t border-zinc-800/60 flex items-center justify-between">
                  <span className="text-[10px] text-zinc-500 flex items-center gap-1">
                    <Calendar size={12} />
                    {new Date(tournament.startDate).toLocaleDateString()}
                  </span>
                  <Link href={`/dashboard/tournaments/${tournament.id}`}>
                    <Button size="xs" variant="secondary" className="bg-zinc-800 hover:bg-zinc-700 text-zinc-300">
                      Manage Setup
                    </Button>
                  </Link>
                </div>
              </CardContent>
            </Card>
          ))}
        </div>
      )}
    </div>
  );
}
