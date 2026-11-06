"use client";

import {
  Accessibility,
  Building2,
  CheckCircle2,
  Database,
  Eye,
  Keyboard,
  Save,
  Server,
  ShieldCheck,
  Volume2,
  VolumeX,
} from "lucide-react";
import { useEffect, useState } from "react";

import { Button } from "@/components/ui/button";
import {
  FieldLabel,
  Input,
  Select,
} from "@/components/ui/field";
import {
  Panel,
  PanelHeader,
} from "@/components/ui/panel";
import { PageHeading } from "@/components/ui/page-heading";
import { PageSkeleton } from "@/components/ui/skeleton";
import { DisplayThemeSettings } from "@/components/settings/display-theme-settings";
import { readCached, writeFreshCache } from "@/lib/client-cache";
import { useAuth } from "@/components/auth/auth-provider";

interface SystemSetting {
  setting_key: string;
  setting_value: unknown;
  description: string | null;
  is_public: boolean;
  updated_by_user_id: string | null;
  updated_at: string | null;
}

interface Organisation {
  id: string;
  name?: string | null;
  display_name?: string | null;
  legal_name?: string | null;
  status?: string | null;
  organisation_status?: string | null;
}

interface HciPreferences {
  brightness: number;
  textScale: number;
  reducedMotion: boolean;
  textSpacing: boolean;
  notificationsMuted: boolean;
  notificationVolume: number;
  notificationSound: "soft" | "alert" | "chime";
}

const defaultHciPreferences: HciPreferences = {
  brightness: 100,
  textScale: 100,
  reducedMotion: false,
  textSpacing: false,
  notificationsMuted: false,
  notificationVolume: 70,
  notificationSound: "soft",
};

const hciStorageKey = "live-hci-preferences";

type AdminSettingsCache = {
  organisations: Organisation[];
  environment: string;
  defaultOrganisation: string;
  sessionDuration: string;
};

const hciToggleOptions: Array<{
  key: "textSpacing" | "reducedMotion";
  label: string;
  description: string;
  icon: typeof Accessibility;
}> = [
  {
    key: "textSpacing",
    label: "Expanded text spacing",
    description: "Add breathing room between letters and words.",
    icon: Keyboard,
  },
  {
    key: "reducedMotion",
    label: "Reduce motion",
    description: "Minimise animations and transitions.",
    icon: Accessibility,
  },
];

export default function AdminSettings() {
  const { user } = useAuth();
  const adminSettingsCacheKey = user?.id ? `admin-settings:${user.id}` : "admin-settings:pending";
  const initialSettings = readCached<AdminSettingsCache>(adminSettingsCacheKey);
  const [loading, setLoading] = useState(() => !initialSettings);
  const [saving, setSaving] = useState(false);

  const [error, setError] = useState("");
  const [success, setSuccess] = useState("");

  const [organisations, setOrganisations] = useState<
    Organisation[]
  >(() => initialSettings?.organisations ?? []);

  const [environment, setEnvironment] =
    useState(() => initialSettings?.environment ?? "Demo");

  const [defaultOrganisation, setDefaultOrganisation] =
    useState(() => initialSettings?.defaultOrganisation ?? "");

  const [sessionDuration, setSessionDuration] =
    useState(() => initialSettings?.sessionDuration ?? "60");

  const [hciPreferences, setHciPreferences] =
    useState<HciPreferences>(defaultHciPreferences);

  useEffect(() => {
    try {
      const stored = window.localStorage.getItem(hciStorageKey);
      if (stored) {
        setHciPreferences({
          ...defaultHciPreferences,
          ...JSON.parse(stored),
        });
      }
    } catch {
      // Preferences are optional; keep the accessible defaults if storage is unavailable.
    }
  }, []);

  useEffect(() => {
    const root = document.documentElement;
    root.style.setProperty(
      "--live-brightness",
      String(hciPreferences.brightness / 100)
    );
    root.style.setProperty(
      "--live-font-scale",
      String(hciPreferences.textScale / 100)
    );
    root.dataset.liveReducedMotion = String(hciPreferences.reducedMotion);
    root.dataset.liveTextSpacing = String(hciPreferences.textSpacing);
    root.dataset.liveNotificationsMuted = String(
      hciPreferences.notificationsMuted
    );
    window.localStorage.setItem(hciStorageKey, JSON.stringify(hciPreferences));
  }, [hciPreferences]);

  useEffect(() => {
    writeFreshCache(adminSettingsCacheKey, {
      organisations,
      environment,
      defaultOrganisation,
      sessionDuration,
    }, 5 * 60_000);
  }, [organisations, environment, defaultOrganisation, sessionDuration]);

  function updateHci<K extends keyof HciPreferences>(
    key: K,
    value: HciPreferences[K]
  ) {
    setHciPreferences((current) => ({ ...current, [key]: value }));
  }

  function previewNotificationSound() {
    if (hciPreferences.notificationsMuted) return;
    const AudioContextClass =
      window.AudioContext ||
      (window as typeof window & { webkitAudioContext?: typeof AudioContext })
        .webkitAudioContext;
    if (!AudioContextClass) return;

    const context = new AudioContextClass();
    const oscillator = context.createOscillator();
    const gain = context.createGain();
    const frequency =
      hciPreferences.notificationSound === "chime"
        ? 880
        : hciPreferences.notificationSound === "alert"
          ? 540
          : 660;
    oscillator.frequency.value = frequency;
    oscillator.type = hciPreferences.notificationSound === "alert" ? "square" : "sine";
    gain.gain.setValueAtTime(hciPreferences.notificationVolume / 100 * 0.08, context.currentTime);
    gain.gain.exponentialRampToValueAtTime(0.001, context.currentTime + 0.35);
    oscillator.connect(gain);
    gain.connect(context.destination);
    oscillator.start();
    oscillator.stop(context.currentTime + 0.35);
    oscillator.addEventListener("ended", () => void context.close());
  }

  /*
   * LOAD SYSTEM SETTINGS
   *
   * Uses your teammate's existing settings API.
   */
  async function loadSettings() {
    try {
      const response = await fetch(
        "/api/admin/settings",
        {
          method: "GET",
          credentials: "include",
        }
      );

      const result = await response.json();

      if (!response.ok || !result.ok) {
        throw new Error(
          result.message ||
            "Unable to load system settings."
        );
      }

      const settings: SystemSetting[] =
        result.settings ?? [];

      for (const setting of settings) {
        if (
          setting.setting_key ===
          "environment"
        ) {
          setEnvironment(
            String(
              setting.setting_value ?? "Demo"
            )
          );
        }

        if (
          setting.setting_key ===
          "default_response_organisation"
        ) {
          setDefaultOrganisation(
            String(
              setting.setting_value ?? ""
            )
          );
        }

        if (
          setting.setting_key ===
          "session_duration_minutes"
        ) {
          setSessionDuration(
            String(
              setting.setting_value ?? "60"
            )
          );
        }
      }
    } catch (error) {
      console.error(
        "Failed to load system settings:",
        error
      );

      throw error;
    }
  }

  /*
   * LOAD ORGANISATIONS
   *
   * Uses your existing Organisation Management API.
   *
   * We are NOT changing the organisation feature.
   */
  async function loadOrganisations() {
    try {
      const response = await fetch(
        "/api/admin/organisations",
        {
          method: "GET",
          credentials: "include",
        }
      );

      const result = await response.json();

      console.log(
        "ORGANISATIONS API RESULT:",
        result
      );

      if (!response.ok || !result.ok) {
        throw new Error(
          result.message ||
            "Unable to load organisations."
        );
      }

      setOrganisations(
        Array.isArray(result.organisations)
          ? result.organisations
          : []
      );
    } catch (error) {
      console.error(
        "Failed to load organisations:",
        error
      );

      /*
       * We don't stop the entire settings page
       * if organisations cannot be loaded.
       *
       * The other system settings can still work.
       */
    }
  }

  /*
   * LOAD EVERYTHING
   */
  useEffect(() => {
    async function loadPage() {
      try {
        if (!readCached<AdminSettingsCache>(adminSettingsCacheKey)) setLoading(true);
        setError("");

        await Promise.all([
          loadSettings(),
          loadOrganisations(),
        ]);
      } catch (error) {
        setError(
          error instanceof Error
            ? error.message
            : "Unable to load system settings."
        );
      } finally {
        setLoading(false);
      }
    }

    loadPage();
  }, []);

  /*
   * GET A DISPLAY NAME FOR AN ORGANISATION
   *
   * Supports the common naming fields so this page
   * remains compatible with your organisation API.
   */
  function getOrganisationName(
    organisation: Organisation
  ) {
    return (
      organisation.name ||
      organisation.display_name ||
      organisation.legal_name ||
      "Unnamed organisation"
    );
  }

  /*
   * SAVE ONE SYSTEM SETTING
   *
   * Uses the existing PATCH /api/admin/settings
   * endpoint.
   */
  async function saveSetting(
    settingKey: string,
    settingValue: unknown,
    description: string
  ) {
    const response = await fetch(
      "/api/admin/settings",
      {
        method: "PATCH",
        credentials: "include",
        headers: {
          "Content-Type": "application/json",
        },
        body: JSON.stringify({
          settingKey,
          settingValue,
          description,
          isPublic: false,
        }),
      }
    );

    const result = await response.json();

    if (!response.ok || !result.ok) {
      throw new Error(
        result.message ||
          "Unable to save the system setting."
      );
    }

    return result;
  }

  /*
   * SAVE ALL SETTINGS
   */
  async function saveSettings() {
    try {
      setSaving(true);
      setError("");
      setSuccess("");

      /*
       * Save the organisation ID.
       *
       * This is better than storing the organisation
       * name because names can potentially change.
       */
      await Promise.all([
        saveSetting(
          "environment",
          environment,
          "Current application environment."
        ),

        saveSetting(
          "default_response_organisation",
          defaultOrganisation,
          "Default organisation used for emergency response routing."
        ),

        saveSetting(
          "session_duration_minutes",
          Number(sessionDuration),
          "Default authenticated session duration in minutes."
        ),
      ]);

      setSuccess(
        "System settings saved successfully."
      );
    } catch (error) {
      console.error(
        "Failed to save system settings:",
        error
      );

      setError(
        error instanceof Error
          ? error.message
          : "Unable to save system settings."
      );
    } finally {
      setSaving(false);
    }
  }

  if (loading) {
    return (
      <div className="app-page grid gap-5">
        <PageHeading
          eyebrow="Administration"
          title="System settings"
          description="Manage system-wide configuration, response routing and authentication settings."
        />
        <DisplayThemeSettings description="Choose the display mode for your admin account." />
        <PageSkeleton />
      </div>
    );
  }

  return (
    <div className="app-page grid gap-5">
      <PageHeading
        eyebrow="Administration"
        title="System settings"
        description="Manage system-wide configuration, response routing and authentication settings."
      />

      <DisplayThemeSettings description="Choose the display mode for your admin account." />

      {/* ERROR MESSAGE */}
      {error ? (
        <div className="rounded-xl border border-[#efc9c7] bg-[#ffefee] px-4 py-3 text-sm font-medium text-[#a93331]">
          {error}
        </div>
      ) : null}

      {/* SUCCESS MESSAGE */}
      {success ? (
        <div className="flex items-center gap-2 rounded-xl border border-[#b9dfc8] bg-[#edf9f1] px-4 py-3 text-sm font-medium text-[#28724a]">
          <CheckCircle2 className="h-4 w-4" />
          {success}
        </div>
      ) : null}

      <div className="grid gap-4 lg:grid-cols-2">
        {/* SYSTEM CONFIGURATION */}
        <Panel>
          <PanelHeader
            title="System configuration"
            description="Manage system-wide application settings."
          />

          <div className="grid gap-5 p-4 sm:p-5">
            {/* ENVIRONMENT */}
            <label>
              <FieldLabel>
                Environment
              </FieldLabel>

              <Select
                value={environment}
                onChange={(event) =>
                  setEnvironment(
                    event.target.value
                  )
                }
              >
                <option value="Demo">
                  Demo
                </option>

                <option value="Staging">
                  Staging
                </option>

                <option value="Production">
                  Production
                </option>
              </Select>

              <p className="mt-1.5 text-xs text-[#71828d]">
                Controls the current application
                environment.
              </p>
            </label>

            {/* DEFAULT RESPONSE ORGANISATION */}
            <label>
              <FieldLabel>
                Default response organisation
              </FieldLabel>

              <div className="relative">
                <Building2 className="pointer-events-none absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-[#71828d]" />

                <Select
                  className="pl-10"
                  value={defaultOrganisation}
                  onChange={(event) =>
                    setDefaultOrganisation(
                      event.target.value
                    )
                  }
                >
                  <option value="">
                    Select an organisation
                  </option>

                  {organisations.map(
                    (organisation) => (
                      <option
                        key={organisation.id}
                        value={organisation.id}
                      >
                        {getOrganisationName(
                          organisation
                        )}
                      </option>
                    )
                  )}
                </Select>
              </div>

              {organisations.length === 0 ? (
                <p className="mt-1.5 text-xs text-[#a93331]">
                  No organisations are currently
                  available. Add an organisation
                  under Organisation Management first.
                </p>
              ) : (
                <p className="mt-1.5 text-xs text-[#71828d]">
                  This organisation will be used as
                  the default response destination
                  when applicable.
                </p>
              )}
            </label>

            {/* SESSION DURATION */}
            <label>
              <FieldLabel>
                Session duration
              </FieldLabel>

              <Select
                value={sessionDuration}
                onChange={(event) =>
                  setSessionDuration(
                    event.target.value
                  )
                }
              >
                <option value="30">
                  30 minutes
                </option>

                <option value="60">
                  60 minutes
                </option>

                <option value="120">
                  2 hours
                </option>

                <option value="240">
                  4 hours
                </option>
              </Select>

              <p className="mt-1.5 text-xs text-[#71828d]">
                Default duration for authenticated
                application sessions.
              </p>
            </label>

            {/* SAVE BUTTON */}
            <Button
              className="justify-self-start"
              disabled={saving}
              onClick={saveSettings}
            >
              <Save className="h-4 w-4" />

              {saving
                ? "Saving..."
                : "Save settings"}
            </Button>
          </div>
        </Panel>

        {/* HCI AND NOTIFICATION PREFERENCES */}
        <Panel>
          <PanelHeader
            title="Accessibility and notifications"
            description="Personalise how LIVE looks, moves and alerts you on this device."
          />

          <div className="grid gap-5 p-4 sm:p-5">
            <div>
              <div className="flex items-center justify-between gap-3">
                <label htmlFor="brightness" className="flex items-center gap-2 text-sm font-semibold">
                  <Accessibility className="h-4 w-4 text-[#0f6872]" />
                  Screen brightness
                </label>
                <output htmlFor="brightness" className="text-sm font-bold text-[#0f6872]">
                  {hciPreferences.brightness}%
                </output>
              </div>
              <input
                id="brightness"
                type="range"
                min="50"
                max="120"
                step="5"
                value={hciPreferences.brightness}
                onChange={(event) => updateHci("brightness", Number(event.target.value))}
                className="mt-3 h-2 w-full cursor-pointer accent-[#0f6872]"
              />
              <p className="mt-1.5 text-xs text-[#71828d]">Adjust the brightness of the LIVE interface.</p>
            </div>

            <div>
              <div className="flex items-center justify-between gap-3">
                <label htmlFor="text-scale" className="flex items-center gap-2 text-sm font-semibold">
                  <Eye className="h-4 w-4 text-[#0f6872]" />
                  Text size
                </label>
                <output htmlFor="text-scale" className="text-sm font-bold text-[#0f6872]">
                  {hciPreferences.textScale}%
                </output>
              </div>
              <input
                id="text-scale"
                type="range"
                min="90"
                max="130"
                step="5"
                value={hciPreferences.textScale}
                onChange={(event) => updateHci("textScale", Number(event.target.value))}
                className="mt-3 h-2 w-full cursor-pointer accent-[#0f6872]"
              />
            </div>

            <div className="grid gap-2">
              {hciToggleOptions.map(({ key, label, description, icon: PreferenceIcon }) => {
                const preferenceKey = key;
                return (
                  <label key={key} className="flex cursor-pointer items-start gap-3 rounded-xl border border-[#e2e8ed] p-3 transition hover:bg-[#f8fafb]">
                    <input
                      type="checkbox"
                      checked={hciPreferences[preferenceKey]}
                      onChange={(event) => updateHci(preferenceKey, event.target.checked)}
                      className="mt-1 h-4 w-4 accent-[#0f6872]"
                    />
                    <PreferenceIcon className="mt-0.5 h-4 w-4 shrink-0 text-[#0f6872]" />
                    <span>
                      <span className="block text-sm font-semibold">{label}</span>
                      <span className="mt-0.5 block text-xs text-[#71828d]">{description}</span>
                    </span>
                  </label>
                );
              })}
            </div>

            <div className="border-t border-[#e2e8ed] pt-4">
              <div className="flex items-center gap-2 text-sm font-semibold">
                {hciPreferences.notificationsMuted ? <VolumeX className="h-4 w-4 text-[#a9443d]" /> : <Volume2 className="h-4 w-4 text-[#0f6872]" />}
                Notification sound
              </div>
              <label className="mt-3 block">
                <span className="mb-2 block text-xs font-semibold uppercase tracking-wide text-[#71828d]">Sound style</span>
                <Select
                  value={hciPreferences.notificationSound}
                  onChange={(event) => updateHci("notificationSound", event.target.value as HciPreferences["notificationSound"])}
                  disabled={hciPreferences.notificationsMuted}
                >
                  <option value="soft">Soft tone</option>
                  <option value="alert">Alert tone</option>
                  <option value="chime">Chime</option>
                </Select>
              </label>
              <div className="mt-3 flex items-center justify-between gap-3">
                <label htmlFor="notification-volume" className="text-xs font-semibold text-[#71828d]">Volume</label>
                <output htmlFor="notification-volume" className="text-xs font-bold text-[#0f6872]">{hciPreferences.notificationVolume}%</output>
              </div>
              <input
                id="notification-volume"
                type="range"
                min="0"
                max="100"
                step="5"
                value={hciPreferences.notificationVolume}
                onChange={(event) => updateHci("notificationVolume", Number(event.target.value))}
                disabled={hciPreferences.notificationsMuted}
                className="mt-2 h-2 w-full cursor-pointer accent-[#0f6872] disabled:cursor-not-allowed disabled:opacity-50"
              />
              <div className="mt-3 flex flex-wrap gap-2">
                <button
                  type="button"
                  onClick={() => updateHci("notificationsMuted", !hciPreferences.notificationsMuted)}
                  className="inline-flex min-h-10 items-center gap-2 rounded-xl border border-[#d6e0e5] px-3 text-xs font-bold text-[#102b3f] transition hover:bg-[#f5f8f9]"
                  aria-pressed={hciPreferences.notificationsMuted}
                >
                  {hciPreferences.notificationsMuted ? <Volume2 className="h-4 w-4" /> : <VolumeX className="h-4 w-4" />}
                  {hciPreferences.notificationsMuted ? "Enable sounds" : "Silence notifications"}
                </button>
                <button
                  type="button"
                  onClick={previewNotificationSound}
                  disabled={hciPreferences.notificationsMuted || hciPreferences.notificationVolume === 0}
                  className="inline-flex min-h-10 items-center rounded-xl border border-[#d6e0e5] px-3 text-xs font-bold text-[#0f6872] transition hover:bg-[#f5f8f9] disabled:cursor-not-allowed disabled:opacity-50"
                >
                  Preview sound
                </button>
              </div>
              <p className="mt-2 text-xs text-[#71828d]">Silencing affects notification sounds on this device; visual notifications remain available.</p>
            </div>
          </div>
        </Panel>

        {/* SYSTEM INFORMATION */}
        <Panel>
          <PanelHeader
            title="System information"
            description="Administration, security and backend services."
          />

          <div className="divide-y divide-[#e2e8ed]">
            {/* DATABASE */}
            <div className="flex gap-3 p-4 sm:p-5">
              <Database className="h-5 w-5 shrink-0 text-[#0f5b67]" />

              <div>
                <h3 className="font-semibold">
                  Database
                </h3>

                <p className="mt-1 text-sm leading-6 text-[#687b89]">
                  Supabase PostgreSQL is used for
                  users, emergency requests,
                  organisations and system
                  configuration.
                </p>
              </div>

              <CheckCircle2 className="ml-auto h-5 w-5 shrink-0 text-[#1f845b]" />
            </div>

            {/* ORGANISATION MANAGEMENT */}
            <div className="flex gap-3 p-4 sm:p-5">
              <Building2 className="h-5 w-5 shrink-0 text-[#0f5b67]" />

              <div>
                <h3 className="font-semibold">
                  Organisation management
                </h3>

                <p className="mt-1 text-sm leading-6 text-[#687b89]">
                  Organisations are managed through
                  the Administration Organisation
                  Management section.
                </p>
              </div>

              <CheckCircle2 className="ml-auto h-5 w-5 shrink-0 text-[#1f845b]" />
            </div>

            {/* JWT */}
            <div className="flex gap-3 p-4 sm:p-5">
              <ShieldCheck className="h-5 w-5 shrink-0 text-[#0f5b67]" />

              <div>
                <h3 className="font-semibold">
                  Authentication
                </h3>

                <p className="mt-1 text-sm leading-6 text-[#687b89]">
                  Protected administration routes
                  use the application's JWT
                  authentication system.
                </p>
              </div>

              <CheckCircle2 className="ml-auto h-5 w-5 shrink-0 text-[#1f845b]" />
            </div>

            {/* BACKEND */}
            <div className="flex gap-3 p-4 sm:p-5">
              <Server className="h-5 w-5 shrink-0 text-[#0f5b67]" />

              <div>
                <h3 className="font-semibold">
                  Backend storage
                </h3>

                <p className="mt-1 text-sm leading-6 text-[#687b89]">
                  System settings are stored in
                  the backend instead of
                  browser-local mock data.
                </p>
              </div>

              <CheckCircle2 className="ml-auto h-5 w-5 shrink-0 text-[#1f845b]" />
            </div>
          </div>
        </Panel>
      </div>

      {/* SETTINGS SUMMARY */}
      <Panel>
        <PanelHeader
          title="Current configuration"
          description="Review the values currently selected for the system."
        />

        <div className="grid gap-3 p-4 sm:grid-cols-3 sm:p-5">
          <div className="rounded-xl border border-[#e2e8ed] bg-[#f8fafb] p-4">
            <p className="text-xs font-semibold uppercase tracking-wide text-[#71828d]">
              Environment
            </p>

            <p className="mt-1 font-semibold">
              {environment}
            </p>
          </div>

          <div className="rounded-xl border border-[#e2e8ed] bg-[#f8fafb] p-4">
            <p className="text-xs font-semibold uppercase tracking-wide text-[#71828d]">
              Default organisation
            </p>

            <p className="mt-1 font-semibold">
              {defaultOrganisation
                ? (() => {
                    const organisation =
                      organisations.find(
                        (item) =>
                          item.id ===
                          defaultOrganisation
                      );

                    return organisation
                      ? getOrganisationName(
                          organisation
                        )
                      : "Selected organisation";
                  })()
                : "Not configured"}
            </p>
          </div>

          <div className="rounded-xl border border-[#e2e8ed] bg-[#f8fafb] p-4">
            <p className="text-xs font-semibold uppercase tracking-wide text-[#71828d]">
              Session duration
            </p>

            <p className="mt-1 font-semibold">
              {sessionDuration} minutes
            </p>
          </div>
        </div>
      </Panel>
    </div>
  );
}
