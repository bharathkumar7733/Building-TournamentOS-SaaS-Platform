"use client";

import * as React from "react";
import { useEffect, useState, useRef } from "react";
import { useSearchParams } from "next/navigation";
import { io, Socket } from "socket.io-client";
import { RefreshCw, Tv, Wifi, WifiOff, Trophy, Swords } from "lucide-react";
import { Badge } from "@/components/ui/badge";

interface StandingRow {
  teamId: string;
  teamName: string;
  points: number;
  kills: number;
  placements: number[];
}

export default function ObsLiveOverlayPage({ params }: { params: Promise<{ id: string }> }) {
  const { id: tournamentId } = React.use(params);
  const searchParams = useSearchParams();

  // Query config: ?scope=room&scopeId=r1 OR ?scope=stage&scopeId=s1
  const scope = searchParams.get("scope") || "room";
  const scopeId = searchParams.get("scopeId") || "";

  const [standings, setStandings] = useState<StandingRow[]>([]);
  const [version, setVersion] = useState(0);
  const [connected, setConnected] = useState(false);
  const [loading, setLoading] = useState(true);

  const socketRef = useRef<Socket | null>(null);
  const API_URL = process.env.NEXT_PUBLIC_API_URL ?? "http://localhost:3001";

  useEffect(() => {
    if (!scopeId) {
      setLoading(false);
      return;
    }

    const socket = io(API_URL);
    socketRef.current = socket;

    socket.on("connect", () => {
      setConnected(true);
      // Join channel with version recovery protocol
      socket.emit("subscribe", {
        scope,
        id: scopeId,
        lastVersion: version,
      });
    });

    socket.on("disconnect", () => {
      setConnected(false);
    });

    // Handle room standings event
    socket.on("room:standings", (data: any) => {
      if (scope === "room" && data.roomId === scopeId) {
        setVersion((prev) => {
          // Discard stale updates
          if (data.version < prev) return prev;
          setStandings(data.standings);
          setLoading(false);
          return data.version;
        });
      }
    });

    // Handle stage standings event
    socket.on("stage:standings", (data: any) => {
      if (scope === "stage" && data.stageId === scopeId) {
        setVersion((prev) => {
          // Discard stale updates
          if (data.version < prev) return prev;
          setStandings(data.standings);
          setLoading(false);
          return data.version;
        });
      }
    });

    return () => {
      socket.disconnect();
    };
  }, [scope, scopeId, version]);

  if (!scopeId) {
    return (
      <div className="flex flex-col items-center justify-center min-h-screen bg-zinc-950 text-zinc-400 p-6">
        <Tv className="w-12 h-12 text-rose-500 mb-4 animate-bounce" />
        <h1 className="text-xl font-bold text-white mb-2">Overlay Configuration Required</h1>
        <p className="text-sm text-zinc-500 text-center max-w-sm">
          Please provide parameters in the URL query string. E.g.
          <code className="block bg-zinc-900 text-rose-400 p-2 rounded-md mt-2 select-all">
            ?scope=room&scopeId=[ROOM_ID]
          </code>
        </p>
      </div>
    );
  }

  return (
    <div className="min-h-screen bg-transparent text-white font-sans overflow-hidden p-6 select-none">
      {/* HUD Bar (OBS Safe zone) */}
      <div className="flex items-center justify-between bg-zinc-950/80 border border-zinc-800/80 backdrop-blur-md rounded-xl p-4 mb-6 shadow-2xl max-w-4xl mx-auto transition-all duration-300">
        <div className="flex items-center gap-3">
          <Trophy className="w-6 h-6 text-amber-400 animate-pulse" />
          <div>
            <h2 className="text-sm font-extrabold tracking-wider text-zinc-300 uppercase">
              Live Standings Board
            </h2>
            <p className="text-[10px] text-rose-400 font-semibold uppercase">
              {scope === "room" ? "Group / Room Leaderboard" : "Stage Overall Standings"}
            </p>
          </div>
        </div>

        <div className="flex items-center gap-4">
          <div className="text-right">
            <span className="text-[10px] text-zinc-500 block uppercase">Telemetry Key</span>
            <span className="text-xs font-mono font-bold text-zinc-300">v{version}</span>
          </div>

          <Badge
            className={
              connected
                ? "bg-emerald-500/10 text-emerald-400 border border-emerald-500/20 gap-1.5"
                : "bg-red-500/10 text-red-400 border border-red-500/20 gap-1.5"
            }
          >
            {connected ? (
              <>
                <Wifi className="w-3 h-3" /> Live
              </>
            ) : (
              <>
                <WifiOff className="w-3 h-3 text-red-400" /> Offline
              </>
            )}
          </Badge>
        </div>
      </div>

      {/* Leaderboard Table Container */}
      {loading ? (
        <div className="flex justify-center items-center py-20">
          <RefreshCw className="w-8 h-8 text-rose-500 animate-spin" />
        </div>
      ) : standings.length === 0 ? (
        <div className="text-center py-20 bg-zinc-950/50 border border-zinc-900 border-dashed rounded-xl max-w-4xl mx-auto">
          <Swords className="w-8 h-8 text-zinc-700 mx-auto mb-2" />
          <p className="text-sm text-zinc-500">Waiting for live match results to populate...</p>
        </div>
      ) : (
        <div className="max-w-4xl mx-auto rounded-xl overflow-hidden border border-zinc-800/80 bg-zinc-950/70 backdrop-blur-md shadow-2xl transition-all duration-300">
          <div className="divide-y divide-zinc-900">
            {/* Header row */}
            <div className="grid grid-cols-12 gap-4 bg-zinc-950/90 py-3.5 px-6 text-xs font-extrabold tracking-wider text-zinc-500 uppercase">
              <div className="col-span-2">Rank</div>
              <div className="col-span-5">Team Name</div>
              <div className="col-span-2 text-right">Kills</div>
              <div className="col-span-3 text-right">Total Points</div>
            </div>

            {/* Standing rows */}
            {standings.map((row, idx) => {
              const rank = idx + 1;
              const isTop3 = rank <= 3;
              const rankColors =
                rank === 1
                  ? "from-amber-400 to-amber-600 text-black font-extrabold"
                  : rank === 2
                    ? "from-zinc-300 to-zinc-400 text-black font-extrabold"
                    : rank === 3
                      ? "from-amber-700 to-amber-900 text-white font-semibold"
                      : "from-zinc-900 to-zinc-950 text-zinc-400";

              return (
                <div
                  key={row.teamId}
                  className="grid grid-cols-12 gap-4 py-4 px-6 items-center hover:bg-white/5 transition-all duration-200 border-l-2 border-transparent hover:border-rose-500"
                >
                  <div className="col-span-2 flex items-center">
                    <span
                      className={`flex items-center justify-center h-6 w-10 rounded-md text-xs font-mono bg-gradient-to-br shadow-inner ${rankColors}`}
                    >
                      #{rank}
                    </span>
                  </div>
                  <div className="col-span-5 font-bold text-zinc-100 truncate text-base">
                    {row.teamName}
                  </div>
                  <div className="col-span-2 text-right font-mono text-zinc-300 text-sm font-semibold">
                    {row.kills}
                  </div>
                  <div className="col-span-3 text-right font-mono text-rose-400 font-extrabold text-base">
                    {row.points} <span className="text-zinc-500 text-[10px] font-normal uppercase">pts</span>
                  </div>
                </div>
              );
            })}
          </div>
        </div>
      )}
    </div>
  );
}
