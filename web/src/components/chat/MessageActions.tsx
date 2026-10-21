import { useEffect, useRef, useState } from "react";
import { useTranslation } from "react-i18next";
import {
  ArrowSquareOut,
  ArrowBendDownRight,
  CheckCircle,
  Flask,
  Timer,
  X,
} from "@phosphor-icons/react";

import { cn } from "@/lib/cn";
import {
  actionKey,
  type AskAction,
  type ChatAction,
  type NavigateAction,
  type OrderAction,
} from "@/lib/chatActions";
import type { ActionHandlers } from "./types";

/**
 * MessageActions: the generative components a reply carries, rendered inline
 * under the line (docs/design/05-chat.md section 3.4). Order chips and navigate
 * buttons sit on one row (the "do" row); ask chips sit below under "Follow up"
 * (the "say" row). Nothing here invents an action: it renders exactly what the
 * reply's `actions` array named, validated by lib/chatActions.
 */
export function MessageActions({
  actions,
  handlers,
  className,
}: {
  actions: ChatAction[];
  handlers: ActionHandlers;
  className?: string;
}) {
  const { t } = useTranslation();
  const doRow = actions.filter(
    (a): a is OrderAction | NavigateAction =>
      a.kind === "order" || (a.kind === "navigate" && Boolean(handlers.navigate)),
  );
  const asks = actions.filter((a): a is AskAction => a.kind === "ask");
  if (doRow.length === 0 && asks.length === 0) return null;

  return (
    <div className={cn("mt-2 flex flex-col gap-2", className)} role="group" aria-label={t("chat.actions.groupLabel")}>
      {doRow.length > 0 ? (
        <div className="flex flex-wrap gap-1.5">
          {doRow.map((a) =>
            a.kind === "order" ? (
              <OrderChip key={actionKey(a)} action={a} handlers={handlers} />
            ) : (
              <NavigateButton key={actionKey(a)} action={a} onNavigate={handlers.navigate!} />
            ),
          )}
        </div>
      ) : null}
      {asks.length > 0 ? (
        <div className="flex flex-col gap-1">
          <span className="text-[11px] font-medium text-subtle">{t("chat.actions.followUps")}</span>
          <div className="flex flex-wrap gap-1.5">
            {asks.map((a) => (
              <AskChip key={actionKey(a)} text={a.text} onAsk={handlers.ask} />
            ))}
          </div>
        </div>
      ) : null}
    </div>
  );
}

const chipBase =
  "inline-flex min-h-8 max-w-full items-center gap-1.5 rounded-control border px-2.5 py-1 text-[0.8125rem] " +
  "transition-colors duration-[120ms] ease-out focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-brand";

/* -------------------------------------------------------------------------- */
/* Order chip                                                                  */
/* -------------------------------------------------------------------------- */

/**
 * OrderChip: one click asks for confirmation inline (Place order / Cancel, Esc
 * cancels), the confirm places the order, and the chip then follows the order's
 * live state from the store: pending with its ETA, then resulted with a View
 * result button that opens Results on that test.
 */
export function OrderChip({
  action,
  handlers,
  startConfirming = false,
  onDismiss,
}: {
  action: OrderAction;
  handlers: ActionHandlers;
  /** Open in the confirm step (slash /order drafts). */
  startConfirming?: boolean;
  /** Draft chips only: remove the draft. */
  onDismiss?: () => void;
}) {
  const { t } = useTranslation();
  const status = handlers.orderStatus(action);
  const [confirming, setConfirming] = useState(startConfirming);
  const confirmRef = useRef<HTMLButtonElement>(null);
  const triggerRef = useRef<HTMLButtonElement>(null);
  const wasConfirming = useRef(false);

  useEffect(() => {
    if (confirming) confirmRef.current?.focus();
    else if (wasConfirming.current && status.state === "none") triggerRef.current?.focus();
    wasConfirming.current = confirming;
  }, [confirming, status.state]);

  if (status.state === "pending") {
    return (
      <span
        className={cn(chipBase, "border-border bg-bg-subtle text-fg")}
        data-order-state="pending"
        data-testid="order-chip"
      >
        <Timer weight="bold" className="h-3.5 w-3.5 shrink-0 text-state-caution motion-safe:animate-pulse" aria-hidden />
        <span className="min-w-0 truncate font-medium">{action.label}</span>
        <span className="shrink-0 font-mono text-[11px] tabular-nums text-muted" aria-live="polite">
          {t("chat.actions.pending", { eta: status.eta })}
        </span>
      </span>
    );
  }

  if (status.state === "resulted") {
    return (
      <span
        className={cn(chipBase, "border-border bg-surface text-fg")}
        data-order-state="resulted"
        data-testid="order-chip"
      >
        <CheckCircle weight="fill" className="h-3.5 w-3.5 shrink-0 text-state-normal" aria-hidden />
        <span className="min-w-0 truncate font-medium">{action.label}</span>
        <span className="shrink-0 text-[11px] text-muted" aria-live="polite">
          {t("chat.actions.resulted")}
        </span>
        {handlers.navigate ? (
          <button
            type="button"
            onClick={() => handlers.navigate!(status.imaging ? "imaging" : "results", status.code)}
            className="-me-1 ms-0.5 shrink-0 rounded-chip px-1.5 py-0.5 text-[11px] font-medium text-brand underline-offset-2 hover:underline focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-brand"
          >
            {t("chat.actions.viewResult")}
          </button>
        ) : null}
      </span>
    );
  }

  if (confirming) {
    return (
      <span
        className={cn(chipBase, "flex-wrap border-brand/40 bg-brand-tint text-fg")}
        role="group"
        aria-label={t("chat.actions.confirmPrompt", { label: action.label })}
        data-order-state="confirming"
        data-testid="order-chip"
        onKeyDown={(e) => {
          if (e.key === "Escape") {
            e.stopPropagation();
            setConfirming(false);
          }
        }}
      >
        <Flask weight="bold" className="h-3.5 w-3.5 shrink-0 text-brand" aria-hidden />
        <span className="min-w-0 font-medium">{t("chat.actions.confirmPrompt", { label: action.label })}</span>
        <span className="flex shrink-0 items-center gap-1">
          <button
            ref={confirmRef}
            type="button"
            onClick={() => {
              handlers.placeOrder(action);
              setConfirming(false);
              onDismiss?.();
            }}
            className="h-6 rounded-chip bg-brand px-2 text-xs font-medium text-on-brand hover:bg-brand-hover focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-brand focus-visible:ring-offset-1"
          >
            {t("chat.actions.confirm")}
          </button>
          <button
            type="button"
            onClick={() => {
              setConfirming(false);
              onDismiss?.();
            }}
            className="h-6 rounded-chip px-2 text-xs font-medium text-muted hover:bg-surface hover:text-fg focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-brand"
          >
            {t("chat.actions.cancel")}
          </button>
        </span>
      </span>
    );
  }

  return (
    <span className="inline-flex max-w-full items-center gap-0.5">
      <button
        ref={triggerRef}
        type="button"
        onClick={() => setConfirming(true)}
        aria-label={t("chat.actions.orderLabel", { label: action.label })}
        data-order-state="none"
        data-testid="order-chip"
        className={cn(chipBase, "border-border-strong bg-surface text-fg hover:border-brand hover:text-brand")}
      >
        <Flask weight="bold" className="h-3.5 w-3.5 shrink-0" aria-hidden />
        <span className="min-w-0 truncate font-medium">{action.label}</span>
        {action.system !== "local" ? (
          <span className="shrink-0 font-mono text-[10px] uppercase text-subtle">{action.system}</span>
        ) : null}
      </button>
      {onDismiss ? (
        <button
          type="button"
          onClick={onDismiss}
          aria-label={t("chat.actions.removeDraft")}
          className="grid h-7 w-7 place-items-center rounded-control text-muted hover:bg-bg-inset hover:text-fg focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-brand"
        >
          <X weight="bold" className="h-3.5 w-3.5" aria-hidden />
        </button>
      ) : null}
    </span>
  );
}

/* -------------------------------------------------------------------------- */
/* Navigate button + ask chip                                                  */
/* -------------------------------------------------------------------------- */

export function NavigateButton({
  action,
  onNavigate,
}: {
  action: NavigateAction;
  onNavigate: (target: NavigateAction["target"], ref?: string) => void;
}) {
  const { t } = useTranslation();
  const target = t(`chat.targets.${action.target}`);
  return (
    <button
      type="button"
      onClick={() => onNavigate(action.target, action.ref)}
      data-testid="navigate-action"
      className={cn(chipBase, "border-transparent bg-transparent px-1.5 font-medium text-brand hover:bg-brand-tint")}
    >
      <ArrowSquareOut weight="bold" className="h-3.5 w-3.5 shrink-0" aria-hidden />
      <span className="truncate">{t("chat.actions.open", { target })}</span>
    </button>
  );
}

export function AskChip({ text, onAsk }: { text: string; onAsk: (text: string) => void }) {
  return (
    <button
      type="button"
      onClick={() => onAsk(text)}
      data-testid="ask-action"
      className={cn(chipBase, "border-border bg-bg-subtle text-start text-fg hover:border-border-strong hover:bg-surface")}
    >
      <ArrowBendDownRight weight="bold" className="h-3.5 w-3.5 shrink-0 text-subtle" aria-hidden />
      <span className="min-w-0 [overflow-wrap:anywhere]">{text}</span>
    </button>
  );
}
