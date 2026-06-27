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
  CheckCircle2,
  XCircle,
  Loader2,
  Download,
  Check,
  X,
  Clock,
  Filter,
  CheckSquare,
  Square,
  ExternalLink,
} from "lucide-react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import { Tabs, TabsList, TabsTrigger } from "@/components/ui/tabs";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import { Toaster, toast } from "sonner";

interface Player {
  id: string;
  name: string;
  gameUid: string;
  isCaptain: boolean;
  isSubstitute: boolean;
}

interface TeamRegistration {
  id: string;
  name: string;
  status: "PENDING" | "APPROVED" | "REJECTED" | "WAITLISTED" | "WITHDRAWN" | "BLACKLISTED";
  captainName: string;
  captainUid: string;
  whatsapp: string | null;
  createdAt: string;
  waitlistPosition: number | null;
  players: Player[];
}

export default function AdminRegistrationsPage({ params }: { params: Promise<{ id: string }> }) {
  const { id: tournamentId } = React.use(params);
  const ORG_ID = "mock-org-id";

  // Tournament metadata state
  const [tournament, setTournament] = useState<any>(null);
  const [loadingTournament, setLoadingTournament] = useState(true);

  // Registrations state
  const [registrations, setRegistrations] = useState<TeamRegistration[]>([]);
  const [loadingRegistrations, setLoadingRegistrations] = useState(true);
  const [statusFilter, setStatusFilter] = useState<string>("ALL");
  const [page, setPage] = useState(1);
  const [totalPages, setTotalPages] = useState(1);

  // Selection state for bulk actions
  const [selectedTeamIds, setSelectedTeamIds] = useState<string[]>([]);

  // Action states
  const [rejectingTeam, setRejectingTeam] = useState<TeamRegistration | null>(null);
  const [rejectReason, setRejectReason] = useState("");
  const [approvingTeam, setApprovingTeam] = useState<TeamRegistration | null>(null);
  const [approvalReason, setApprovalReason] = useState("");
  const [showBulkApproveDialog, setShowBulkApproveDialog] = useState(false);
  const [bulkApprovalReason, setBulkApprovalReason] = useState("");
  const [isSubmittingAction, setIsSubmittingAction] = useState(false);

  // Load tournament metadata
  useEffect(() => {
    setLoadingTournament(true);
    fetch(`${process.env.NEXT_PUBLIC_API_URL ?? "http://localhost:3001"}/api/v1/organizations/${ORG_ID}/tournaments/${tournamentId}`)
      .then((r) => r.json())
      .then((data) => {
        setTournament(data.data || data);
      })
      .catch((err) => {
        console.error("Failed to load tournament metadata", err);
      })
      .finally(() => {
        setLoadingTournament(false);
      });
  }, [tournamentId]);

  // Load team registrations
  const loadRegistrations = () => {
    setLoadingRegistrations(true);
    const statusParam = statusFilter !== "ALL" ? `&status=${statusFilter}` : "";
    fetch(
      `${process.env.NEXT_PUBLIC_API_URL ?? "http://localhost:3001"}/api/v1/organizations/${ORG_ID}/tournaments/${tournamentId}/registrations?page=${page}&limit=20${statusParam}`
    )
      .then((r) => {
        if (!r.ok) throw new Error("Failed to load registrations.");
        return r.json();
      })
      .then((res) => {
        setRegistrations((res.data as TeamRegistration[]) || []);
        if (res.meta) {
          setTotalPages(res.meta.totalPages || 1);
        }
      })
      .catch((err) => {
        console.error(err);
        toast.error("Failed to load team registrations.");
      })
      .finally(() => {
        setLoadingRegistrations(false);
        setSelectedTeamIds([]); // Clear selection on load
      });
  };

  useEffect(() => {
    loadRegistrations();
  }, [tournamentId, statusFilter, page]);

  // Bulk select toggles
  const toggleSelectAll = () => {
    const bulkEligibleIds = registrations
      .filter((t) => t.status === "PENDING" || t.status === "WAITLISTED")
      .map((t) => t.id);

    if (selectedTeamIds.length === bulkEligibleIds.length) {
      setSelectedTeamIds([]);
    } else {
      setSelectedTeamIds(bulkEligibleIds);
    }
  };

  const toggleSelectTeam = (id: string) => {
    if (selectedTeamIds.includes(id)) {
      setSelectedTeamIds(selectedTeamIds.filter((tId) => tId !== id));
    } else {
      setSelectedTeamIds([...selectedTeamIds, id]);
    }
  };

  // Actions
  const handleApprove = async (teamId: string, reason?: string) => {
    setIsSubmittingAction(true);
    try {
      const response = await fetch(
        `${process.env.NEXT_PUBLIC_API_URL ?? "http://localhost:3001"}/api/v1/organizations/${ORG_ID}/tournaments/${tournamentId}/registrations/${teamId}/approve`,
        {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ reason: reason?.trim() || undefined }),
        }
      );
      const res = await response.json();
      if (!response.ok) {
        throw new Error(res.error?.message || res.message || "Failed to approve team.");
      }
      toast.success("Team approved successfully.");
      setApprovingTeam(null);
      setApprovalReason("");
      loadRegistrations();
    } catch (err: any) {
      console.error(err);
      toast.error(err.message);
    } finally {
      setIsSubmittingAction(false);
    }
  };

  const handleRejectSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!rejectingTeam) return;

    if (rejectReason.trim().length < 5) {
      toast.error("Please supply a rejection reason of at least 5 characters.");
      return;
    }

    setIsSubmittingAction(true);
    try {
      const response = await fetch(
        `${process.env.NEXT_PUBLIC_API_URL ?? "http://localhost:3001"}/api/v1/organizations/${ORG_ID}/tournaments/${tournamentId}/registrations/${rejectingTeam.id}/reject`,
        {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ reason: rejectReason.trim() }),
        }
      );
      const res = await response.json();
      if (!response.ok) {
        throw new Error(res.error?.message || res.message || "Failed to reject team.");
      }
      toast.success("Team registration rejected.");
      setRejectingTeam(null);
      setRejectReason("");
      loadRegistrations();
    } catch (err: any) {
      console.error(err);
      toast.error(err.message);
    } finally {
      setIsSubmittingAction(false);
    }
  };

  const handleBulkApprove = async (reason?: string) => {
    if (selectedTeamIds.length === 0) return;

    setIsSubmittingAction(true);
    try {
      const response = await fetch(
        `${process.env.NEXT_PUBLIC_API_URL ?? "http://localhost:3001"}/api/v1/organizations/${ORG_ID}/tournaments/${tournamentId}/registrations/bulk-approve`,
        {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ teamIds: selectedTeamIds, reason: reason?.trim() || undefined }),
        }
      );
      const res = await response.json();
      if (!response.ok) {
        throw new Error(res.error?.message || res.message || "Failed to bulk approve teams.");
      }
      
      const approved = res.data?.results?.filter((r: any) => r.result === "approved") || [];
      const skipped = res.data?.results?.filter((r: any) => r.result === "skipped") || [];
      
      toast.success(`Processed bulk approvals: ${approved.length} approved, ${skipped.length} skipped.`);
      setShowBulkApproveDialog(false);
      setBulkApprovalReason("");
      loadRegistrations();
    } catch (err: any) {
      console.error(err);
      toast.error(err.message);
    } finally {
      setIsSubmittingAction(false);
    }
  };

  const handleExportCsv = async () => {
    try {
      const response = await fetch(
        `${process.env.NEXT_PUBLIC_API_URL ?? "http://localhost:3001"}/api/v1/organizations/${ORG_ID}/tournaments/${tournamentId}/registrations/export`
      );
      if (!response.ok) throw new Error("Failed to export CSV.");
      const blob = await response.blob();
      const url = window.URL.createObjectURL(blob);
      const a = document.createElement("a");
      a.href = url;
      a.download = `registrations-${tournamentId}-${Date.now()}.csv`;
      document.body.appendChild(a);
      a.click();
      a.remove();
      window.URL.revokeObjectURL(url);
      toast.success("CSV export downloaded.");
    } catch (err: any) {
      console.error(err);
      toast.error(err.message || "CSV export failed.");
    }
  };

  if (loadingTournament) {
    return (
      <div className="flex flex-col items-center justify-center min-h-[60vh] gap-4">
        <Loader2 className="w-8 h-8 text-rose-500 animate-spin" />
        <p className="text-zinc-400 text-sm">Loading console registrations...</p>
      </div>
    );
  }

  // Count approved teams in current list
  const approvedCount = registrations.filter((r) => r.status === "APPROVED").length; // Note: list is paginated
  const maxTeams = tournament?.config?.maxTeams ?? 0;

  // Bulk toggle helper
  const bulkEligible = registrations.filter((t) => t.status === "PENDING" || t.status === "WAITLISTED");
  const isAllSelected = bulkEligible.length > 0 && selectedTeamIds.length === bulkEligible.length;

  return (
    <div className="space-y-6">
      <Toaster theme="dark" position="bottom-right" />

      {/* Breadcrumb / Back button */}
      <div>
        <Link href={`/dashboard/tournaments/${tournamentId}`}>
          <Button variant="ghost" size="sm" className="text-zinc-400 hover:text-white gap-2">
            <ArrowLeft className="w-4 h-4" /> Back to Campaign Configuration
          </Button>
        </Link>
      </div>

      {/* Header Banner */}
      <div className="flex flex-col md:flex-row md:items-center justify-between gap-4 border-b border-zinc-800 pb-4">
        <div className="space-y-1">
          <h1 className="text-3xl font-extrabold tracking-tight bg-clip-text text-transparent bg-gradient-to-r from-white to-zinc-400">
            Player Registration Console
          </h1>
          <p className="text-zinc-400 text-sm">
            Review rosters, manage waitlist queues, bulk approve applications, and export audit files.
          </p>
        </div>

        <div className="flex items-center gap-2">
          <Button
            variant="outline"
            size="sm"
            onClick={handleExportCsv}
            className="border-zinc-800 hover:bg-zinc-900 text-zinc-300 gap-2 h-9"
          >
            <Download className="w-4 h-4" /> Export CSV
          </Button>
          <Link href={`/tournaments/${tournamentId}/register`} target="_blank">
            <Button
              variant="outline"
              size="sm"
              className="border-rose-500/20 hover:bg-rose-500/5 text-rose-400 gap-2 h-9"
            >
              Public Form <ExternalLink className="w-3.5 h-3.5" />
            </Button>
          </Link>
        </div>
      </div>

      {/* Quick summary grid */}
      <div className="grid gap-4 sm:grid-cols-3">
        <Card className="bg-zinc-900/40 border-zinc-800/80 backdrop-blur-sm">
          <CardHeader className="py-4">
            <CardTitle className="text-xs text-zinc-500 uppercase tracking-wider">Tournament Name</CardTitle>
          </CardHeader>
          <CardContent className="py-2">
            <div className="text-lg font-bold text-zinc-100 truncate">{tournament?.name}</div>
            <p className="text-[10px] text-zinc-500 mt-1">{tournament?.game}</p>
          </CardContent>
        </Card>
        <Card className="bg-zinc-900/40 border-zinc-800/80 backdrop-blur-sm">
          <CardHeader className="py-4">
            <CardTitle className="text-xs text-zinc-500 uppercase tracking-wider">Capacity Lock Status</CardTitle>
          </CardHeader>
          <CardContent className="py-2">
            <div className="text-lg font-bold text-zinc-100 flex items-center gap-2">
              <span>{maxTeams} Teams Max</span>
            </div>
            <p className="text-[10px] text-zinc-500 mt-1">Checked with raw row locks on db transactions</p>
          </CardContent>
        </Card>
        <Card className="bg-zinc-900/40 border-zinc-800/80 backdrop-blur-sm">
          <CardHeader className="py-4">
            <CardTitle className="text-xs text-zinc-500 uppercase tracking-wider">Registration Phase</CardTitle>
          </CardHeader>
          <CardContent className="py-2">
            <div className="text-lg font-bold text-zinc-100">
              <Badge
                className={
                  tournament?.status === "REGISTRATION_OPEN"
                    ? "bg-emerald-500/10 text-emerald-400 border border-emerald-500/20"
                    : "bg-zinc-800 text-zinc-400 border border-zinc-700"
                }
              >
                {tournament?.status}
              </Badge>
            </div>
            <p className="text-[10px] text-zinc-500 mt-1">Lifecycle handled dynamically by startsAt/endsAt</p>
          </CardContent>
        </Card>
      </div>

      {/* Main Table section */}
      <Card className="bg-zinc-900/40 border-zinc-800/80 backdrop-blur-sm shadow-xl">
        <CardHeader className="flex flex-col sm:flex-row sm:items-center justify-between gap-4 pb-2">
          <div>
            <CardTitle className="text-lg">Registered Teams</CardTitle>
            <CardDescription>Manage approval state and waitlist order.</CardDescription>
          </div>
          
          {/* Status filtering tabs */}
          <Tabs value={statusFilter} onValueChange={(val) => { setStatusFilter(val); setPage(1); }}>
            <TabsList className="bg-zinc-950 border border-zinc-900">
              <TabsTrigger value="ALL">All</TabsTrigger>
              <TabsTrigger value="PENDING">Pending</TabsTrigger>
              <TabsTrigger value="APPROVED">Approved</TabsTrigger>
              <TabsTrigger value="WAITLISTED">Waitlist</TabsTrigger>
              <TabsTrigger value="REJECTED">Rejected</TabsTrigger>
            </TabsList>
          </Tabs>
        </CardHeader>
        <CardContent className="space-y-4">
          
          {/* Bulk Action Panel */}
          {selectedTeamIds.length > 0 && (
            <div className="bg-rose-500/5 border border-rose-500/15 rounded-lg p-3.5 flex items-center justify-between gap-4">
              <div className="text-xs text-rose-300">
                <strong>{selectedTeamIds.length}</strong> teams selected for bulk actions.
              </div>
              <div className="flex gap-2">
                <Button
                  size="sm"
                  onClick={() => setShowBulkApproveDialog(true)}
                  disabled={isSubmittingAction}
                  className="bg-emerald-600 hover:bg-emerald-700 font-semibold gap-1"
                >
                  <Check className="w-3.5 h-3.5" /> Approve Selected
                </Button>
                <Button
                  size="sm"
                  variant="ghost"
                  onClick={() => setSelectedTeamIds([])}
                  className="text-zinc-400 hover:text-white"
                >
                  Clear Selection
                </Button>
              </div>
            </div>
          )}

          {loadingRegistrations ? (
            <div className="flex flex-col items-center justify-center py-20 gap-3">
              <Loader2 className="w-6 h-6 text-rose-500 animate-spin" />
              <span className="text-zinc-500 text-xs">Fetching applications...</span>
            </div>
          ) : registrations.length === 0 ? (
            <div className="text-center py-20 border border-dashed border-zinc-800 rounded-xl space-y-2">
              <Filter className="w-8 h-8 text-zinc-600 mx-auto" />
              <h3 className="font-bold text-zinc-300">No Teams Found</h3>
              <p className="text-xs text-zinc-500">No applications match the current filter criteria.</p>
            </div>
          ) : (
            <div className="border border-zinc-800/80 rounded-lg overflow-hidden">
              <Table>
                <TableHeader className="bg-zinc-950">
                  <TableRow className="border-zinc-800">
                    <TableHead className="w-10">
                      <Button
                        type="button"
                        variant="ghost"
                        size="icon"
                        onClick={toggleSelectAll}
                        disabled={bulkEligible.length === 0}
                        className="text-zinc-500 hover:text-zinc-200"
                      >
                        {isAllSelected ? (
                          <CheckSquare className="w-4 h-4 text-rose-500" />
                        ) : (
                          <Square className="w-4 h-4" />
                        )}
                      </Button>
                    </TableHead>
                    <TableHead className="text-zinc-400 font-medium">Team Name</TableHead>
                    <TableHead className="text-zinc-400 font-medium">Captain</TableHead>
                    <TableHead className="text-zinc-400 font-medium">WhatsApp</TableHead>
                    <TableHead className="text-zinc-400 font-medium">Roster Size</TableHead>
                    <TableHead className="text-zinc-400 font-medium">Status</TableHead>
                    <TableHead className="text-zinc-400 font-medium">Registered Date</TableHead>
                    <TableHead className="text-zinc-400 font-medium text-right">Actions</TableHead>
                  </TableRow>
                </TableHeader>
                <TableBody>
                  {registrations.map((team) => {
                    const isSelectable = team.status === "PENDING" || team.status === "WAITLISTED";
                    const isSelected = selectedTeamIds.includes(team.id);

                    return (
                      <TableRow key={team.id} className="border-zinc-800 hover:bg-zinc-900/20">
                        <TableCell>
                          <Button
                            type="button"
                            variant="ghost"
                            size="icon"
                            disabled={!isSelectable}
                            onClick={() => toggleSelectTeam(team.id)}
                            className={`text-zinc-500 hover:text-zinc-200 ${!isSelectable && "opacity-20"}`}
                          >
                            {isSelected ? (
                              <CheckSquare className="w-4 h-4 text-rose-500" />
                            ) : (
                              <Square className="w-4 h-4" />
                            )}
                          </Button>
                        </TableCell>
                        <TableCell className="font-semibold text-zinc-100">
                          {team.name}
                          {team.status === "WAITLISTED" && team.waitlistPosition && (
                            <Badge className="ml-2 bg-amber-500/10 text-amber-500 border-none text-[10px] py-0.5">
                              WL #{team.waitlistPosition}
                            </Badge>
                          )}
                        </TableCell>
                        <TableCell className="text-zinc-300">
                          <div>{team.captainName}</div>
                          <div className="text-[10px] text-zinc-500">UID: {team.captainUid}</div>
                        </TableCell>
                        <TableCell className="text-zinc-400 text-xs">{team.whatsapp || "—"}</TableCell>
                        <TableCell className="text-zinc-400 text-xs">
                          {team.players.length} players
                        </TableCell>
                        <TableCell>
                          <Badge
                            className={
                              team.status === "APPROVED"
                                ? "bg-emerald-500/10 text-emerald-400 border border-emerald-500/20 hover:bg-emerald-500/10"
                                : team.status === "PENDING"
                                  ? "bg-sky-500/10 text-sky-400 border border-sky-500/20 hover:bg-sky-500/10"
                                  : team.status === "WAITLISTED"
                                    ? "bg-amber-500/10 text-amber-400 border border-amber-500/20 hover:bg-amber-500/10"
                                    : "bg-red-500/10 text-red-400 border border-red-500/20 hover:bg-red-500/10"
                            }
                          >
                            {team.status}
                          </Badge>
                        </TableCell>
                        <TableCell className="text-zinc-500 text-xs">
                          {new Date(team.createdAt).toLocaleDateString()}
                        </TableCell>
                        <TableCell className="text-right">
                          <div className="flex items-center justify-end gap-1.5">
                            {isSelectable && (
                              <>
                                <Button
                                  size="icon"
                                  variant="ghost"
                                  disabled={isSubmittingAction}
                                  onClick={() => setApprovingTeam(team)}
                                  className="text-emerald-500 hover:text-emerald-400 hover:bg-emerald-950/20 h-8 w-8"
                                >
                                  <Check className="w-4 h-4" />
                                </Button>
                                <Button
                                  size="icon"
                                  variant="ghost"
                                  disabled={isSubmittingAction}
                                  onClick={() => setRejectingTeam(team)}
                                  className="text-red-500 hover:text-red-400 hover:bg-red-950/20 h-8 w-8"
                                >
                                  <X className="w-4 h-4" />
                                </Button>
                              </>
                            )}
                            {!isSelectable && <span className="text-[10px] text-zinc-600 italic">No actions</span>}
                          </div>
                        </TableCell>
                      </TableRow>
                    );
                  })}
                </TableBody>
              </Table>
            </div>
          )}

          {/* Paging controls */}
          {!loadingRegistrations && totalPages > 1 && (
            <div className="flex items-center justify-between border-t border-zinc-800 pt-4">
              <span className="text-xs text-zinc-500">
                Page {page} of {totalPages}
              </span>
              <div className="flex gap-2">
                <Button
                  size="xs"
                  variant="outline"
                  disabled={page <= 1}
                  onClick={() => setPage(page - 1)}
                  className="border-zinc-800 text-zinc-300 text-xs py-1 px-3 h-8"
                >
                  Previous
                </Button>
                <Button
                  size="xs"
                  variant="outline"
                  disabled={page >= totalPages}
                  onClick={() => setPage(page + 1)}
                  className="border-zinc-800 text-zinc-300 text-xs py-1 px-3 h-8"
                >
                  Next
                </Button>
              </div>
            </div>
          )}
        </CardContent>
      </Card>

      {/* Reject dialog */}
      {rejectingTeam && (
        <Dialog open={!!rejectingTeam} onOpenChange={(open) => !open && setRejectingTeam(null)}>
          <DialogContent className="bg-zinc-900 border border-zinc-800 max-w-md p-6">
            <form onSubmit={handleRejectSubmit}>
              <DialogHeader>
                <DialogTitle>Reject Registration</DialogTitle>
                <DialogDescription>
                  Supply a reason for rejecting the registration of team <strong>{rejectingTeam.name}</strong>.
                  This reason will be logged for administrative history.
                </DialogDescription>
              </DialogHeader>

              <div className="my-4 space-y-2">
                <Input
                  id="reject-reason"
                  placeholder="e.g. Incomplete profile or wrong game identifier"
                  value={rejectReason}
                  onChange={(e) => setRejectReason(e.target.value)}
                  required
                  className="bg-zinc-950 border-zinc-800 text-sm focus:ring-rose-500 focus:border-rose-500 w-full h-10"
                />
              </div>

              <DialogFooter>
                <Button
                  type="button"
                  variant="ghost"
                  onClick={() => {
                    setRejectingTeam(null);
                    setRejectReason("");
                  }}
                  className="text-zinc-400 hover:text-white"
                >
                  Cancel
                </Button>
                <Button
                  type="submit"
                  disabled={isSubmittingAction}
                  className="bg-red-600 hover:bg-red-700 font-semibold"
                >
                  Confirm Reject
                </Button>
              </DialogFooter>
            </form>
          </DialogContent>
        </Dialog>
      )}

      {/* Approve dialog */}
      {approvingTeam && (
        <Dialog open={!!approvingTeam} onOpenChange={(open) => !open && setApprovingTeam(null)}>
          <DialogContent className="bg-zinc-900 border border-zinc-800 max-w-md p-6">
            <form onSubmit={(e) => {
              e.preventDefault();
              handleApprove(approvingTeam.id, approvalReason);
            }}>
              <DialogHeader>
                <DialogTitle>Approve Registration</DialogTitle>
                <DialogDescription>
                  Supply an optional reason/note for approving the registration of team <strong>{approvingTeam.name}</strong>.
                  This reason will be logged for administrative history.
                </DialogDescription>
              </DialogHeader>

              <div className="my-4 space-y-2">
                <Input
                  id="approval-reason"
                  placeholder="e.g. Roster verified and payment confirmed (optional)"
                  value={approvalReason}
                  onChange={(e) => setApprovalReason(e.target.value)}
                  className="bg-zinc-950 border-zinc-800 text-sm focus:ring-emerald-500 focus:border-emerald-500 w-full h-10"
                />
              </div>

              <DialogFooter>
                <Button
                  type="button"
                  variant="ghost"
                  onClick={() => {
                    setApprovingTeam(null);
                    setApprovalReason("");
                  }}
                  className="text-zinc-400 hover:text-white"
                >
                  Cancel
                </Button>
                <Button
                  type="submit"
                  disabled={isSubmittingAction}
                  className="bg-emerald-600 hover:bg-emerald-700 font-semibold"
                >
                  Confirm Approve
                </Button>
              </DialogFooter>
            </form>
          </DialogContent>
        </Dialog>
      )}

      {/* Bulk Approve dialog */}
      {showBulkApproveDialog && (
        <Dialog open={showBulkApproveDialog} onOpenChange={(open) => !open && setShowBulkApproveDialog(false)}>
          <DialogContent className="bg-zinc-900 border border-zinc-800 max-w-md p-6">
            <form onSubmit={(e) => {
              e.preventDefault();
              handleBulkApprove(bulkApprovalReason);
            }}>
              <DialogHeader>
                <DialogTitle>Bulk Approve Registrations</DialogTitle>
                <DialogDescription>
                  You are about to approve <strong>{selectedTeamIds.length}</strong> selected teams. You can supply an optional reason/note for these approvals.
                </DialogDescription>
              </DialogHeader>

              <div className="my-4 space-y-2">
                <Input
                  id="bulk-approval-reason"
                  placeholder="e.g. Batch invite approvals (optional)"
                  value={bulkApprovalReason}
                  onChange={(e) => setBulkApprovalReason(e.target.value)}
                  className="bg-zinc-950 border-zinc-800 text-sm focus:ring-emerald-500 focus:border-emerald-500 w-full h-10"
                />
              </div>

              <DialogFooter>
                <Button
                  type="button"
                  variant="ghost"
                  onClick={() => {
                    setShowBulkApproveDialog(false);
                    setBulkApprovalReason("");
                  }}
                  className="text-zinc-400 hover:text-white"
                >
                  Cancel
                </Button>
                <Button
                  type="submit"
                  disabled={isSubmittingAction}
                  className="bg-emerald-600 hover:bg-emerald-700 font-semibold"
                >
                  Confirm Bulk Approve
                </Button>
              </DialogFooter>
            </form>
          </DialogContent>
        </Dialog>
      )}
    </div>
  );
}
