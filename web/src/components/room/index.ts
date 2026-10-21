export { RoleAvatar, type RoleAvatarProps } from "./RoleAvatar";
export { ROLE_ICON, PRESENCE_COLOR } from "./roleMeta";
export { RoomCard, type RoomCardProps } from "./RoomCard";
export { CreateRoomDialog, type CreateRoomDialogProps } from "./CreateRoomDialog";
export { ParticipantsPanel, type ParticipantsPanelProps } from "./ParticipantsPanel";
export { CompactVitals, type CompactVitalsProps } from "./CompactVitals";
export { FloorPanel, type FloorPanelProps } from "./FloorPanel";
export { DebriefPanel, type DebriefPanelProps } from "./DebriefPanel";
export { RoleScopeBar, type RoleScopeBarProps } from "./RoleScopeBar";
export { JoinByCode, type JoinByCodeProps } from "./JoinByCode";
export { OrderHandoffPanel, type OrderHandoffPanelProps } from "./OrderHandoffPanel";
export { RoleSwitcher, type RoleSwitcherProps } from "./RoleSwitcher";
export { HandoffTimeline, type HandoffTimelineProps } from "./HandoffTimeline";
export { PrehospitalPanel, type PrehospitalPanelProps } from "./PrehospitalPanel";
export { type DebriefLoopStats } from "./DebriefPanel";
export {
  bindRoomCase,
  resetRoomCase,
  setActingRole,
  setRoomAiBackfill,
  handoff,
  placeOrderAs,
  claimTask,
  completeTask,
  taskTally,
  useRoomCaseState,
  applyThreadTask,
  setRoomThread,
  setRoomAiRoles,
  medsGiven,
  administrationLocked,
  type RoomCaseState,
  type RoomTask,
  type RoomTaskKind,
  type RoomTaskStatus,
  type RoomResult,
  type RoomHandoff,
} from "./roomCaseStore";
