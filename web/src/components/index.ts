export { Sparkline, type SparklineProps } from "./Sparkline";
export { ProgressStages, type ProgressStagesProps } from "./ProgressStages";
export { CaseCard, type CaseCardProps } from "./CaseCard";
export {
  CaseInstanceCard,
  type CaseInstanceCardProps,
} from "./CaseInstanceCard";
export { ChatMessage, type ChatMessageProps } from "./ChatMessage";
export { EncounterChat, type EncounterChatProps } from "./EncounterChat";
export { GuidanceCard, type GuidanceCardProps } from "./GuidanceCard";
export { VitalCard, type VitalCardProps } from "./VitalCard";
export { PatientPortrait, type PatientPortraitProps } from "./PatientPortrait";
export { DomainBand, BAND_SCALE, type DomainBandProps } from "./DomainBand";
export { GapCard, type GapCardProps } from "./GapCard";
export { CitationPill, type CitationPillProps } from "./CitationPill";
export {
  ProcessTimingCard,
  type ProcessTimingCardProps,
} from "./ProcessTimingCard";
export {
  TreatmentChecklist,
  type TreatmentChecklistProps,
} from "./TreatmentChecklist";
export {
  CalibrationPlot,
  type CalibrationPlotProps,
} from "./CalibrationPlot";
export { stateMap, trendGlyph, type StatePresentation } from "./clinicalState";

// EHR workspace (Stage 2)
export {
  SimBadge,
  PatientBanner,
  Storyboard,
  ActivityTabs,
  EncounterClock,
  NewCaseMenu,
  PatientAvatar,
  signsFromVitals,
  type SimBadgeProps,
  type PatientBannerProps,
  type StoryboardProps,
  type ActivityTabsProps,
  type EncounterClockProps,
  type NewCaseMenuProps,
  type PatientAvatarProps,
  type PatientAvatarDriver,
  type AvatarTier,
} from "./ehr";
