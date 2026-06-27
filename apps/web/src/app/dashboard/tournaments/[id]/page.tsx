"use client";

import * as React from "react";
import { useEffect, useState } from "react";
import { useRouter } from "next/navigation";
import Link from "next/link";
import { ArrowLeft, Loader2, Calendar, Trophy, Lock, Megaphone } from "lucide-react";
import { useForm } from "react-hook-form";
import { zodResolver } from "@hookform/resolvers/zod";
import * as z from "zod";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Textarea } from "@/components/ui/textarea";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Form, FormControl, FormDescription, FormField, FormItem, FormLabel, FormMessage } from "@/components/ui/form";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { tournamentApi } from "@/lib/api-client";

const formSchema = z.object({
  name: z.string().min(3, "Name must be at least 3 characters").max(100, "Name must be at most 100 characters"),
  game: z.string().min(1, "Game is required"),
  startDate: z.string().refine((val) => !isNaN(Date.parse(val)), {
    message: "Invalid date format",
  }),
  maxTeams: z.number().int().min(2, "Minimum teams is 2").max(1000, "Maximum is 1000"),
  roomCapacity: z.number().int().min(1, "Minimum capacity is 1").max(100, "Maximum is 100"),
  qualificationType: z.enum(["TOP_X_PER_ROOM", "OVERALL_RANKING", "MANUAL"]),
  rules: z.string().max(10000).optional(),
});

type FormValues = z.infer<typeof formSchema>;

export default function TournamentDetailPage({ params }: { params: Promise<{ id: string }> }) {
  const router = useRouter();
  const { id } = React.use(params);

  const [tournament, setTournament] = useState<any>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [isSubmitting, setIsSubmitting] = useState(false);
  const [isPublishing, setIsPublishing] = useState(false);

  const form = useForm<FormValues>({
    resolver: zodResolver(formSchema),
    defaultValues: {
      name: "",
      game: "VALORANT",
      startDate: "",
      maxTeams: 100,
      roomCapacity: 20,
      qualificationType: "TOP_X_PER_ROOM",
      rules: "",
    },
  });

  const loadTournament = () => {
    setLoading(true);
    tournamentApi
      .get(id)
      .then((res) => {
        setTournament(res);
        // Map UTC Date string to datetime-local local input format (YYYY-MM-DDThh:mm)
        const localDate = new Date(res.startDate);
        const tzOffset = localDate.getTimezoneOffset() * 60000;
        const localISODate = new Date(localDate.getTime() - tzOffset).toISOString().slice(0, 16);

        form.reset({
          name: res.name,
          game: res.game,
          startDate: localISODate,
          maxTeams: res.maxTeams,
          roomCapacity: res.roomCapacity,
          qualificationType: res.qualificationType as any,
          rules: res.rules || "",
        });
      })
      .catch((err) => {
        console.error(err);
        setError("Failed to fetch tournament. Make sure the database and API are running.");
      })
      .finally(() => {
        setLoading(false);
      });
  };

  useEffect(() => {
    loadTournament();
  }, [id]);

  const onUpdate = async (values: FormValues) => {
    setIsSubmitting(true);
    setError(null);
    try {
      const payload = {
        ...values,
        startDate: new Date(values.startDate).toISOString(),
      };
      await tournamentApi.update(id, payload);
      loadTournament();
    } catch (err: any) {
      console.error(err);
      setError(err.message || "Failed to update configuration.");
    } finally {
      setIsSubmitting(false);
    }
  };

  const onPublish = async () => {
    setIsPublishing(true);
    setError(null);
    try {
      await tournamentApi.publish(id);
      loadTournament();
    } catch (err: any) {
      console.error(err);
      setError(err.message || "Failed to publish tournament.");
    } finally {
      setIsPublishing(false);
    }
  };

  if (loading) {
    return (
      <div className="flex flex-col items-center justify-center py-20 gap-3">
        <Loader2 className="animate-spin text-rose-500" size={32} />
        <p className="text-sm text-zinc-500">Loading campaign setup...</p>
      </div>
    );
  }

  if (error && !tournament) {
    return (
      <div className="space-y-4 text-center max-w-md mx-auto py-12">
        <p className="text-sm text-zinc-400">{error}</p>
        <Link href="/dashboard/tournaments">
          <Button variant="outline" className="border-zinc-800 text-zinc-300">
            Back to Tournaments
          </Button>
        </Link>
      </div>
    );
  }

  const isDraft = tournament.status === "DRAFT";

  return (
    <div className="space-y-6 max-w-4xl mx-auto">
      {/* Header bar */}
      <div className="flex flex-col gap-4">
        <Link
          href="/dashboard/tournaments"
          className="inline-flex items-center gap-1.5 text-xs text-zinc-500 hover:text-zinc-300 transition-colors w-fit"
        >
          <ArrowLeft size={14} /> Back to tournaments
        </Link>

        <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-4 border-b border-zinc-900 pb-5">
          <div className="space-y-1">
            <div className="flex items-center gap-3">
              <h1 className="text-2xl font-extrabold text-zinc-100">{tournament.name}</h1>
              <Badge
                className={`
                  text-[10px] uppercase font-bold
                  ${
                    isDraft
                      ? "bg-zinc-800 text-zinc-400"
                      : tournament.status === "REGISTRATION_OPEN"
                      ? "bg-emerald-500/10 text-emerald-400 border border-emerald-500/20"
                      : "bg-rose-500/10 text-rose-400 border border-rose-500/20"
                  }
                `}
              >
                {tournament.status}
              </Badge>
            </div>
            <p className="text-zinc-500 text-xs font-mono">Tournament ID: {tournament.id}</p>
          </div>

          {/* Action Button */}
          {isDraft && (
            <Button
              onClick={onPublish}
              disabled={isPublishing}
              className="bg-emerald-600 hover:bg-emerald-500 text-white font-semibold gap-2 shadow-lg shadow-emerald-600/10"
            >
              {isPublishing ? (
                <>
                  <Loader2 className="h-4 w-4 animate-spin" />
                  Publishing...
                </>
              ) : (
                <>
                  <Megaphone size={16} />
                  Publish Tournament
                </>
              )}
            </Button>
          )}
        </div>
      </div>

      {error && (
        <div className="p-3.5 text-xs font-semibold text-rose-400 bg-rose-500/10 border border-rose-500/20 rounded-lg">
          {error}
        </div>
      )}

      {/* Main split grid */}
      <div className="grid gap-6 md:grid-cols-3">
        {/* Left Col: Setup & Config Forms */}
        <div className="md:col-span-2 space-y-6">
          <Card className="bg-zinc-900/40 border-zinc-800/80 backdrop-blur-sm">
            <CardHeader className="flex flex-row items-center justify-between">
              <div>
                <CardTitle className="text-lg font-bold text-zinc-100">Setup Parameters</CardTitle>
                <CardDescription className="text-zinc-500 text-xs">
                  {isDraft ? "Configure the options for your tournament." : "Configuration is locked as the tournament is published."}
                </CardDescription>
              </div>
              {!isDraft && <Lock size={16} className="text-zinc-500" />}
            </CardHeader>
            <CardContent>
              <Form {...form}>
                <form onSubmit={form.handleSubmit(onUpdate)} className="space-y-6">
                  {/* Name */}
                  <FormField
                    control={form.control}
                    name="name"
                    render={({ field }) => (
                      <FormItem>
                        <FormLabel className="text-zinc-300 text-xs">Tournament Name</FormLabel>
                        <FormControl>
                          <Input
                            disabled={!isDraft}
                            placeholder="Pro Tournament"
                            {...field}
                            className="bg-zinc-950/60 border-zinc-800/80 text-zinc-200 focus-visible:ring-rose-500 disabled:opacity-70"
                          />
                        </FormControl>
                        <FormMessage className="text-rose-400 text-xs" />
                      </FormItem>
                    )}
                  />

                  {/* Row: Game and Date */}
                  <div className="grid gap-6 sm:grid-cols-2">
                    <FormField
                      control={form.control}
                      name="game"
                      render={({ field }) => (
                        <FormItem>
                          <FormLabel className="text-zinc-300 text-xs">Game</FormLabel>
                          <FormControl>
                            <Select onValueChange={field.onChange} defaultValue={field.value} disabled={!isDraft}>
                              <SelectTrigger className="bg-zinc-950/60 border-zinc-800/80 text-zinc-300 disabled:opacity-70">
                                <SelectValue placeholder="Select Game" />
                              </SelectTrigger>
                              <SelectContent className="bg-zinc-900 border-zinc-800 text-zinc-300">
                                <SelectItem value="VALORANT">Valorant</SelectItem>
                                <SelectItem value="BGMI">BGMI (India)</SelectItem>
                                <SelectItem value="FREEFIRE">Free Fire</SelectItem>
                                <SelectItem value="PUBG_MOBILE">PUBG Mobile</SelectItem>
                                <SelectItem value="CUSTOM">Custom Game Mode</SelectItem>
                              </SelectContent>
                            </Select>
                          </FormControl>
                          <FormMessage className="text-rose-400 text-xs" />
                        </FormItem>
                      )}
                    />

                    <FormField
                      control={form.control}
                      name="startDate"
                      render={({ field }) => (
                        <FormItem>
                          <FormLabel className="text-zinc-300 text-xs">Start Date & Time</FormLabel>
                          <FormControl>
                            <Input
                              type="datetime-local"
                              disabled={!isDraft}
                              {...field}
                              className="bg-zinc-950/60 border-zinc-800/80 text-zinc-300 focus-visible:ring-rose-500 [color-scheme:dark] disabled:opacity-70"
                            />
                          </FormControl>
                          <FormMessage className="text-rose-400 text-xs" />
                        </FormItem>
                      )}
                    />
                  </div>

                  {/* Row: Capacity limits */}
                  <div className="grid gap-6 sm:grid-cols-2">
                    <FormField
                      control={form.control}
                      name="maxTeams"
                      render={({ field }) => (
                        <FormItem>
                          <FormLabel className="text-zinc-300 text-xs">Max Teams</FormLabel>
                          <FormControl>
                            <Input
                              type="number"
                              disabled={!isDraft}
                              {...field}
                              onChange={(e) => field.onChange(e.target.value === '' ? '' : Number(e.target.value))}
                              className="bg-zinc-950/60 border-zinc-800/80 text-zinc-200 focus-visible:ring-rose-500 disabled:opacity-70"
                            />
                          </FormControl>
                          <FormMessage className="text-rose-400 text-xs" />
                        </FormItem>
                      )}
                    />

                    <FormField
                      control={form.control}
                      name="roomCapacity"
                      render={({ field }) => (
                        <FormItem>
                          <FormLabel className="text-zinc-300 text-xs">Room Capacity</FormLabel>
                          <FormControl>
                            <Input
                              type="number"
                              disabled={!isDraft}
                              {...field}
                              onChange={(e) => field.onChange(e.target.value === '' ? '' : Number(e.target.value))}
                              className="bg-zinc-950/60 border-zinc-800/80 text-zinc-200 focus-visible:ring-rose-500 disabled:opacity-70"
                            />
                          </FormControl>
                          <FormMessage className="text-rose-400 text-xs" />
                        </FormItem>
                      )}
                    />
                  </div>

                  {/* Qualification Type */}
                  <FormField
                    control={form.control}
                    name="qualificationType"
                    render={({ field }) => (
                      <FormItem>
                        <FormLabel className="text-zinc-300 text-xs">Qualification Model</FormLabel>
                        <FormControl>
                          <Select onValueChange={field.onChange} defaultValue={field.value} disabled={!isDraft}>
                            <SelectTrigger className="bg-zinc-950/60 border-zinc-800/80 text-zinc-300 disabled:opacity-70">
                              <SelectValue placeholder="Select Model" />
                            </SelectTrigger>
                            <SelectContent className="bg-zinc-900 border-zinc-800 text-zinc-300">
                              <SelectItem value="TOP_X_PER_ROOM">Top X Teams per Room (Auto)</SelectItem>
                              <SelectItem value="OVERALL_RANKING">Overall Group Leaderboard (Auto)</SelectItem>
                              <SelectItem value="MANUAL">Manual Admin Override Selection</SelectItem>
                            </SelectContent>
                          </Select>
                        </FormControl>
                        <FormMessage className="text-rose-400 text-xs" />
                      </FormItem>
                    )}
                  />

                  {/* Rules */}
                  <FormField
                    control={form.control}
                    name="rules"
                    render={({ field }) => (
                      <FormItem>
                        <FormLabel className="text-zinc-300 text-xs">Guidelines & Rules</FormLabel>
                        <FormControl>
                          <Textarea
                            disabled={!isDraft}
                            rows={4}
                            {...field}
                            className="bg-zinc-950/60 border-zinc-800/80 text-zinc-200 focus-visible:ring-rose-500 resize-none disabled:opacity-70"
                          />
                        </FormControl>
                        <FormMessage className="text-rose-400 text-xs" />
                      </FormItem>
                    )}
                  />

                  {/* Save button (only in Draft) */}
                  {isDraft && (
                    <div className="flex justify-end pt-4 border-t border-zinc-800/60">
                      <Button
                        type="submit"
                        disabled={isSubmitting}
                        className="bg-gradient-to-r from-rose-500 to-violet-600 hover:opacity-90 font-semibold"
                      >
                        {isSubmitting ? (
                          <>
                            <Loader2 className="mr-2 h-4 w-4 animate-spin" />
                            Saving...
                          </>
                        ) : (
                          "Save Configuration"
                        )}
                      </Button>
                    </div>
                  )}
                </form>
              </Form>
            </CardContent>
          </Card>
        </div>

        {/* Right Col: Metadata Info Card */}
        <div className="space-y-6">
          <Card className="bg-zinc-900/40 border-zinc-800/80 backdrop-blur-sm">
            <CardHeader>
              <CardTitle className="text-sm font-bold text-zinc-200">Event Info</CardTitle>
            </CardHeader>
            <CardContent className="space-y-4 text-xs text-zinc-400">
              <div className="flex items-center justify-between">
                <span>Created By:</span>
                <span className="font-mono text-zinc-300">{tournament.createdBy}</span>
              </div>
              <div className="flex items-center justify-between">
                <span>Created At:</span>
                <span className="text-zinc-300">{new Date(tournament.createdAt).toLocaleString()}</span>
              </div>
              <div className="flex items-center justify-between">
                <span>Last Updated:</span>
                <span className="text-zinc-300">{new Date(tournament.updatedAt).toLocaleString()}</span>
              </div>
              <div className="flex items-center justify-between">
                <span>Org ID:</span>
                <span className="font-mono text-zinc-300">{tournament.organizationId}</span>
              </div>
            </CardContent>
          </Card>
        </div>
      </div>
    </div>
  );
}
