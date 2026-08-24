"use client";

import {
  Building2,
  DatabaseZap,
  MapPin,
  Phone,
  Power,
  Plus,
  X,
} from "lucide-react";

import { FormEvent, useEffect, useState } from "react";

import { useAuth } from "@/components/auth/auth-provider";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Panel, PanelHeader } from "@/components/ui/panel";
import { PageHeading } from "@/components/ui/page-heading";
import { PageSkeleton } from "@/components/ui/skeleton";

type Organisation = {
  id: string;
  name: string;
  organisation_type: string;
  contact_phone: string | null;
  service_area_description: string;
  status: string;
  integration_status: string;
};

export default function AdminOrgs() {
  const { user } = useAuth();

  const [organisations, setOrganisations] = useState<Organisation[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState("");

  const [showCreateForm, setShowCreateForm] = useState(false);
  const [creating, setCreating] = useState(false);
  const [createError, setCreateError] = useState("");
  const [createSuccess, setCreateSuccess] = useState("");

  const [form, setForm] = useState({
    name: "",
    organisation_type: "emergency_response",
    registration_number: "",
    contact_email: "",
    contact_phone: "",
    address_line_1: "",
    address_line_2: "",
    suburb: "",
    city: "",
    province: "",
    postal_code: "",
    service_area_description: "",
    status: "active",
  });

  useEffect(() => {
    loadOrganisations();
  }, [user]);

  async function loadOrganisations() {
    if (!user) return;

    try {
      setLoading(true);
      setError("");

      const response = await fetch("/api/admin/organisations", {
        method: "GET",
        credentials: "include",
      });

      const data = await response.json();

      if (!response.ok) {
        throw new Error(
          data.message || "Failed to load organizations."
        );
      }

      const nextOrganisations =
        data?.data?.organisations ??
        data?.organisations ??
        data?.organizations ??
        [];

      setOrganisations(
        Array.isArray(nextOrganisations)
          ? nextOrganisations
          : [],
      );
    } catch (error) {
      console.error("Failed to load organizations:", error);

      setError(
        error instanceof Error
          ? error.message
          : "Failed to load organizations."
      );
    } finally {
      setLoading(false);
    }
  }

  function updateForm(
    field: string,
    value: string
  ) {
    setForm((previous) => ({
      ...previous,
      [field]: value,
    }));
  }

  async function createOrganisation(
    event: FormEvent<HTMLFormElement>
  ) {
    event.preventDefault();

    setCreating(true);
    setCreateError("");
    setCreateSuccess("");

    try {
      const response = await fetch(
        "/api/admin/organisations",
        {
          method: "POST",
          headers: {
            "Content-Type": "application/json",
          },
          credentials: "include",
          body: JSON.stringify(form),
        }
      );

      const data = await response.json();

      if (!response.ok) {
        throw new Error(
          data.message ||
            "Failed to create organization."
        );
      }

      setCreateSuccess(
        "Organization created successfully."
      );

      setForm({
        name: "",
        organisation_type: "emergency_response",
        registration_number: "",
        contact_email: "",
        contact_phone: "",
        address_line_1: "",
        address_line_2: "",
        suburb: "",
        city: "",
        province: "",
        postal_code: "",
        service_area_description: "",
        status: "active",
      });

      await loadOrganisations();

      setTimeout(() => {
        setShowCreateForm(false);
        setCreateSuccess("");
      }, 1000);
    } catch (error) {
      console.error(
        "Failed to create organization:",
        error
      );

      setCreateError(
        error instanceof Error
          ? error.message
          : "Failed to create organization."
      );
    } finally {
      setCreating(false);
    }
  }

  if (!user || loading) {
    return <PageSkeleton />;
  }

  if (error) {
    return (
      <div className="app-page grid gap-5">
        <PageHeading
          eyebrow="Administration"
          title="Response organisations"
          description="Review service coverage, integration state and operational availability."
        />

        <Panel>
          <div className="p-6">
            <p className="font-semibold text-red-600">
              Unable to load organizations
            </p>

            <p className="mt-2 text-sm text-[#748693]">
              {error}
            </p>

            <Button
              className="mt-4"
              onClick={loadOrganisations}
            >
              Try again
            </Button>
          </div>
        </Panel>
      </div>
    );
  }

  return (
    <div className="app-page grid gap-5">

      {/* PAGE HEADER */}
      <div className="flex flex-col gap-4 sm:flex-row sm:items-end sm:justify-between">
        <PageHeading
          eyebrow="Administration"
          title="Response organisations"
          description="Review service coverage, integration state and operational availability."
        />

        <Button
          onClick={() => {
            setShowCreateForm(true);
            setCreateError("");
            setCreateSuccess("");
          }}
        >
          <Plus className="h-4 w-4" />
          Add organisation
        </Button>
      </div>

      {/* CREATE ORGANISATION FORM */}
      {showCreateForm && (
        <Panel>
          <div className="border-b border-[#e2e8ed] p-5">
            <div className="flex items-center justify-between">
              <div>
                <h2 className="text-lg font-bold">
                  Add organisation
                </h2>

                <p className="mt-1 text-sm text-[#748693]">
                  Create a new organisation for the LIVE
                  emergency response system.
                </p>
              </div>

              <button
                type="button"
                onClick={() =>
                  setShowCreateForm(false)
                }
                className="rounded-lg p-2 hover:bg-gray-100"
              >
                <X className="h-5 w-5" />
              </button>
            </div>
          </div>

          <form
            onSubmit={createOrganisation}
            className="grid gap-5 p-5"
          >

            {/* NAME + TYPE */}
            <div className="grid gap-4 md:grid-cols-2">

              <FormField
                label="Organisation name"
                required
              >
                <input
                  value={form.name}
                  onChange={(event) =>
                    updateForm(
                      "name",
                      event.target.value
                    )
                  }
                  placeholder="e.g. Vaal Medical Hospital"
                  required
                  className="form-input"
                />
              </FormField>

              <FormField
                label="Organisation type"
                required
              >
                <select
                  value={form.organisation_type}
                  onChange={(event) =>
                    updateForm(
                      "organisation_type",
                      event.target.value
                    )
                  }
                  className="form-input"
                >
                  <option value="emergency_response">
                    Emergency Response
                  </option>

                  <option value="hospital">
                    Hospital
                  </option>

                  <option value="administration">
                    Administration
                  </option>

                  <option value="support">
                    Support
                  </option>
                </select>
              </FormField>
            </div>

            {/* REGISTRATION */}
            <FormField label="Registration number">
              <input
                value={form.registration_number}
                onChange={(event) =>
                  updateForm(
                    "registration_number",
                    event.target.value
                  )
                }
                placeholder="Optional"
                className="form-input"
              />
            </FormField>

            {/* CONTACT */}
            <div className="grid gap-4 md:grid-cols-2">

              <FormField label="Contact email">
                <input
                  type="email"
                  value={form.contact_email}
                  onChange={(event) =>
                    updateForm(
                      "contact_email",
                      event.target.value
                    )
                  }
                  placeholder="organisation@example.com"
                  className="form-input"
                />
              </FormField>

              <FormField label="Contact phone">
                <input
                  value={form.contact_phone}
                  onChange={(event) =>
                    updateForm(
                      "contact_phone",
                      event.target.value
                    )
                  }
                  placeholder="016 000 0000"
                  className="form-input"
                />
              </FormField>

            </div>

            {/* ADDRESS */}
            <FormField label="Address">
              <input
                value={form.address_line_1}
                onChange={(event) =>
                  updateForm(
                    "address_line_1",
                    event.target.value
                  )
                }
                placeholder="Street address"
                className="form-input"
              />
            </FormField>

            <FormField label="Address line 2">
              <input
                value={form.address_line_2}
                onChange={(event) =>
                  updateForm(
                    "address_line_2",
                    event.target.value
                  )
                }
                placeholder="Building / unit (optional)"
                className="form-input"
              />
            </FormField>

            {/* LOCATION */}
            <div className="grid gap-4 md:grid-cols-2">

              <FormField label="Suburb">
                <input
                  value={form.suburb}
                  onChange={(event) =>
                    updateForm(
                      "suburb",
                      event.target.value
                    )
                  }
                  placeholder="Suburb"
                  className="form-input"
                />
              </FormField>

              <FormField label="City">
                <input
                  value={form.city}
                  onChange={(event) =>
                    updateForm(
                      "city",
                      event.target.value
                    )
                  }
                  placeholder="City"
                  className="form-input"
                />
              </FormField>

              <FormField label="Province">
                <input
                  value={form.province}
                  onChange={(event) =>
                    updateForm(
                      "province",
                      event.target.value
                    )
                  }
                  placeholder="Gauteng"
                  className="form-input"
                />
              </FormField>

              <FormField label="Postal code">
                <input
                  value={form.postal_code}
                  onChange={(event) =>
                    updateForm(
                      "postal_code",
                      event.target.value
                    )
                  }
                  placeholder="1930"
                  className="form-input"
                />
              </FormField>

            </div>

            {/* SERVICE AREA */}
            <FormField
              label="Service area"
              required
            >
              <textarea
                value={
                  form.service_area_description
                }
                onChange={(event) =>
                  updateForm(
                    "service_area_description",
                    event.target.value
                  )
                }
                placeholder="Describe the area served by this organisation."
                required
                rows={3}
                className="form-input"
              />
            </FormField>

            {/* STATUS */}
            <FormField label="Status">
              <select
                value={form.status}
                onChange={(event) =>
                  updateForm(
                    "status",
                    event.target.value
                  )
                }
                className="form-input"
              >
                <option value="active">
                  Active
                </option>

                <option value="pending">
                  Pending
                </option>

                <option value="paused">
                  Paused
                </option>
              </select>
            </FormField>

            {/* MESSAGES */}
            {createError && (
              <div className="rounded-lg border border-red-200 bg-red-50 p-4 text-sm text-red-700">
                {createError}
              </div>
            )}

            {createSuccess && (
              <div className="rounded-lg border border-green-200 bg-green-50 p-4 text-sm text-green-700">
                {createSuccess}
              </div>
            )}

            {/* ACTIONS */}
            <div className="flex flex-col gap-3 border-t border-[#e2e8ed] pt-5 sm:flex-row sm:justify-end">

              <Button
                type="button"
                variant="outline"
                onClick={() =>
                  setShowCreateForm(false)
                }
              >
                Cancel
              </Button>

              <Button
                type="submit"
                disabled={creating}
              >
                {creating
                  ? "Creating..."
                  : "Create organisation"}
              </Button>

            </div>
          </form>
        </Panel>
      )}

      {/* ORGANISATIONS LIST */}
      {organisations.length === 0 ? (
        <Panel>
          <div className="p-6">
            <p className="font-semibold">
              No organizations found.
            </p>

            <p className="mt-1 text-sm text-[#748693]">
              Organizations created in the system
              will appear here.
            </p>
          </div>
        </Panel>
      ) : (
        <div className="grid gap-4 lg:grid-cols-2">
          {organisations.map((org) => (
            <Panel key={org.id}>

              <PanelHeader
                title={org.name}
                description={formatOrganisationType(
                  org.organisation_type
                )}
                action={
                  <Badge
                    tone={
                      org.status === "active"
                        ? "success"
                        : "warning"
                    }
                  >
                    {formatStatus(org.status)}
                  </Badge>
                }
              />

              <div className="divide-y divide-[#e2e8ed]">

                <div className="flex gap-3 p-4 sm:p-5">
                  <DatabaseZap className="h-5 w-5 text-[#0f5b67]" />

                  <div>
                    <p className="text-xs font-bold uppercase tracking-wide text-[#748693]">
                      Integration
                    </p>

                    <p className="mt-1 font-semibold">
                      {formatIntegrationStatus(
                        org.integration_status
                      )}
                    </p>
                  </div>
                </div>

                <div className="flex gap-3 p-4 sm:p-5">
                  <MapPin className="h-5 w-5 text-[#0f5b67]" />

                  <div>
                    <p className="text-xs font-bold uppercase tracking-wide text-[#748693]">
                      Service area
                    </p>

                    <p className="mt-1 font-semibold">
                      {org.service_area_description}
                    </p>
                  </div>
                </div>

                <div className="flex gap-3 p-4 sm:p-5">
                  <Phone className="h-5 w-5 text-[#0f5b67]" />

                  <div>
                    <p className="text-xs font-bold uppercase tracking-wide text-[#748693]">
                      Operational contact
                    </p>

                    <p className="mt-1 font-semibold">
                      {org.contact_phone ||
                        "Not provided"}
                    </p>
                  </div>
                </div>

              </div>

              <div className="border-t border-[#e2e8ed] p-4">
                <Button
                  variant={
                    org.status === "active"
                      ? "outline"
                      : "success"
                  }
                  className="w-full"
                  onClick={() =>
                    toggleOrganisationStatus(
                      org.id,
                      org.status
                    )
                  }
                >
                  <Power className="h-4 w-4" />

                  {org.status === "active"
                    ? "Pause organisation"
                    : "Restore organisation"}
                </Button>
              </div>

            </Panel>
          ))}
        </div>
      )}
    </div>
  );
}


// ============================================
// FORM FIELD
// ============================================

function FormField({
  label,
  required,
  children,
}: {
  label: string;
  required?: boolean;
  children: React.ReactNode;
}) {
  return (
    <div className="grid gap-2">
      <label className="text-sm font-semibold">
        {label}

        {required && (
          <span className="ml-1 text-red-500">
            *
          </span>
        )}
      </label>

      {children}
    </div>
  );
}


// ============================================
// HELPER FUNCTIONS
// ============================================

function formatOrganisationType(type: string) {
  return type
    .split("_")
    .map(
      (word) =>
        word.charAt(0).toUpperCase() +
        word.slice(1)
    )
    .join(" ");
}

function formatStatus(status: string) {
  return status
    .split("_")
    .map(
      (word) =>
        word.charAt(0).toUpperCase() +
        word.slice(1)
    )
    .join(" ");
}

function formatIntegrationStatus(status: string) {
  return status
    .split("_")
    .map(
      (word) =>
        word.charAt(0).toUpperCase() +
        word.slice(1)
    )
    .join(" ");
}


// ============================================
// UPDATE ORGANISATION STATUS
// ============================================

async function toggleOrganisationStatus(
  organisationId: string,
  currentStatus: string
) {
  const newStatus =
    currentStatus === "active"
      ? "paused"
      : "active";

  try {
    const response = await fetch(
      `/api/admin/organisations/${organisationId}`,
      {
        method: "PATCH",
        headers: {
          "Content-Type": "application/json",
        },
        credentials: "include",
        body: JSON.stringify({
          status: newStatus,
        }),
      }
    );

    const data = await response.json();

    if (!response.ok) {
      throw new Error(
        data.message ||
          "Failed to update organization status."
      );
    }

    window.location.reload();
  } catch (error) {
    console.error(
      "Failed to update organization status:",
      error
    );

    alert(
      error instanceof Error
        ? error.message
        : "Failed to update organization status."
    );
  }
}