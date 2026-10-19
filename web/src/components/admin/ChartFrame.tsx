import { useState, type ReactNode } from "react";
import { useTranslation } from "react-i18next";
import { ChartBar, Table as TableIcon } from "@phosphor-icons/react";
import { Button, Card, CardDescription, CardHeader, CardTitle } from "@/components/ui";
import { cn } from "@/lib/cn";

/**
 * ChartFrame wraps every admin chart with its mandatory table equivalent
 * (docs/design/00 section 5: "every chart ships a table equivalent in the same
 * component"). The toggle is a real button with aria-pressed; the table is the
 * accessible artifact, the chart the overlay.
 */
export function ChartFrame({
  title,
  description,
  chart,
  table,
  empty,
  isEmpty = false,
  className,
}: {
  title: ReactNode;
  description?: ReactNode;
  chart: ReactNode;
  table: ReactNode;
  empty?: ReactNode;
  isEmpty?: boolean;
  className?: string;
}) {
  const { t } = useTranslation();
  const [asTable, setAsTable] = useState(false);
  return (
    <Card padding="md" className={cn("flex min-w-0 flex-col", className)}>
      <CardHeader className="flex-row items-start justify-between gap-3">
        <div className="flex min-w-0 flex-col gap-1">
          <CardTitle className="text-sm">{title}</CardTitle>
          {description ? <CardDescription className="text-xs">{description}</CardDescription> : null}
        </div>
        {!isEmpty ? (
          <Button
            variant="ghost"
            size="sm"
            aria-pressed={asTable}
            onClick={() => setAsTable((v) => !v)}
            leadingIcon={
              asTable ? (
                <ChartBar weight="bold" className="h-4 w-4" />
              ) : (
                <TableIcon weight="bold" className="h-4 w-4" />
              )
            }
          >
            {asTable ? t("admin.common.viewChart") : t("admin.common.viewTable")}
          </Button>
        ) : null}
      </CardHeader>
      {isEmpty ? (
        <p className="py-10 text-center text-sm text-muted">{empty}</p>
      ) : asTable ? (
        <div className="min-w-0">{table}</div>
      ) : (
        <div className="min-w-0">{chart}</div>
      )}
    </Card>
  );
}

/** Theme-aware series palette (CSS vars switch with the .dark class). */
export const SERIES_COLORS = {
  brand: "var(--brand-600)",
  blue: "var(--grad-blue)",
  pink: "var(--grad-pink)",
  teal: "var(--grad-teal)",
  caution: "var(--state-caution)",
  critical: "var(--state-critical)",
  normal: "var(--state-normal)",
  subtle: "var(--fg-subtle)",
} as const;

export const PIE_PALETTE = [
  SERIES_COLORS.brand,
  SERIES_COLORS.blue,
  SERIES_COLORS.pink,
  SERIES_COLORS.caution,
  SERIES_COLORS.teal,
  SERIES_COLORS.subtle,
];

/** Both theme keys point at the same CSS variable, which already flips in .dark. */
export function themed(color: string): { light: string[]; dark: string[] } {
  return { light: [color], dark: [color] };
}

/** CSS-identifier-safe key for a free-text series name (provider/model ids). */
export function slugKey(name: string, index: number): string {
  const s = name.toLowerCase().replace(/[^a-z0-9]+/g, "-").replace(/^-+|-+$/g, "");
  return `s${index}-${s || "x"}`;
}
