import { useMemo, useState, type FormEvent } from "react";
import { useNavigate } from "react-router-dom";
import { useTranslation } from "react-i18next";
import { motion } from "motion/react";
import {
  Check,
  CheckCircle,
  SignOut,
  UserCircle,
} from "@phosphor-icons/react";

import { PageContainer, PageHeader } from "@/components/shell";
import {
  Button,
  Card,
  Field,
  TextInput,
  Select,
} from "@/components/ui";
import { useEntry } from "@/lib/useLang";
import { LANGUAGE_META, normalizeLanguage } from "@/i18n";
import {
  AVATAR_SEEDS,
  PROFILE_LANGUAGES,
  PROFILE_ROLES,
  createProfile,
  signOut,
  updateProfile,
  useProfile,
  type ProfileDraft,
  type ProfileLanguage,
  type ProfileRole,
} from "@/state/profileStore";

/* -------------------------------------------------------------------------- */
/* Generated avatar (deterministic, offline — no photo, no external asset)     */
/* -------------------------------------------------------------------------- */

/** Fixed, pleasant hues for the named seeds; unknown seeds hash to a hue. */
const SEED_HUE: Record<string, number> = {
  aster: 262,
  cobalt: 214,
  verdant: 152,
  amber: 38,
  magenta: 322,
  slate: 220,
};

function hueForSeed(seed: string): number {
  if (seed in SEED_HUE) return SEED_HUE[seed];
  let h = 0;
  for (let i = 0; i < seed.length; i++) h = (h * 31 + seed.charCodeAt(i)) % 360;
  return h;
}

function initialsOf(name: string): string {
  const parts = name.trim().split(/\s+/).filter(Boolean);
  if (parts.length === 0) return "?";
  const first = parts[0]?.[0] ?? "";
  const last = parts.length > 1 ? (parts[parts.length - 1]?.[0] ?? "") : "";
  return (first + last).toUpperCase() || "?";
}

export function ProfileAvatar({
  seed,
  name,
  size = 40,
  className,
}: {
  seed: string;
  name: string;
  size?: number;
  className?: string;
}) {
  const hue = hueForSeed(seed);
  return (
    <span
      aria-hidden="true"
      className={className}
      style={{
        display: "inline-grid",
        placeItems: "center",
        width: size,
        height: size,
        borderRadius: "9999px",
        background: `hsl(${hue} 58% 45%)`,
        color: "#fff",
        fontWeight: 600,
        fontSize: Math.max(11, Math.round(size * 0.38)),
        lineHeight: 1,
        letterSpacing: "0.01em",
        userSelect: "none",
      }}
    >
      {initialsOf(name)}
    </span>
  );
}

/* -------------------------------------------------------------------------- */
/* Form                                                                        */
/* -------------------------------------------------------------------------- */

interface FormErrors {
  fullName?: string;
  institution?: string;
  role?: string;
}

interface ProfileFormProps {
  mode: "create" | "edit";
  initial: {
    fullName: string;
    role: ProfileRole | "";
    institution: string;
    specialty: string;
    language: ProfileLanguage;
    avatarSeed: string;
  };
  onSubmit: (draft: ProfileDraft) => void;
  saved: boolean;
  onCancel: () => void;
}

function ProfileForm({ mode, initial, onSubmit, saved, onCancel }: ProfileFormProps) {
  const { t } = useTranslation();
  const [fullName, setFullName] = useState(initial.fullName);
  const [role, setRole] = useState<ProfileRole | "">(initial.role);
  const [institution, setInstitution] = useState(initial.institution);
  const [specialty, setSpecialty] = useState(initial.specialty);
  const [language, setLanguage] = useState<ProfileLanguage>(initial.language);
  const [avatarSeed, setAvatarSeed] = useState(initial.avatarSeed);
  const [errors, setErrors] = useState<FormErrors>({});

  function validate(): FormErrors {
    const next: FormErrors = {};
    if (fullName.trim() === "") next.fullName = t("profile.form.fullNameError");
    if (institution.trim() === "")
      next.institution = t("profile.form.institutionError");
    if (!(PROFILE_ROLES as readonly string[]).includes(role))
      next.role = t("profile.form.roleError");
    return next;
  }

  function handleSubmit(e: FormEvent<HTMLFormElement>) {
    e.preventDefault();
    const next = validate();
    setErrors(next);
    if (Object.keys(next).length > 0) return;
    onSubmit({
      fullName: fullName.trim(),
      role: role as ProfileRole,
      institution: institution.trim(),
      specialty: specialty.trim() ? specialty.trim() : undefined,
      language,
      avatarSeed,
    });
  }

  const previewName = fullName.trim() || t("profile.form.fullName");

  return (
    <form onSubmit={handleSubmit} noValidate className="flex flex-col gap-6">
      {/* Live avatar preview + picker */}
      <fieldset className="flex flex-col gap-3">
        <legend className="text-sm font-medium text-fg">
          {t("profile.form.avatar")}
        </legend>
        <p className="text-xs text-muted">{t("profile.form.avatarHint")}</p>
        <div className="flex items-center gap-4">
          <ProfileAvatar seed={avatarSeed} name={previewName} size={56} />
          <div
            role="radiogroup"
            aria-label={t("profile.form.avatar")}
            className="flex flex-wrap gap-2"
          >
            {AVATAR_SEEDS.map((seed) => {
              const selected = seed === avatarSeed;
              return (
                <label
                  key={seed}
                  className="relative block cursor-pointer rounded-full"
                >
                  <input
                    type="radio"
                    name="avatarSeed"
                    value={seed}
                    checked={selected}
                    onChange={() => setAvatarSeed(seed)}
                    className="peer sr-only"
                    aria-label={t("profile.form.avatarChoose", { name: seed })}
                  />
                  <span
                    className={
                      "block rounded-full ring-2 ring-offset-2 ring-offset-surface transition-shadow " +
                      "ring-transparent hover:ring-border-strong " +
                      "peer-checked:ring-brand peer-focus-visible:ring-brand"
                    }
                  >
                    <ProfileAvatar seed={seed} name={previewName} size={36} />
                  </span>
                  {selected ? (
                    <span
                      aria-hidden="true"
                      className="absolute -right-0.5 -top-0.5 grid h-4 w-4 place-items-center rounded-full bg-brand text-white"
                    >
                      <Check weight="bold" className="h-2.5 w-2.5" />
                    </span>
                  ) : null}
                </label>
              );
            })}
          </div>
        </div>
      </fieldset>

      <Field label={t("profile.form.fullName")} error={errors.fullName}>
        {(aria) => (
          <TextInput
            {...aria}
            value={fullName}
            autoComplete="name"
            placeholder={t("profile.form.fullNamePlaceholder")}
            onChange={(e) => setFullName(e.target.value)}
          />
        )}
      </Field>

      <div className="grid gap-6 sm:grid-cols-2">
        <Field
          label={t("profile.form.role")}
          hint={t("profile.form.roleHint")}
          error={errors.role}
        >
          {(aria) => (
            <Select
              {...aria}
              value={role}
              onChange={(e) => setRole(e.target.value as ProfileRole | "")}
            >
              <option value="" disabled>
                {"—"}
              </option>
              {PROFILE_ROLES.map((r) => (
                <option key={r} value={r}>
                  {t(`profile.roles.${r}`)}
                </option>
              ))}
            </Select>
          )}
        </Field>

        <Field
          label={t("profile.form.language")}
          hint={t("profile.form.languageHint")}
        >
          {(aria) => (
            <Select
              {...aria}
              value={language}
              onChange={(e) => setLanguage(e.target.value as ProfileLanguage)}
            >
              {PROFILE_LANGUAGES.map((l) => {
                const meta = LANGUAGE_META[l];
                // Native name is already localized ("Türkçe", "العربية"); append
                // the English name for the languages whose native script the
                // reader may not recognize, so every option stays identifiable.
                const label =
                  meta.nativeName === meta.englishName
                    ? meta.nativeName
                    : `${meta.nativeName} · ${meta.englishName}`;
                return (
                  <option key={l} value={l} lang={l}>
                    {label}
                  </option>
                );
              })}
            </Select>
          )}
        </Field>
      </div>

      <Field label={t("profile.form.institution")} error={errors.institution}>
        {(aria) => (
          <TextInput
            {...aria}
            value={institution}
            autoComplete="organization"
            placeholder={t("profile.form.institutionPlaceholder")}
            onChange={(e) => setInstitution(e.target.value)}
          />
        )}
      </Field>

      <Field
        label={t("profile.form.specialty")}
        hint={t("profile.form.specialtyHint")}
        optional
      >
        {(aria) => (
          <TextInput
            {...aria}
            value={specialty}
            placeholder={t("profile.form.specialtyPlaceholder")}
            onChange={(e) => setSpecialty(e.target.value)}
          />
        )}
      </Field>

      <div className="flex flex-wrap items-center gap-3 pt-1">
        <Button type="submit">
          {mode === "create" ? t("profile.form.create") : t("profile.form.save")}
        </Button>
        {mode === "edit" ? (
          <Button type="button" variant="ghost" onClick={onCancel}>
            {t("profile.form.cancel")}
          </Button>
        ) : null}
        {saved ? (
          <span className="inline-flex items-center gap-1.5 text-sm text-[color:var(--state-normal)]">
            <CheckCircle weight="fill" className="h-4 w-4" aria-hidden="true" />
            {t("profile.form.saved")}
          </span>
        ) : null}
      </div>
    </form>
  );
}

/* -------------------------------------------------------------------------- */
/* Page                                                                        */
/* -------------------------------------------------------------------------- */

/**
 * ProfilePage — one route, two states:
 *   - First-time onboarding (no profile yet): create a REAL local profile.
 *   - Account (already onboarded): edit the same fields, or sign out.
 * The profile is the app's source of truth for identity, role, and language.
 */
export function ProfilePage() {
  const { t, i18n } = useTranslation();
  const navigate = useNavigate();
  const profile = useProfile();
  const entry = useEntry();
  const [saved, setSaved] = useState(false);

  const isEdit = profile?.onboarded === true;

  const initial = useMemo(
    () => ({
      fullName: profile?.fullName ?? "",
      role: (profile?.role ?? "") as ProfileRole | "",
      institution: profile?.institution ?? "",
      specialty: profile?.specialty ?? "",
      language: profile?.language ?? normalizeLanguage(i18n.resolvedLanguage),
      avatarSeed: profile?.avatarSeed ?? AVATAR_SEEDS[0],
    }),
    // Re-seed the form only when the identity of the saved profile changes.
    // eslint-disable-next-line react-hooks/exhaustive-deps
    [profile?.createdAt],
  );

  function applyLanguage(lang: ProfileLanguage) {
    if (i18n.resolvedLanguage !== lang) void i18n.changeLanguage(lang);
  }

  function handleCreate(draft: ProfileDraft) {
    createProfile(draft);
    applyLanguage(draft.language);
    navigate("/", { replace: true });
  }

  function handleUpdate(draft: ProfileDraft) {
    updateProfile(draft);
    applyLanguage(draft.language);
    setSaved(true);
  }

  function handleSignOut() {
    signOut();
    navigate("/signin", { replace: true });
  }

  const memberSince =
    profile?.createdAt != null
      ? new Date(profile.createdAt).toLocaleDateString(
          i18n.resolvedLanguage === "tr" ? "tr-TR" : "en-GB",
          { year: "numeric", month: "long", day: "numeric" },
        )
      : "";

  return (
    <PageContainer width="prose">
      <motion.div {...entry} className="flex flex-col gap-6">
        <PageHeader
          eyebrow={
            isEdit ? t("profile.account.eyebrow") : t("profile.onboarding.eyebrow")
          }
          title={isEdit ? t("profile.account.title") : t("profile.onboarding.title")}
          description={
            isEdit ? t("profile.account.lede") : t("profile.onboarding.lede")
          }
          actions={
            isEdit ? (
              <Button
                variant="secondary"
                onClick={handleSignOut}
                leadingIcon={<SignOut weight="bold" className="h-4 w-4" />}
              >
                {t("profile.account.signOut")}
              </Button>
            ) : undefined
          }
        />

        {isEdit && profile ? (
          <Card padding="md" variant="inset">
            <div className="flex items-center gap-3">
              <ProfileAvatar
                seed={profile.avatarSeed}
                name={profile.fullName}
                size={44}
              />
              <div className="min-w-0">
                <p className="truncate text-sm font-semibold text-fg">
                  {profile.fullName}
                </p>
                <p className="truncate text-xs text-muted">
                  {t(`profile.roles.${profile.role}`)}
                  {" · "}
                  {profile.institution}
                </p>
              </div>
              {memberSince ? (
                <p className="ms-auto hidden shrink-0 text-xs text-subtle sm:block">
                  {t("profile.account.memberSince", { date: memberSince })}
                </p>
              ) : null}
            </div>
          </Card>
        ) : (
          <div className="flex items-center gap-2 text-xs text-muted">
            <UserCircle weight="bold" className="h-4 w-4 shrink-0" aria-hidden="true" />
            <span>{t("profile.signIn.privacyNote")}</span>
          </div>
        )}

        <Card padding="lg">
          <ProfileForm
            mode={isEdit ? "edit" : "create"}
            initial={initial}
            saved={saved}
            onSubmit={isEdit ? handleUpdate : handleCreate}
            onCancel={() => navigate("/")}
          />
        </Card>
      </motion.div>
    </PageContainer>
  );
}
