"use client";

import * as React from "react";
import { useEffect, useState } from "react";
import Link from "next/link";
import {
  Trophy,
  Users,
  Activity,
  ArrowLeft,
  AlertTriangle,
  CheckCircle,
  Loader2,
  Plus,
  Trash2,
  Clock,
  ShieldCheck,
  Smartphone,
} from "lucide-react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { apiFetch } from "@/lib/api-client";
import { Toaster, toast } from "sonner";

interface PlayerInput {
  name: string;
  gameUid: string;
  isCaptain: boolean;
  isSubstitute: boolean;
}

export default function PublicRegisterPage({ params }: { params: Promise<{ id: string }> }) {
  const { id: tournamentId } = React.use(params);

  // Tournament metadata state
  const [tournament, setTournament] = useState<any>(null);
  const [loadingTournament, setLoadingTournament] = useState(true);
  const [tournamentError, setTournamentError] = useState<string | null>(null);

  // Form inputs state
  const [teamName, setTeamName] = useState("");
  const [whatsapp, setWhatsapp] = useState("");
  const [players, setPlayers] = useState<PlayerInput[]>([
    { name: "", gameUid: "", isCaptain: true, isSubstitute: false },
    { name: "", gameUid: "", isCaptain: false, isSubstitute: false },
    { name: "", gameUid: "", isCaptain: false, isSubstitute: false },
    { name: "", gameUid: "", isCaptain: false, isSubstitute: false },
  ]);

  // Submission/Success state
  const [isSubmitting, setIsSubmitting] = useState(false);
  const [submitSuccess, setSubmitSuccess] = useState<any>(null);
  const [submitError, setSubmitError] = useState<string | null>(null);

  // Fetch tournament details on mount
  useEffect(() => {
    setLoadingTournament(true);
    fetch(`${process.env.NEXT_PUBLIC_API_URL ?? "http://localhost:3001"}/api/v1/organizations/mock-org-id/tournaments/${tournamentId}`)
      .then((r) => {
        if (!r.ok) throw new Error("Tournament not found or API is offline.");
        return r.json();
      })
      .then((data) => {
        setTournament(data.data || data);
      })
      .catch((err) => {
        console.error(err);
        setTournamentError(err.message);
      })
      .finally(() => {
        setLoadingTournament(false);
      });
  }, [tournamentId]);

  // Handle adding/removing player slots
  const addPlayerSlot = () => {
    if (players.length >= 6) {
      toast.error("Standard Battle Royale rosters are capped at 6 players (4 active + 2 substitutes).");
      return;
    }
    setPlayers([...players, { name: "", gameUid: "", isCaptain: false, isSubstitute: true }]);
  };

  const removePlayerSlot = (index: number) => {
    if (players.length <= 4) {
      toast.error("A team must have at least 4 players.");
      return;
    }
    const targetPlayer = players[index];
    const newPlayers = players.filter((_, idx) => idx !== index);

    // If we removed the captain, assign it to the first player
    if (targetPlayer.isCaptain) {
      newPlayers[0].isCaptain = true;
    }

    setPlayers(newPlayers);
  };

  const handlePlayerChange = (index: number, field: keyof PlayerInput, value: any) => {
    const updated = [...players];
    if (field === "isCaptain" && value === true) {
      // Clear captain flag from all other players
      updated.forEach((p, idx) => {
        p.isCaptain = idx === index;
      });
    } else {
      (updated[index] as any)[field] = value;
    }
    setPlayers(updated);
  };

  // Submit handler
  const handleRegister = async (e: React.FormEvent) => {
    e.preventDefault();
    setIsSubmitting(true);
    setSubmitError(null);

    // 1. Basic validation
    if (!teamName.trim()) {
      setSubmitError("Team name is required.");
      setIsSubmitting(false);
      return;
    }

    // 2. Validate roster fields
    for (let i = 0; i < players.length; i++) {
      if (!players[i].name.trim() || !players[i].gameUid.trim()) {
        setSubmitError(`Please fill in Name and Game UID for Player ${i + 1}.`);
        setIsSubmitting(false);
        return;
      }
    }

    // 3. Unique UIDs validation
    const uids = players.map((p) => p.gameUid.trim());
    if (new Set(uids).size !== uids.length) {
      setSubmitError("Duplicate Game UIDs found within your roster.");
      setIsSubmitting(false);
      return;
    }

    // Find captain details
    const captainPlayer = players.find((p) => p.isCaptain);
    if (!captainPlayer) {
      setSubmitError("Exactly one player must be marked as Captain.");
      setIsSubmitting(false);
      return;
    }

    const payload = {
      name: teamName.trim(),
      whatsapp: whatsapp.trim() || undefined,
      captainUid: captainPlayer.gameUid.trim(),
      captainName: captainPlayer.name.trim(),
      players: players.map((p) => ({
        name: p.name.trim(),
        gameUid: p.gameUid.trim(),
        isCaptain: p.isCaptain,
        isSubstitute: p.isSubstitute,
      })),
    };

    // Hash payload for idempotency key verification
    const cyrb53 = (str: string, seed = 0) => {
      let h1 = 0xdeadbeef ^ seed, h2 = 0x41c6ce57 ^ seed;
      for (let i = 0, ch; i < str.length; i++) {
        ch = str.charCodeAt(i);
        h1 = Math.imul(h1 ^ ch, 2654435761);
        h2 = Math.imul(h2 ^ ch, 1597334677);
      }
      h1 = Math.imul(h1 ^ (h1 >>> 16), 2246822507) ^ Math.imul(h2 ^ (h2 >>> 13), 3266489909);
      h2 = Math.imul(h2 ^ (h2 >>> 16), 2246822507) ^ Math.imul(h1 ^ (h1 >>> 13), 3266489909);
      return (h2 >>> 0).toString(16) + (h1 >>> 0).toString(16);
    };

    const payloadStr = JSON.stringify(payload);
    const payloadHash = cyrb53(payloadStr);

    let idempotencyKey = localStorage.getItem(`idempotency_key:${tournamentId}`);
    const storedHash = localStorage.getItem(`payload_hash:${tournamentId}`);

    if (!idempotencyKey || storedHash !== payloadHash) {
      idempotencyKey = window.crypto.randomUUID();
      localStorage.setItem(`idempotency_key:${tournamentId}`, idempotencyKey);
      localStorage.setItem(`payload_hash:${tournamentId}`, payloadHash);
    }

    try {
      const response = await fetch(
        `${process.env.NEXT_PUBLIC_API_URL ?? "http://localhost:3001"}/api/v1/tournaments/${tournamentId}/register`,
        {
          method: "POST",
          headers: {
            "Content-Type": "application/json",
            "X-Idempotency-Key": idempotencyKey,
          },
          body: payloadStr,
        }
      );

      const resJson = await response.json();

      if (!response.ok) {
        throw new Error(resJson.error?.message || resJson.message || "Registration failed.");
      }

      // Success: clear local storage tokens
      localStorage.removeItem(`idempotency_key:${tournamentId}`);
      localStorage.removeItem(`payload_hash:${tournamentId}`);

      setSubmitSuccess(resJson.data);
      toast.success("Registration submitted!");
    } catch (err: any) {
      console.error(err);
      setSubmitError(err.message || "An unexpected error occurred. Please try again.");
    } finally {
      setIsSubmitting(false);
    }
  };

  if (loadingTournament) {
    return (
      <div className="flex flex-col items-center justify-center min-h-[60vh] gap-4">
        <Loader2 className="w-8 h-8 text-rose-500 animate-spin" />
        <p className="text-zinc-400 text-sm">Loading tournament details...</p>
      </div>
    );
  }

  if (tournamentError || !tournament) {
    return (
      <div className="max-w-md mx-auto mt-20 p-6 bg-zinc-900 border border-zinc-800 rounded-xl text-center space-y-4">
        <AlertTriangle className="w-12 h-12 text-red-500 mx-auto" />
        <h2 className="text-xl font-bold">Failed to Load Tournament</h2>
        <p className="text-zinc-400 text-sm">{tournamentError || "Tournament not found."}</p>
        <Link href="/">
          <Button className="mt-2" variant="outline">
            <ArrowLeft className="w-4 h-4 mr-2" /> Back to Home
          </Button>
        </Link>
      </div>
    );
  }

  // Registration Window Calculations
  const startsAt = tournament.registrationStartsAt ? new Date(tournament.registrationStartsAt) : null;
  const endsAt = tournament.registrationEndsAt ? new Date(tournament.registrationEndsAt) : null;
  const now = new Date();
  const isTooEarly = startsAt && now < startsAt;
  const isTooLate = endsAt && now > endsAt;
  const isWindowClosed = isTooEarly || isTooLate || tournament.status !== "REGISTRATION_OPEN";

  if (submitSuccess) {
    return (
      <div className="max-w-2xl mx-auto py-12 px-4 space-y-8">
        <Toaster theme="dark" position="bottom-right" />
        
        {/* Success Header */}
        <div className="text-center space-y-3">
          <CheckCircle className="w-16 h-16 text-emerald-500 mx-auto animate-bounce" />
          <h1 className="text-3xl font-extrabold tracking-tight bg-clip-text text-transparent bg-gradient-to-r from-emerald-400 to-teal-500">
            Registration Received!
          </h1>
          <p className="text-zinc-400 text-sm max-w-md mx-auto">
            Your application for <strong className="text-zinc-200">{tournament.name}</strong> has been successfully submitted.
          </p>
        </div>

        {/* Status Card */}
        <Card className="bg-zinc-900/40 border-zinc-800 backdrop-blur-sm shadow-xl overflow-hidden">
          <div className="h-1 bg-gradient-to-r from-rose-500 to-violet-600" />
          <CardHeader>
            <div className="flex items-center justify-between">
              <CardTitle className="text-lg">Registration Summary</CardTitle>
              <Badge
                className={
                  submitSuccess.status === "WAITLISTED"
                    ? "bg-amber-500/10 text-amber-400 border border-amber-500/20"
                    : "bg-emerald-500/10 text-emerald-400 border border-emerald-500/20"
                }
              >
                {submitSuccess.status}
              </Badge>
            </div>
            <CardDescription>Ref ID: {submitSuccess.teamId}</CardDescription>
          </CardHeader>
          <CardContent className="space-y-4">
            <div className="grid grid-cols-2 gap-4 border-t border-b border-zinc-800/80 py-4">
              <div>
                <span className="text-xs text-zinc-500 block uppercase">Team Name</span>
                <span className="text-zinc-200 font-semibold">{teamName}</span>
              </div>
              <div>
                <span className="text-xs text-zinc-500 block uppercase">Captain</span>
                <span className="text-zinc-200 font-semibold">
                  {players.find((p) => p.isCaptain)?.name}
                </span>
              </div>
              {submitSuccess.status === "WAITLISTED" && (
                <div className="col-span-2 bg-amber-500/5 border border-amber-500/10 p-3 rounded-lg flex items-center gap-3">
                  <Clock className="w-5 h-5 text-amber-400 shrink-0" />
                  <div className="text-xs text-amber-400">
                    <strong>Waitlist Position #{submitSuccess.waitlistPosition}</strong>. The tournament is currently full. If an approved team withdraws or gets rejected, waitlisted teams will be promoted in queue order.
                  </div>
                </div>
              )}
            </div>

            <div className="space-y-2">
              <h3 className="text-sm font-semibold text-zinc-300">Roster</h3>
              <div className="grid gap-2 sm:grid-cols-2">
                {players.map((p, idx) => (
                  <div key={idx} className="bg-zinc-950/40 p-2.5 rounded-lg border border-zinc-900 flex justify-between items-center text-xs">
                    <div>
                      <span className="text-zinc-300 font-medium block">{p.name}</span>
                      <span className="text-zinc-500 block">UID: {p.gameUid}</span>
                    </div>
                    {p.isCaptain && <Badge className="bg-rose-500/10 text-rose-400 border-none">Captain</Badge>}
                    {p.isSubstitute && <Badge className="bg-zinc-800 text-zinc-400 border-none">Substitute</Badge>}
                  </div>
                ))}
              </div>
            </div>

            <div className="pt-4 flex justify-center">
              <Link href="/">
                <Button className="w-full sm:w-auto" variant="outline">
                  Return to Dashboard
                </Button>
              </Link>
            </div>
          </CardContent>
        </Card>
      </div>
    );
  }

  return (
    <div className="max-w-3xl mx-auto py-10 px-4 space-y-8">
      <Toaster theme="dark" position="bottom-right" />

      {/* Back button */}
      <div>
        <Link href="/">
          <Button variant="ghost" size="sm" className="text-zinc-400 hover:text-white gap-2">
            <ArrowLeft className="w-4 h-4" /> Back
          </Button>
        </Link>
      </div>

      {/* Hero Banner */}
      <div className="bg-zinc-900/30 border border-zinc-800/80 rounded-2xl p-6 flex flex-col md:flex-row items-start md:items-center justify-between gap-6 backdrop-blur-sm shadow-xl">
        <div className="space-y-1">
          <div className="flex items-center gap-2">
            <Badge className="bg-gradient-to-r from-rose-500 to-violet-600 border-none">
              {tournament.game}
            </Badge>
            <Badge variant="outline" className="border-zinc-700 text-zinc-400">
              Max: {tournament.config?.maxTeams ?? 0} Teams
            </Badge>
          </div>
          <h1 className="text-2xl font-extrabold tracking-tight text-white mt-2">
            {tournament.name}
          </h1>
          <p className="text-xs text-zinc-400 flex items-center gap-1.5 mt-1">
            <Trophy className="w-3.5 h-3.5 text-rose-500" /> Standard placement + kill scoring
          </p>
        </div>

        {/* Dynamic Dates Banner */}
        <div className="text-right text-xs space-y-1 bg-zinc-950/40 p-3 rounded-lg border border-zinc-900 w-full md:w-auto">
          {startsAt && (
            <div className="text-zinc-400">
              Starts: <strong className="text-zinc-200">{startsAt.toLocaleString()}</strong>
            </div>
          )}
          {endsAt && (
            <div className="text-zinc-400">
              Closes: <strong className="text-zinc-200">{endsAt.toLocaleString()}</strong>
            </div>
          )}
        </div>
      </div>

      {/* If Window is Closed */}
      {isWindowClosed ? (
        <Card className="bg-red-950/10 border-red-900/30 text-red-400 p-6 flex items-start gap-4 shadow-lg">
          <AlertTriangle className="w-6 h-6 shrink-0 mt-0.5 text-red-500" />
          <div className="space-y-1.5">
            <h3 className="font-bold text-base text-zinc-200">Registration is Closed</h3>
            <p className="text-xs text-zinc-400">
              {isTooEarly && `Registration has not opened yet. It will start at ${startsAt?.toLocaleString()}.`}
              {isTooLate && `Registration for this tournament closed at ${endsAt?.toLocaleString()}.`}
              {!isTooEarly && !isTooLate && "The administrator has closed registration."}
            </p>
            <div className="pt-2">
              <Link href="/">
                <Button size="sm" variant="outline" className="border-red-900/40 hover:bg-red-950/20 text-red-300">
                  Return to Home
                </Button>
              </Link>
            </div>
          </div>
        </Card>
      ) : (
        /* Form Card */
        <Card className="bg-zinc-900/40 border-zinc-800/80 backdrop-blur-sm shadow-2xl">
          <CardHeader>
            <CardTitle>Team Application</CardTitle>
            <CardDescription>
              Complete the roster form below to apply. Fields marked with * are mandatory.
            </CardDescription>
          </CardHeader>
          <CardContent>
            <form onSubmit={handleRegister} className="space-y-6">
              
              {/* Error Banner */}
              {submitError && (
                <div className="bg-red-500/10 border border-red-500/20 text-red-400 p-3.5 rounded-lg text-xs flex items-center gap-2">
                  <AlertTriangle className="w-4 h-4 shrink-0 text-red-500" />
                  <span>{submitError}</span>
                </div>
              )}

              {/* Team Information */}
              <div className="grid gap-4 sm:grid-cols-2">
                <div className="space-y-2">
                  <Label htmlFor="team-name" className="text-xs font-semibold text-zinc-300">
                    Team Name *
                  </Label>
                  <Input
                    id="team-name"
                    placeholder="e.g. Team Liquid"
                    value={teamName}
                    onChange={(e) => setTeamName(e.target.value)}
                    required
                    className="bg-zinc-950 border-zinc-800 focus:ring-rose-500 focus:border-rose-500"
                  />
                </div>
                <div className="space-y-2">
                  <Label htmlFor="whatsapp" className="text-xs font-semibold text-zinc-300 flex items-center gap-1">
                    <Smartphone className="w-3 h-3" /> WhatsApp Contact (Optional)
                  </Label>
                  <Input
                    id="whatsapp"
                    placeholder="e.g. +1234567890"
                    value={whatsapp}
                    onChange={(e) => setWhatsapp(e.target.value)}
                    className="bg-zinc-950 border-zinc-800 focus:ring-rose-500 focus:border-rose-500"
                  />
                </div>
              </div>

              {/* Roster Section */}
              <div className="space-y-4">
                <div className="flex items-center justify-between border-b border-zinc-800 pb-2">
                  <h3 className="text-sm font-semibold text-zinc-200 flex items-center gap-1.5">
                    <Users className="w-4 h-4 text-violet-500" /> Roster ({players.length}/6 Players)
                  </h3>
                  <Button
                    type="button"
                    variant="outline"
                    size="xs"
                    onClick={addPlayerSlot}
                    disabled={players.length >= 6}
                    className="border-zinc-800 hover:bg-zinc-800 text-xs py-1 h-7"
                  >
                    <Plus className="w-3.5 h-3.5 mr-1" /> Add Player (Sub)
                  </Button>
                </div>

                <div className="space-y-3">
                  {players.map((player, index) => (
                    <div
                      key={index}
                      className={`p-4 rounded-xl border transition-all flex flex-col md:flex-row items-stretch md:items-end gap-3 backdrop-blur-sm ${
                        player.isCaptain
                          ? "bg-rose-500/5 border-rose-500/20"
                          : "bg-zinc-950/40 border-zinc-800/80"
                      }`}
                    >
                      <div className="flex-1 space-y-1.5">
                        <Label className="text-[10px] text-zinc-400 block uppercase font-medium">
                          Player Name *
                        </Label>
                        <Input
                          placeholder={`e.g. ${index === 0 ? "Captain Name" : `Player ${index + 1}`}`}
                          value={player.name}
                          onChange={(e) => handlePlayerChange(index, "name", e.target.value)}
                          required
                          className="bg-zinc-950 border-zinc-800 focus:ring-rose-500 focus:border-rose-500 text-sm h-9"
                        />
                      </div>

                      <div className="flex-1 space-y-1.5">
                        <Label className="text-[10px] text-zinc-400 block uppercase font-medium">
                          Game UID *
                        </Label>
                        <Input
                          placeholder="e.g. 5293849"
                          value={player.gameUid}
                          onChange={(e) => handlePlayerChange(index, "gameUid", e.target.value)}
                          required
                          className="bg-zinc-950 border-zinc-800 focus:ring-rose-500 focus:border-rose-500 text-sm h-9"
                        />
                      </div>

                      {/* Captain & Sub Options */}
                      <div className="flex items-center gap-4 h-9">
                        <label className="flex items-center gap-1.5 text-xs text-zinc-400 cursor-pointer select-none">
                          <input
                            type="radio"
                            name="captain-select"
                            checked={player.isCaptain}
                            onChange={() => handlePlayerChange(index, "isCaptain", true)}
                            className="w-4 h-4 rounded-full border-zinc-800 text-rose-500 focus:ring-rose-500"
                          />
                          <span>Captain</span>
                        </label>

                        {index >= 4 && (
                          <Badge variant="secondary" className="bg-zinc-800 text-zinc-400 border-none text-[10px]">
                            Substitute
                          </Badge>
                        )}

                        {players.length > 4 && (
                          <Button
                            type="button"
                            variant="ghost"
                            size="icon"
                            onClick={() => removePlayerSlot(index)}
                            className="text-zinc-500 hover:text-red-400 hover:bg-zinc-800/20 shrink-0 h-9 w-9"
                          >
                            <Trash2 className="w-4 h-4" />
                          </Button>
                        )}
                      </div>
                    </div>
                  ))}
                </div>
              </div>

              {/* Submit Buttons */}
              <div className="pt-4 border-t border-zinc-800/80 flex items-center justify-between gap-4">
                <p className="text-[10px] text-zinc-500 max-w-sm">
                  By clicking Register, you confirm that your roster complies with the tournament guidelines. If capacity is full, you will be placed on the waitlist.
                </p>
                <Button
                  type="submit"
                  disabled={isSubmitting}
                  className="bg-gradient-to-r from-rose-500 to-violet-600 hover:opacity-90 transition-all font-semibold px-6 shadow-lg shadow-rose-500/10 shrink-0"
                >
                  {isSubmitting ? (
                    <>
                      <Loader2 className="w-4 h-4 mr-2 animate-spin" /> Registering...
                    </>
                  ) : (
                    "Register Team"
                  )}
                </Button>
              </div>
            </form>
          </CardContent>
        </Card>
      )}
    </div>
  );
}
