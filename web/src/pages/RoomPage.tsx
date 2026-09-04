import { useCallback, useEffect, useMemo, useState } from "react";
import { Link, useNavigate, useParams } from "react-router-dom";
import { useTranslation } from "react-i18next";
import { motion } from "motion/react";
import {
  Plus,
  ArrowLeft,
  ShieldCheck,
  Broadcast,
  Play,
  Flag,
  ArrowCounterClockwise,
  Copy,
  Check,
} from "@phosphor-icons/react";

import { PageContainer, PageHeader } from "@/components/shell";
import {
  Button,
  Card,
  Badge,
  SectionLabel,
  StatusDot,
  Tabs,
  TabsList,
  TabsTrigger,
  TabsContent,
} from "@/components/ui";
import { PatientBanner, SimBadge } from "@/components/ehr";
import { InterviewTab } from "@/components/ehr/tabs/InterviewTab";
import {
  RoomCard,
  CreateRoomDialog,
  ParticipantsPanel,
  CompactVitals,
  FloorPanel,
  DebriefPanel,
  RoleScopeBar,
  JoinByCode,
} from "@/components/room";
import {
  useRoomList,
  useRoomRuntime,
  createRoom,
  joinByCode,
  takeSeat,
  leaveSeat,
  toggleReady,
  setBackfill,
  claimLead,
  raiseHand,
  lowerHand,
  grantFloor,
  passFloor,
  escalateFloor,
  delegateFloor,
  promptDoctorFloor,
  closeLoop,
  setPhase,
  closedLoopStats,
  openLoopEvent,
  type RoomRuntime,
} from "@/components/room/roomStore";
import { useEntry, useLang } from "@/lib/useLang";
import { roomCase, type ClinicalRole, type Room } from "@/data/rooms";
import { getSeedCase } from "@/data/seedCases";
import { resetEncounter, startEncounter, useEncounterState } from "@/state/encounterStore";

/* -------------------------------------------------------------------------- */
/* Lobby (/rooms)                                                              */
/* -------------------------------------------------------------------------- */

function Lobby() {
  const { t } = useTranslation();
  const lang = useLang();
  const navigate = useNavigate();
  const top = useEntry();
  const body = useEntry(0.06);

  const roomsList = useRoomList();
  const [createOpen, setCreateOpen] = useState(false);

  const handleCreate = useCallback(
    (config: {
      caseId: string;
      humanRoles: ClinicalRole[];
      aiBackfill: boolean;
      locale: "tr" | "en";
    }) => {
      setCreateOpen(false);
      const id = createRoom(config);
      navigate(`/rooms/${id}`);
    },
    [navigate],
  );

  const handleJoin = useCallback(
    (code: string): boolean => {
      const id = joinByCode(code);
      if (!id) return false;
      navigate(`/rooms/${id}`);
      return true;
    },
    [navigate],
  );

  const openRooms = roomsList.filter((r) => r.status !== "debrief");

  return (
    <PageContainer width="wide" className="flex flex-col gap-8">
      {/* Header */}
      <motion.div {...top}>
        <PageHeader
          eyebrow={t("rooms3.eyebrow")}
          title={t("rooms.lobby.title")}
          description={t("rooms.lobby.subtitle")}
          actions={
            <Button
              onClick={() => setCreateOpen(true)}
              leadingIcon={<Plus weight="bold" className="h-4 w-4" />}
            >
              {t("rooms.lobby.create")}
            </Button>
          }
        />
      </motion.div>

      {/* Join with a code */}
      <motion.div {...body}>
        <JoinByCode onJoin={handleJoin} />
      </motion.div>

      {/* Open rooms */}
      <motion.div {...body} className="flex flex-col gap-3">
        <SectionLabel
          icon={<Broadcast weight="bold" className="h-3.5 w-3.5" aria-hidden />}
          trailing={
            <span className="tnum text-xs font-medium text-muted">
              {openRooms.length}
            </span>
          }
        >
          {t("rooms.lobby.openRooms")}
        </SectionLabel>
        {openRooms.length === 0 ? (
          <Card variant="inset" padding="lg">
            <p className="text-sm text-muted">{t("rooms.lobby.empty")}</p>
          </Card>
        ) : (
          <div className="grid gap-4 sm:grid-cols-2 xl:grid-cols-3">
            {openRooms.map((room) => (
              <RoomCard key={room.id} room={room} lang={lang} />
            ))}
          </div>
        )}
      </motion.div>

      {/* Production note (mock presence) */}
      <motion.div {...body}>
        <Card
          variant="inset"
          padding="md"
          className="flex items-start gap-2.5"
        >
          <ShieldCheck weight="bold" className="mt-0.5 h-4 w-4 shrink-0 text-subtle" aria-hidden />
          <p className="text-xs leading-relaxed text-muted">{t("rooms.lobby.prodNote")}</p>
        </Card>
      </motion.div>

      <SimBadge variant="bar" />

      <CreateRoomDialog
        open={createOpen}
        onClose={() => setCreateOpen(false)}
        lang={lang}
        onCreate={handleCreate}
      />
    </PageContainer>
  );
}

/* -------------------------------------------------------------------------- */
/* In-room (/rooms/:id)                                                         */
/* -------------------------------------------------------------------------- */

/** Fallback scope when this device only observes: show the team lead's seat. */
function leadRoleFor(room: Room): ClinicalRole {
  const lead = room.seats.find((s) => s.teamLead) ?? room.seats[0];
  return lead.role;
}

/** A small copy-to-clipboard invite chip so a teammate can join by code. */
function InviteChip({ code }: { code: string }) {
  const { t } = useTranslation();
  const [copied, setCopied] = useState(false);

  const copy = useCallback(async () => {
    try {
      if (!navigator.clipboard) return;
      await navigator.clipboard.writeText(code);
      setCopied(true);
      window.setTimeout(() => setCopied(false), 2000);
    } catch {
      // Clipboard may be unavailable; the code stays visible to copy manually.
    }
  }, [code]);

  return (
    <span className="inline-flex items-center gap-1.5 rounded-full border border-border bg-bg-subtle py-0.5 pl-2.5 pr-1 text-xs font-medium text-muted">
      <span>{t("rooms.invite.label")}</span>
      <span className="font-mono tracking-wide text-fg">{code}</span>
      <button
        type="button"
        onClick={copy}
        aria-label={copied ? t("rooms.invite.copied") : t("rooms.invite.copy")}
        className="grid h-6 w-6 place-items-center rounded-full text-muted transition-colors duration-200 hover:bg-surface hover:text-fg focus-visible:outline-none"
      >
        {copied ? (
          <Check weight="bold" className="h-3.5 w-3.5 text-[color:var(--state-normal)]" aria-hidden />
        ) : (
          <Copy weight="bold" className="h-3.5 w-3.5" aria-hidden />
        )}
      </button>
    </span>
  );
}

function InRoom({ id, runtime }: { id: string; runtime: RoomRuntime }) {
  const { t } = useTranslation();
  const lang = useLang();
  const top = useEntry();
  const body = useEntry(0.06);

  const room = runtime.room;
  const caseInstance = useMemo(
    () => roomCase(room) ?? getSeedCase("em-acs-001"),
    [room.caseId],
  );

  // Scope: the seat this device holds, or the lead's seat when only observing.
  const mine = runtime.mine;
  const observer = mine == null;
  const effectiveRole: ClinicalRole = mine ?? leadRoleFor(room);
  const mySeat = room.seats.find((s) => s.role === effectiveRole);
  const teamLead = mySeat?.teamLead ?? false;
  const iAmLead = !observer && teamLead;
  const canOrder = !observer && effectiveRole === "doctor";

  // Seed the encounter store with the room's case so we reuse the real
  // PatientBanner + Interview interaction over one authoritative Case State.
  const state = useEncounterState();
  useEffect(() => {
    if (caseInstance) startEncounter(caseInstance);
    return () => resetEncounter();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [room.id]);

  // Ambient "who is speaking" rotation — paused while a seat explicitly holds
  // the floor, so the granted floor is authoritative. Reduced-motion users still
  // read the label; only the pulse is cosmetic.
  const [rotIdx, setRotIdx] = useState(0);
  useEffect(() => {
    if (runtime.floorHolder) return;
    const iv = window.setInterval(() => {
      setRotIdx((n) => (n + 1) % room.seats.length);
    }, 3200);
    return () => window.clearInterval(iv);
  }, [room.seats.length, runtime.floorHolder]);
  const speakingRole: ClinicalRole | null =
    runtime.floorHolder ?? room.seats[rotIdx % room.seats.length]?.role ?? null;

  const openLoop = openLoopEvent(runtime.floor);

  // Controlled tabs: an ended session lands on the debrief; a seat switch that
  // removes the interview tab falls back to the floor.
  const initialTab = room.status === "debrief" ? "debrief" : canOrder ? "interview" : "floor";
  const [tab, setTab] = useState<string>(initialTab);
  useEffect(() => {
    if (tab === "interview" && !canOrder) setTab("floor");
  }, [tab, canOrder]);

  const [guidanceOn, setGuidanceOn] = useState(true);

  // Floor + turn handlers (all act on the shared room state).
  const handleTakeSeat = useCallback((role: ClinicalRole) => takeSeat(id, role), [id]);
  const handleLeaveSeat = useCallback(() => leaveSeat(id), [id]);
  const handleToggleReady = useCallback((role: ClinicalRole) => toggleReady(id, role), [id]);
  const handleClaimLead = useCallback((role: ClinicalRole) => claimLead(id, role), [id]);
  const handleGrantFloor = useCallback((role: ClinicalRole) => grantFloor(id, role), [id]);
  const handleToggleBackfill = useCallback((on: boolean) => setBackfill(id, on), [id]);
  const handleRequestFloor = useCallback(() => raiseHand(id, effectiveRole), [id, effectiveRole]);
  const handleLowerHand = useCallback(() => lowerHand(id, effectiveRole), [id, effectiveRole]);
  const handlePassFloor = useCallback(() => passFloor(id), [id]);
  const handleEscalate = useCallback(() => escalateFloor(id, effectiveRole), [id, effectiveRole]);
  const handleDelegate = useCallback(() => delegateFloor(id, effectiveRole), [id, effectiveRole]);
  const handlePromptDoctor = useCallback(
    () => promptDoctorFloor(id, effectiveRole),
    [id, effectiveRole],
  );
  const handleCloseLoop = useCallback((evId: string) => closeLoop(id, evId), [id]);
  const handleEndSession = useCallback(() => {
    setPhase(id, "debrief");
    setTab("debrief");
  }, [id]);

  if (!caseInstance || !state.caseInstance) {
    return (
      <PageContainer width="wide">
        <p className="text-sm text-muted">{t("common.loading")}</p>
      </PageContainer>
    );
  }

  const affectLabel = t("encounter.affect.distress");
  const loopStats = closedLoopStats(runtime.floor);

  return (
    <PageContainer width="wide" className="flex flex-col gap-4">
      {/* Back + room title + phase control */}
      <motion.div {...top} className="flex flex-wrap items-center justify-between gap-3">
        <div className="flex items-center gap-2">
          <Button asChild size="sm" variant="ghost" leadingIcon={<ArrowLeft weight="bold" className="h-4 w-4" />}>
            <Link to="/rooms">{t("rooms.inroom.backToLobby")}</Link>
          </Button>
          <span className="hidden text-muted sm:inline" aria-hidden>·</span>
          <h1 className="text-lg font-semibold tracking-tight text-fg">{room.title[lang]}</h1>
        </div>
        <div className="flex flex-wrap items-center gap-2.5">
          <Badge tone="neutral">{t(`rooms.locale.${room.locale}`)}</Badge>
          <StatusDot
            tone={
              room.status === "in-progress"
                ? "caution"
                : room.status === "debrief"
                  ? "neutral"
                  : "normal"
            }
            pulse={room.status === "in-progress"}
            label={t(`rooms.status.${room.status}`)}
          />
          <InviteChip code={room.joinCode} />
          {room.status === "open" ? (
            <Button
              size="sm"
              onClick={() => setPhase(id, "in-progress")}
              leadingIcon={<Play weight="bold" className="h-4 w-4" />}
            >
              {t("rooms.phase.startSession")}
            </Button>
          ) : room.status === "in-progress" ? (
            <Button
              size="sm"
              variant="secondary"
              onClick={handleEndSession}
              leadingIcon={<Flag weight="bold" className="h-4 w-4" />}
            >
              {t("rooms.phase.endSession")}
            </Button>
          ) : (
            <Button
              size="sm"
              variant="ghost"
              onClick={() => setPhase(id, "open")}
              leadingIcon={<ArrowCounterClockwise weight="bold" className="h-4 w-4" />}
            >
              {t("rooms.phase.reopen")}
            </Button>
          )}
        </div>
      </motion.div>

      {/* Sticky role-scoped patient banner (shared Case State) */}
      <motion.div {...top}>
        <PatientBanner caseInstance={caseInstance} lang={lang} />
      </motion.div>

      {/* Workspace: main interaction + room rail */}
      <div className="grid gap-4 lg:grid-cols-[1fr_minmax(0,340px)]">
        {/* Main column — role-scoped EHR + interaction */}
        <motion.div {...body} className="flex min-w-0 flex-col gap-4">
          <CompactVitals caseInstance={caseInstance} />

          <RoleScopeBar
            role={effectiveRole}
            lang={lang}
            teamLead={teamLead}
            observer={observer}
            handRaised={runtime.hands.includes(effectiveRole)}
            hasFloor={runtime.floorHolder === effectiveRole}
            onRequestFloor={handleRequestFloor}
            onLowerHand={handleLowerHand}
            onPassFloor={handlePassFloor}
            onEscalate={handleEscalate}
            onDelegate={handleDelegate}
            onPromptDoctor={handlePromptDoctor}
          />

          <Tabs value={tab} onValueChange={setTab}>
            <TabsList>
              {canOrder ? (
                <TabsTrigger value="interview">{t("rooms.inroom.tabInterview")}</TabsTrigger>
              ) : null}
              <TabsTrigger value="floor">{t("rooms.inroom.tabFloor")}</TabsTrigger>
              <TabsTrigger value="debrief">{t("rooms.inroom.tabDebrief")}</TabsTrigger>
            </TabsList>

            {canOrder ? (
              <TabsContent value="interview">
                <InterviewTab
                  caseInstance={caseInstance}
                  lang={lang}
                  affectLabel={affectLabel}
                  guidanceOn={guidanceOn}
                  onGuidanceChange={setGuidanceOn}
                />
              </TabsContent>
            ) : null}

            <TabsContent value="floor">
              <FloorPanel
                room={room}
                events={runtime.floor}
                lang={lang}
                openLoopId={openLoop?.id ?? null}
                onCloseLoop={handleCloseLoop}
              />
            </TabsContent>

            <TabsContent value="debrief">
              <DebriefPanel
                lang={lang}
                woreHat={iAmLead}
                loopsClosed={{ closed: runtime.loopsClosedByMe, total: loopStats.total }}
                live={room.status === "debrief"}
              />
            </TabsContent>
          </Tabs>
        </motion.div>

        {/* Room rail — participants + shared team clock + seat control */}
        <motion.div {...body} className="flex flex-col gap-4">
          <ParticipantsPanel
            room={room}
            speakingRole={speakingRole}
            mine={mine}
            raisedHands={runtime.hands}
            floorHolder={runtime.floorHolder}
            iAmLead={iAmLead}
            onTakeSeat={handleTakeSeat}
            onLeaveSeat={handleLeaveSeat}
            onToggleReady={handleToggleReady}
            onClaimLead={handleClaimLead}
            onGrantFloor={handleGrantFloor}
            onToggleBackfill={handleToggleBackfill}
          />
        </motion.div>
      </div>

      <SimBadge variant="bar" />
    </PageContainer>
  );
}

/* -------------------------------------------------------------------------- */
/* Route entry                                                                 */
/* -------------------------------------------------------------------------- */

/**
 * RoomPage — the multiplayer moat (Journey 6). Renders the lobby at /rooms and a
 * role-scoped, genuinely interactive in-room encounter at /rooms/:id: create and
 * join rooms, take and leave seats, toggle AI backfill, request and pass the
 * floor, post SBAR turns, close communication loops, and drive the room through
 * its lifecycle into a debrief that separates individual leadership from team
 * clinical marks. Believable realtime over a mock store; production rides a
 * self-hosted LiveKit WebRTC room (voice/3D premium-gated, text the accessible
 * floor).
 */
export function RoomPage() {
  const { id } = useParams();
  const runtime = useRoomRuntime(id);

  if (id && runtime) return <InRoom id={id} runtime={runtime} />;
  return <Lobby />;
}
