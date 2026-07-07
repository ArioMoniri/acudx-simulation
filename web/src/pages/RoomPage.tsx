import { useCallback, useEffect, useMemo, useState } from "react";
import { Link, useNavigate, useParams } from "react-router-dom";
import { useTranslation } from "react-i18next";
import { motion } from "motion/react";
import {
  Plus,
  UsersThree,
  ArrowLeft,
  ShieldCheck,
  Broadcast,
} from "@phosphor-icons/react";

import { PageContainer } from "@/components/shell";
import { Button, Card, Badge, Tabs, TabsList, TabsTrigger, TabsContent } from "@/components/ui";
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
} from "@/components/room";
import { useEntry, useLang } from "@/lib/useLang";
import {
  rooms,
  getRoom,
  roomCase,
  acsFloor,
  type ClinicalRole,
  type FloorEvent,
  type Room,
} from "@/data/rooms";
import { getSeedCase } from "@/data/seedCases";
import {
  resetEncounter,
  startEncounter,
  useEncounterState,
} from "@/state/encounterStore";

/* -------------------------------------------------------------------------- */
/* Lobby (/rooms)                                                              */
/* -------------------------------------------------------------------------- */

function Lobby() {
  const { t } = useTranslation();
  const lang = useLang();
  const navigate = useNavigate();
  const top = useEntry();
  const body = useEntry(0.06);

  const [createOpen, setCreateOpen] = useState(false);

  const handleCreate = useCallback(
    (config: { caseId: string; humanRoles: ClinicalRole[]; aiBackfill: boolean }) => {
      // Mock creation: the first matching room for that case is opened, or the
      // solo case fallback. In production this mints a real LiveKit room.
      setCreateOpen(false);
      const existing = rooms.find((r) => r.caseId === config.caseId && r.status === "open");
      navigate(`/rooms/${existing ? existing.id : "appy-solo"}`);
    },
    [navigate],
  );

  const openRooms = rooms.filter((r) => r.status !== "debrief");

  return (
    <PageContainer width="wide" className="flex flex-col gap-6">
      {/* Header */}
      <motion.div {...top} className="flex flex-col gap-4 sm:flex-row sm:items-end sm:justify-between">
        <div>
          <div className="flex items-center gap-2">
            <span className="grid h-10 w-10 place-items-center rounded-control bg-brand-tint text-brand">
              <UsersThree weight="bold" className="h-6 w-6" aria-hidden />
            </span>
            <h1 className="text-2xl font-semibold tracking-tight text-fg sm:text-3xl">
              {t("rooms.lobby.title")}
            </h1>
          </div>
          <p className="mt-2 max-w-2xl text-sm text-muted">{t("rooms.lobby.subtitle")}</p>
        </div>
        <Button
          onClick={() => setCreateOpen(true)}
          leadingIcon={<Plus weight="bold" className="h-4 w-4" />}
        >
          {t("rooms.lobby.create")}
        </Button>
      </motion.div>

      {/* Open rooms */}
      <motion.div {...body}>
        <h2 className="mb-3 flex items-center gap-2 text-sm font-semibold text-fg">
          <Broadcast weight="bold" className="h-4 w-4 text-brand" aria-hidden />
          {t("rooms.lobby.openRooms")}
        </h2>
        {openRooms.length === 0 ? (
          <Card padding="lg">
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
        <Card padding="md" className="flex items-start gap-2.5 border-dashed">
          <ShieldCheck weight="bold" className="mt-0.5 h-4 w-4 shrink-0 text-muted" aria-hidden />
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

/** Which seat this device holds. Prefer a human "you" seat, else the host role. */
function myRoleFor(room: Room): { role: ClinicalRole; teamLead: boolean } {
  const mine = room.seats.find((s) => s.holder?.id === "u-me");
  if (mine) return { role: mine.role, teamLead: mine.teamLead };
  const lead = room.seats.find((s) => s.teamLead) ?? room.seats[0];
  return { role: lead.role, teamLead: lead.teamLead };
}

function InRoom({ room }: { room: Room }) {
  const { t } = useTranslation();
  const lang = useLang();
  const top = useEntry();
  const body = useEntry(0.06);

  const caseInstance = useMemo(() => roomCase(room) ?? getSeedCase("em-acs-001"), [room]);
  const { role: myRole, teamLead } = useMemo(() => myRoleFor(room), [room]);
  const canOrder = myRole === "doctor";

  // Seed the encounter store with the room's case so we can reuse the real
  // PatientBanner + Interview interaction over one authoritative Case State.
  const state = useEncounterState();
  useEffect(() => {
    if (caseInstance) startEncounter(caseInstance);
    return () => resetEncounter();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [room.id]);

  // Mock "who is speaking" — rotates through the seats every few seconds so the
  // room feels live. Reduced-motion users still get the label; only the cadence
  // is cosmetic.
  const [speakingIdx, setSpeakingIdx] = useState(0);
  useEffect(() => {
    const id = window.setInterval(() => {
      setSpeakingIdx((n) => (n + 1) % room.seats.length);
    }, 3200);
    return () => window.clearInterval(id);
  }, [room.seats.length]);
  const speakingRole = room.seats[speakingIdx]?.role ?? null;

  // Mock closed-loop comms: the ACS floor carries one open loop the learner can
  // acknowledge / read back. Closing it flips it to a confirmed state.
  const [events, setEvents] = useState<FloorEvent[]>(acsFloor);
  const openLoopEvent = events.find((e) => e.loop === "open");
  const handleCloseLoop = useCallback((id: string) => {
    setEvents((prev) =>
      prev.map((e) => (e.id === id ? { ...e, loop: "closed" as const } : e)),
    );
  }, []);

  const [guidanceOn, setGuidanceOn] = useState(true);

  if (!caseInstance || !state.caseInstance) {
    return (
      <PageContainer width="wide">
        <p className="text-sm text-muted">{t("common.loading")}</p>
      </PageContainer>
    );
  }

  const affectLabel = t("encounter.affect.distress");

  return (
    <PageContainer width="wide" className="flex flex-col gap-4">
      {/* Back + room title */}
      <motion.div {...top} className="flex flex-wrap items-center justify-between gap-3">
        <div className="flex items-center gap-2">
          <Button asChild size="sm" variant="ghost" leadingIcon={<ArrowLeft weight="bold" className="h-4 w-4" />}>
            <Link to="/rooms">{t("rooms.inroom.backToLobby")}</Link>
          </Button>
          <span className="hidden text-muted sm:inline" aria-hidden>·</span>
          <h1 className="text-lg font-semibold tracking-tight text-fg">
            {room.title[lang]}
          </h1>
        </div>
        <div className="flex items-center gap-2">
          <Badge tone="neutral">{t(`rooms.locale.${room.locale}`)}</Badge>
          <Badge
            tone={room.status === "in-progress" ? "caution" : "normal"}
            icon={<Broadcast weight="fill" className="h-3 w-3" aria-hidden />}
          >
            {t(`rooms.status.${room.status}`)}
          </Badge>
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

          <RoleScopeBar role={myRole} lang={lang} teamLead={teamLead} />

          <Tabs defaultValue={canOrder ? "interview" : "floor"}>
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
                events={events}
                lang={lang}
                openLoopId={openLoopEvent?.id ?? null}
                onCloseLoop={handleCloseLoop}
              />
            </TabsContent>

            <TabsContent value="debrief">
              <DebriefPanel lang={lang} />
            </TabsContent>
          </Tabs>
        </motion.div>

        {/* Room rail — participants + shared team clock */}
        <motion.div {...body} className="flex flex-col gap-4">
          <ParticipantsPanel room={room} speakingRole={speakingRole} myRole={myRole} />
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
 * RoomPage — the multiplayer moat (Journey 6). Renders the lobby at /rooms and
 * a role-scoped in-room encounter at /rooms/:id. A believable realtime UI over
 * mock presence and mock floor control; production rides a self-hosted LiveKit
 * WebRTC room (voice/3D premium-gated, text-team-rooms the accessible floor).
 */
export function RoomPage() {
  const { id } = useParams();
  const room = id ? getRoom(id) : undefined;

  if (id && room) return <InRoom room={room} />;
  return <Lobby />;
}
