import * as TabsPrimitive from "@radix-ui/react-tabs";
import { createContext, forwardRef, useContext } from "react";
import { cn } from "@/lib/cn";

type TabsVariant = "segmented" | "underline" | "vertical";

const VariantCtx = createContext<TabsVariant>("segmented");

export const Tabs = TabsPrimitive.Root;

export const TabsList = forwardRef<
  React.ElementRef<typeof TabsPrimitive.List>,
  React.ComponentPropsWithoutRef<typeof TabsPrimitive.List> & {
    variant?: TabsVariant;
  }
>(function TabsList({ className, variant = "segmented", ...props }, ref) {
  return (
    <VariantCtx.Provider value={variant}>
      <TabsPrimitive.List
        ref={ref}
        className={cn(
          variant === "segmented"
            ? "inline-flex items-center gap-0.5 rounded-control border border-border bg-bg-inset p-0.5"
            : variant === "vertical"
              ? "flex flex-col gap-px"
              : "flex items-center gap-4 border-b border-border",
          className,
        )}
        {...props}
      />
    </VariantCtx.Provider>
  );
});

export const TabsTrigger = forwardRef<
  React.ElementRef<typeof TabsPrimitive.Trigger>,
  React.ComponentPropsWithoutRef<typeof TabsPrimitive.Trigger>
>(function TabsTrigger({ className, ...props }, ref) {
  const variant = useContext(VariantCtx);
  return (
    <TabsPrimitive.Trigger
      ref={ref}
      className={cn(
        "text-[0.8125rem] font-medium transition-colors duration-[120ms] ease-out",
        variant === "segmented"
          ? [
              "inline-flex min-h-7 items-center justify-center rounded-chip px-2.5 py-1",
              "text-muted hover:text-fg",
              "data-[state=active]:bg-surface data-[state=active]:text-fg data-[state=active]:shadow-soft-md",
            ]
          : variant === "vertical"
            ? [
                // Console section nav (Vercel settings, Whop admin): a left list.
                "flex min-h-8 w-full items-center gap-2 rounded-control px-2.5 py-1.5 text-start",
                "text-muted hover:bg-bg-inset hover:text-fg",
                "data-[state=active]:bg-surface data-[state=active]:text-fg data-[state=active]:font-semibold",
                "data-[state=active]:shadow-[inset_2px_0_0_var(--brand-600),0_0_0_1px_var(--border)]",
              ]
            : [
                // Underline tabs: the EHR activity-tab treatment.
                "-mb-px inline-flex items-center gap-1.5 border-b-2 border-transparent pb-2 pt-1",
                "text-muted hover:text-fg hover:border-border-strong",
                "data-[state=active]:border-brand data-[state=active]:text-fg",
              ],
        className,
      )}
      {...props}
    />
  );
});

export const TabsContent = forwardRef<
  React.ElementRef<typeof TabsPrimitive.Content>,
  React.ComponentPropsWithoutRef<typeof TabsPrimitive.Content>
>(function TabsContent({ className, ...props }, ref) {
  return (
    <TabsPrimitive.Content
      ref={ref}
      className={cn("mt-4", className)}
      {...props}
    />
  );
});
