"use client";

/**
 * LiveResponseMap
 *
 * A real, interactive street / satellite map (Leaflet) that replaces the
 * previous hand-drawn SVG illustration. It keeps the exact same props, so
 * every page that already renders <LiveResponseMap /> keeps working.
 *
 *  - "Map" view uses OpenStreetMap street tiles.
 *  - "Satellite" view uses Esri World Imagery with road + place-name overlays.
 *  - Incident, responder and "my location" markers sit at real coordinates.
 *  - When a responder is known, a road-following route is drawn using the
 *    public OSRM router (falls back to a straight dashed line if offline).
 *
 * No API key or billing account is required. Leaflet touches `window`, so it
 * is imported lazily inside an effect to stay safe during server rendering.
 */

import "leaflet/dist/leaflet.css";

import type * as Leaflet from "leaflet";
import {
  Crosshair,
  Layers3,
  LocateFixed,
  LoaderCircle,
  Minus,
  Plus,
} from "lucide-react";
import {
  useCallback,
  useEffect,
  useMemo,
  useRef,
  useState,
  type ReactNode,
} from "react";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import type {
  EmergencyRequest,
  Responder,
} from "@/lib/types";
import { cn } from "@/lib/utils";
import { requesterText } from "@/lib/requester-ui";
import type { RequesterLanguage } from "@/lib/requester-language";

type PreviewLocation = {
  lat: number;
  lng: number;
  address?: string;
  accuracy?: number;
};

type LiveResponseMapProps = {
  request?: EmergencyRequest;
  uiLanguage?: RequesterLanguage;
  responder?: Pick<Responder, "location"> &
    Partial<Pick<Responder, "name" | "team" | "vehicle">>;
  responderAssigned?: boolean;
  responderName?: string;
  responderStatus?: string;
  responderDistanceMetres?: number | null;
  showMyLocation?: boolean;
  requesterName?: string;
  emptyMapMessage?: string;
  responderMode?: boolean;
  onResponderLocationChange?: (location: LatLng) => void;
  immersive?: boolean;
  showAll?: boolean;
  requests?: EmergencyRequest[];
  onIncidentSelect?: (request: EmergencyRequest) => void;
  responders?: Array<Pick<Responder, "location"> &
    Partial<Pick<Responder, "id" | "name" | "team" | "vehicle" | "availability">>>;
  operationalRoutes?: Array<{
    requestId: string;
    responder: Pick<Responder, "location"> &
      Partial<Pick<Responder, "id" | "name" | "team" | "vehicle">>;
  }>;
  mobileAction?: ReactNode;
  landingPreview?: boolean;
  previewLocation?: PreviewLocation;
  previewLocationLabel?: string;
  previewLocationMarker?: "requester" | "responder";
  compactRequestDetails?: boolean;
  hideActiveRequestDetails?: boolean;
  hideActiveRequestDetailsMobile?: boolean;
  mobileBottomOffset?: boolean;
  hideMapStatus?: boolean;
  mapStatusOffsetClassName?: string;
  mapControlsOffsetClassName?: string;
  fallbackCenter?: LatLng | null;
  className?: string;
};

type LatLng = { lat: number; lng: number };
type BaseLayer = "map" | "satellite";

function responderIdentity(value: unknown) {
  return typeof value === "string" ? value.trim().toLowerCase() : "";
}

/* ------------------------------------------------------------------------ */
/* Configuration                                                             */
/* ------------------------------------------------------------------------ */

/** Last resort only. Staff maps supply an organisation-specific fallback centre. */
const DEFAULT_CENTER: LatLng = { lat: -26.2041, lng: 28.0473 };
const DEFAULT_ZOOM = 12;

const TILES = {
  // Street view: OpenStreetMap standard tiles - free, no API key.
  map: {
    url:
      process.env.NEXT_PUBLIC_MAP_TILE_URL ||
      "https://tile.openstreetmap.org/{z}/{x}/{y}.png",
    attribution:
      '&copy; <a href="https://www.openstreetmap.org/copyright">OpenStreetMap</a> contributors',
    maxZoom: 19,
  },
  // Satellite view: Esri World Imagery - free, no API key.
  satellite: {
    url: "https://server.arcgisonline.com/ArcGIS/rest/services/World_Imagery/MapServer/tile/{z}/{y}/{x}",
    attribution: "Imagery &copy; Esri, Maxar, Earthstar Geographics",
    maxZoom: 19,
  },
  // Road + place-name overlays drawn on top of the satellite imagery.
  labels: [
    "https://server.arcgisonline.com/ArcGIS/rest/services/Reference/World_Transportation/MapServer/tile/{z}/{y}/{x}",
    "https://server.arcgisonline.com/ArcGIS/rest/services/Reference/World_Boundaries_and_Places/MapServer/tile/{z}/{y}/{x}",
  ],
} as const;

const ROUTER_URL =
  process.env.NEXT_PUBLIC_ROUTER_URL ||
  "https://router.project-osrm.org/route/v1/driving";

/* ------------------------------------------------------------------------ */
/* Helpers                                                                   */
/* ------------------------------------------------------------------------ */

function toLatLng(value: unknown): LatLng | null {
  if (!value || typeof value !== "object") return null;
  const v = value as Record<string, unknown>;
  const lat = Number(v.lat ?? v.latitude);
  const lng = Number(v.lng ?? v.longitude);
  if (!Number.isFinite(lat) || !Number.isFinite(lng)) return null;
  if (lat === 0 && lng === 0) return null;
  if (Math.abs(lat) > 90 || Math.abs(lng) > 180) return null;
  return { lat, lng };
}

function requestLocationValue(request: unknown): unknown {
  if (!request || typeof request !== "object") return null;
  const value = request as Record<string, unknown>;
  if (value.location) return value.location;
  const locations = value.request_locations;
  return Array.isArray(locations) ? locations[0] : locations;
}

function requestLocationAddress(request: unknown): string | null {
  if (!request || typeof request !== "object") return null;
  const value = request as Record<string, unknown>;
  const locations = Array.isArray(value.request_locations)
    ? value.request_locations
    : value.request_locations
      ? [value.request_locations]
      : [];
  const candidates = [value.location, ...locations, value];

  for (const candidate of candidates) {
    if (!candidate || typeof candidate !== "object") continue;
    const location = candidate as Record<string, unknown>;
    const address = location.address ?? location.addressText ?? location.address_text ?? location.landmark;
    if (typeof address === "string" && address.trim() && address !== "Current device location" && address !== "Emergency request location") {
      return address.trim();
    }
  }
  return null;
}

const formatCoordinate = (value: unknown, decimals = 6): string => {
  const number = Number(value);
  return Number.isFinite(number)
    ? number.toFixed(decimals)
    : "Location unavailable";
};

function formatDistance(metres: number): string {
  return metres < 1000
    ? `${Math.round(metres)} m`
    : `${(metres / 1000).toFixed(1)} km`;
}
function escapeHtml(text: string): string {
  return text
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;");
}

function isLiveLeafletMap(map: Leaflet.Map | null): map is Leaflet.Map {
  if (!map) return false;
  try {
    return Boolean(map.getContainer()?.isConnected);
  } catch {
    return false;
  }
}

/** Road-following route from the public OSRM router. Null on any failure. */
async function fetchRoute(
  from: LatLng,
  to: LatLng,
  signal: AbortSignal
): Promise<{ points: LatLng[]; metres: number; seconds: number } | null> {
  try {
    const res = await fetch(
      `${ROUTER_URL}/${from.lng},${from.lat};${to.lng},${to.lat}?overview=full&geometries=geojson`,
      { signal }
    );
    if (!res.ok) return null;
    const data = await res.json();
    const route = data?.routes?.[0];
    const coords: [number, number][] | undefined =
      route?.geometry?.coordinates;
    if (!coords?.length) return null;
    return {
      points: coords.map(([lng, lat]) => ({ lat, lng })),
      metres: Number(route.distance) || 0,
      seconds: Number(route.duration) || 0,
    };
  } catch {
    return null;
  }
}

/* Marker HTML (Leaflet divIcons, styled inline so no image assets needed). */

const incidentIconHtml = (large: boolean, bouncing = false, cancellationRequested = false) => {
  const size = large ? 46 : 38;
  const color = cancellationRequested ? "#b97018" : "#d53f3d";
  const ring = cancellationRequested ? "rgba(185,112,24,.35)" : "rgba(213,63,61,.35)";
  const center = cancellationRequested
    ? '<text x="12" y="16" text-anchor="middle" font-size="13" font-weight="800" font-family="system-ui,sans-serif" fill="#ffffff">!</text>'
    : '<circle cx="12" cy="11.5" r="4.4" fill="#ffffff"/>';
  return `
  <div class="${bouncing ? "map-pin-bounce" : ""}" style="position:relative;width:${size}px;height:${size + 10}px;">
    <span class="pulse-ring" style="position:absolute;left:${size / 2 - 14}px;bottom:-4px;width:28px;height:28px;border-radius:9999px;background:${ring};"></span>
    <svg width="${size}" height="${size + 10}" viewBox="0 0 24 30" style="position:relative;filter:drop-shadow(0 6px 8px rgba(120,20,20,.35));">
      <path d="M12 0C5.4 0 0 5.2 0 11.7 0 20.4 12 30 12 30s12-9.6 12-18.3C24 5.2 18.6 0 12 0z" fill="${color}" stroke="#ffffff" stroke-width="1.6"/>
      ${center}
    </svg>
  </div>`;
};

const userIconHtml = `
  <div style="position:relative;width:22px;height:22px;">
    <span class="pulse-ring" style="position:absolute;inset:-6px;border-radius:9999px;background:rgba(26,115,232,.28);"></span>
    <span style="position:absolute;inset:0;border-radius:9999px;background:#1a73e8;border:3px solid #fff;box-shadow:0 2px 6px rgba(0,0,0,.35);"></span>
  </div>`;

const availableResponderIconHtml = `
  <div style="position:relative;width:30px;height:30px;">
    <span style="position:absolute;inset:-5px;border-radius:9999px;background:rgba(31,132,91,.20);"></span>
    <span style="position:absolute;inset:3px;border-radius:9999px;background:#1f845b;border:3px solid #fff;box-shadow:0 2px 6px rgba(0,0,0,.35);"></span>
    <span style="position:absolute;left:10px;top:10px;width:6px;height:6px;border-radius:9999px;background:#fff;"></span>
  </div>`;

/* ------------------------------------------------------------------------ */
/* Component                                                                 */
/* ------------------------------------------------------------------------ */

export function LiveResponseMap({
  request,
  uiLanguage,
  responder,
  responderAssigned = false,
  responderName,
  responderStatus,
  responderDistanceMetres,
  showMyLocation = true,
  requesterName,
  emptyMapMessage,
  responderMode = false,
  onResponderLocationChange,
  immersive = false,
  showAll = false,
  requests = [],
  onIncidentSelect,
  responders = [],
  operationalRoutes = [],
  mobileAction,
  landingPreview = false,
  previewLocation,
  previewLocationLabel,
  previewLocationMarker = "requester",
  hideActiveRequestDetails = false,
  hideActiveRequestDetailsMobile = false,
  hideMapStatus = false,
  mapStatusOffsetClassName,
  mapControlsOffsetClassName,
  fallbackCenter,
  className,
}: LiveResponseMapProps) {
  const containerRef = useRef<HTMLDivElement | null>(null);
  const LRef = useRef<typeof Leaflet | null>(null);
  const mapRef = useRef<Leaflet.Map | null>(null);
  const baseLayerRef = useRef<Leaflet.Layer[]>([]);
  const dataLayerRef = useRef<Leaflet.LayerGroup | null>(null);
  const routeLayerRef = useRef<Leaflet.LayerGroup | null>(null);
  const operationalRouteLayerRef = useRef<Leaflet.LayerGroup | null>(null);
  const operationalRouteCacheRef = useRef(
    new Map<string, { points: LatLng[]; metres: number; seconds: number }>(),
  );
  const userLayerRef = useRef<Leaflet.LayerGroup | null>(null);
  const responderMarkerRef = useRef<Leaflet.Marker | null>(null);
  const lastFitKeyRef = useRef<string>("");
  const locationUpdateInFlightRef = useRef(false);
  const lastLocationUpdateAtRef = useRef(0);

  const [ready, setReady] = useState(false);
  const [mapLoading, setMapLoading] = useState(true);
  const [baseLayer, setBaseLayer] = useState<BaseLayer>("map");
  const [selectedIncidentId, setSelectedIncidentId] = useState<string | null>(null);
  const [selectedOperationalRouteId, setSelectedOperationalRouteId] = useState<string | null>(null);
  const [selectedOperationalEta, setSelectedOperationalEta] = useState<{ metres: number; seconds: number } | null>(null);
  const [route, setRoute] = useState<{
    points: LatLng[];
    metres: number;
    seconds: number;
    exact: boolean;
  } | null>(null);
  const [locating, setLocating] = useState(false);
  const [userPosition, setUserPosition] = useState<LatLng | null>(null);

  /* ---------------------------------------------------------------- */
  /* Work out what needs to be shown                                    */
  /* ---------------------------------------------------------------- */

  const incidents = useMemo(() => {
    const list = landingPreview
      ? request
        ? [request]
        : []
      : showAll
        ? requests
        : request
          ? [request]
          : [];
    const available = list
      .map((item) => ({ item, pos: toLatLng(requestLocationValue(item)) }))
      .filter(
        (entry): entry is { item: EmergencyRequest; pos: LatLng } =>
          entry.pos !== null
      );
    // Selecting a request should open its popup, not remove the other
    // requests and force the map to zoom into the incident.
    return available;
  }, [landingPreview, showAll, requests, request, selectedIncidentId, uiLanguage]);

  useEffect(() => {
    setSelectedIncidentId(null);
  }, [request?.id]);

  useEffect(() => {
    if (!selectedOperationalRouteId) return;
    if (!operationalRoutes.some((entry) => entry.requestId === selectedOperationalRouteId)) {
      setSelectedOperationalRouteId(null);
      setSelectedOperationalEta(null);
    }
  }, [operationalRoutes, selectedOperationalRouteId]);

  const previewPos = useMemo(
    () => toLatLng(previewLocation),
    [previewLocation]
  );

  /** Primary incident location (used for routing). */
  const target: LatLng | null = useMemo(() => {
    if (incidents[0]) return incidents[0].pos;
    if (previewPos) return previewPos;
    if (landingPreview) return DEFAULT_CENTER;
    return null;
  }, [incidents, previewPos, landingPreview]);

  /** Responder position (landing page invents one nearby if needed). */
  const responderPos: LatLng | null = useMemo(() => {
    const real = toLatLng(responder?.location);
    // Use the live browser GPS when available, but keep the last known mission
    // position as the route origin while mobile GPS permission/location loads.
    if (responderMode) return userPosition ?? real;
    if (!showAll && request && real) return real;
    if (landingPreview && target) {
      return real ?? { lat: target.lat + 0.018, lng: target.lng + 0.022 };
    }
    return null;
  }, [responder, responderMode, userPosition, request, showAll, landingPreview, target]);

  const lastKnownResponderPos = useMemo(
    () => toLatLng(responder?.location),
    [responder],
  );

  const responderPositions = useMemo(() => {
    const assignedResponderIds = new Set(
      operationalRoutes.map((entry) => responderIdentity(entry.responder.id)).filter(Boolean),
    );
    return responders
      .filter((item) => !assignedResponderIds.has(responderIdentity(item.id)))
      .map((item) => ({ item, pos: toLatLng(item.location) }))
      .filter((entry): entry is { item: (typeof responders)[number]; pos: LatLng } => entry.pos !== null);
  }, [operationalRoutes, responders]);

  /* ---------------------------------------------------------------- */
  /* Create the map once                                                */
  /* ---------------------------------------------------------------- */

  useEffect(() => {
    let cancelled = false;

    (async () => {
      const mod = await import("leaflet");
      const L = ((mod as unknown as { default?: typeof Leaflet }).default ??
        mod) as typeof Leaflet;
      if (cancelled || !containerRef.current || mapRef.current) return;

      LRef.current = L;

      // When the map opens on an existing incident, start at that known point.
      // The organisation centre is only the initial fallback if no request pin
      // is available yet.
      const initialCenter = incidents[0]?.pos ?? previewPos ?? fallbackCenter ?? DEFAULT_CENTER;
      const map = L.map(containerRef.current, {
        center: [initialCenter.lat, initialCenter.lng],
        zoom: DEFAULT_ZOOM,
        zoomControl: false,
        attributionControl: true,
        scrollWheelZoom: !landingPreview,
        dragging: !landingPreview || !L.Browser.mobile,
        tap: false,
      } as Leaflet.MapOptions);

      map.attributionControl.setPrefix(false);
      map.attributionControl.setPosition("topleft");

      // Street names drawn over satellite imagery sit above tiles but below
      // routes and markers, and never block clicks.
      const labelsPane = map.createPane("labels");
      labelsPane.style.zIndex = "350";
      labelsPane.style.pointerEvents = "none";

      dataLayerRef.current = L.layerGroup().addTo(map);
      routeLayerRef.current = L.layerGroup().addTo(map);
      operationalRouteLayerRef.current = L.layerGroup().addTo(map);
      userLayerRef.current = L.layerGroup().addTo(map);
      mapRef.current = map;
      setMapLoading(true);

      // Leaflet needs a size recalculation when its container is resized
      // (mobile sheets, responsive grids, etc).
      const observer = new ResizeObserver(() => {
        if (mapRef.current === map && map.getContainer()?.isConnected) map.invalidateSize();
      });
      observer.observe(containerRef.current);
      (map as unknown as { _liveObserver: ResizeObserver })._liveObserver =
        observer;

      setReady(true);
    })();

    return () => {
      cancelled = true;
      const map = mapRef.current;
      mapRef.current = null;
      if (map) {
        (
          map as unknown as { _liveObserver?: ResizeObserver }
        )._liveObserver?.disconnect();
        map.stop();
        map.remove();
      }
      mapRef.current = null;
      responderMarkerRef.current = null;
      operationalRouteLayerRef.current = null;
      baseLayerRef.current = [];
      lastFitKeyRef.current = "";
      setReady(false);
      setMapLoading(true);
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  /* ---------------------------------------------------------------- */
  /* Base layer (map / satellite)                                       */
  /* ---------------------------------------------------------------- */

  useEffect(() => {
    const L = LRef.current;
    const map = mapRef.current;
    if (!ready || !L || !map) return;

    baseLayerRef.current.forEach((layer) => map.removeLayer(layer));
    setMapLoading(true);

    baseLayerRef.current =
      baseLayer === "map"
        ? [
            L.tileLayer(TILES.map.url, {
              maxZoom: TILES.map.maxZoom,
              attribution: TILES.map.attribution,
            }),
          ]
        : [
            L.tileLayer(TILES.satellite.url, {
              maxZoom: TILES.satellite.maxZoom,
              attribution: TILES.satellite.attribution,
            }),
            ...TILES.labels.map((url) =>
              L.tileLayer(url, { maxZoom: 19, pane: "labels" })
            ),
          ];

    baseLayerRef.current.forEach((layer) => {
      layer.addTo(map);
      (layer as Leaflet.TileLayer).bringToBack?.();
    });
    const primaryLayer = baseLayerRef.current[0] as Leaflet.TileLayer | undefined;
    let settled = false;
    const finishLoading = () => {
      if (settled) return;
      settled = true;
      setMapLoading(false);
    };
    primaryLayer?.once("load", finishLoading);
    const fallbackTimer = window.setTimeout(finishLoading, 8_000);
    return () => window.clearTimeout(fallbackTimer);
  }, [ready, baseLayer]);

  /* ---------------------------------------------------------------- */
  /* Incident / preview markers + fitting the view                      */
  /* ---------------------------------------------------------------- */

  useEffect(() => {
    const L = LRef.current;
    const map = mapRef.current;
    const group = dataLayerRef.current;
    if (!ready || !L || !map || !group) return;

    if (!isLiveLeafletMap(map)) return;
    try {
      group.clearLayers();
    } catch {
      return;
    }

    incidents.forEach(({ item, pos }) => {
      const cancellationRequested = Boolean(item.cancellationRequestedAt || (item as any).cancellation_requested_at);
      const marker = L.marker([pos.lat, pos.lng], {
        icon: L.divIcon({
          className: "",
          html: incidentIconHtml(!showAll, showAll && !selectedIncidentId, cancellationRequested),
          iconSize: [46, 56],
          iconAnchor: [showAll ? 19 : 23, showAll ? 48 : 56],
          popupAnchor: [0, -50],
        }),
        zIndexOffset: 500,
      });

      marker.on("click", () => {
        setSelectedIncidentId(item.id);
        onIncidentSelect?.(item);
        if (showAll && operationalRoutes.some((entry) => entry.requestId === item.id)) {
          setSelectedOperationalRouteId((current) => current === item.id ? null : item.id);
          setSelectedOperationalEta(null);
        }
        if (!isLiveLeafletMap(map)) return;
        try {
          map.flyTo([pos.lat, pos.lng], Math.max(map.getZoom(), 15), {
            animate: true,
            duration: 0.6,
          });
          const element = marker.getElement();
          element?.querySelector(".map-pin-bounce")?.classList.remove("map-pin-bounce");
        } catch {
          // The marker can be removed during a responsive rerender.
        }
      });

      if (landingPreview) {
        marker.bindTooltip(
          `<p style="margin:0;font-size:10px;font-weight:600;text-transform:uppercase;letter-spacing:.1em;color:#a33a38">${escapeHtml(requesterText(uiLanguage ?? "English", "Requester located"))}</p>
           <p style="margin:4px 0 0;font-size:12px;font-weight:600;color:#102b3f">${escapeHtml(requesterText(uiLanguage ?? "English", "Location attached to request"))}</p>`,
          {
            permanent: true,
            direction: "bottom",
            offset: [0, 4],
            className: "live-map-callout",
            interactive: false,
          }
        );
      } else {
        const address = requestLocationAddress(item) ?? `${formatCoordinate(pos.lat, 5)}, ${formatCoordinate(pos.lng, 5)}`;
        marker.bindPopup(
          `<div style="font:600 12px/1.4 system-ui,sans-serif;color:#102b3f;min-width:160px">
             <div style="color:#a33a38;text-transform:uppercase;font-size:10px;letter-spacing:.08em">${escapeHtml(requesterText(uiLanguage ?? "English", String((item as any).current_status ?? (item as any).currentStatus ?? item.status ?? "").replace(/_/g, " ")))}</div>
             ${cancellationRequested ? '<div style="margin-top:3px;color:#9a5c0d;text-transform:uppercase;font-size:10px;font-weight:700;letter-spacing:.05em">Cancellation requested · dispatcher approval</div>' : ""}
             <div style="margin-top:2px">${escapeHtml(requesterText(uiLanguage ?? "English", String(item.category ?? "Emergency request")))}</div>
             <div style="margin-top:4px;font-weight:400;color:#5d7080">${escapeHtml(address)}</div>
             <div style="margin-top:4px;font-weight:400;color:#8a9aa4;font-size:11px">${escapeHtml(String(item.id ?? ""))}</div>
           </div>`
        );
        if (!showAll) marker.bindTooltip(responderMode ? requesterText(uiLanguage ?? "English", "Request location") : requesterText(uiLanguage ?? "English", "Requester"), {
          permanent: true,
          direction: "top",
          offset: [0, -48],
          className: "live-map-marker-label",
          interactive: false,
        });
      }

      marker.addTo(group);

      const accuracy = Number(item.location?.accuracy);
      if (!showAll && Number.isFinite(accuracy) && accuracy > 0 && accuracy < 5000) {
        L.circle([pos.lat, pos.lng], {
          radius: accuracy,
          color: "#d53f3d",
          weight: 1,
          fillColor: "#d53f3d",
          fillOpacity: 0.08,
          interactive: false,
        }).addTo(group);
      }
    });

    if (showAll && !landingPreview) {
      responderPositions.forEach(({ item, pos }) => {
        const marker = L.marker([pos.lat, pos.lng], {
          icon: L.divIcon({
            className: "",
            html: availableResponderIconHtml,
            iconSize: [30, 30],
            iconAnchor: [15, 15],
            popupAnchor: [0, -15],
          }),
          zIndexOffset: 700,
        });
        const responderLabel = item.name ?? "Available responder";
        marker.bindPopup(
          `<div style="font:600 12px/1.4 system-ui,sans-serif;color:#102b3f;min-width:150px">
             <div style="color:#1f845b;text-transform:uppercase;font-size:10px;letter-spacing:.08em">Available responder</div>
             <div style="margin-top:2px">${escapeHtml(responderLabel)}</div>
             <div style="margin-top:4px;font-weight:400;color:#5d7080">${escapeHtml([item.team, item.vehicle].filter(Boolean).join(" · ") || "Ready for assignment")}</div>
           </div>`
        );
        marker.bindTooltip(responderLabel, {
          permanent: true,
          direction: "top",
          offset: [0, -16],
          className: "live-map-marker-label",
          interactive: false,
        });
        marker.addTo(group);
      });
    }

    if (previewPos && !request) {
      const isResponderPreview = previewLocationMarker === "responder";
      const marker = L.marker([previewPos.lat, previewPos.lng], {
        icon: L.divIcon({
          className: "",
          html: isResponderPreview ? userIconHtml : incidentIconHtml(true),
          iconSize: isResponderPreview ? [22, 22] : [46, 56],
          iconAnchor: isResponderPreview ? [11, 11] : [23, 56],
        }),
        zIndexOffset: 500,
      });
      if (previewLocationLabel) {
        marker.bindTooltip(previewLocationLabel, {
          permanent: true,
          direction: "top",
          offset: [0, isResponderPreview ? -12 : -48],
          className: "live-map-marker-label",
          interactive: false,
        });
      }
      marker.addTo(group);

      const accuracy = Number(previewLocation?.accuracy);
      if (Number.isFinite(accuracy) && accuracy > 0 && accuracy < 5000) {
        L.circle([previewPos.lat, previewPos.lng], {
          radius: accuracy,
          color: isResponderPreview ? "#1a73e8" : "#d53f3d",
          weight: 1,
          fillColor: isResponderPreview ? "#1a73e8" : "#d53f3d",
          fillOpacity: 0.1,
          interactive: false,
        }).addTo(group);
      }
    }

    // Re-fit only when the *set* of things on the map changes, so live
    // position updates don't keep yanking the view away from the user.
    // Keep the incident as the initial anchor while responder GPS resolves.
    // On mobile, fit both route endpoints after GPS is available so the route
    // itself stays in the narrow viewport. Desktop keeps its existing request
    // anchor and can use the recenter control to show both locations.
    const mapWidth = map.getSize().x;
    const isMobileViewport = mapWidth > 0
      ? mapWidth < 768
      : typeof window !== "undefined" && window.innerWidth < 768;
    const fitResponderRouteOnMobile = responderMode && !showAll && responderAssigned && isMobileViewport && Boolean(responderPos);
    const shouldAnchorResponderMapToRequests = responderMode && incidents.length > 0 && !fitResponderRouteOnMobile;
    const points: LatLng[] = [
      ...incidents.map((entry) => entry.pos),
      ...(showAll ? responderPositions.map((entry) => entry.pos) : []),
      ...(showAll
        ? operationalRoutes
            .map((entry) => toLatLng(entry.responder.location))
            .filter((point): point is LatLng => point !== null)
        : []),
      ...(previewPos && !request ? [previewPos] : []),
      ...(!shouldAnchorResponderMapToRequests && responderPos ? [responderPos] : []),
    ];
    // Track coarse coordinate changes as well as identities. This recentres
    // the board when an admin moves an organisation's responders or request
    // locations to another city, while ignoring routine GPS jitter within a
    // small area so the map does not fight the dispatcher during live work.
    const fitKey = [
      incidents.map((entry) => `${entry.item.id}:${entry.pos.lat.toFixed(2)},${entry.pos.lng.toFixed(2)}`).join(","),
      fallbackCenter ? `${fallbackCenter.lat.toFixed(3)},${fallbackCenter.lng.toFixed(3)}` : "",
      previewPos ? `${previewPos.lat.toFixed(4)},${previewPos.lng.toFixed(4)}` : "",
      !shouldAnchorResponderMapToRequests && responderPos
        ? `${responderPos.lat.toFixed(2)},${responderPos.lng.toFixed(2)}`
        : "",
      responderPositions.map((entry) => `${entry.item.id ?? "responder"}:${entry.pos.lat.toFixed(2)},${entry.pos.lng.toFixed(2)}`).join(","),
      operationalRoutes.map((entry) => {
        const point = toLatLng(entry.responder.location);
        return point ? `${entry.requestId}:${point.lat.toFixed(2)},${point.lng.toFixed(2)}` : "";
      }).join(","),
    ].join("|");

    if (fitKey !== lastFitKeyRef.current) {
      lastFitKeyRef.current = fitKey;
      if (points.length === 0) {
        const center = toLatLng(fallbackCenter) ?? DEFAULT_CENTER;
        map.flyTo([center.lat, center.lng], DEFAULT_ZOOM, { animate: true, duration: 1.1 });
      } else if (points.length === 1) {
        map.flyTo([points[0].lat, points[0].lng], previewPos ? 17 : 15, {
          animate: true,
          duration: 1.1,
        });
      } else {
        map.fitBounds(
          L.latLngBounds(points.map((p) => [p.lat, p.lng] as [number, number])),
          {
            paddingTopLeft: [40, 70],
            paddingBottomRight: [70, request ? 150 : 40],
            maxZoom: 16,
            animate: true,
            duration: 1,
          }
        );
      }
    }
  }, [
    ready,
    incidents,
    fallbackCenter,
    previewPos,
    previewLocation?.accuracy,
    previewLocationLabel,
    previewLocationMarker,
    request,
    responderPos,
    responderPositions,
    operationalRoutes,
    showAll,
    responderMode,
    landingPreview,
    onIncidentSelect,
  ]);

  /* ---------------------------------------------------------------- */
  /* Dispatcher routes: one blue route for each assigned active request */
  /* ---------------------------------------------------------------- */

  useEffect(() => {
    const L = LRef.current;
    const group = operationalRouteLayerRef.current;
    if (!ready || !L || !group) return;

    group.clearLayers();
    if (!showAll || landingPreview || operationalRoutes.length === 0) return;

    const controller = new AbortController();
    const incidentById = new Map(incidents.map((entry) => [entry.item.id, entry.pos]));
    const visibleRoutes = selectedOperationalRouteId
      ? operationalRoutes.filter((entry) => entry.requestId === selectedOperationalRouteId)
      : operationalRoutes;

    const driverMarkerPosition = (requestId: string, actual: LatLng): LatLng => {
      const nearby = visibleRoutes
        .map((entry) => ({ requestId: entry.requestId, position: toLatLng(entry.responder.location) }))
        .filter((entry): entry is { requestId: string; position: LatLng } => Boolean(entry.position))
        .filter((entry) =>
          Math.abs(entry.position.lat - actual.lat) < 0.0005 &&
          Math.abs(entry.position.lng - actual.lng) < 0.0005,
        );
      if (nearby.length < 2) return actual;

      const index = nearby.findIndex((entry) => entry.requestId === requestId);
      const angle = -Math.PI / 2 + (Math.max(0, index) * (Math.PI * 2)) / nearby.length;
      const offset = 0.00035;
      return {
        lat: actual.lat + Math.sin(angle) * offset,
        lng: actual.lng + Math.cos(angle) * offset,
      };
    };

    const drawRoute = (requestId: string, from: LatLng, to: LatLng, exactPoints?: LatLng[]) => {
      const points = exactPoints ?? [];
      if (points.length < 2) return;
      const latlngs = points.map((point) => [point.lat, point.lng] as [number, number]);
      const casing = L.polyline(latlngs, {
        color: "#ffffff",
        weight: 9,
        opacity: 0.95,
        lineCap: "round",
        lineJoin: "round",
        interactive: true,
      }).addTo(group);
      const routeLine = L.polyline(latlngs, {
        color: "#1a73e8",
        weight: 5,
        opacity: 0.95,
        lineCap: "round",
        lineJoin: "round",
        interactive: true,
      }).addTo(group);
      const selectRoute = () => {
        setSelectedOperationalRouteId((current) => current === requestId ? null : requestId);
        setSelectedOperationalEta(null);
      };
      casing.on("click", selectRoute);
      routeLine.on("click", selectRoute);
    };

    visibleRoutes.forEach(({ requestId, responder: assignedResponder }) => {
      const target = incidentById.get(requestId);
      const from = toLatLng(assignedResponder.location);
      if (!target || !from) return;

      const markerPosition = driverMarkerPosition(requestId, from);
      L.marker([from.lat, from.lng], {
        icon: L.divIcon({
          className: "",
          html: userIconHtml,
          iconSize: [22, 22],
          iconAnchor: [11, 11],
          popupAnchor: [0, -12],
        }),
        zIndexOffset: 900,
      })
        .bindPopup(
          `<div style="font:600 12px/1.4 system-ui,sans-serif;color:#102b3f;min-width:150px">
             <div style="color:#1a73e8;text-transform:uppercase;font-size:10px;letter-spacing:.08em">${escapeHtml(requesterText(uiLanguage ?? "English", "Assigned responder"))}</div>
             <div style="margin-top:2px">${escapeHtml(assignedResponder.name ?? "Assigned responder")}</div>
             <div style="margin-top:4px;font-weight:400;color:#5d7080">${escapeHtml(requesterText(uiLanguage ?? "English", "Route for request {id}", { id: requestId }))}</div>
           </div>`
        )
        .addTo(group);
      L.marker([markerPosition.lat, markerPosition.lng], {
        icon: L.divIcon({
          className: "",
          html: `<span style="display:inline-block;white-space:nowrap;border-radius:9999px;background:#167a86;color:#fff;padding:4px 8px;font:700 11px/1.1 system-ui,sans-serif;box-shadow:0 2px 6px rgba(16,43,63,.25);">${escapeHtml(assignedResponder.name ?? "Responder")}</span>`,
          iconSize: [160, 24],
          iconAnchor: [80, 12],
        }),
        interactive: false,
        zIndexOffset: 950,
      }).addTo(group);
      const routeCacheKey = `${requestId}:${from.lat.toFixed(5)},${from.lng.toFixed(5)}>${target.lat.toFixed(5)},${target.lng.toFixed(5)}`;
      const cachedRoute = operationalRouteCacheRef.current.get(routeCacheKey);
      if (cachedRoute) {
        if (selectedOperationalRouteId === requestId) {
          setSelectedOperationalEta({ metres: cachedRoute.metres, seconds: cachedRoute.seconds });
        }
        drawRoute(requestId, from, target, cachedRoute.points);
        return;
      }

      void fetchRoute(from, target, controller.signal).then((routeResult) => {
        if (controller.signal.aborted || !routeResult) return;
        operationalRouteCacheRef.current.set(routeCacheKey, routeResult);
        if (selectedOperationalRouteId === requestId) {
          setSelectedOperationalEta({ metres: routeResult.metres, seconds: routeResult.seconds });
        }
        // Dispatcher routes only use the real road-following geometry. Do not
        // draw a straight horizontal placeholder while routing is pending.
        drawRoute(requestId, from, target, routeResult.points);
      });
    });

    return () => controller.abort();
  }, [ready, showAll, landingPreview, operationalRoutes, incidents, selectedOperationalRouteId]);

  /* ---------------------------------------------------------------- */
  /* Route between responder and incident                               */
  /* ---------------------------------------------------------------- */

  // An active responder page passes its assigned request even if an older or
  // partial mission payload omits the responder ID. Keep route rendering
  // available for that mission; queued requests on the no-mission map do not
  // pass `request` and therefore still have no responder route.
  const hasAssignedResponderRoute = responderAssigned || Boolean(request?.id);
  const routeKey =
    (!responderMode || hasAssignedResponderRoute) && responderPos && target
      ? `${responderPos.lat.toFixed(4)},${responderPos.lng.toFixed(4)}>${target.lat.toFixed(4)},${target.lng.toFixed(4)}`
      : "";

  useEffect(() => {
    if (!routeKey || !responderPos || !target) {
      setRoute(null);
      return;
    }

    const controller = new AbortController();
    // Show a straight line immediately, then upgrade to the road route.
    setRoute((current) =>
      current?.exact
        ? current
        : { points: [responderPos, target], metres: 0, seconds: 0, exact: false }
    );

    fetchRoute(responderPos, target, controller.signal).then((result) => {
      if (controller.signal.aborted) return;
      if (result) setRoute({ ...result, exact: true });
      else setRoute({ points: [responderPos, target], metres: 0, seconds: 0, exact: false });
    });

    return () => controller.abort();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [routeKey]);

  useEffect(() => {
    const L = LRef.current;
    const map = mapRef.current;
    const group = routeLayerRef.current;
    if (!ready || !L || !group) return;

    try {
      group.clearLayers();
    } catch {
      return;
    }
    responderMarkerRef.current = null;
    if (!route || !responderPos) return;

    const latlngs = route.points.map((p) => [p.lat, p.lng] as [number, number]);

    // White casing + coloured line, like a navigation app.
    L.polyline(latlngs, {
      color: "#ffffff",
      weight: 10,
      opacity: 0.95,
      lineCap: "round",
      lineJoin: "round",
      interactive: false,
    }).addTo(group);
    L.polyline(latlngs, {
      color: route.exact ? "#1a73e8" : "#0f6872",
      weight: 6,
      opacity: 0.95,
      dashArray: route.exact ? undefined : "10 12",
      lineCap: "round",
      lineJoin: "round",
      interactive: false,
    }).addTo(group);

    const marker = L.marker([responderPos.lat, responderPos.lng], {
      icon: L.divIcon({
        className: "",
        html: userIconHtml,
        iconSize: [22, 22],
        iconAnchor: [11, 11],
      }),
      zIndexOffset: 1000,
    });

    if (responderMode) {
      marker.bindTooltip("You", {
        permanent: true,
        direction: "top",
        offset: [0, -12],
        className: "live-map-marker-label",
        interactive: false,
      });
    }

    if (responder && !landingPreview) {
      marker.bindPopup(
        `<div style="font:600 12px/1.4 system-ui,sans-serif;color:#102b3f">
           ${escapeHtml(responder.name ?? "Responder")}
           <div style="font-weight:400;color:#5d7080">${escapeHtml(
             [responder.team, responder.vehicle].filter(Boolean).join(" · ")
           )}</div>
         </div>`
      );
      marker.bindTooltip(responderMode ? "You" : "Responder", {
        permanent: true,
        direction: "top",
        offset: [0, -24],
        className: "live-map-marker-label live-map-driver-label",
        interactive: false,
      });
    }

    if (!isLiveLeafletMap(map)) return;
    marker.addTo(group);
    responderMarkerRef.current = marker;
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [ready, route, responder, landingPreview]);

  /* Keep the responder marker in sync with live position updates. */
  useEffect(() => {
    if (landingPreview || !responderPos) return;
    const marker = responderMarkerRef.current;
    const group = routeLayerRef.current;
    if (!marker || !group || !group.hasLayer(marker)) return;
    try {
      marker.setLatLng([responderPos.lat, responderPos.lng]);
    } catch {
      // Ignore updates targeting a marker removed by a route/map rerender.
    }
  }, [responderPos, landingPreview]);

  /* Landing page: drive the responder along the route on a loop. */
  useEffect(() => {
    if (!landingPreview || !route || route.points.length < 2) return;
    const marker = responderMarkerRef.current;
    if (!marker) return;

    const pts = route.points;
    const segLengths: number[] = [];
    let total = 0;
    for (let i = 1; i < pts.length; i++) {
      const d = Math.hypot(pts[i].lat - pts[i - 1].lat, pts[i].lng - pts[i - 1].lng);
      segLengths.push(d);
      total += d;
    }
    if (total === 0) return;

    const duration = 9000;
    let frame = 0;
    const start = performance.now();

    const tick = (now: number) => {
      if (!routeLayerRef.current?.hasLayer(marker)) return;
      const cycle = ((now - start) % (duration * 2)) / duration;
      const t = cycle <= 1 ? cycle : 2 - cycle; // ping-pong
      let dist = t * total;
      let i = 0;
      while (i < segLengths.length - 1 && dist > segLengths[i]) {
        dist -= segLengths[i];
        i++;
      }
      const f = segLengths[i] ? dist / segLengths[i] : 0;
      const a = pts[i];
      const b = pts[i + 1];
      try {
        marker.setLatLng([a.lat + (b.lat - a.lat) * f, a.lng + (b.lng - a.lng) * f]);
      } catch {
        return;
      }
      frame = requestAnimationFrame(tick);
    };
    frame = requestAnimationFrame(tick);
    return () => cancelAnimationFrame(frame);
  }, [landingPreview, route]);

  /* ---------------------------------------------------------------- */
  /* Controls                                                           */
  /* ---------------------------------------------------------------- */

  const locateMe = useCallback(() => {
    const L = LRef.current;
    const map = mapRef.current;
    const group = userLayerRef.current;
    if (!L || !map || !group || !navigator.geolocation) return;

    setLocating(true);
    navigator.geolocation.getCurrentPosition(
      (pos) => {
        setLocating(false);
        const here: [number, number] = [pos.coords.latitude, pos.coords.longitude];

        // Geolocation can resolve after this map has been replaced or
        // unmounted. Never update a stale Leaflet instance; doing so causes
        // Leaflet to read `_leaflet_pos` from a removed SVG/container node.
        const currentMap = mapRef.current;
        const currentGroup = userLayerRef.current;
        if (
          !currentMap ||
          currentMap !== map ||
          !currentGroup ||
          !currentMap.getContainer()?.isConnected
        ) {
          return;
        }

        setUserPosition({ lat: here[0], lng: here[1] });
        if (responderMode) onResponderLocationChange?.({ lat: here[0], lng: here[1] });

        if (responderMode) {
          if (!locationUpdateInFlightRef.current && Date.now() - lastLocationUpdateAtRef.current >= 3_000) {
            locationUpdateInFlightRef.current = true;
            lastLocationUpdateAtRef.current = Date.now();
            void fetch("/api/responder/location", {
              method: "PATCH",
              credentials: "include",
              headers: { "Content-Type": "application/json" },
              body: JSON.stringify({
                latitude: pos.coords.latitude,
                longitude: pos.coords.longitude,
                accuracyMeters: pos.coords.accuracy,
              }),
            }).catch(() => {
              // The map still uses the fresh browser position if persistence fails.
            }).finally(() => {
              locationUpdateInFlightRef.current = false;
            });
          }
        }

        try {
          currentGroup.clearLayers();
        } catch {
          return;
        }

        // Keep the responder's blue "you are here" marker visible even when
        // an active request is displayed. The request marker remains separate.
        if (responderMode || !request) {
          L.marker(here, {
            icon: L.divIcon({
              className: "",
              html: userIconHtml,
              iconSize: [22, 22],
              iconAnchor: [11, 11],
            }),
          })
            .bindPopup("You are here")
          .bindTooltip("You", {
            permanent: true,
            direction: "top",
            offset: [0, -12],
            className: "live-map-marker-label",
            interactive: false,
          })
            .addTo(currentGroup);
        }
        // Camera changes are handled by the shared fit effect so GPS arrival
        // produces one smooth transition instead of a flyTo followed by a
        // second fitBounds animation.
      },
      () => setLocating(false),
      { enableHighAccuracy: true, timeout: 10000, maximumAge: 0 }
    );
  }, [responderMode, request, onResponderLocationChange]);

  // Show the cached responder point while browser GPS resolves. It is only a
  // marker; it never moves the camera away from a request or org fallback.
  useEffect(() => {
    const L = LRef.current;
    const map = mapRef.current;
    const group = userLayerRef.current;
    if (!ready || !responderMode || userPosition || !lastKnownResponderPos || !L || !map || !group) return;
    if (!map.getContainer()?.isConnected) return;

    try {
      group.clearLayers();
      L.marker([lastKnownResponderPos.lat, lastKnownResponderPos.lng], {
        icon: L.divIcon({
          className: "",
          html: userIconHtml,
          iconSize: [22, 22],
          iconAnchor: [11, 11],
        }),
        zIndexOffset: 900,
      })
        .bindPopup("Last known responder location")
        .addTo(group);
    } catch {
      // The map may be removed during a responsive rerender.
    }
  }, [ready, responderMode, userPosition, lastKnownResponderPos]);

  useEffect(() => {
    const L = LRef.current;
    const map = mapRef.current;
    const group = userLayerRef.current;
    if (!ready || !responderMode || !userPosition || !L || !map || !group) return;
    if (!map.getContainer()?.isConnected) return;

    try {
      group.clearLayers();
      L.marker([userPosition.lat, userPosition.lng], {
        icon: L.divIcon({
          className: "",
          html: userIconHtml,
          iconSize: [22, 22],
          iconAnchor: [11, 11],
        }),
        zIndexOffset: 1000,
      })
        .bindPopup("Current device location")
        .bindTooltip("You", {
          permanent: true,
          direction: "top",
          offset: [0, -12],
          className: "live-map-marker-label",
          interactive: false,
        })
        .addTo(group);
    } catch {
      // The map can be removed during navigation; the next mount redraws it.
    }
  }, [ready, responderMode, userPosition]);

  // Locate the responder automatically on every responder mission map so the
  // route can be drawn immediately. Previously this stopped when a request
  // existed, which made the route appear only after clicking "My location".
  useEffect(() => {
    if (!responderMode || landingPreview || !ready || userPosition) return;
    void locateMe();
  }, [responderMode, landingPreview, ready, userPosition, request, locateMe]);

  // Once the responder has granted location access, keep the operational
  // position current while they move. Dispatchers read this value from the
  // responder profile on their next live-operations refresh.
  useEffect(() => {
    if (!responderMode || landingPreview || !ready || !userPosition || !navigator.geolocation) return;

    const watchId = navigator.geolocation.watchPosition(
      (position) => {
        const nextPosition = {
          lat: position.coords.latitude,
          lng: position.coords.longitude,
        };
        setUserPosition(nextPosition);
        onResponderLocationChange?.(nextPosition);
        if (locationUpdateInFlightRef.current || Date.now() - lastLocationUpdateAtRef.current < 3_000) return;
        locationUpdateInFlightRef.current = true;
        lastLocationUpdateAtRef.current = Date.now();
        void fetch("/api/responder/location", {
          method: "PATCH",
          credentials: "include",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({
            latitude: position.coords.latitude,
            longitude: position.coords.longitude,
            accuracyMeters: position.coords.accuracy,
          }),
        }).catch(() => {
          // Keep the local map position even if a transient save fails.
        }).finally(() => {
          locationUpdateInFlightRef.current = false;
        });
      },
      () => {
        // The last confirmed location remains visible if GPS temporarily drops.
      },
      { enableHighAccuracy: true, maximumAge: 0, timeout: 5_000 },
    );

    return () => navigator.geolocation.clearWatch(watchId);
  }, [responderMode, landingPreview, ready, Boolean(userPosition), onResponderLocationChange]);

  const recenter = () => {
    const L = LRef.current;
    const map = mapRef.current;
    if (!L || !isLiveLeafletMap(map)) return;
    const points: LatLng[] = [
      ...incidents.map((e) => e.pos),
      ...(showAll ? responderPositions.map((entry) => entry.pos) : []),
      ...(showAll
        ? operationalRoutes
            .map((entry) => toLatLng(entry.responder.location))
            .filter((point): point is LatLng => point !== null)
        : []),
      ...(previewPos ? [previewPos] : []),
      ...(responderPos ? [responderPos] : []),
    ];
    if (points.length === 0) return;
    try {
      if (points.length === 1) {
        map.flyTo([points[0].lat, points[0].lng], 16, { duration: 0.6 });
      } else {
        map.flyToBounds(
          L.latLngBounds(points.map((p) => [p.lat, p.lng] as [number, number])),
          { padding: [60, 60], maxZoom: 16, duration: 0.6 }
        );
      }
    } catch {
      // Ignore a control click that races with map unmount/navigation.
    }
  };

  const requestLocation = requestLocationValue(request);
  const hasRequestLocation = Boolean(toLatLng(requestLocation));
  const displayLocation = requestLocationAddress(request) ??
    (hasRequestLocation && requestLocation && typeof requestLocation === "object"
      ? `${formatCoordinate((requestLocation as Record<string, unknown>).lat ?? (requestLocation as Record<string, unknown>).latitude)}, ${formatCoordinate((requestLocation as Record<string, unknown>).lng ?? (requestLocation as Record<string, unknown>).longitude)}`
      : "Location unavailable");
  const hasResponderAssignment = Boolean(responderAssigned || responder || request?.assignedResponderId);
  const responderHasArrived = responderStatus === "arrived";
  const responderIsNear = !responderHasArrived && responderDistanceMetres != null && responderDistanceMetres <= 1_000;
  const selectedOperationalRequest = selectedOperationalRouteId
    ? requests.find((item) => item.id === selectedOperationalRouteId)
    : null;
  const selectedOperationalRoute = selectedOperationalRouteId
    ? operationalRoutes.find((entry) => entry.requestId === selectedOperationalRouteId)
    : null;
  const selectedOperationalRecord = selectedOperationalRequest as (EmergencyRequest & Record<string, unknown>) | undefined;
  const selectedOperationalLocation = selectedOperationalRequest
    ? toLatLng(requestLocationValue(selectedOperationalRequest))
    : null;
  const selectedOperationalStatus = String(
    selectedOperationalRecord?.current_status ?? selectedOperationalRecord?.currentStatus ?? selectedOperationalRequest?.status ?? "",
  ).toLowerCase();
  const selectedOperationalStatusText = selectedOperationalStatus === "arrived"
    ? "Responder has arrived"
    : selectedOperationalStatus === "en_route"
      ? "Responder en route"
      : selectedOperationalStatus === "assigned"
        ? "Responder assigned"
        : "Emergency request";

  /* ---------------------------------------------------------------- */
  /* Render                                                             */
  /* ---------------------------------------------------------------- */

  return (
    <div
      className={cn(
        "live-map relative isolate overflow-hidden bg-[#e9eff3]",
        immersive
          ? "h-full min-h-0 rounded-none md:h-[72dvh] md:min-h-[500px] md:rounded-[22px]"
          : landingPreview
            ? "h-[58dvh] min-h-[470px] rounded-[11px]"
            : "h-[56dvh] min-h-[430px] rounded-none md:rounded-[20px]",
        className
      )}
    >
      {/* The real map */}
      <div
        ref={containerRef}
        className="absolute inset-0 z-0"
        aria-label="Map"
        role="region"
      />

      {/* Loading shimmer while Leaflet initialises */}
      {mapLoading ? (
        <div className="absolute inset-0 z-[20] grid place-items-center bg-[#edf2f4]/85 backdrop-blur-[1px]">
          <div className="inline-flex items-center gap-2 rounded-full border border-white/80 bg-white/95 px-4 py-2 text-sm font-semibold text-[#102b3f] shadow-md">
            <LoaderCircle className="h-4 w-4 animate-spin text-[#0f6872]" />
            Loading map...
          </div>
        </div>
      ) : null}

      {/* Map labels */}
      {!hideMapStatus ? <div className={cn("pointer-events-none absolute left-3 right-16 top-3 z-[1000] flex flex-wrap gap-2 sm:left-4 sm:right-16 sm:top-4", mapStatusOffsetClassName)}>
        <Badge tone="success" className="bg-white/95 shadow-sm">
          <span className="mr-1.5 h-2 w-2 rounded-full bg-[#1f845b]" />
          {landingPreview
            ? "Location preview"
            : showAll
              ? `${incidents.length} on map`
              : requesterText(uiLanguage ?? "English", "Live map")}
        </Badge>

        {request && !landingPreview ? (
          <Badge tone="slate" className="hidden bg-white/95 shadow-sm sm:inline-flex">
            {request.id}
          </Badge>
        ) : null}

        {route?.exact && route.metres > 0 && !landingPreview ? (
          <Badge tone="blue" className="bg-white/95 shadow-sm">
            {formatDistance(route.metres)} · {requesterText(uiLanguage ?? "English", "{count} min drive", { count: Math.max(1, Math.round(route.seconds / 60)) })}
          </Badge>
        ) : null}
        {selectedOperationalEta && selectedOperationalRouteId ? (
          <Badge tone="blue" className="bg-white/95 shadow-sm">
            {formatDistance(selectedOperationalEta.metres)} · {requesterText(uiLanguage ?? "English", "{count} min drive", { count: Math.max(1, Math.round(selectedOperationalEta.seconds / 60)) })}
          </Badge>
        ) : null}

        {selectedOperationalRequest && selectedOperationalRouteId ? (
          <Badge tone="slate" className="bg-white/95 shadow-sm">
            Selected request · {selectedOperationalRequest.id}
          </Badge>
        ) : null}

        {selectedOperationalRouteId ? (
          <button
            type="button"
            onClick={() => {
              setSelectedOperationalRouteId(null);
              setSelectedOperationalEta(null);
            }}
            className="pointer-events-auto rounded-full border border-[#cbd8df] bg-white/95 px-3 py-1.5 text-xs font-bold text-[#315464] shadow-sm transition hover:bg-white"
          >
            Clear selection
          </button>
        ) : null}
      </div> : null}

      {emptyMapMessage ? <div className="pointer-events-none absolute inset-x-0 bottom-5 z-[1000] text-center">
        <span className="inline-flex animate-pulse rounded-full bg-white/90 px-4 py-2 text-sm font-semibold text-[#102b3f] shadow-md backdrop-blur-sm">
          {emptyMapMessage}
        </span>
      </div> : null}

      {/* Map controls (same look as before) */}
      <div className={cn("absolute right-3 top-3 z-[1000] grid gap-2 sm:right-4 sm:top-4", mapControlsOffsetClassName)}>
        <Button
          variant="outline"
          size="icon"
          aria-label={baseLayer === "map" ? "Show satellite view" : "Show map view"}
          title={baseLayer === "map" ? "Satellite" : "Map"}
          onClick={() => setBaseLayer((v) => (v === "map" ? "satellite" : "map"))}
          className={cn("bg-white shadow-md", baseLayer === "satellite" && "ring-2 ring-[#1a73e8]")}
        >
          <Layers3 className="h-5 w-5" />
        </Button>

        {!landingPreview ? (
          <>
            {showMyLocation ? <Button
              variant="outline"
              size="icon"
              aria-label="Show my location"
              title="My location"
              onClick={locateMe}
              className="bg-white shadow-md"
            >
              <LocateFixed className={cn("h-5 w-5", locating && "animate-pulse text-[#1a73e8]")} />
            </Button> : null}

            <Button
              variant="outline"
              size="icon"
              aria-label="Re-centre on incident"
              title="Re-centre"
              onClick={recenter}
              className="bg-white shadow-md"
            >
              <Crosshair className="h-5 w-5" />
            </Button>
          </>
        ) : null}
      </div>

      {!landingPreview ? (
        <div className="absolute right-3 top-[10.5rem] z-[1000] grid overflow-hidden rounded-xl border border-[#d7e0e7] bg-white shadow-lg sm:right-4">
          <button
            type="button"
            onClick={() => mapRef.current?.zoomIn()}
            className="grid h-10 w-10 place-items-center hover:bg-[#eef3f5]"
            aria-label="Zoom in"
          >
            <Plus className="h-4 w-4" />
          </button>
          <button
            type="button"
            onClick={() => mapRef.current?.zoomOut()}
            className="grid h-10 w-10 place-items-center border-t border-[#e1e7eb] hover:bg-[#eef3f5]"
            aria-label="Zoom out"
          >
            <Minus className="h-4 w-4" />
          </button>
        </div>
      ) : null}

      {/* Location-confirmation information */}
      {previewLocation && !request ? (
        <div className="absolute inset-x-0 bottom-0 z-[1000] border-t border-white/70 bg-white/95 p-3.5 shadow-[0_-10px_30px_rgba(16,43,63,.10)] backdrop-blur-lg sm:inset-x-auto sm:bottom-4 sm:left-4 sm:w-[390px] sm:border-0 sm:p-4 sm:shadow-xl">
          <div className="flex items-start gap-3">
            <span className="grid h-10 w-10 shrink-0 place-items-center rounded-xl bg-[#e7f3f4] text-[#0f6872]">
              <LocateFixed className="h-5 w-5" />
            </span>
            <div className="min-w-0 flex-1">
              <p className="text-xs font-semibold uppercase tracking-wide text-[#7b8b96]">
                {previewLocationLabel ?? "Location confirmed"}
              </p>
              <p className="mt-1 truncate text-sm font-semibold">
                {previewLocation.address &&
                previewLocation.address !== "Current device location"
                  ? previewLocation.address
                  : `${formatCoordinate(previewLocation.lat)}, ${formatCoordinate(previewLocation.lng)}`}
              </p>
              <p className="mt-1 text-xs text-[#687b89]">
                {formatCoordinate(previewLocation.lat, 5)},{" "}
                {formatCoordinate(previewLocation.lng, 5)}
                {previewLocation.accuracy
                  ? ` · ±${Math.round(previewLocation.accuracy)}m`
                  : ""}
              </p>
            </div>
          </div>
        </div>
      ) : null}

      {/* Active-request information */}
      {request && !landingPreview && !hideActiveRequestDetails ? (
        <div className={cn("absolute inset-x-0 bottom-0 z-[1000] border-t border-white/70 bg-white/94 p-3.5 shadow-[0_-10px_30px_rgba(16,43,63,.10)] backdrop-blur-lg sm:inset-x-auto sm:bottom-4 sm:left-4 sm:w-[390px] sm:rounded-2xl sm:border sm:p-4 sm:shadow-xl", hideActiveRequestDetailsMobile && "hidden md:block")}>
          <div className="min-w-0">
            <div className="mb-3 animate-pulse text-center">
              {responderMode ? (
                <p className="text-sm font-semibold text-[#102b3f]">
                  {requesterText(uiLanguage ?? "English", hasResponderAssignment ? "Assigned to an emergency request" : "Searching for an emergency request")}
                </p>
              ) : responderHasArrived ? (
                <p className="rounded-lg bg-[#d53f3d] px-3 py-2 text-sm font-bold text-white">
                  <span>{requesterText(uiLanguage ?? "English", "Responder has arrived")}</span>
                </p>
              ) : responderIsNear ? (
                <p className="rounded-lg bg-[#f2c94c] px-3 py-2 text-sm font-bold text-[#4d3a00]">
                  <span style={{ color: "#3f2e00" }}>{requesterText(uiLanguage ?? "English", "Responder is arriving soon")}</span>
                </p>
              ) : hasResponderAssignment ? (
                <p className="text-sm font-semibold text-[#102b3f]">
                  {requesterText(uiLanguage ?? "English", "{name} on the way", { name: responder?.name ?? responderName ?? "Responder" })}
                </p>
              ) : (
                <p className="text-sm font-semibold text-[#102b3f]">{requesterText(uiLanguage ?? "English", "Emergency sent")}</p>
              )}
            </div>
            {requesterName ? <p className="mb-1 truncate text-sm font-semibold text-[#102b3f]">{requesterText(uiLanguage ?? "English", "Requester")}: {requesterName}</p> : null}
            {!responderMode && hasResponderAssignment ? <p className="mb-1 truncate text-sm font-semibold text-[#102b3f]">{requesterText(uiLanguage ?? "English", "Responder")}: {responder?.name ?? responderName ?? "Responder"}</p> : null}
              <p className="mt-1 truncate text-sm font-semibold">
                {displayLocation}
              </p>
              <p className="mt-1 text-xs text-[#687b89]">
                {requesterText(uiLanguage ?? "English", "Emergency request location")}
              </p>
          </div>
          {mobileAction ? <div className="mt-3 md:hidden">{mobileAction}</div> : null}
        </div>
      ) : null}

      {selectedOperationalRequest && selectedOperationalRoute && !landingPreview ? (
        <div className="absolute inset-x-0 bottom-0 z-[1000] border-t border-white/70 bg-[#f7f4ef]/95 p-3.5 shadow-[0_-10px_30px_rgba(16,43,63,.12)] backdrop-blur-lg sm:inset-x-auto sm:bottom-4 sm:left-4 sm:w-[390px] sm:rounded-2xl sm:border sm:p-4 sm:shadow-xl">
          <div className="overflow-hidden rounded-xl border border-[#ded8ce] bg-[#f7f4ef]">
            <p className="bg-[#df6664] px-3 py-2 text-center text-sm font-bold text-white">
              {requesterText(uiLanguage ?? "English", selectedOperationalStatusText)}
            </p>
            <div className="p-3">
              <p className="text-sm font-semibold text-[#102b3f]">
                {requesterText(uiLanguage ?? "English", "Requester")}: {selectedOperationalRequest.requesterName ?? String(selectedOperationalRecord?.requester_name ?? requesterText(uiLanguage ?? "English", "Requester"))}
              </p>
              <p className="mt-1 text-sm font-semibold text-[#102b3f]">
                {requesterText(uiLanguage ?? "English", "Responder")}: {selectedOperationalRoute.responder.name ?? requesterText(uiLanguage ?? "English", "Assigned responder")}
              </p>
              <p className="mt-1 text-sm text-[#536b78]">
                {requesterText(uiLanguage ?? "English", selectedOperationalRequest.category ?? "Emergency request")}
              </p>
              {selectedOperationalLocation ? (
                <p className="mt-1 text-sm font-semibold text-[#102b3f]">
                  {formatCoordinate(selectedOperationalLocation.lat)}, {formatCoordinate(selectedOperationalLocation.lng)}
                </p>
              ) : null}
              <p className="mt-1 text-xs text-[#687b89]">{requesterText(uiLanguage ?? "English", "Emergency request location")}</p>
            </div>
          </div>
        </div>
      ) : null}
    </div>
  );
}

