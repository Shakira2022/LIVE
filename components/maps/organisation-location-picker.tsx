"use client";

import "leaflet/dist/leaflet.css";

import { LoaderCircle, MapPin } from "lucide-react";
import { useEffect, useRef } from "react";
import type * as Leaflet from "leaflet";

export type OrganisationPoint = { latitude: number; longitude: number };

export function OrganisationLocationPicker({
  point,
  onChange,
  loading = false,
  errorMessage = "",
}: {
  point: OrganisationPoint | null;
  onChange: (point: OrganisationPoint) => void;
  loading?: boolean;
  errorMessage?: string;
}) {
  const elementRef = useRef<HTMLDivElement | null>(null);
  const mapRef = useRef<Leaflet.Map | null>(null);
  const markerRef = useRef<Leaflet.Marker | null>(null);
  const onChangeRef = useRef(onChange);
  onChangeRef.current = onChange;

  useEffect(() => {
    let disposed = false;
    void import("leaflet").then((leaflet) => {
      if (disposed || !elementRef.current || mapRef.current) return;
      const initial: [number, number] = point
        ? [point.latitude, point.longitude]
        : [-26.6736, 27.9261];
      const map = leaflet.map(elementRef.current, { scrollWheelZoom: true }).setView(initial, point ? 15 : 9);
      leaflet.tileLayer("https://{s}.tile.openstreetmap.org/{z}/{x}/{y}.png", {
        maxZoom: 19,
        attribution: '&copy; <a href="https://www.openstreetmap.org/copyright">OpenStreetMap</a>',
      }).addTo(map);
      const pinIcon = leaflet.divIcon({
        className: "organisation-location-pin",
        html: '<div style="width:26px;height:26px;background:#d53f3d;border:3px solid white;border-radius:50% 50% 50% 0;transform:rotate(-45deg);box-shadow:0 3px 10px rgba(16,43,63,.35)"></div>',
        iconSize: [26, 26],
        iconAnchor: [13, 26],
      });
      const marker = leaflet.marker(initial, { draggable: true, icon: pinIcon }).addTo(map);
      marker.on("dragend", () => {
        const position = marker.getLatLng();
        onChangeRef.current({ latitude: position.lat, longitude: position.lng });
      });
      map.on("click", (event: Leaflet.LeafletMouseEvent) => {
        marker.setLatLng(event.latlng);
        onChangeRef.current({ latitude: event.latlng.lat, longitude: event.latlng.lng });
      });
      mapRef.current = map;
      markerRef.current = marker;
      window.setTimeout(() => map.invalidateSize(), 50);
    });

    return () => {
      disposed = true;
      mapRef.current?.remove();
      mapRef.current = null;
      markerRef.current = null;
    };
  }, []);

  useEffect(() => {
    if (!point || !mapRef.current || !markerRef.current) return;
    const position: [number, number] = [point.latitude, point.longitude];
    markerRef.current.setLatLng(position);
    mapRef.current.setView(position, Math.max(mapRef.current.getZoom(), 15));
  }, [point?.latitude, point?.longitude]);

  return (
    <div className="relative overflow-hidden rounded-xl border border-[#dfe7ec] bg-[#e9eff3]">
      <div ref={elementRef} className="h-[360px] w-full sm:h-[480px]" aria-label="Organisation location map" />
      <div className="absolute left-3 top-3 z-[500] flex items-center gap-2 rounded-full bg-white/95 px-3 py-2 text-xs font-semibold text-[#18364a] shadow">
        {loading ? <LoaderCircle className="h-4 w-4 animate-spin" /> : <MapPin className="h-4 w-4 text-[#d53f3d]" />}
        {loading ? "Finding address on map…" : "Drag the pin or click the map to set the location"}
      </div>
      {errorMessage ? (
        <div role="alert" className="absolute bottom-3 left-3 right-3 z-[500] rounded-lg border border-[#efc9c7] bg-white/95 px-3 py-2 text-sm font-semibold text-[#a93331] shadow">
          {errorMessage}
        </div>
      ) : null}
    </div>
  );
}
