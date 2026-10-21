import { useEffect, useState } from "react";
import { useTranslation } from "react-i18next";
import { motion } from "motion/react";
import { SignOut } from "@phosphor-icons/react";
import { PageContainer, PageHeader } from "@/components/shell";
import { Badge, Button, Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui";
import {
  AdminSessionProvider,
  AdminTokenGate,
  GpuSection,
  OverviewSection,
  ProvidersSection,
  SettingsSection,
  TelemetrySection,
  UsersSection,
  useAdminSession,
} from "@/components/admin";
import { useEntry } from "@/lib/useLang";

const TABS = ["overview", "providers", "users", "gpu", "telemetry", "settings"] as const;
type Tab = (typeof TABS)[number];
const TAB_KEY = "acudx-admin-tab";

function readTab(): Tab {
  try {
    const v = sessionStorage.getItem(TAB_KEY);
    return (TABS as readonly string[]).includes(v ?? "") ? (v as Tab) : "overview";
  } catch {
    return "overview";
  }
}

function Console() {
  const { t } = useTranslation();
  const { signedIn, signOut } = useAdminSession();
  const [tab, setTab] = useState<Tab>(readTab);
  const entry = useEntry();

  useEffect(() => {
    try {
      sessionStorage.setItem(TAB_KEY, tab);
    } catch {
      /* per-tab convenience only */
    }
  }, [tab]);

  return (
    <PageContainer width="wide">
      <motion.div {...entry} className="flex flex-col gap-5">
        <PageHeader
          eyebrow={t("admin.eyebrow")}
          title={t("admin.title")}
          description={t("admin.description")}
          meta={signedIn ? <Badge tone="normal" dot>{t("admin.token.signedIn")}</Badge> : null}
          actions={
            signedIn ? (
              <Button variant="secondary" size="sm" leadingIcon={<SignOut weight="bold" className="h-4 w-4" />} onClick={signOut}>
                {t("admin.token.signOut")}
              </Button>
            ) : null
          }
        />

        {!signedIn ? (
          <AdminTokenGate />
        ) : (
          <Tabs value={tab} onValueChange={(v) => setTab(v as Tab)} className="grid gap-5 lg:grid-cols-[200px_minmax(0,1fr)] lg:gap-8">
            {/* Console section nav: a left list on lg+, a segmented strip below. */}
            <div className="lg:sticky lg:top-16 lg:self-start">
              <TabsList aria-label={t("admin.title")} variant="vertical" className="hidden lg:flex">
                {TABS.map((k) => (
                  <TabsTrigger key={k} value={k}>
                    {t(`admin.tabs.${k}`)}
                  </TabsTrigger>
                ))}
              </TabsList>
              <div className="lg:hidden">
                <TabsList aria-label={t("admin.title")} variant="underline" className="flex-wrap gap-x-4 gap-y-0">
                  {TABS.map((k) => (
                    <TabsTrigger key={k} value={k}>
                      {t(`admin.tabs.${k}`)}
                    </TabsTrigger>
                  ))}
                </TabsList>
              </div>
            </div>
            <div className="min-w-0 [&>[role=tabpanel]]:mt-0">
            <TabsContent value="overview">
              <OverviewSection />
            </TabsContent>
            <TabsContent value="providers">
              <ProvidersSection />
            </TabsContent>
            <TabsContent value="users">
              <UsersSection />
            </TabsContent>
            <TabsContent value="gpu">
              <GpuSection />
            </TabsContent>
            <TabsContent value="telemetry">
              <TelemetrySection />
            </TabsContent>
            <TabsContent value="settings">
              <SettingsSection />
            </TabsContent>
            </div>
          </Tabs>
        )}
      </motion.div>
    </PageContainer>
  );
}

/**
 * /admin: the operator console. Route access is the real `admin` profile role
 * (RoleGate in App.tsx); API access is the gateway's ADMIN_TOKEN, entered on
 * the gate below and held in sessionStorage for this tab only.
 */
export function AdminPage() {
  return (
    <AdminSessionProvider>
      <Console />
    </AdminSessionProvider>
  );
}
