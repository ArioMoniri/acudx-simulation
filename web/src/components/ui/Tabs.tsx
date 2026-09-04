import * as TabsPrimitive from "@radix-ui/react-tabs";
import { createContext, forwardRef, useContext } from "react";
import { cn } from "@/lib/cn";

type TabsVariant = "segmented" | "underline";

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
            ? "inline-flex items-center gap-1 rounded-control border border-border bg-bg-subtle p-1"
            : "flex items-center gap-5 border-b border-border",
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
        "text-sm font-medium transition-colors duration-150 ease-out focus-visible:outline-none",
        variant === "segmented"
          ? [
              "inline-flex min-h-8 items-center justify-center rounded-[6px] px-3 py-1.5",
              "text-muted hover:text-fg",
              "data-[state=active]:bg-surface data-[state=active]:text-fg data-[state=active]:shadow-soft",
            ]
          : [
              // Underline tabs — the EHR / section-nav treatment (Heidi/Attio).
              "-mb-px inline-flex items-center gap-1.5 border-b-2 border-transparent pb-2.5 pt-1",
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
      className={cn("mt-4 focus-visible:outline-none", className)}
      {...props}
    />
  );
});
