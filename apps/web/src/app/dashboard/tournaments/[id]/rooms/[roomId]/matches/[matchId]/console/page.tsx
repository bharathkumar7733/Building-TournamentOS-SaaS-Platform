"use client";

import * as React from "react";
import { useEffect, useState, useRef } from "react";
import Link from "next/link";
import { io, Socket } from "socket.io-client";
import {
  Play,
  Pause,
  CheckCircle,
  AlertTriangle,
  ArrowLeft,
  Tv,
  Wifi,
  WifiOff,
  Plus,
  Minus,
  RefreshCw,
  Clock,
  ShieldAlert,
} from "lucide-react";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import { Toaster, toast } from "sonner";

interface MatchResult {
  teamId: string;
  teamName: string;
  kills: number;
  placement: number;
  points: number;
  version: number;
}

interface MatchStatusResponse {
  matchId: string;
  roomId: string;
  state: "UPCOMING" | "LIVE" | "PAUSED" | "COMPLETED" | "ABANDONED";
  scheduledAt: string;
  startedAt: string | null;
  endedAt: string | null;
  pausedAt: string | null;
  pausedDurationMs: number;
  version: number;
  results: MatchResult[];
}

export default function AdminMatchConsolePage({
  params,
}: {
  params: Promise<{ id: string; roomId: string; matchId: string }>;
}) {
  const { id: tournamentId, roomId, matchId } = React.use(params);

  const [match, setMatch] = useState<MatchStatusResponse | null>(null);
  const [loading, setLoading] = useState(true);
  const [socketConnected, setSocketConnected] = useState(false);
  const [isSubmitting, setIsSubmitting] = useState(false);
  const [timerText, setTimerText] = useState("00:00");

  const socketRef = useRef<Socket | null>(null);
  const timerIntervalRef = useRef<NodeJS.Timeout | null>(null);

  const API_URL = process.env.NEXT_PUBLIC_API_URL ?? "http://localhost:3001";

  // 1. Fetch current match status
  const fetchStatus = async () => {
    try {
      const response = await fetch(
        `${API_URL}/api/v1/tournaments/${tournamentId}/matches/${matchId}/status`
      );
      if (!response.ok) throw new Error("Failed to load match status.");
      const res = await response.json();
      setMatch(res.data);
    } catch (err: any) {
      console.error(err);
      toast.error(err.message || "Failed to load match console status.");
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => {
    fetchStatus();
    return () => {
      if (timerIntervalRef.current) clearInterval(timerIntervalRef.current);
    };
  }, [matchId]);

  // 2. Setup WebSocket Connection and recovery protocol
  useEffect(() => {
    const socket = io(API_URL);
    socketRef.current = socket;

    socket.on("connect", () => {
      setSocketConnected(true);
      // Subscribe with WebSocket Recovery Sync Protocol
      socket.emit("subscribe", {
        scope: "match",
        id: matchId,
        lastVersion: match?.version ?? 0,
      });
    });

    socket.on("disconnect", () => {
      setSocketConnected(false);
    });

    // Listen to real-time events to display current version/scores
    socket.on("match:update", (data: any) => {
      if (data.matchId === matchId) {
        setMatch((prev) => {
          if (!prev) return prev;
          // Ignore stale version updates
          if (data.version < prev.version) return prev;
          return {
            ...prev,
            state: data.state,
            updatedAt: data.updatedAt,
            version: data.version,
            results: data.standings.map((s: any) => {
              const existing = prev.results.find((r) => r.teamId === s.teamId);
              return {
                teamId: s.teamId,
                teamName: existing?.teamName || "Team",
                kills: s.kills,
                placement: s.placement,
                points: s.points,
                version: s.version || data.version,
              };
            }),
          };
        });
      }
    });

    socket.on("match:started", () => fetchStatus());
    socket.on("match:paused", () => fetchStatus());
    socket.on("match:resumed", () => fetchStatus());
    socket.on("match:completed", () => fetchStatus());
    socket.on("match:abandoned", () => fetchStatus());

    return () => {
      socket.disconnect();
    };
  }, [matchId, match?.version]);

  // 3. Server-timestamp-derived timer tick calculation
  useEffect(() => {
    if (timerIntervalRef.current) clearInterval(timerIntervalRef.current);

    if (!match || match.state === "UPCOMING") {
      setTimerText("00:00");
      return;
    }

    const calculateTimer = () => {
      if (!match.startedAt) return "00:00";
      const start = new Date(match.startedAt).getTime();
      const ended = match.endedAt ? new Date(match.endedAt).getTime() : null;
      const paused = match.pausedAt ? new Date(match.pausedAt).getTime() : null;
      const pausedOffset = match.pausedDurationMs;

      let elapsed = 0;
      if (ended) {
        elapsed = ended - start - pausedOffset;
      } else if (paused) {
        elapsed = paused - start - pausedOffset;
      } else {
        elapsed = Date.now() - start - pausedOffset;
      }

      if (elapsed < 0) elapsed = 0;
      const totalSec = Math.floor(elapsed / 1000);
      const min = String(Math.floor(totalSec / 60)).padStart(2, "0");
      const sec = String(totalSec % 60).padStart(2, "0");
      return `${min}:${sec}`;
    };

    setTimerText(calculateTimer());

    if (match.state === "LIVE") {
      timerIntervalRef.current = setInterval(() => {
        setTimerText(calculateTimer());
      }, 1000);
    }
  }, [match?.state, match?.startedAt, match?.endedAt, match?.pausedAt, match?.pausedDurationMs]);

  // 4. REST transition commands
  const handleTransition = async (targetState: string) => {
    setIsSubmitting(true);
    try {
      const response = await fetch(
        `${API_URL}/api/v1/tournaments/${tournamentId}/matches/${matchId}/transition`,
        {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ state: targetState }),
        }
      );
      const res = await response.json();
      if (!response.ok) throw new Error(res.error?.message || "Transition failed.");
      toast.success(`Match status updated to ${targetState}`);
      fetchStatus();
    } catch (err: any) {
      console.error(err);
      toast.error(err.message);
    } finally {
      setIsSubmitting(false);
    }
  };

  // 5. REST score writes (with Idempotency-Key header)
  const handleScoreUpdate = async (teamId: string, kills: number, placement: number, version: number) => {
    setIsSubmitting(true);
    // Generate a random idempotency key for this request attempt
    const idempotencyKey = `score-${matchId}-${teamId}-${kills}-${placement}-${version}-${Date.now()}`;
    try {
      const response = await fetch(
        `${API_URL}/api/v1/tournaments/${tournamentId}/matches/${matchId}/results`,
        {
          method: "POST",
          headers: {
            "Content-Type": "application/json",
            "x-idempotency-key": idempotencyKey,
          },
          body: JSON.stringify({ teamId, kills, placement, version }),
        }
      );
      const res = await response.json();
      if (!response.ok) {
        if (response.status === 409) {
          throw new Error("Optimistic Lock Conflict: Standings updated by another admin. Refreshing...");
        }
        throw new Error(res.error?.message || "Score submission failed.");
      }
      toast.success("Score updated successfully.");
      fetchStatus();
    } catch (err: any) {
      console.error(err);
      toast.error(err.message);
      fetchStatus(); // Force status reload to sync version
    } finally {
      setIsSubmitting(false);
    }
  };

  // 6. REST score reverts
  const handleScoreRevert = async (teamId: string, kills: number, placement: number, version: number) => {
    setIsSubmitting(true);
    try {
      const response = await fetch(
        `${API_URL}/api/v1/tournaments/${tournamentId}/matches/${matchId}/results/revert`,
        {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ teamId, kills, placement, version }),
        }
      );
      const res = await response.json();
      if (!response.ok) {
        if (response.status === 409) {
          throw new Error("Lock Conflict: Revert rejected. Refreshing...");
        }
        throw new Error(res.error?.message || "Score revert failed.");
      }
      toast.success("Score reverted successfully.");
      fetchStatus();
    } catch (err: any) {
      console.error(err);
      toast.error(err.message);
      fetchStatus();
    } finally {
      setIsSubmitting(false);
    }
  };

  if (loading) {
    return (
      <div className="flex flex-col items-center justify-center min-h-[60vh] gap-4">
        <RefreshCw className="w-8 h-8 text-rose-500 animate-spin" />
        <p className="text-zinc-400 text-sm">Loading match console state...</p>
      </div>
    );
  }

  if (!match) return <div className="text-center py-20 text-red-500">Match not found.</div>;

  return (
    <div className="space-y-6">
      <Toaster theme="dark" position="bottom-right" />

      {/* Navigation breadcrumb */}
      <div>
        <Link href={`/dashboard/tournaments/${tournamentId}`}>
          <Button variant="ghost" size="sm" className="text-zinc-400 hover:text-white gap-2">
            <ArrowLeft className="w-4 h-4" /> Back to Dashboard
          </Button>
        </Link>
      </div>

      {/* Main Console Header */}
      <div className="flex flex-col md:flex-row md:items-center justify-between gap-4 border-b border-zinc-800 pb-4">
        <div className="space-y-1">
          <div className="flex items-center gap-3">
            <h1 className="text-3xl font-extrabold tracking-tight bg-clip-text text-transparent bg-gradient-to-r from-white to-zinc-400">
              Admin Match Console
            </h1>
            <Badge
              className={
                socketConnected
                  ? "bg-emerald-500/10 text-emerald-400 border-emerald-500/20 gap-1.5"
                  : "bg-red-500/10 text-red-400 border-red-500/20 gap-1.5"
              }
            >
              {socketConnected ? (
                <>
                  <Wifi className="w-3 h-3" /> Connected
                </>
              ) : (
                <>
                  <WifiOff className="w-3 h-3" /> Disconnected
                </>
              )}
            </Badge>
          </div>
          <p className="text-zinc-400 text-sm">
            Control match states, modify scores, review lock versions, and sync live overlays.
          </p>
        </div>

        <div className="flex items-center gap-2">
          <Link href={`/tournaments/${tournamentId}/overlays/live`} target="_blank">
            <Button
              variant="outline"
              size="sm"
              className="border-rose-500/25 text-rose-400 hover:bg-rose-500/10 gap-2 h-9"
            >
              <Tv className="w-4 h-4" /> Live Broadcast Overlay
            </Button>
          </Link>
        </div>
      </div>

      {/* Lifecycle Status & Clock Banner */}
      <div className="grid gap-4 sm:grid-cols-3">
        <Card className="bg-zinc-950 border-zinc-800">
          <CardHeader className="py-4">
            <CardTitle className="text-xs text-zinc-500 uppercase tracking-wider">State Machine Status</CardTitle>
          </CardHeader>
          <CardContent className="py-2 space-y-3">
            <div className="text-2xl font-bold flex items-center gap-2 text-white">
              <span className="h-3 w-3 rounded-full bg-rose-500 animate-pulse" />
              {match.state}
            </div>

            {/* Transition Controls */}
            <div className="flex flex-wrap gap-1.5">
              {match.state === "UPCOMING" && (
                <Button
                  size="sm"
                  disabled={isSubmitting}
                  onClick={() => handleTransition("LIVE")}
                  className="bg-emerald-600 hover:bg-emerald-700 font-semibold gap-1.5"
                >
                  <Play className="w-3.5 h-3.5" /> Start Match
                </Button>
              )}
              {match.state === "LIVE" && (
                <>
                  <Button
                    size="sm"
                    disabled={isSubmitting}
                    onClick={() => handleTransition("PAUSED")}
                    className="bg-amber-600 hover:bg-amber-700 font-semibold gap-1.5"
                  >
                    <Pause className="w-3.5 h-3.5" /> Pause
                  </Button>
                  <Button
                    size="sm"
                    disabled={isSubmitting}
                    onClick={() => handleTransition("COMPLETED")}
                    className="bg-emerald-600 hover:bg-emerald-700 font-semibold gap-1.5"
                  >
                    <CheckCircle className="w-3.5 h-3.5" /> Complete
                  </Button>
                  <Button
                    size="sm"
                    variant="destructive"
                    disabled={isSubmitting}
                    onClick={() => handleTransition("ABANDONED")}
                    className="font-semibold gap-1.5"
                  >
                    <ShieldAlert className="w-3.5 h-3.5" /> Abandon
                  </Button>
                </>
              )}
              {match.state === "PAUSED" && (
                <>
                  <Button
                    size="sm"
                    disabled={isSubmitting}
                    onClick={() => handleTransition("LIVE")}
                    className="bg-emerald-600 hover:bg-emerald-700 font-semibold gap-1.5"
                  >
                    <Play className="w-3.5 h-3.5" /> Resume
                  </Button>
                  <Button
                    size="sm"
                    variant="destructive"
                    disabled={isSubmitting}
                    onClick={() => handleTransition("ABANDONED")}
                    className="font-semibold gap-1.5"
                  >
                    <ShieldAlert className="w-3.5 h-3.5" /> Abandon
                  </Button>
                </>
              )}
              {(match.state === "COMPLETED" || match.state === "ABANDONED") && (
                <span className="text-xs text-zinc-500 italic">Terminal State Locked</span>
              )}
            </div>
          </CardContent>
        </Card>

        <Card className="bg-zinc-950 border-zinc-800">
          <CardHeader className="py-4">
            <CardTitle className="text-xs text-zinc-500 uppercase tracking-wider">Server-Synced Match Timer</CardTitle>
          </CardHeader>
          <CardContent className="py-2">
            <div className="text-3xl font-extrabold text-white flex items-center gap-2">
              <Clock className="w-6 h-6 text-zinc-400" />
              <span>{timerText}</span>
            </div>
            <p className="text-[10px] text-zinc-500 mt-2">
              Derived dynamically from server timestamps to prevent browser drifts.
            </p>
          </CardContent>
        </Card>

        <Card className="bg-zinc-950 border-zinc-800">
          <CardHeader className="py-4">
            <CardTitle className="text-xs text-zinc-500 uppercase tracking-wider">Score Version (Lock Key)</CardTitle>
          </CardHeader>
          <CardContent className="py-2">
            <div className="text-3xl font-extrabold text-rose-400">
              v{match.version}
            </div>
            <p className="text-[10px] text-zinc-500 mt-2">
              Incremental updates prevent concurrent transaction collision hazards.
            </p>
          </CardContent>
        </Card>
      </div>

      {/* Interactive Scoring Grid */}
      <Card className="bg-zinc-950 border-zinc-800">
        <CardHeader>
          <CardTitle>Roster Standings & Realtime Score Adjuster</CardTitle>
          <CardDescription>
            Update kills and placement points. Save commits immediately.
          </CardDescription>
        </CardHeader>
        <CardContent>
          <Table>
            <TableHeader className="bg-zinc-900/60">
              <TableRow className="border-zinc-800">
                <TableHead className="text-zinc-400 font-medium">Team Name</TableHead>
                <TableHead className="text-zinc-400 font-medium">Kills Count</TableHead>
                <TableHead className="text-zinc-400 font-medium">Placement Rank</TableHead>
                <TableHead className="text-zinc-400 font-medium">Aggregated Points</TableHead>
                <TableHead className="text-zinc-400 font-medium">Lock Version</TableHead>
                <TableHead className="text-zinc-400 font-medium text-right">Commit Ops</TableHead>
              </TableRow>
            </TableHeader>
            <TableBody>
              {match.results.map((res) => (
                <TableRowKey
                  key={res.teamId}
                  res={res}
                  matchState={match.state}
                  isSubmitting={isSubmitting}
                  onUpdate={handleScoreUpdate}
                  onRevert={handleScoreRevert}
                />
              ))}
            </TableBody>
          </Table>
        </CardContent>
      </Card>
    </div>
  );
}

interface TableRowProps {
  res: MatchResult;
  matchState: string;
  isSubmitting: boolean;
  onUpdate: (teamId: string, kills: number, placement: number, version: number) => Promise<void>;
  onRevert: (teamId: string, kills: number, placement: number, version: number) => Promise<void>;
}

function TableRowKey({ res, matchState, isSubmitting, onUpdate, onRevert }: TableRowProps) {
  const [kills, setKills] = useState(res.kills);
  const [placement, setPlacement] = useState(res.placement);

  // Sync state if backend updates via websocket
  useEffect(() => {
    setKills(res.kills);
    setPlacement(res.placement);
  }, [res.kills, res.placement]);

  const isLive = matchState === "LIVE";
  const hasChanges = kills !== res.kills || placement !== res.placement;

  return (
    <TableRow className="border-zinc-800 hover:bg-zinc-900/20">
      <TableCell className="font-semibold text-zinc-100">{res.teamName}</TableCell>
      <TableCell>
        <div className="flex items-center gap-1">
          <Button
            size="icon"
            variant="outline"
            disabled={!isLive || isSubmitting || kills === 0}
            onClick={() => setKills((prev) => Math.max(0, prev - 1))}
            className="h-7 w-7 border-zinc-800"
          >
            <Minus className="w-3.5 h-3.5" />
          </Button>
          <span className="w-8 text-center text-sm font-semibold">{kills}</span>
          <Button
            size="icon"
            variant="outline"
            disabled={!isLive || isSubmitting}
            onClick={() => setKills((prev) => prev + 1)}
            className="h-7 w-7 border-zinc-800"
          >
            <Plus className="w-3.5 h-3.5" />
          </Button>
        </div>
      </TableCell>
      <TableCell>
        <select
          value={placement}
          disabled={!isLive || isSubmitting}
          onChange={(e) => setPlacement(Number(e.target.value))}
          className="bg-zinc-950 border border-zinc-800 text-sm rounded-md px-2.5 py-1 text-white focus:outline-none focus:ring-1 focus:ring-rose-500 w-24 h-8"
        >
          <option value={0}>—</option>
          {Array.from({ length: 20 }, (_, idx) => (
            <option key={idx + 1} value={idx + 1}>
              #{idx + 1}
            </option>
          ))}
        </select>
      </TableCell>
      <TableCell className="text-rose-400 font-semibold">{res.points} pts</TableCell>
      <TableCell className="text-zinc-500 text-xs">v{res.version}</TableCell>
      <TableCell className="text-right">
        <div className="flex items-center justify-end gap-2">
          {/* Save score update (version checked) */}
          <Button
            size="sm"
            disabled={!isLive || !hasChanges || isSubmitting}
            onClick={() => onUpdate(res.teamId, kills, placement, res.version)}
            className="bg-rose-600 hover:bg-rose-700 font-semibold h-8 px-3"
          >
            Save
          </Button>
          {/* Revert score values (audit logged, version checked) */}
          <Button
            size="sm"
            variant="outline"
            disabled={!isLive || isSubmitting || (res.kills === 0 && res.placement === 0)}
            onClick={() => onRevert(res.teamId, 0, 0, res.version)}
            className="border-zinc-800 text-zinc-400 hover:text-white hover:bg-zinc-900 h-8 px-3"
          >
            Revert
          </Button>
        </div>
      </TableCell>
    </TableRow>
  );
}
