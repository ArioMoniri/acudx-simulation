import { useCallback, useEffect, useMemo, useState } from "react";
import { Link, useNavigate, useParams } from "react-router-dom";
import { useTranslation } from "react-i18next";
import { motion } from "motion/react";
import {
  Plus,
  ArrowLeft,
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
  OrderHandoffPanel,
  RoleSwitcher,
  HandoffTimeline,
  PrehospitalPanel,
  bindRoomCase,
  setActingRole,
  setRoomAiBackfill,
  handoff,
  taskTally,
  useRoomCaseState,
  useRoomVitals,
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
  postFloorEvent,
  closeLoop,
  setPhase,
  closedLoopStats,
  openLoopEvent,
  attachRoomCase,
  familyForSeedCase,
  type RoomRuntime,
} from "@/components/room/roomStore";
import { useEntry, useLang } from "@/lib/useLang";
import { roomCase, effectiveHolder, type ClinicalRole, type Room } from "@/data/rooms";
import {
  getEncounterSnapshot,
  resetEncounter,
  startGeneratedEncounter,
  useEncounterState,
} from "@/state/encounterStore";
import { endCaseSession, requestCase } from "@/lib/caseSession";
import type { ChiefComplaintFamily } from "@/domain/caseGen";

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

  // The room's case is generated on request at room creation through the same
  // pipeline as a solo encounter (review 06a P15); the room binds to its thread.
  const handleCreate = useCallback(
    async (config: {
      family: ChiefComplaintFamily | null;
      humanRoles: ClinicalRole[];
      aiBackfill: boolean;
      locale: "tr" | "en";
    }): Promise<string | null> => {
      const res = await requestCase({
        locale: config.locale,
        purpose: "room",
        ...(config.family ? { complaint: config.family } : {}),
      });
      const live = getEncounterSnapshot().caseInstance;
      if (!res.ok || !live) return res.ok ? "no_spec" : res.error;
      setCreateOpen(false);
      const id = createRoom({
        caseId: `room-${config.family ?? "any"}`,
        humanRoles: config.humanRoles,
        aiBackfill: config.aiBackfill,
        locale: config.locale,
        caseInstance: live,
        threadId: res.data.threadId,
      });
      navigate(`/rooms/${id}`);
      return null;
    },
    [navigate],
  );

  const handleJoin = useCallback(
    async (code: string): Promise<boolean> => {
      const id = await joinByCode(code);
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
          <div className="grid grid-cols-1 gap-4 sm:grid-cols-2 xl:grid-cols-3">
            {openRooms.map((room) => (
              <RoomCard key={room.id} room={room} lang={lang} />
            ))}
          </div>
        )}
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
    <span className="inline-flex items-center gap-1.5 rounded-full border border-border bg-bg-subtle py-0.5 ps-2.5 pe-1 text-xs font-medium text-muted">
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
  // Only ever the case generated on request for this room (the create-dialog bug of
  // review 06a P15, a published pick playing em-acs-001, cannot happen: there is no
  // pick and no fallback patient).
  const caseInstance = roomCase(room, runtime.caseInstance);
  const [caseError, setCaseError] = useState<string | null>(null);

  // Scope: the seat this device holds, or the lead's seat when only observing.
  const mine = runtime.mine;
  const observer = mine == null;
  const effectiveRole: ClinicalRole = mine ?? leadRoleFor(room);
  const mySeat = room.seats.find((s) => s.role === effectiveRole);
  const teamLead = mySeat?.teamLead ?? false;
  const iAmLead = !observer && teamLead;

  // Seed the SOLO encounter store with the case so we reuse the real interview
  // interaction for the doctor's history-taking. The shared collaborative state
  // (vitals + task loop) lives in the SEPARATE room-case store, below, so the
  // two never fight over the single-encounter singleton.
  const state = useEncounterState();
  const threadId = runtime.threadId ?? room.threadId ?? null;
  useEffect(() => {
    const live = getEncounterSnapshot();
    if (caseInstance && threadId) {
      // The host's store already runs this thread (requested in the create flow).
      if (live.generation?.threadId !== threadId) {
        startGeneratedEncounter(caseInstance, {
          source: "model", threadId, council: null, degraded: false, model: null, note: null,
        });
      }
      return;
    }
    if (caseInstance) return;
    // A lobby room opened without a case: request one now, for this room only.
    const controller = new AbortController();
    const family = familyForSeedCase(room.caseId);
    void requestCase(
      { locale: room.locale, purpose: "room", ...(family ? { complaint: family } : {}) },
      { signal: controller.signal },
    ).then((res) => {
      if (controller.signal.aborted) return;
      const started = getEncounterSnapshot().caseInstance;
      if (res.ok && started) attachRoomCase(id, started, res.data.threadId);
      else setCaseError(res.ok ? "no_spec" : res.error);
    });
    return () => controller.abort();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [room.id, caseInstance == null, threadId]);
  useEffect(() => () => {
    endCaseSession();
    resetEncounter();
  }, []);

  // Shared room-case state: bind the room to ONE case and drive the multi-role
  // order → task → execute loop on top of the clinical-course engine.
  const roomCaseState = useRoomCaseState(id);
  useEffect(() => {
    if (caseInstance) {
      bindRoomCase(id, caseInstance, { actingRole: effectiveRole, aiBackfill: room.aiBackfill });
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [id, caseInstance]);

  // The role this device acts as in the shared case, kept in lockstep with the
  // seat it holds; AI backfill mirrors the room toggle.
  const actingRole: ClinicalRole = roomCaseState?.actingRole ?? effectiveRole;
  useEffect(() => {
    setActingRole(id, effectiveRole);
  }, [id, effectiveRole]);
  useEffect(() => {
    setRoomAiBackfill(id, room.aiBackfill);
  }, [id, room.aiBackfill]);

  // Live shared vitals — respond when the nurse administers a medication task.
  const { vitals: liveVitals, status: courseStatus } = useRoomVitals(id);

  // Roles currently driven by scripted AI (for the role-switcher hint).
  const aiRoles = useMemo(
    () =>
      room.seats
        .filter((s) => s.role !== actingRole)
        .map((s) => ({ role: s.role, holder: effectiveHolder(s, room.aiBackfill) }))
        .filter((x) => x.holder?.kind === "ai")
        .map((x) => x.role),
    [room.seats, room.aiBackfill, actingRole],
  );

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

  // Role-scoped tabs: the doctor gets the interview, the paramedic the
  // prehospital handover; everyone shares the order/task loop, floor + debrief.
  const roleTab: string =
    actingRole === "doctor" ? "interview" : actingRole === "paramedic" ? "prehospital" : "orders";
  const availableTabs = useMemo(() => {
    const tabs: string[] = [];
    if (actingRole === "doctor") tabs.push("interview");
    if (actingRole === "paramedic") tabs.push("prehospital");
    tabs.push("orders", "floor", "debrief");
    return tabs;
  }, [actingRole]);

  const [tab, setTab] = useState<string>(room.status === "debrief" ? "debrief" : roleTab);
  // Keep the active tab valid after a role switch or when the session ends.
  useEffect(() => {
    if (!availableTabs.includes(tab)) setTab(roleTab);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [availableTabs]);

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

  // Switch the acting seat (takes the seat + sets the shared acting role).
  const handleSwitchRole = useCallback((role: ClinicalRole) => {
    takeSeat(id, role);
    setActingRole(id, role);
  }, [id]);

  // Paramedic delivers the structured scene handover: posts it to the team floor
  // and records the paramedic → doctor pass on the shared handoff timeline.
  const handoverGiven = (roomCaseState?.handoffs ?? []).some((h) => h.from === "paramedic");
  const handleGiveHandover = useCallback(() => {
    if (!caseInstance) return;
    postFloorEvent(id, {
      role: "paramedic",
      ai: actingRole !== "paramedic",
      kind: "handover",
      text: {
        en: `ATMIST handover: ${caseInstance.chiefComplaint.en}. Arrival vitals and timeline passed to the team, access in place.`,
        tr: `ATMIST devri: ${caseInstance.chiefComplaint.tr}. Varış vitalleri ve zaman çizelgesi ekibe aktarıldı, damar yolu açık.`,
      },
    });
    handoff(id, "paramedic", "doctor");
  }, [id, actingRole, caseInstance]);

  if (!caseInstance || !state.caseInstance || !roomCaseState) {
    return (
      <PageContainer width="wide">
        {caseError ? (
          <p role="alert" className="text-sm text-fg">
            {t(`live2.gen.error.${caseError}`, { defaultValue: t("live2.gen.error.unknown", { code: caseError }) })}{" "}
            <span className="text-muted">{t("live2.gen.onRequestHint")}</span>
          </p>
        ) : (
          <p className="text-sm text-muted">{t("live2.gen.title")}</p>
        )}
      </PageContainer>
    );
  }

  const affectLabel = t("encounter.affect.distress");
  const loopStats = closedLoopStats(runtime.floor);
  const tally = taskTally(roomCaseState);
  const debriefLoop = {
    ordersPlaced: roomCaseState.tasks.length,
    tasksDone: tally.done,
    tasksTotal: tally.total,
    medsGiven: roomCaseState.treatments.length,
    handoffs: roomCaseState.handoffs.length,
  };

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
          <RoleSwitcher
            actingRole={actingRole}
            lang={lang}
            aiRoles={aiRoles}
            onSwitch={handleSwitchRole}
          />

          {/* Shared live monitor — one patient, responds to the nurse's meds */}
          <CompactVitals caseInstance={caseInstance} live={liveVitals} status={courseStatus} />

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
              {availableTabs.map((key) => (
                <TabsTrigger key={key} value={key}>
                  {t(`roomscollab.tabs.${key}`)}
                </TabsTrigger>
              ))}
            </TabsList>

            {actingRole === "doctor" ? (
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

            {actingRole === "paramedic" ? (
              <TabsContent value="prehospital">
                <PrehospitalPanel
                  caseInstance={caseInstance}
                  lang={lang}
                  given={handoverGiven}
                  onGiveHandover={handleGiveHandover}
                />
              </TabsContent>
            ) : null}

            <TabsContent value="orders">
              <OrderHandoffPanel
                roomId={id}
                state={roomCaseState}
                lang={lang}
                actingRole={actingRole}
              />
            </TabsContent>

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
                loop={debriefLoop}
                live={room.status === "debrief"}
              />
            </TabsContent>
          </Tabs>
        </motion.div>

        {/* Room rail — participants + shared team clock + handoff timeline */}
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

          <HandoffTimeline
            roomId={id}
            state={roomCaseState}
            actingRole={actingRole}
            lang={lang}
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
 * clinical marks. Realtime presence and a shared team floor keep every seat in
 * sync throughout the encounter.
 */
export function RoomPage() {
  const { id } = useParams();
  const runtime = useRoomRuntime(id);

  if (id && runtime) return <InRoom id={id} runtime={runtime} />;
  return <Lobby />;
}
