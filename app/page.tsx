"use client";

import { motion } from "framer-motion";
import {
  ArrowRight,
  ChevronRight,
  ClipboardCheck,
  LocateFixed,
  MapPin,
  Radio,
  ShieldCheck,
  Siren,
  Users,
} from "lucide-react";
import Link from "next/link";
import { useState } from "react";
import { Brand } from "@/components/layout/brand";
import { PublicHeader } from "@/components/layout/public-header";
import { LiveResponseMap } from "@/components/maps/live-response-map";
import { Button } from "@/components/ui/button";
import { Sheet } from "@/components/ui/sheet";
import { useMockStore } from "@/lib/mock-store";

const featureDetails = [
  {
    id: "location",
    icon: LocateFixed,
    number: "01",
    title: "Accurate requester location",
    summary: "LIVE captures the device position and presents it clearly to the response team.",
    description:
      "When a requester reaches the location step, LIVE asks the browser for a high-accuracy position. The interface shows each location attempt, the remaining time and whether the coordinates were confirmed. The requester can see that the system is working instead of waiting on a blank screen.",
    points: [
      "Captures latitude, longitude, accuracy and capture time.",
      "Shows a visible location-in-progress state.",
      "Retries failed location attempts before asking the requester to try again.",
      "Displays the confirmed point on the response map.",
    ],
  },
  {
    id: "progress",
    icon: Radio,
    number: "02",
    title: "Live request progress",
    summary: "The requester can follow each approved response stage from submission to closure.",
    description:
      "LIVE turns operational updates into clear language for the requester. A status timeline shows when the request was submitted, received, assigned, placed en route, marked as arrived and finally closed or cancelled.",
    points: [
      "Uses an ordered status history instead of replacing earlier events.",
      "Displays an ETA only when one is available from the response workflow.",
      "Keeps the map and current status together on mobile.",
      "Creates in-app notifications for important changes.",
    ],
  },
  {
    id: "workspaces",
    icon: Users,
    number: "03",
    title: "Purpose-built workspaces",
    summary: "Each role sees the controls and information needed for its responsibility.",
    description:
      "The requester, dispatcher, responder, administrator and auditor do not share one crowded dashboard. LIVE gives every role a focused workspace with role-appropriate navigation, mobile layouts and access boundaries.",
    points: [
      "Requesters create and track only their own requests.",
      "Dispatchers review, route, assign and update authorised requests.",
      "Responders receive a mission-focused map and action sequence.",
      "Administrators and auditors receive controlled management or read-only views.",
    ],
  },
  {
    id: "audit",
    icon: ShieldCheck,
    number: "04",
    title: "Traceable operational actions",
    summary: "Important changes remain connected to an actor, time, target and result.",
    description:
      "LIVE records significant request and access activity so that authorised staff can understand what happened during an incident. The prototype keeps audit information separate from ordinary user-facing notifications.",
    points: [
      "Records request creation, assignment and status changes.",
      "Captures the acting user and their role.",
      "Maintains correlation identifiers for important actions.",
      "Keeps the auditor workspace read-only.",
    ],
  },
] as const;

type Feature = (typeof featureDetails)[number];

export default function LandingPage() {
  const { db } = useMockStore();
  const [selectedFeature, setSelectedFeature] = useState<Feature | null>(null);
  const request = db?.requests[0];
  const responder = request
    ? db?.responders.find((item) => item.id === request.assignedResponderId)
    : undefined;

  return (
    <div className="min-h-dvh bg-[#f5f7f9]">
      <PublicHeader />

      <main className="pt-16">
        <section className="border-b border-[#dfe6ea] bg-white">
          <div className="mx-auto grid max-w-7xl gap-10 px-4 py-12 sm:px-6 sm:py-16 lg:grid-cols-[0.84fr_1.16fr] lg:items-center lg:py-20">
            <motion.div
              initial={{ opacity: 0, y: 14 }}
              animate={{ opacity: 1, y: 0 }}
              transition={{ duration: 0.45 }}
              className="max-w-xl"
            >
              <div className="inline-flex items-center gap-2 border-l-2 border-[#0f6872] pl-3 text-xs font-semibold uppercase tracking-[0.14em] text-[#0f6872]">
                <span className="h-2 w-2 rounded-full bg-[#1f845b]" />
                Location-aware emergency coordination
              </div>

              <h1 className="mt-6 text-4xl font-bold leading-[1.08] tracking-[-0.035em] text-[#102b3f] sm:text-5xl lg:text-[3.6rem]">
                One request. One confirmed location. One connected response.
              </h1>

              <p className="mt-5 max-w-lg text-base leading-7 text-[#607482] sm:text-lg">
                LIVE helps a requester share essential incident information, confirms their device location and gives authorised teams a clear path from dispatch to arrival.
              </p>

              <div className="mt-8 flex flex-col gap-3 sm:flex-row">
                <Link href="/login">
                  <Button size="lg" className="w-full sm:w-auto">
                    Sign in to LIVE
                    <ArrowRight className="h-5 w-5" />
                  </Button>
                </Link>
                <Link href="/register">
                  <Button size="lg" variant="outline" className="w-full sm:w-auto">
                    Create requester account
                  </Button>
                </Link>
              </div>

              <div className="mt-9 grid gap-4 border-t border-[#dfe6ea] pt-6 sm:grid-cols-3">
                {[
                  ["Fast", "Short guided request flow"],
                  ["Visible", "Location and progress states"],
                  ["Controlled", "Role-based access and actions"],
                ].map(([title, text]) => (
                  <div key={title}>
                    <p className="text-sm font-semibold text-[#102b3f]">{title}</p>
                    <p className="mt-1 text-xs leading-5 text-[#71838e]">{text}</p>
                  </div>
                ))}
              </div>
            </motion.div>

            <motion.div
              initial={{ opacity: 0, scale: 0.985 }}
              animate={{ opacity: 1, scale: 1 }}
              transition={{ duration: 0.5, delay: 0.08 }}
              className="relative overflow-hidden rounded-[16px] border border-[#d5dfe4] bg-[#edf2f4] p-1.5 shadow-[0_20px_55px_rgba(16,43,63,.10)]"
            >
              <LiveResponseMap
                request={request}
                responder={responder}
                landingPreview
              />
            </motion.div>
          </div>
        </section>

        <section className="mx-auto max-w-7xl px-4 py-14 sm:px-6 sm:py-20">
          <div className="grid gap-10 lg:grid-cols-[0.72fr_1.28fr] lg:gap-16">
            <div className="lg:sticky lg:top-24 lg:self-start">
              <p className="text-xs font-semibold uppercase tracking-[0.14em] text-[#0f6872]">
                The LIVE response path
              </p>
              <h2 className="mt-3 text-3xl font-bold tracking-[-0.025em] text-[#102b3f] sm:text-4xl">
                Clear actions without a crowded emergency screen.
              </h2>
              <p className="mt-4 max-w-md leading-7 text-[#647783]">
                The requester completes only the essential incident details. LIVE then handles location confirmation visibly before the final submission step.
              </p>
            </div>

            <div className="border-t border-[#d9e2e7]">
              {[
                {
                  icon: Siren,
                  number: "01",
                  title: "Describe the incident",
                  text: "Choose the emergency category, priority and a short description of the help required.",
                },
                {
                  icon: MapPin,
                  number: "02",
                  title: "Confirm the requester position",
                  text: "The browser locates the requester, displays progress and confirms the captured coordinates.",
                },
                {
                  icon: ClipboardCheck,
                  number: "03",
                  title: "Review and submit",
                  text: "LIVE presents the request and location for a final check before adding it to the response queue.",
                },
              ].map((item) => {
                const Icon = item.icon;
                return (
                  <div
                    key={item.number}
                    className="grid gap-4 border-b border-[#d9e2e7] py-7 sm:grid-cols-[56px_72px_1fr] sm:items-start"
                  >
                    <span className="grid h-11 w-11 place-items-center rounded-xl bg-[#e7f3f4] text-[#0f6872]">
                      <Icon className="h-5 w-5" />
                    </span>
                    <span className="pt-2 text-xs font-semibold text-[#8b9aa4]">{item.number}</span>
                    <div>
                      <h3 className="text-lg font-semibold text-[#102b3f]">{item.title}</h3>
                      <p className="mt-2 max-w-2xl text-sm leading-6 text-[#657985]">{item.text}</p>
                    </div>
                  </div>
                );
              })}
            </div>
          </div>
        </section>

        <section id="how-it-works" className="border-y border-[#dfe6ea] bg-white">
          <div className="mx-auto max-w-7xl px-4 py-14 sm:px-6 sm:py-20">
            <div className="grid gap-8 lg:grid-cols-[0.72fr_1.28fr] lg:gap-16">
              <div>
                <p className="text-xs font-semibold uppercase tracking-[0.14em] text-[#0f6872]">
                  Built for the people using it
                </p>
                <h2 className="mt-3 text-3xl font-bold tracking-[-0.025em] text-[#102b3f]">
                  Understand each capability before relying on it.
                </h2>
                <p className="mt-4 leading-7 text-[#647783]">
                  Open any capability to see what it does, what the requester sees and how it supports the response workflow.
                </p>
              </div>

              <div className="border-t border-[#d9e2e7]">
                {featureDetails.map((item) => {
                  const Icon = item.icon;
                  return (
                    <button
                      key={item.id}
                      type="button"
                      onClick={() => setSelectedFeature(item)}
                      className="group grid w-full gap-4 border-b border-[#d9e2e7] py-6 text-left transition hover:bg-[#f7fafb] sm:grid-cols-[52px_54px_1fr_36px] sm:items-center sm:px-3"
                    >
                      <span className="grid h-11 w-11 place-items-center rounded-xl bg-[#e7f3f4] text-[#0f6872]">
                        <Icon className="h-5 w-5" />
                      </span>
                      <span className="text-xs font-semibold text-[#8c9aa4]">{item.number}</span>
                      <span>
                        <span className="block text-base font-semibold text-[#102b3f]">{item.title}</span>
                        <span className="mt-1 block text-sm leading-6 text-[#657985]">{item.summary}</span>
                      </span>
                      <ChevronRight className="hidden h-5 w-5 text-[#8a9aa4] transition group-hover:translate-x-1 group-hover:text-[#0f6872] sm:block" />
                    </button>
                  );
                })}
              </div>
            </div>
          </div>
        </section>

        <section className="mx-auto max-w-7xl px-4 py-14 sm:px-6 sm:py-20">
          <div className="grid overflow-hidden rounded-[18px] bg-[#102b3f] text-white lg:grid-cols-[1fr_0.72fr]">
            <div className="p-7 sm:p-10">
              <p className="text-xs font-semibold uppercase tracking-[0.14em] text-[#88d3d6]">
                A responsive web application
              </p>
              <h2 className="mt-4 max-w-2xl text-3xl font-bold tracking-[-0.025em]">
                Desktop for operational work. Mobile for urgent action.
              </h2>
              <p className="mt-4 max-w-2xl leading-7 text-white/70">
                LIVE restructures the same workflow for each screen size. Mobile uses guided steps, bottom navigation, full-height maps and focused sheets instead of compressed desktop panels.
              </p>
            </div>
            <div className="border-t border-white/10 bg-white/[0.04] p-7 sm:p-10 lg:border-l lg:border-t-0">
              <div className="grid gap-4">
                {["Large touch targets", "Visible loading states", "No overlapping controls", "Role-aware navigation"].map((text) => (
                  <div key={text} className="flex items-center gap-3">
                    <span className="grid h-8 w-8 place-items-center rounded-full bg-white/10">
                      <ShieldCheck className="h-4 w-4 text-[#88d3d6]" />
                    </span>
                    <span className="font-medium">{text}</span>
                  </div>
                ))}
              </div>
            </div>
          </div>
        </section>
                <section
          id="about"
          className="border-y border-[#dfe6ea] bg-[#f5f7f9]"
        >
          <div className="mx-auto max-w-7xl px-4 py-14 sm:px-6 sm:py-20">
            <div className="grid gap-10 lg:grid-cols-[0.8fr_1.2fr] lg:items-center lg:gap-16">

              <div>
                <p className="text-xs font-semibold uppercase tracking-[0.14em] text-[#0f6872]">
                  About LIVE
                </p>

                <h2 className="mt-3 text-3xl font-bold tracking-[-0.025em] text-[#102b3f] sm:text-4xl">
                  Emergency coordination made simpler.
                </h2>

                <p className="mt-5 max-w-xl text-base leading-7 text-[#647783]">
                  LIVE is designed to make emergency requests easier to
                  understand, submit and coordinate. It connects the
                  requester with authorised response teams while keeping
                  important information visible throughout the process.
                </p>

                <Link href="/register" className="mt-7 inline-block">
                  <Button size="lg">
                    Get started
                    <ArrowRight className="h-5 w-5" />
                  </Button>
                </Link>
              </div>

              <div className="grid gap-4 sm:grid-cols-2">

                <div className="rounded-2xl border border-[#d9e2e7] bg-white p-6 shadow-sm">
                  <span className="grid h-11 w-11 place-items-center rounded-xl bg-[#e7f3f4] text-[#0f6872]">
                    <MapPin className="h-5 w-5" />
                  </span>

                  <h3 className="mt-5 text-lg font-semibold text-[#102b3f]">
                    Location-aware
                  </h3>

                  <p className="mt-2 text-sm leading-6 text-[#657985]">
                    Help teams understand where assistance is needed by
                    confirming the requester's location.
                  </p>
                </div>

                <div className="rounded-2xl border border-[#d9e2e7] bg-white p-6 shadow-sm">
                  <span className="grid h-11 w-11 place-items-center rounded-xl bg-[#e7f3f4] text-[#0f6872]">
                    <Siren className="h-5 w-5" />
                  </span>

                  <h3 className="mt-5 text-lg font-semibold text-[#102b3f]">
                    Simple requests
                  </h3>

                  <p className="mt-2 text-sm leading-6 text-[#657985]">
                    A guided process helps users provide the essential
                    information without unnecessary steps.
                  </p>
                </div>

                <div className="rounded-2xl border border-[#d9e2e7] bg-white p-6 shadow-sm">
                  <span className="grid h-11 w-11 place-items-center rounded-xl bg-[#e9f6ef] text-[#1f845b]">
                    <ShieldCheck className="h-5 w-5" />
                  </span>

                  <h3 className="mt-5 text-lg font-semibold text-[#102b3f]">
                    Controlled access
                  </h3>

                  <p className="mt-2 text-sm leading-6 text-[#657985]">
                    Role-based access helps ensure that users and response
                    teams see the information relevant to them.
                  </p>
                </div>

                <div className="rounded-2xl border border-[#d9e2e7] bg-white p-6 shadow-sm">
                  <span className="grid h-11 w-11 place-items-center rounded-xl bg-[#e7f3f4] text-[#0f6872]">
                    <ClipboardCheck className="h-5 w-5" />
                  </span>

                  <h3 className="mt-5 text-lg font-semibold text-[#102b3f]">
                    Clear progress
                  </h3>

                  <p className="mt-2 text-sm leading-6 text-[#657985]">
                    Users can understand what is happening from request
                    submission through to response.
                  </p>
                </div>

              </div>
            </div>
          </div>
        </section>
      </main>

      <footer className="border-t border-[#dfe6ea] bg-white">
        <div className="mx-auto flex max-w-7xl flex-col gap-4 px-4 py-8 sm:flex-row sm:items-center sm:justify-between sm:px-6">
          <Brand compact />
          <p className="max-w-2xl text-xs leading-5 text-[#71828d]">
            Prototype only. LIVE does not replace official emergency numbers or confirm that real emergency services have been contacted.
          </p>
        </div>
      </footer>

      <Sheet
        open={Boolean(selectedFeature)}
        onOpenChange={(open) => {
          if (!open) setSelectedFeature(null);
        }}
        title={selectedFeature?.title || "LIVE capability"}
        description="How this capability supports the requester and response team"
        side="right"
      >
        {selectedFeature ? (
          <div className="p-5 sm:p-6">
            <span className="grid h-12 w-12 place-items-center rounded-xl bg-[#e7f3f4] text-[#0f6872]">
              <selectedFeature.icon className="h-6 w-6" />
            </span>
            <p className="mt-5 text-base leading-7 text-[#536b78]">{selectedFeature.description}</p>
            <div className="mt-6 border-t border-[#dfe6ea]">
              {selectedFeature.points.map((point) => (
                <div key={point} className="flex gap-3 border-b border-[#dfe6ea] py-4">
                  <span className="mt-0.5 grid h-6 w-6 shrink-0 place-items-center rounded-full bg-[#e9f6ef] text-[#1f845b]">
                    <ShieldCheck className="h-3.5 w-3.5" />
                  </span>
                  <p className="text-sm leading-6 text-[#5e7380]">{point}</p>
                </div>
              ))}
            </div>
            <Link href="/login" className="mt-7 block">
              <Button size="lg" className="w-full">
                Sign in to explore LIVE
                <ArrowRight className="h-5 w-5" />
              </Button>
            </Link>
          </div>
        ) : null}
      </Sheet>
    </div>
  );
}
