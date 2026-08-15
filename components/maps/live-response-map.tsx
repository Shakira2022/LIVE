"use client";

import { motion } from "framer-motion";
import {
  Crosshair,
  Layers3,
  LocateFixed,
  MapPin,
  Minus,
  Navigation2,
  Plus,
} from "lucide-react";
import {
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
  const [zoom, setZoom] = useState(1);
  const [layer, setLayer] = useState(false);

  /*
   * The landing page uses its own requester marker.
   * The normal request marker must therefore remain
   * hidden on the landing-page map.
   */
  const all = landingPreview
    ? []
    : showAll
      ? requests
      : request
        ? [request]
        : [];

  const showPreviewPin =
    landingPreview ||
    Boolean(previewLocation);

  /*
   * The landing preview always demonstrates a route.
   * Operational maps show the route once a responder
   * has been assigned.
   */
  const showResponseRoute =
    landingPreview ||
    Boolean(request && responder);

  return (
    <div
      className={cn(
        "map-grid relative overflow-hidden bg-[#e9eff3]",
        immersive
          ? "h-full min-h-0 rounded-none md:h-[72dvh] md:min-h-[500px] md:rounded-[22px]"
          : landingPreview
            ? "h-[58dvh] min-h-[470px] rounded-[11px]"
            : "h-[56dvh] min-h-[430px] rounded-none md:rounded-[20px]",
        className
      )}
    >
      {/* Map background */}
      <div
        className="absolute inset-0 opacity-90"
        style={{
          transform: `scale(${zoom})`,
          transition: "transform 0.25s ease",
        }}
      >
        <svg
          viewBox="0 0 1000 700"
          className="h-full w-full"
          preserveAspectRatio="xMidYMid slice"
          aria-hidden="true"
        >
          {/* Main curved road */}
          <path
            d="M-40 570 C120 470, 240 610, 400 470 S720 290, 1050 370"
            fill="none"
            stroke="#cbd7de"
            strokeWidth="72"
          />

          <path
            className="map-road"
            d="M-40 570 C120 470, 240 610, 400 470 S720 290, 1050 370"
            fill="none"
            stroke="#ffffff"
            strokeWidth="48"
          />

          {/* Vertical road */}
          <path
            d="M120 -30 C170 120, 260 210, 450 260 S760 350, 920 730"
            fill="none"
            stroke="#cbd7de"
            strokeWidth="58"
          />

          <path
            className="map-road"
            d="M120 -30 C170 120, 260 210, 450 260 S760 350, 920 730"
            fill="none"
            stroke="#ffffff"
            strokeWidth="36"
          />

          {/* Top road */}
          <path
            d="M-50 160 C160 210, 300 150, 520 110 S850 60, 1050 145"
            fill="none"
            stroke="#d4dee4"
            strokeWidth="38"
          />

          <path
            className="map-road"
            d="M-50 160 C160 210, 300 150, 520 110 S850 60, 1050 145"
            fill="none"
            stroke="#ffffff"
            strokeWidth="22"
          />

          {/* Response route */}
          {showResponseRoute ? (
            <motion.path
              d="M340 420 C440 375 520 355 610 330 S710 295 760 245"
              fill="none"
              stroke="#0f6872"
              strokeWidth="8"
              strokeLinecap="round"
              strokeDasharray="16 16"
              initial={{
                pathLength: 0,
              }}
              animate={{
                pathLength: 1,
              }}
              transition={{
                duration: 1.1,
                ease: "easeInOut",
              }}
            />
          ) : null}

          {/* Optional map layer */}
          {layer ? (
            <>
              <rect
                x="40"
                y="40"
                width="190"
                height="130"
                rx="18"
                fill="#d9eedd"
                opacity=".8"
              />

              <rect
                x="690"
                y="480"
                width="230"
                height="160"
                rx="18"
                fill="#d9eedd"
                opacity=".8"
              />
            </>
          ) : null}
        </svg>
      </div>

      {/*
       * Normal emergency markers.
       * These are hidden from the landing preview so that
       * the landing page contains only one requester marker.
       */}
      {all.map((item, index) => (
        <div
          key={item.id}
          className="absolute"
          style={{
            left: `${
              42 + (index % 3) * 15
            }%`,
            top: `${
              48 - (index % 2) * 21
            }%`,
          }}
        >
          <span className="pulse-ring absolute inset-0 rounded-full bg-[#d53f3d]/30" />

          <span className="relative grid h-11 w-11 place-items-center rounded-full border-4 border-white bg-[#d53f3d] text-white shadow-xl">
            <MapPin className="h-5 w-5" />
          </span>
        </div>
      ))}

      {/*
       * Landing-page requester marker or location-preview marker.
       * This is the only red requester marker shown on the landing page.
       */}
      {showPreviewPin ? (
        <div className="absolute left-[46%] top-[47%] -translate-x-1/2 -translate-y-1/2">
          <span className="pulse-ring absolute inset-0 rounded-full bg-[#d53f3d]/30" />

          <motion.div
            initial={{
              y: -34,
              opacity: 0,
            }}
            animate={{
              y: [0, -8, 0],
              opacity: 1,
            }}
            transition={{
              opacity: {
                duration: 0.25,
              },
              y: {
                duration: 1.7,
                repeat: Infinity,
                ease: "easeInOut",
              },
            }}
            className="relative grid h-14 w-14 place-items-center rounded-full border-4 border-white bg-[#d53f3d] text-white shadow-[0_12px_25px_rgba(213,63,61,.28)]"
          >
            <MapPin className="h-6 w-6" />
          </motion.div>

          {landingPreview ? (
            <motion.div
              initial={{
                opacity: 0,
                y: 8,
              }}
              animate={{
                opacity: 1,
                y: 0,
              }}
              transition={{
                delay: 0.35,
              }}
              className="absolute left-1/2 top-[66px] w-48 -translate-x-1/2 border-l-2 border-[#d53f3d] bg-white/95 px-3 py-2.5 shadow-lg backdrop-blur"
            >
              <p className="text-[10px] font-semibold uppercase tracking-[0.1em] text-[#a33a38]">
                Requester located
              </p>

              <p className="mt-1 text-xs font-semibold text-[#102b3f]">
                Location attached to request
              </p>
            </motion.div>
          ) : null}
        </div>
      ) : null}

      {/*
       * Landing-page responder.
       *
       * Its position follows the same approximate points as
       * the teal SVG response route:
       *
       * M340 420
       * C440 375
       * 520 355
       * 610 330
       * S710 295
       * 760 245
       */}
      {landingPreview ? (
        <motion.div
          className="absolute z-20"
          initial={{
            left: "34%",
            top: "60%",
          }}
          animate={{
            left: [
              "34%",
              "44%",
              "52%",
              "61%",
              "70%",
              "76%",
            ],
            top: [
              "60%",
              "54%",
              "51%",
              "47%",
              "42%",
              "35%",
            ],
          }}
          transition={{
            duration: 8,
            repeat: Infinity,
            repeatType: "reverse",
            ease: "linear",
          }}
        >
          <span className="grid h-12 w-12 -translate-x-1/2 -translate-y-1/2 place-items-center rounded-xl border-4 border-white bg-[#0f6872] text-white shadow-xl">
            <Navigation2 className="h-5 w-5 rotate-[-25deg]" />
          </span>
        </motion.div>
      ) : request && responder ? (
        /*
         * Operational-map responder.
         * This keeps the existing application animation.
         */
        <motion.div
          className="absolute left-[70%] top-[28%]"
          animate={{
            x: [
              0,
              -24,
              -48,
              -72,
            ],
            y: [
              0,
              12,
              30,
              54,
            ],
          }}
          transition={{
            duration: 8,
            repeat: Infinity,
            repeatType: "reverse",
            ease: "linear",
          }}
        >
          <span className="grid h-12 w-12 place-items-center rounded-xl border-4 border-white bg-[#0f6872] text-white shadow-xl">
            <Navigation2 className="h-5 w-5 rotate-[-25deg]" />
          </span>
        </motion.div>
      ) : null}

      {/* Map labels */}
      <div className="absolute left-3 top-3 flex flex-wrap gap-2 sm:left-4 sm:top-4">
        <Badge tone="success">
          <span className="mr-1.5 h-2 w-2 rounded-full bg-[#1f845b]" />

          {landingPreview
            ? "Location preview"
            : "Live mock data"}
        </Badge>

        {request ? (
          <Badge
            tone="slate"
            className="hidden sm:inline-flex"
          >
            {request.id}
          </Badge>
        ) : null}
      </div>

      {/* Operational map controls */}
      {!landingPreview ? (
        <>
          <div className="absolute right-3 top-3 grid gap-2 sm:right-4 sm:top-4">
            <Button
              variant="outline"
              size="icon"
              aria-label="Map layers"
              onClick={() =>
                setLayer((value) => !value)
              }
            >
              <Layers3 className="h-5 w-5" />
            </Button>

            <Button
              variant="outline"
              size="icon"
              aria-label="Locate"
            >
              <LocateFixed className="h-5 w-5" />
            </Button>
          </div>

          <div className="absolute right-3 top-32 grid overflow-hidden rounded-xl border border-[#d7e0e7] bg-white shadow-lg sm:right-4">
            <button
              type="button"
              onClick={() =>
                setZoom((value) =>
                  Math.min(
                    1.35,
                    value + 0.08
                  )
                )
              }
              className="grid h-10 w-10 place-items-center hover:bg-[#eef3f5]"
              aria-label="Zoom in"
            >
              <Plus className="h-4 w-4" />
            </button>

            <button
              type="button"
              onClick={() =>
                setZoom((value) =>
                  Math.max(
                    0.85,
                    value - 0.08
                  )
                )
              }
              className="grid h-10 w-10 place-items-center border-t border-[#e1e7eb] hover:bg-[#eef3f5]"
              aria-label="Zoom out"
            >
              <Minus className="h-4 w-4" />
            </button>
          </div>
        </>
      ) : null}

      {/* Location-confirmation information */}
      {previewLocation && !request ? (
        <div className="absolute inset-x-0 bottom-0 border-t border-white/70 bg-white/95 p-3.5 shadow-[0_-10px_30px_rgba(16,43,63,.10)] backdrop-blur-lg sm:inset-x-auto sm:bottom-4 sm:left-4 sm:w-[390px] sm:border-0 sm:p-4 sm:shadow-xl">
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
                  : `${previewLocation.lat.toFixed(6)}, ${previewLocation.lng.toFixed(6)}`}
              </p>

              <p className="mt-1 text-xs text-[#687b89]">
                {previewLocation.lat.toFixed(5)},{" "}
                {previewLocation.lng.toFixed(5)}

                {previewLocation.accuracy
                  ? ` · ±${Math.round(
                      previewLocation.accuracy
                    )}m`
                  : ""}
              </p>
            </div>
          </div>
        </div>
      ) : null}

      {/* Active-request information */}
      {request ? (
        <div className="absolute inset-x-0 bottom-0 border-t border-white/70 bg-white/94 p-3.5 shadow-[0_-10px_30px_rgba(16,43,63,.10)] backdrop-blur-lg sm:inset-x-auto sm:bottom-4 sm:left-4 sm:w-[390px] sm:rounded-2xl sm:border sm:p-4 sm:shadow-xl">
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
                {request.location.address &&
                request.location.address !== "Current device location"
                  ? request.location.address
                  : `${request.location.lat.toFixed(6)}, ${request.location.lng.toFixed(6)}`}
              </p>

              <p className="mt-1 text-xs text-[#687b89]">
                {request.location.method}

                {request.location.accuracy
                  ? ` · ±${request.location.accuracy}m`
                  : ""}
              </p>
            </div>
          </div>

          {mobileAction ? (
            <div className="mt-3 md:hidden">
              {mobileAction}
            </div>
          ) : null}
        </div>
      ) : null}
    </div>
  );
}