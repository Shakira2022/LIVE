"use client";

import {
  Building2,
  DatabaseZap,
  LoaderCircle,
  MapPin,
  Phone,
  Power,
  Plus,
  Search,
} from "lucide-react";

import { FormEvent, useCallback, useEffect, useRef, useState } from "react";

import { useAuth } from "@/components/auth/auth-provider";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Panel, PanelHeader } from "@/components/ui/panel";
import { PageHeading } from "@/components/ui/page-heading";
import { PageSkeleton } from "@/components/ui/skeleton";
import { Input, Select, Textarea } from "@/components/ui/field";
import { readCached, writeFreshCache } from "@/lib/client-cache";
import { Sheet } from "@/components/ui/sheet";
import { TopValidationAlert } from "@/components/ui/top-validation-alert";
import { OrganisationLocationPicker } from "@/components/maps/organisation-location-picker";

type Organisation = {
  id: string;
  name: string;
  organisation_type: string;
  contact_phone: string | null;
  service_area_description: string;
  status: string;
  integration_status: string;
  registration_number?: string | null;
  contact_email?: string | null;
  address_line_1?: string | null;
  address_line_2?: string | null;
  suburb?: string | null;
  city?: string | null;
  province?: string | null;
  postal_code?: string | null;
  latitude?: number | null;
  longitude?: number | null;
};

export default function AdminOrgs() {
  const { user } = useAuth();

  const organisationsCacheKey = user?.id ? `admin-organisations:${user.id}` : null;
  const cachedOrganisations = organisationsCacheKey
    ? readCached<Organisation[]>(organisationsCacheKey)
    : null;

  const [organisations, setOrganisations] = useState<Organisation[]>(() => cachedOrganisations ?? []);
  const [loading, setLoading] = useState(() => !cachedOrganisations);
  const [refreshing, setRefreshing] = useState(false);
  const [error, setError] = useState("");
  const [updatingOrganisationId, setUpdatingOrganisationId] = useState<string | null>(null);
  const hasLoadedOrganisations = useRef(Boolean(cachedOrganisations));
  const manuallyPinnedLocation = useRef(false);
  const addressSearchController = useRef<AbortController | null>(null);

  const [showCreateForm, setShowCreateForm] = useState(false);
  const [editingOrganisationId, setEditingOrganisationId] = useState<string | null>(null);
  const [addressLookupLoading, setAddressLookupLoading] = useState(false);
  const [addressLookupError, setAddressLookupError] = useState("");
  const [creating, setCreating] = useState(false);
  const [createError, setCreateError] = useState("");
  const [createSuccess, setCreateSuccess] = useState("");
  const [missingInfoOpen, setMissingInfoOpen] = useState(false);
  const [missingRequiredFields, setMissingRequiredFields] = useState<string[]>([]);

  const [form, setForm] = useState({
    name: "",
    organisation_type: "medical",
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
    latitude: null as number | null,
    longitude: null as number | null,
  });
  const addressForMap = uniqueAddressParts([
    form.address_line_1,
    form.address_line_2,
    form.suburb,
    form.city,
    form.province,
    form.postal_code,
  ]).join(", ");

  useEffect(() => () => addressSearchController.current?.abort(), []);

  const loadOrganisations = useCallback(async () => {
    if (!user?.id) return;

    const initialLoad = !hasLoadedOrganisations.current;
    if (initialLoad) setLoading(true);
    else setRefreshing(true);

    try {
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
      const next = Array.isArray(nextOrganisations) ? nextOrganisations : [];
      if (organisationsCacheKey) writeFreshCache(organisationsCacheKey, next, 5 * 60_000);
    } catch (error) {
      console.error("Failed to load organizations:", error);

      setError(
        error instanceof Error
          ? error.message
          : "Failed to load organizations."
      );
    } finally {
      hasLoadedOrganisations.current = true;
      setLoading(false);
      setRefreshing(false);
    }
  }, [organisationsCacheKey, user?.id]);

  useEffect(() => {
    void loadOrganisations();
  }, [loadOrganisations]);

  function updateForm(
    field: string,
    value: string
  ) {
    setForm((previous) => ({
      ...previous,
      [field]: value,
      ...(["address_line_1", "address_line_2", "suburb", "city", "province", "postal_code"].includes(field)
        ? { latitude: null, longitude: null }
        : {}),
    }));
    if (["address_line_1", "address_line_2", "suburb", "city", "province", "postal_code"].includes(field)) {
      addressSearchController.current?.abort();
      addressSearchController.current = null;
      setAddressLookupLoading(false);
      manuallyPinnedLocation.current = false;
    }
  }

  async function searchAddressOnMap() {
    if (!form.address_line_1.trim()) {
      setAddressLookupError("Enter Address line 1 before searching the map.");
      return;
    }

    addressSearchController.current?.abort();
    const controller = new AbortController();
    addressSearchController.current = controller;
    manuallyPinnedLocation.current = false;
    setAddressLookupLoading(true);
    setAddressLookupError("");

    const addressLineParts = [form.address_line_1, form.address_line_2];
    const queryParts = [
      addressLineParts,
      [...addressLineParts, form.suburb],
      [...addressLineParts, form.suburb, form.city, form.province, form.postal_code],
    ];

    try {
      let match: { lat: string; lon: string } | undefined;
      for (const parts of queryParts) {
        const query = uniqueAddressParts([...parts, "South Africa"]).join(", ");
        const url = new URL("https://nominatim.openstreetmap.org/search");
        url.search = new URLSearchParams({ q: query, format: "jsonv2", limit: "1", countrycodes: "za" }).toString();
        const response = await fetch(url, { signal: controller.signal, headers: { Accept: "application/json" } });
        if (!response.ok) throw new Error("Address lookup is temporarily unavailable.");
        const results: Array<{ lat: string; lon: string }> = await response.json();
        if (results[0]) {
          match = results[0];
          break;
        }
      }

      if (!match) throw new Error("Could not find address on the map. Add the suburb or city and search again, or move the map pin to the correct place.");
      if (!manuallyPinnedLocation.current && !controller.signal.aborted) {
        setForm((current) => ({ ...current, latitude: Number(match!.lat), longitude: Number(match!.lon) }));
      }
    } catch (lookupError) {
      if (!controller.signal.aborted) {
        setAddressLookupError(lookupError instanceof Error ? lookupError.message : "Unable to find this address.");
      }
    } finally {
      if (!controller.signal.aborted) {
        setAddressLookupLoading(false);
        addressSearchController.current = null;
      }
    }
  }

  function openCreateOrganisation() {
    addressSearchController.current?.abort();
    addressSearchController.current = null;
    setAddressLookupLoading(false);
    setEditingOrganisationId(null);
    manuallyPinnedLocation.current = false;
    setCreateError("");
    setCreateSuccess("");
    setAddressLookupError("");
    setForm({
      name: "", organisation_type: "medical", registration_number: "", contact_email: "",
      contact_phone: "", address_line_1: "", address_line_2: "", suburb: "", city: "", province: "",
      postal_code: "", service_area_description: "", status: "active", latitude: null, longitude: null,
    });
    setShowCreateForm(true);
  }

  async function createOrganisation(
    event: FormEvent<HTMLFormElement>
  ) {
    event.preventDefault();

    const missing = [
      !form.name.trim() ? "Organisation name" : null,
      !form.organisation_type.trim() ? "Organisation type" : null,
      !form.service_area_description.trim() ? "Service area" : null,
      !form.address_line_1.trim() ? "Street address" : null,
      !form.city.trim() ? "City" : null,
      !form.province.trim() ? "Province" : null,
      form.latitude === null || form.longitude === null ? "Map pin location" : null,
      form.latitude !== null && (form.latitude < -35 || form.latitude > -22) ? "South African map latitude" : null,
      form.longitude !== null && (form.longitude < 16 || form.longitude > 33) ? "South African map longitude" : null,
    ].filter((field): field is string => Boolean(field));

    if (missing.length > 0) {
      setMissingRequiredFields(missing);
      setMissingInfoOpen(true);
      return;
    }

    if (form.contact_email.trim() && !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(form.contact_email.trim())) {
      setCreateError("Enter a valid contact email address, or leave the field empty.");
      return;
    }

    setCreating(true);
    setCreateError("");
    setCreateSuccess("");

    try {
      const response = await fetch(
        editingOrganisationId
          ? `/api/admin/organisations/${editingOrganisationId}`
          : "/api/admin/organisations",
        {
          method: editingOrganisationId ? "PATCH" : "POST",
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
          data?.error?.message ||
            data?.message ||
            "Failed to create organization."
        );
      }

      setCreateSuccess(editingOrganisationId ? "Organisation updated successfully." : "Organisation created successfully.");

      setForm({
        name: "",
        organisation_type: "medical",
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
        latitude: null,
        longitude: null,
      });
      setEditingOrganisationId(null);

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

  function openEditOrganisation(organisation: Organisation) {
    addressSearchController.current?.abort();
    addressSearchController.current = null;
    setAddressLookupLoading(false);
    manuallyPinnedLocation.current = true;
    setEditingOrganisationId(organisation.id);
    setCreateError("");
    setCreateSuccess("");
    setAddressLookupError("");
    setForm({
      name: organisation.name,
      organisation_type: responseTypeForEdit(organisation.organisation_type),
      registration_number: organisation.registration_number ?? "",
      contact_email: organisation.contact_email ?? "",
      contact_phone: organisation.contact_phone ?? "",
      address_line_1: organisation.address_line_1 ?? "",
      address_line_2: organisation.address_line_2 ?? "",
      suburb: organisation.suburb ?? "",
      city: organisation.city ?? "",
      province: organisation.province ?? "",
      postal_code: organisation.postal_code ?? "",
      service_area_description: organisation.service_area_description ?? "",
      status: organisation.status === "active" ? "active" : "paused",
      latitude: organisation.latitude == null ? null : Number(organisation.latitude),
      longitude: organisation.longitude == null ? null : Number(organisation.longitude),
    });
    setShowCreateForm(true);
  }

  async function toggleOrganisationStatus(organisation: Organisation) {
    const newStatus = organisation.status === "active" ? "paused" : "active";
    if (updatingOrganisationId) return;

    setUpdatingOrganisationId(organisation.id);
    setError("");
    try {
      const response = await fetch(`/api/admin/organisations/${organisation.id}`, {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        credentials: "include",
        body: JSON.stringify({ status: newStatus }),
      });
      const data = await response.json();
      if (!response.ok) {
        throw new Error(data?.error?.message || data?.message || "Failed to update organisation status.");
      }

      const updatedOrganisation = data?.data?.organisation ?? data?.organisation;
      setOrganisations((current) => current.map((item) => item.id === organisation.id
        ? { ...item, ...(updatedOrganisation ?? {}), status: newStatus }
        : item));
      if (organisationsCacheKey) {
        const cached = readCached<Organisation[]>(organisationsCacheKey) ?? organisations;
        writeFreshCache(organisationsCacheKey, cached.map((item) => item.id === organisation.id
          ? { ...item, ...(updatedOrganisation ?? {}), status: newStatus }
          : item), 5 * 60_000);
      }
    } catch (updateError) {
      setError(updateError instanceof Error ? updateError.message : "Failed to update organisation status.");
    } finally {
      setUpdatingOrganisationId(null);
    }
  }

  if (!user || (loading && organisations.length === 0)) {
    return <PageSkeleton />;
  }

  if (error && organisations.length === 0) {
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
          onClick={openCreateOrganisation}
        >
          <Plus className="h-4 w-4" />
          Add organisation
        </Button>
      </div>

      {refreshing ? <p className="text-xs font-medium text-[#718490]" role="status" aria-live="polite">Refreshing organisation data…</p> : null}
      {error && organisations.length > 0 ? <div role="alert" className="rounded-lg border border-[#efc9c7] bg-[#ffefee] px-4 py-3 text-sm text-[#a93331]">{error}</div> : null}

      {/* CREATE ORGANISATION MODAL */}
      <Sheet
        open={showCreateForm}
        onOpenChange={(open) => {
          if (!creating) {
            setShowCreateForm(open);
            if (!open) setMissingInfoOpen(false);
          }
        }}
        title={editingOrganisationId ? "Edit organisation" : "Add organisation"}
        description={editingOrganisationId ? "Update this organisation's details, service type, address and map location." : "Create a response organisation and confirm its address on the map."}
        side="center"
        dismissible={!creating}
        className="max-h-[94dvh] w-[calc(100%-1rem)] max-w-[96vw] rounded-2xl border border-[#dfe7ec] bg-white shadow-2xl"
        scrollAreaClassName="p-5 sm:p-6"
        footer={(
          <div className="flex flex-col gap-3 sm:flex-row sm:justify-end">
            <Button
              type="button"
              variant="outline"
              disabled={creating}
              onClick={() => setShowCreateForm(false)}
            >
              Cancel
            </Button>
            <Button
              type="submit"
              form="create-organisation-form"
              disabled={creating}
            >
              {creating ? (editingOrganisationId ? "Saving..." : "Creating...") : (editingOrganisationId ? "Save changes" : "Create organisation")}
            </Button>
          </div>
        )}
      >
        <form
          id="create-organisation-form"
          noValidate
          onSubmit={createOrganisation}
          className="grid gap-5"
        >

          <div className="grid gap-6 xl:grid-cols-[minmax(0,0.9fr)_minmax(520px,1.1fr)]">
            <div className="grid content-start gap-5">

            {/* NAME + TYPE */}
            <div className="grid gap-4 md:grid-cols-2">

              <FormField
                label="Organisation name"
                required
              >
                <Input
                  value={form.name}
                  onChange={(event) =>
                    updateForm(
                      "name",
                      event.target.value
                    )
                  }
                  placeholder="e.g. Vaal Medical Hospital"
                  required
                />
              </FormField>

              <FormField
                label="Organisation type"
                required
              >
                <Select required
                  value={form.organisation_type}
                  onChange={(event) =>
                    updateForm(
                      "organisation_type",
                      event.target.value
                    )
                  }
                >
                  <option value="">Choose an organisation response type</option>
                  <option value="medical">
                    Medical
                  </option>
                  <option value="firefighter">
                    Firefighter
                  </option>
                  <option value="police">
                    Police
                  </option>
                </Select>
              </FormField>
            </div>

            {/* REGISTRATION */}
            <FormField label="Registration number">
              <Input
                value={form.registration_number}
                onChange={(event) =>
                  updateForm(
                    "registration_number",
                    event.target.value
                  )
                }
                placeholder="Optional"
              />
            </FormField>

            {/* CONTACT */}
            <div className="grid gap-4 md:grid-cols-2">

              <FormField label="Contact email">
                <Input
                  type="email"
                  value={form.contact_email}
                  onChange={(event) =>
                    updateForm(
                      "contact_email",
                      event.target.value
                    )
                  }
                  placeholder="organisation@example.com"
                />
              </FormField>

              <FormField label="Contact phone">
                <Input
                  value={form.contact_phone}
                  onChange={(event) =>
                    updateForm(
                      "contact_phone",
                      event.target.value
                    )
                  }
                  placeholder="016 000 0000"
                />
              </FormField>

            </div>

            {/* ADDRESS */}
            <FormField label="Address line 1">
              <Input
                value={form.address_line_1}
                onChange={(event) =>
                  updateForm(
                    "address_line_1",
                    event.target.value
                  )
                }
                placeholder="Street number and name (e.g. 36 Fortuna Avenue)"
              />
            </FormField>

            <FormField label="Address line 2">
              <Input
                value={form.address_line_2}
                onChange={(event) =>
                  updateForm(
                    "address_line_2",
                    event.target.value
                  )
                }
                placeholder="Building / unit (optional)"
              />
            </FormField>

            {/* LOCATION */}
            <div className="grid gap-4 md:grid-cols-2">

              <FormField label="Suburb">
                <Input
                  value={form.suburb}
                  onChange={(event) =>
                    updateForm(
                      "suburb",
                      event.target.value
                    )
                  }
                  placeholder="Suburb"
                />
              </FormField>

              <FormField label="City">
                <Input
                  value={form.city}
                  onChange={(event) =>
                    updateForm(
                      "city",
                      event.target.value
                    )
                  }
                  placeholder="City"
                />
              </FormField>

              <FormField label="Province">
                <Input
                  value={form.province}
                  onChange={(event) =>
                    updateForm(
                      "province",
                      event.target.value
                    )
                  }
                  placeholder="Gauteng"
                />
              </FormField>

              <FormField label="Postal code">
                <Input
                  value={form.postal_code}
                  onChange={(event) =>
                    updateForm(
                      "postal_code",
                      event.target.value
                    )
                  }
                  placeholder="1930"
                />
              </FormField>

            </div>

            {/* SERVICE AREA */}
            <FormField
              label="Service area"
              required
            >
              <Textarea
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
              />
            </FormField>

            </div>

            <section className="grid content-start gap-3" aria-label="Confirm organisation map location">
              <div>
                <h3 className="text-sm font-bold text-[#18364a]">Confirm the organisation location</h3>
                <p className="mt-1 text-xs leading-5 text-[#718490]">We use this pin to find the closest eligible organisation. Drag it to the actual station, hospital or base entrance if the address lookup is off.</p>
              </div>
              <div className="rounded-lg border border-[#dfe7ec] bg-white px-3 py-2.5">
                <p className="text-[11px] font-bold uppercase tracking-wide text-[#718490]">Address shown on this map</p>
                <p className="mt-1 text-sm font-semibold text-[#18364a]">{addressForMap || "Enter the organisation address to preview it here."}</p>
              </div>
              <OrganisationLocationPicker
                point={form.latitude !== null && form.longitude !== null ? { latitude: form.latitude, longitude: form.longitude } : null}
                loading={addressLookupLoading}
                errorMessage={addressLookupError}
                onChange={(point) => {
                  manuallyPinnedLocation.current = true;
                  setForm((current) => ({ ...current, latitude: point.latitude, longitude: point.longitude }));
                }}
              />
              <div className="grid gap-2">
                <Button type="button" variant="outline" onClick={() => void searchAddressOnMap()} disabled={addressLookupLoading || !form.address_line_1.trim()}>
                  {addressLookupLoading ? <LoaderCircle className="h-4 w-4 animate-spin" /> : <Search className="h-4 w-4" />}
                  {addressLookupLoading ? "Searching address…" : "Search address on map"}
                </Button>
                <p className="text-xs text-[#718490]">Enter the street address in line 1. Search checks lines 1 and 2 first, then adds suburb and city details if needed.</p>
              </div>
              {form.latitude !== null && form.longitude !== null ? (
                <p className="text-xs text-[#718490]">Pinned coordinates: {form.latitude.toFixed(6)}, {form.longitude.toFixed(6)}</p>
              ) : <p className="text-xs font-semibold text-[#a93331]">Set an address and confirm a pin before saving.</p>}
            </section>
          </div>

            {/* STATUS */}
            <FormField label="Status">
              <Select
                value={form.status}
                onChange={(event) =>
                  updateForm(
                    "status",
                    event.target.value
                  )
                }
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
              </Select>
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

        </form>
      </Sheet>

      <TopValidationAlert
        open={missingInfoOpen}
        onClose={() => setMissingInfoOpen(false)}
        items={missingRequiredFields}
        autoDismissMs={6000}
      />

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
        <div role="region" aria-label="Organisations list" tabIndex={0} className="max-h-[65vh] touch-pan-y overscroll-contain overflow-y-auto pr-1">
        <div className="grid gap-4 lg:grid-cols-2">
          {organisations.map((org) => (
            <Panel key={org.id} aria-busy={updatingOrganisationId === org.id} className={updatingOrganisationId === org.id ? "opacity-70" : undefined}>

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

              <div className="grid grid-cols-2 gap-2 border-t border-[#e2e8ed] p-4">
                <Button variant="outline" disabled={updatingOrganisationId !== null} onClick={() => openEditOrganisation(org)}>
                  Edit organisation
                </Button>
                <Button
                  variant={
                    org.status === "active"
                      ? "outline"
                      : "success"
                  }
                  className="w-full"
                  disabled={updatingOrganisationId !== null}
                  onClick={() =>
                    void toggleOrganisationStatus(org)
                  }
                >
                  {updatingOrganisationId === org.id
                    ? <><LoaderCircle className="h-4 w-4 animate-spin" />{org.status === "active" ? "Pausing" : "Resuming"} organisation…</>
                    : <><Power className="h-4 w-4" />{org.status === "active" ? "Pause organisation" : "Restore organisation"}</>}
                </Button>
              </div>

            </Panel>
          ))}
        </div>
        </div>
      )}
    </div>
  );
}

function uniqueAddressParts(values: string[]) {
  const seen = new Set<string>();
  const result: string[] = [];
  for (const value of values) {
    for (const part of value.split(",").map((item) => item.trim()).filter(Boolean)) {
      const key = part.toLocaleLowerCase();
      if (seen.has(key)) continue;
      seen.add(key);
      result.push(part);
    }
  }
  return result;
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
  const labels: Record<string, string> = {
    medical: "Medical",
    firefighter: "Firefighter",
    police: "Police",
    hospital: "Medical / Hospital",
    emergency_response: "Needs response type selection",
    fire: "Firefighter (legacy type)",
    fire_service: "Firefighter (legacy type)",
    police_service: "Police",
  };
  if (labels[type]) return labels[type];
  return type
    .split("_")
    .map(
      (word) =>
        word.charAt(0).toUpperCase() +
        word.slice(1)
    )
    .join(" ");
}

function responseTypeForEdit(type: string) {
  if (type === "medical" || type === "firefighter" || type === "police") return type;
  if (type === "hospital") return "medical";
  if (type === "fire" || type === "fire_service") return "firefighter";
  if (type === "police_service") return "police";
  // A generic emergency_response record cannot be safely classified without
  // an administrator choosing its actual response service.
  return "";
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
