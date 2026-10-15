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
  Minus,
  Plus,
} from "lucide-react";
import {
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

type PreviewLocation = {
  lat: number;
  lng: number;
  address?: string;
  accuracy?: number;
};

type LiveResponseMapProps = {
  request?: EmergencyRequest;
  responder?: Responder;
  immersive?: boolean;
  showAll?: boolean;
  requests?: EmergencyRequest[];
  mobileAction?: ReactNode;
  landingPreview?: boolean;
  previewLocation?: PreviewLocation;
  className?: string;
};

type LatLng = { lat: number; lng: number };
type BaseLayer = "map" | "satellite";

/* ------------------------------------------------------------------------ */
/* Configuration                                                             */
/* ------------------------------------------------------------------------ */

/** Johannesburg CBD - used when nothing on the map has coordinates yet. */
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

const incidentIconHtml = (large: boolean) => {
  const size = large ? 46 : 38;
  return `
  <div style="position:relative;width:${size}px;height:${size + 10}px;">
    <span class="pulse-ring" style="position:absolute;left:${size / 2 - 14}px;bottom:-4px;width:28px;height:28px;border-radius:9999px;background:rgba(213,63,61,.35);"></span>
    <svg width="${size}" height="${size + 10}" viewBox="0 0 24 30" style="position:relative;filter:drop-shadow(0 6px 8px rgba(120,20,20,.35));">
      <path d="M12 0C5.4 0 0 5.2 0 11.7 0 20.4 12 30 12 30s12-9.6 12-18.3C24 5.2 18.6 0 12 0z" fill="#d53f3d" stroke="#ffffff" stroke-width="1.6"/>
      <circle cx="12" cy="11.5" r="4.4" fill="#ffffff"/>
    </svg>
  </div>`;
};

const responderIconHtml = (heading = 0) => `
  <div style="width:44px;height:44px;display:grid;place-items:center;border-radius:14px;background:#0f6872;border:3px solid #fff;box-shadow:0 8px 18px rgba(15,104,114,.35);">
    <svg width="20" height="20" viewBox="0 0 24 24" style="transform:rotate(${heading}deg);transition:transform .3s linear;">
      <path d="M12 2 19 21 12 17 5 21z" fill="#ffffff"/>
    </svg>
  </div>`;

const userIconHtml = `
  <div style="position:relative;width:22px;height:22px;">
    <span class="pulse-ring" style="position:absolute;inset:-6px;border-radius:9999px;background:rgba(26,115,232,.28);"></span>
    <span style="position:absolute;inset:0;border-radius:9999px;background:#1a73e8;border:3px solid #fff;box-shadow:0 2px 6px rgba(0,0,0,.35);"></span>
  </div>`;

function bearing(a: LatLng, b: LatLng): number {
  const toRad = (d: number) => (d * Math.PI) / 180;
  const y = Math.sin(toRad(b.lng - a.lng)) * Math.cos(toRad(b.lat));
  const x =
    Math.cos(toRad(a.lat)) * Math.sin(toRad(b.lat)) -
    Math.sin(toRad(a.lat)) *
      Math.cos(toRad(b.lat)) *
      Math.cos(toRad(b.lng - a.lng));
  return ((Math.atan2(y, x) * 180) / Math.PI + 360) % 360;
}

/* ------------------------------------------------------------------------ */
/* Component                                                                 */
/* ------------------------------------------------------------------------ */

export function LiveResponseMap({
  request,
  responder,
  immersive = false,
  showAll = false,
  requests = [],
  mobileAction,
  landingPreview = false,
  previewLocation,
  className,
}: LiveResponseMapProps) {
  const containerRef = useRef<HTMLDivElement | null>(null);
  const LRef = useRef<typeof Leaflet | null>(null);
  const mapRef = useRef<Leaflet.Map | null>(null);
  const baseLayerRef = useRef<Leaflet.Layer[]>([]);
  const dataLayerRef = useRef<Leaflet.LayerGroup | null>(null);
  const routeLayerRef = useRef<Leaflet.LayerGroup | null>(null);
  const userLayerRef = useRef<Leaflet.LayerGroup | null>(null);
  const responderMarkerRef = useRef<Leaflet.Marker | null>(null);
  const lastFitKeyRef = useRef<string>("");

  const [ready, setReady] = useState(false);
  const [baseLayer, setBaseLayer] = useState<BaseLayer>("map");
  const [route, setRoute] = useState<{
    points: LatLng[];
    metres: number;
    seconds: number;
    exact: boolean;
  } | null>(null);
  const [locating, setLocating] = useState(false);

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
    return list
      .map((item) => ({ item, pos: toLatLng(item?.location) }))
      .filter(
        (entry): entry is { item: EmergencyRequest; pos: LatLng } =>
          entry.pos !== null
      );
  }, [landingPreview, showAll, requests, request]);

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
    if (!showAll && request && real) return real;
    if (landingPreview && target) {
      return real ?? { lat: target.lat + 0.018, lng: target.lng + 0.022 };
    }
    return null;
  }, [responder, request, showAll, landingPreview, target]);

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

      const map = L.map(containerRef.current, {
        center: [DEFAULT_CENTER.lat, DEFAULT_CENTER.lng],
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
      userLayerRef.current = L.layerGroup().addTo(map);
      mapRef.current = map;

      // Leaflet needs a size recalculation when its container is resized
      // (mobile sheets, responsive grids, etc).
      const observer = new ResizeObserver(() => map.invalidateSize());
      observer.observe(containerRef.current);
      (map as unknown as { _liveObserver: ResizeObserver })._liveObserver =
        observer;

      setReady(true);
    })();

    return () => {
      cancelled = true;
      const map = mapRef.current;
      if (map) {
        (
          map as unknown as { _liveObserver?: ResizeObserver }
        )._liveObserver?.disconnect();
        map.remove();
      }
      mapRef.current = null;
      responderMarkerRef.current = null;
      baseLayerRef.current = [];
      lastFitKeyRef.current = "";
      setReady(false);
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
  }, [ready, baseLayer]);

  /* ---------------------------------------------------------------- */
  /* Incident / preview markers + fitting the view                      */
  /* ---------------------------------------------------------------- */

  useEffect(() => {
    const L = LRef.current;
    const map = mapRef.current;
    const group = dataLayerRef.current;
    if (!ready || !L || !map || !group) return;

    group.clearLayers();

    incidents.forEach(({ item, pos }) => {
      const marker = L.marker([pos.lat, pos.lng], {
        icon: L.divIcon({
          className: "",
          html: incidentIconHtml(!showAll),
          iconSize: [46, 56],
          iconAnchor: [showAll ? 19 : 23, showAll ? 48 : 56],
          popupAnchor: [0, -50],
        }),
        zIndexOffset: 500,
      });

      if (landingPreview) {
        marker.bindTooltip(
          `<p style="margin:0;font-size:10px;font-weight:600;text-transform:uppercase;letter-spacing:.1em;color:#a33a38">Requester located</p>
           <p style="margin:4px 0 0;font-size:12px;font-weight:600;color:#102b3f">Location attached to request</p>`,
          {
            permanent: true,
            direction: "bottom",
            offset: [0, 4],
            className: "live-map-callout",
            interactive: false,
          }
        );
      } else {
        const address =
          item.location?.address &&
          item.location.address !== "Current device location"
            ? item.location.address
            : `${formatCoordinate(pos.lat, 5)}, ${formatCoordinate(pos.lng, 5)}`;
        marker.bindPopup(
          `<div style="font:600 12px/1.4 system-ui,sans-serif;color:#102b3f;min-width:160px">
             <div style="color:#a33a38;text-transform:uppercase;font-size:10px;letter-spacing:.08em">${escapeHtml(String(item.status ?? ""))}</div>
             <div style="margin-top:2px">${escapeHtml(String(item.category ?? "Emergency request"))}</div>
             <div style="margin-top:4px;font-weight:400;color:#5d7080">${escapeHtml(address)}</div>
             <div style="margin-top:4px;font-weight:400;color:#8a9aa4;font-size:11px">${escapeHtml(String(item.id ?? ""))}</div>
           </div>`
        );
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

    if (previewPos && !request) {
      L.marker([previewPos.lat, previewPos.lng], {
        icon: L.divIcon({
          className: "",
          html: incidentIconHtml(true),
          iconSize: [46, 56],
          iconAnchor: [23, 56],
        }),
        zIndexOffset: 500,
      }).addTo(group);

      const accuracy = Number(previewLocation?.accuracy);
      if (Number.isFinite(accuracy) && accuracy > 0 && accuracy < 5000) {
        L.circle([previewPos.lat, previewPos.lng], {
          radius: accuracy,
          color: "#1a73e8",
          weight: 1,
          fillColor: "#1a73e8",
          fillOpacity: 0.1,
          interactive: false,
        }).addTo(group);
      }
    }

    // Re-fit only when the *set* of things on the map changes, so live
    // position updates don't keep yanking the view away from the user.
    const points: LatLng[] = [
      ...incidents.map((entry) => entry.pos),
      ...(previewPos && !request ? [previewPos] : []),
      ...(responderPos ? [responderPos] : []),
    ];
    const fitKey = [
      incidents.map((e) => e.item.id).join(","),
      previewPos ? `${previewPos.lat.toFixed(4)},${previewPos.lng.toFixed(4)}` : "",
      responderPos ? "r" : "",
    ].join("|");

    if (fitKey !== lastFitKeyRef.current) {
      lastFitKeyRef.current = fitKey;
      if (points.length === 0) {
        map.setView([DEFAULT_CENTER.lat, DEFAULT_CENTER.lng], DEFAULT_ZOOM);
      } else if (points.length === 1) {
        map.setView([points[0].lat, points[0].lng], previewPos ? 17 : 15);
      } else {
        map.fitBounds(
          L.latLngBounds(points.map((p) => [p.lat, p.lng] as [number, number])),
          {
            paddingTopLeft: [40, 70],
            paddingBottomRight: [70, request ? 150 : 40],
            maxZoom: 16,
          }
        );
      }
    }
  }, [
    ready,
    incidents,
    previewPos,
    previewLocation?.accuracy,
    request,
    responderPos,
    showAll,
    landingPreview,
  ]);

  /* ---------------------------------------------------------------- */
  /* Route between responder and incident                               */
  /* ---------------------------------------------------------------- */

  const routeKey =
    responderPos && target
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
    const group = routeLayerRef.current;
    if (!ready || !L || !group) return;

    group.clearLayers();
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

    const heading =
      route.points.length > 1 ? bearing(route.points[0], route.points[1]) : 0;

    const marker = L.marker([responderPos.lat, responderPos.lng], {
      icon: L.divIcon({
        className: "",
        html: responderIconHtml(heading),
        iconSize: [44, 44],
        iconAnchor: [22, 22],
      }),
      zIndexOffset: 1000,
    });

    if (responder && !landingPreview) {
      marker.bindPopup(
        `<div style="font:600 12px/1.4 system-ui,sans-serif;color:#102b3f">
           ${escapeHtml(responder.name ?? "Responder")}
           <div style="font-weight:400;color:#5d7080">${escapeHtml(
             [responder.team, responder.vehicle].filter(Boolean).join(" · ")
           )}</div>
         </div>`
      );
    }

    marker.addTo(group);
    responderMarkerRef.current = marker;
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [ready, route]);

  /* Keep the responder marker in sync with live position updates. */
  useEffect(() => {
    if (landingPreview || !responderPos) return;
    responderMarkerRef.current?.setLatLng([responderPos.lat, responderPos.lng]);
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
      marker.setLatLng([a.lat + (b.lat - a.lat) * f, a.lng + (b.lng - a.lng) * f]);
      frame = requestAnimationFrame(tick);
    };
    frame = requestAnimationFrame(tick);
    return () => cancelAnimationFrame(frame);
  }, [landingPreview, route]);

  /* ---------------------------------------------------------------- */
  /* Controls                                                           */
  /* ---------------------------------------------------------------- */

  const locateMe = () => {
    const L = LRef.current;
    const map = mapRef.current;
    const group = userLayerRef.current;
    if (!L || !map || !group || !navigator.geolocation) return;

    setLocating(true);
    navigator.geolocation.getCurrentPosition(
      (pos) => {
        setLocating(false);
        const here: [number, number] = [pos.coords.latitude, pos.coords.longitude];
        group.clearLayers();
        L.circle(here, {
          radius: pos.coords.accuracy,
          color: "#1a73e8",
          weight: 1,
          fillColor: "#1a73e8",
          fillOpacity: 0.1,
          interactive: false,
        }).addTo(group);
        L.marker(here, {
          icon: L.divIcon({
            className: "",
            html: userIconHtml,
            iconSize: [22, 22],
            iconAnchor: [11, 11],
          }),
        })
          .bindPopup("You are here")
          .addTo(group);
        map.flyTo(here, Math.max(map.getZoom(), 16), { duration: 0.8 });
      },
      () => setLocating(false),
      { enableHighAccuracy: true, timeout: 10000, maximumAge: 15000 }
    );
  };

  const recenter = () => {
    const L = LRef.current;
    const map = mapRef.current;
    if (!L || !map) return;
    const points: LatLng[] = [
      ...incidents.map((e) => e.pos),
      ...(previewPos ? [previewPos] : []),
      ...(responderPos ? [responderPos] : []),
    ];
    if (points.length === 0) return;
    if (points.length === 1) {
      map.flyTo([points[0].lat, points[0].lng], 16, { duration: 0.6 });
    } else {
      map.flyToBounds(
        L.latLngBounds(points.map((p) => [p.lat, p.lng] as [number, number])),
        { padding: [60, 60], maxZoom: 16, duration: 0.6 }
      );
    }
  };

  const hasRequestLocation = Boolean(toLatLng(request?.location));

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
      {!ready ? (
        <div className="map-grid absolute inset-0 z-[1] animate-pulse" />
      ) : null}

      {/* Map labels */}
      <div className="pointer-events-none absolute left-3 top-3 z-[1000] flex flex-wrap gap-2 sm:left-4 sm:top-4">
        <Badge tone="success" className="bg-white/95 shadow-sm">
          <span className="mr-1.5 h-2 w-2 rounded-full bg-[#1f845b]" />
          {landingPreview
            ? "Location preview"
            : showAll
              ? `${incidents.length} on map`
              : "Live map"}
        </Badge>

        {request && !landingPreview ? (
          <Badge tone="slate" className="hidden bg-white/95 shadow-sm sm:inline-flex">
            {request.id}
          </Badge>
        ) : null}

        {route?.exact && route.metres > 0 && !landingPreview ? (
          <Badge tone="blue" className="bg-white/95 shadow-sm">
            {formatDistance(route.metres)} · {Math.max(1, Math.round(route.seconds / 60))} min drive
          </Badge>
        ) : null}
      </div>

      {/* Map controls (same look as before) */}
      <div className="absolute right-3 top-3 z-[1000] grid gap-2 sm:right-4 sm:top-4">
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
            <Button
              variant="outline"
              size="icon"
              aria-label="Show my location"
              title="My location"
              onClick={locateMe}
              className="bg-white shadow-md"
            >
              <LocateFixed className={cn("h-5 w-5", locating && "animate-pulse text-[#1a73e8]")} />
            </Button>

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
                Location confirmed
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
      {request && !landingPreview ? (
        <div className="absolute inset-x-0 bottom-0 z-[1000] border-t border-white/70 bg-white/94 p-3.5 shadow-[0_-10px_30px_rgba(16,43,63,.10)] backdrop-blur-lg sm:inset-x-auto sm:bottom-4 sm:left-4 sm:w-[390px] sm:rounded-2xl sm:border sm:p-4 sm:shadow-xl">
          <div className="flex items-start gap-3">
            <span className="grid h-10 w-10 shrink-0 place-items-center rounded-xl bg-[#ffeded] text-[#c73937]">
              <Crosshair className="h-5 w-5" />
            </span>
            <div className="min-w-0 flex-1">
              <div className="flex items-center justify-between gap-3">
                <p className="text-xs font-semibold uppercase tracking-wide text-[#7b8b96]">
                  {request.status}
                </p>
                {request.etaMinutes ? (
                  <span className="rounded-full bg-[#e7f3f4] px-2 py-1 text-[10px] font-semibold text-[#0f6872]">
                    ETA {request.etaMinutes} min
                  </span>
                ) : null}
              </div>
              <p className="mt-1 truncate text-sm font-semibold">
                {hasRequestLocation &&
                request.location?.address &&
                request.location.address !== "Current device location"
                  ? request.location.address
                  : hasRequestLocation
                    ? `${formatCoordinate(request.location.lat)}, ${formatCoordinate(request.location.lng)}`
                    : "Location unavailable"}
              </p>
              <p className="mt-1 text-xs text-[#687b89]">
                Emergency request location
              </p>
            </div>
          </div>
          {mobileAction ? <div className="mt-3 md:hidden">{mobileAction}</div> : null}
        </div>
      ) : null}
    </div>
  );
}
