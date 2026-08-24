"use client";

import { Save, Server, ShieldCheck } from "lucide-react";
import { useEffect, useState } from "react";

import { Button } from "@/components/ui/button";
import { FieldLabel, Input, Select } from "@/components/ui/field";
import { Panel, PanelHeader } from "@/components/ui/panel";
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

export default function AdminSettings() {
    const [loading, setLoading] = useState(true);
    const [saving, setSaving] = useState(false);
    const [error, setError] = useState("");
    const [success, setSuccess] = useState("");

    const [environment, setEnvironment] = useState("Demo");
    const [defaultOrganisation, setDefaultOrganisation] = useState("");
    const [sessionDuration, setSessionDuration] = useState("60");

    async function loadSettings() {
        try {
            setLoading(true);
            setError("");

            const response = await fetch("/api/admin/settings");
            const result = await response.json();

            if (!response.ok || !result.ok) {
                setError(result.message || "Unable to load system settings.");
                return;
            }

            const settings: SystemSetting[] = result.settings ?? [];

            for (const setting of settings) {
                if (setting.setting_key === "environment") {
                    setEnvironment(String(setting.setting_value ?? "Demo"));
                }

                if (setting.setting_key === "default_response_organisation") {
                    setDefaultOrganisation(String(setting.setting_value ?? ""));
                }

                if (setting.setting_key === "session_duration_minutes") {
                    setSessionDuration(String(setting.setting_value ?? "60"));
                }
            }
        } catch {
            setError("Unable to connect to the settings service.");
        } finally {
            setLoading(false);
        }
    }

    useEffect(() => {
        loadSettings();
    }, []);

    async function saveSetting(
        settingKey: string,
        settingValue: unknown,
        description: string,
    ) {
        const response = await fetch("/api/admin/settings", {
            method: "PATCH",
            headers: {
                "Content-Type": "application/json",
            },
            body: JSON.stringify({
                settingKey,
                settingValue,
                description,
                isPublic: false,
            }),
        });

        const result = await response.json();

        if (!response.ok || !result.ok) {
            throw new Error(
                result.message || "Unable to save the system setting.",
            );
        }
    }

    async function saveSettings() {
        try {
            setSaving(true);
            setError("");
            setSuccess("");

            await Promise.all([
                saveSetting(
                    "environment",
                    environment,
                    "Current application environment.",
                ),
                saveSetting(
                    "default_response_organisation",
                    defaultOrganisation,
                    "Default organisation used for response routing.",
                ),
                saveSetting(
                    "session_duration_minutes",
                    Number(sessionDuration),
                    "Default authenticated session duration in minutes.",
                ),
            ]);

            setSuccess("System settings saved successfully.");
        } catch (error) {
            setError(
                error instanceof Error
                    ? error.message
                    : "Unable to save system settings.",
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
                description="Manage system-level configuration stored securely in the backend."
            />

            {error ? (
                <div className="rounded-xl border border-[#efc9c7] bg-[#ffefee] px-4 py-3 text-sm font-medium text-[#a93331]">
                    {error}
                </div>
            ) : null}

            {success ? (
                <div className="rounded-xl border border-[#b9dfc8] bg-[#edf9f1] px-4 py-3 text-sm font-medium text-[#28724a]">
                    {success}
                </div>
            ) : null}

            <div className="grid gap-4 lg:grid-cols-2">
                <Panel>
                    <PanelHeader
                        title="Environment"
                        description="System-wide application configuration"
                    />

                    <div className="grid gap-4 p-4 sm:p-5">
                        <label>
                            <FieldLabel>Environment</FieldLabel>

                            <Select
                                value={environment}
                                onChange={(event) =>
                                    setEnvironment(event.target.value)
                                }
                            >
                                <option value="Demo">Demo</option>
                                <option value="Staging">Staging</option>
                                <option value="Production">Production</option>
                            </Select>
                        </label>

                        <label>
                            <FieldLabel>
                                Default response organisation
                            </FieldLabel>

                            <Input
                                value={defaultOrganisation}
                                onChange={(event) =>
                                    setDefaultOrganisation(event.target.value)
                                }
                                placeholder="Organisation name"
                            />
                        </label>

                        <label>
                            <FieldLabel>Session duration</FieldLabel>

                            <Select
                                value={sessionDuration}
                                onChange={(event) =>
                                    setSessionDuration(event.target.value)
                                }
                            >
                                <option value="30">30 minutes</option>
                                <option value="60">60 minutes</option>
                                <option value="240">4 hours</option>
                            </Select>
                        </label>

                        <Button
                            className="justify-self-start"
                            disabled={saving}
                            onClick={saveSettings}
                        >
                            <Save className="h-4 w-4" />

                            {saving ? "Saving..." : "Save settings"}
                        </Button>
                    </div>
                </Panel>

                <Panel>
                    <PanelHeader
                        title="System information"
                        description="Administration and security overview"
                    />

                    <div className="divide-y divide-[#e2e8ed]">
                        <div className="flex gap-3 p-4 sm:p-5">
                            <Server className="h-5 w-5 text-[#0f5b67]" />

                            <div>
                                <h3 className="font-semibold">
                                    Backend storage
                                </h3>

                                <p className="mt-1 text-sm leading-6 text-[#687b89]">
                                    System settings are stored in Supabase instead
                                    of browser-local mock data.
                                </p>
                            </div>
                        </div>

                        <div className="flex gap-3 p-4 sm:p-5">
                            <ShieldCheck className="h-5 w-5 text-[#0f5b67]" />

                            <div>
                                <h3 className="font-semibold">
                                    Administrator protection
                                </h3>

                                <p className="mt-1 text-sm leading-6 text-[#687b89]">
                                    Settings requests require a valid authenticated
                                    administrator session.
                                </p>
                            </div>
                        </div>
                    </div>
                </Panel>
            </div>
        </div>
    );
}
