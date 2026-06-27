"use client";

import { useForm } from "react-hook-form";
import { zodResolver } from "@hookform/resolvers/zod";
import * as z from "zod";
import { useRouter } from "next/navigation";
import { useState } from "react";
import Link from "next/link";
import { ArrowLeft, Loader2 } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Textarea } from "@/components/ui/textarea";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Form, FormControl, FormDescription, FormField, FormItem, FormLabel, FormMessage } from "@/components/ui/form";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { tournamentApi } from "@/lib/api-client";

const formSchema = z.object({
  name: z.string().min(3, "Name must be at least 3 characters").max(100, "Name must be at most 100 characters"),
  game: z.string().min(1, "Game is required"),
  startDate: z.string().refine((val) => !isNaN(Date.parse(val)), {
    message: "Invalid date format",
  }).refine((val) => new Date(val) > new Date(), {
    message: "Start date must be in the future",
  }),
  maxTeams: z.number().int().min(2, "Minimum teams is 2").max(1000, "Maximum is 1000"),
  roomCapacity: z.number().int().min(1, "Minimum capacity is 1").max(100, "Maximum is 100"),
  qualificationType: z.enum(["TOP_X_PER_ROOM", "OVERALL_RANKING", "MANUAL"]),
  rules: z.string().max(10000, "Rules must be under 10000 characters").optional(),
});

type FormValues = z.infer<typeof formSchema>;

export default function CreateTournamentPage() {
  const router = useRouter();
  const [isSubmitting, setIsSubmitting] = useState(false);
  const [submitError, setSubmitError] = useState<string | null>(null);

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

  const onSubmit = async (values: FormValues) => {
    setIsSubmitting(true);
    setSubmitError(null);
    try {
      // API expects ISO 8601 string for dates
      const payload = {
        ...values,
        startDate: new Date(values.startDate).toISOString(),
      };
      await tournamentApi.create(payload);
      router.push("/dashboard/tournaments");
    } catch (err: any) {
      console.error(err);
      setSubmitError(err.message || "Failed to create tournament. Ensure the backend API is running.");
    } finally {
      setIsSubmitting(false);
    }
  };

  return (
    <div className="space-y-6 max-w-2xl mx-auto">
      {/* Back Link */}
      <div className="flex items-center gap-2">
        <Link
          href="/dashboard/tournaments"
          className="inline-flex items-center gap-1.5 text-xs text-zinc-500 hover:text-zinc-300 transition-colors"
        >
          <ArrowLeft size={14} /> Back to list
        </Link>
      </div>

      <Card className="bg-zinc-900/40 border-zinc-800/80 backdrop-blur-sm">
        <CardHeader>
          <CardTitle className="text-xl font-bold bg-clip-text text-transparent bg-gradient-to-r from-white to-zinc-400">
            Create Campaign
          </CardTitle>
          <CardDescription className="text-zinc-500 text-xs">
            Configure parameters for your battle royale tournament.
          </CardDescription>
        </CardHeader>
        <CardContent>
          <Form {...form}>
            <form onSubmit={form.handleSubmit(onSubmit)} className="space-y-6">
              {submitError && (
                <div className="p-3.5 text-xs font-semibold text-rose-400 bg-rose-500/10 border border-rose-500/20 rounded-lg">
                  {submitError}
                </div>
              )}

              {/* Tournament Name */}
              <FormField
                control={form.control}
                name="name"
                render={({ field }) => (
                  <FormItem>
                    <FormLabel className="text-zinc-300 text-xs">Tournament Name</FormLabel>
                    <FormControl>
                      <Input
                        placeholder="e.g. Pro BR League Season 1"
                        {...field}
                        className="bg-zinc-950/60 border-zinc-800/80 text-zinc-200 focus-visible:ring-rose-500"
                      />
                    </FormControl>
                    <FormMessage className="text-rose-400 text-xs" />
                  </FormItem>
                )}
              />

              {/* Row: Game and Start Date */}
              <div className="grid gap-6 sm:grid-cols-2">
                <FormField
                  control={form.control}
                  name="game"
                  render={({ field }) => (
                    <FormItem>
                      <FormLabel className="text-zinc-300 text-xs">Game / Title</FormLabel>
                      <FormControl>
                        <Select onValueChange={field.onChange} defaultValue={field.value}>
                          <SelectTrigger className="bg-zinc-950/60 border-zinc-800/80 text-zinc-300">
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
                          {...field}
                          className="bg-zinc-950/60 border-zinc-800/80 text-zinc-300 focus-visible:ring-rose-500 [color-scheme:dark]"
                        />
                      </FormControl>
                      <FormMessage className="text-rose-400 text-xs" />
                    </FormItem>
                  )}
                />
              </div>

              {/* Row: Max Teams and Room Capacity */}
              <div className="grid gap-6 sm:grid-cols-2">
                <FormField
                  control={form.control}
                  name="maxTeams"
                  render={({ field }) => (
                    <FormItem>
                      <FormLabel className="text-zinc-300 text-xs">Max Teams Limit</FormLabel>
                      <FormControl>
                        <Input
                          type="number"
                          placeholder="100"
                          {...field}
                          onChange={(e) => field.onChange(e.target.value === '' ? '' : Number(e.target.value))}
                          className="bg-zinc-950/60 border-zinc-800/80 text-zinc-200 focus-visible:ring-rose-500"
                        />
                      </FormControl>
                      <FormDescription className="text-zinc-500 text-[10px]">
                        Total capacity of registered teams.
                      </FormDescription>
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
                          placeholder="20"
                          {...field}
                          onChange={(e) => field.onChange(e.target.value === '' ? '' : Number(e.target.value))}
                          className="bg-zinc-950/60 border-zinc-800/80 text-zinc-200 focus-visible:ring-rose-500"
                        />
                      </FormControl>
                      <FormDescription className="text-zinc-500 text-[10px]">
                        Maximum teams per match lobby (e.g. 20 for BR).
                      </FormDescription>
                      <FormMessage className="text-rose-400 text-xs" />
                    </FormItem>
                  )}
                />
              </div>

              {/* Qualification Model */}
              <FormField
                control={form.control}
                name="qualificationType"
                render={({ field }) => (
                  <FormItem>
                    <FormLabel className="text-zinc-300 text-xs">Qualification Model</FormLabel>
                    <FormControl>
                      <Select onValueChange={field.onChange} defaultValue={field.value}>
                        <SelectTrigger className="bg-zinc-950/60 border-zinc-800/80 text-zinc-300">
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

              {/* Rules / Description */}
              <FormField
                control={form.control}
                name="rules"
                render={({ field }) => (
                  <FormItem>
                    <FormLabel className="text-zinc-300 text-xs">Tournament Rules & Guidelines</FormLabel>
                    <FormControl>
                      <Textarea
                        placeholder="Add tournament details, map pools, rules, scoring systems..."
                        rows={5}
                        {...field}
                        className="bg-zinc-950/60 border-zinc-800/80 text-zinc-200 focus-visible:ring-rose-500 resize-none"
                      />
                    </FormControl>
                    <FormMessage className="text-rose-400 text-xs" />
                  </FormItem>
                )}
              />

              {/* Buttons */}
              <div className="flex items-center justify-end gap-3 pt-4 border-t border-zinc-800/60">
                <Link href="/dashboard/tournaments">
                  <Button type="button" variant="outline" className="border-zinc-800 bg-transparent text-zinc-400 hover:text-zinc-200">
                    Cancel
                  </Button>
                </Link>
                <Button
                  type="submit"
                  disabled={isSubmitting}
                  className="bg-gradient-to-r from-rose-500 to-violet-600 hover:opacity-90 font-semibold"
                >
                  {isSubmitting ? (
                    <>
                      <Loader2 className="mr-2 h-4 w-4 animate-spin" />
                      Creating...
                    </>
                  ) : (
                    "Create Campaign"
                  )}
                </Button>
              </div>
            </form>
          </Form>
        </CardContent>
      </Card>
    </div>
  );
}
