import {
  Buildings,
  ChartLineUp,
  ChatCircleText,
  Exam,
  Flask,
  GraduationCap,
  House,
  Play,
  Stack,
  Users,
  UsersThree,
  Wrench,
  type Icon,
} from "@phosphor-icons/react";

/** One glyph per destination, shared by the rail, the bottom tab bar and the palette. */
export const NAV_ICON: Record<string, Icon> = {
  "/": House,
  "/start": Play,
  "/cases": Stack,
  "/rooms": UsersThree,
  "/exam": Exam,
  "/atlas": Flask,
  "/feedback": ChatCircleText,
  "/progress": ChartLineUp,
  "/authoring": GraduationCap,
  "/faculty": Users,
  "/dean": Buildings,
  "/admin": Wrench,
};
