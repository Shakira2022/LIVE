"use client";

import {
  Building2,
  CheckCircle2,
  Database,
  Save,
  Server,
  ShieldCheck,
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

export default function AdminSettings() {
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);

  const [error, setError] = useState("");
  const [success, setSuccess] = useState("");

  const [organisations, setOrganisations] = useState<
    Organisation[]
  >([]);

  const [environment, setEnvironment] =
    useState("Demo");

  const [defaultOrganisation, setDefaultOrganisation] =
    useState("");

  const [sessionDuration, setSessionDuration] =
    useState("60");

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
      setOrganisations([]);
    }
  }

  /*
   * LOAD EVERYTHING
   */
  useEffect(() => {
    async function loadPage() {
      try {
        setLoading(true);
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
    return <PageSkeleton />;
  }

  return (
    <div className="app-page grid gap-5">
      <PageHeading
        eyebrow="Administration"
        title="System settings"
        description="Manage system-wide configuration, response routing and authentication settings."
      />

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