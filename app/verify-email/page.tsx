"use client";

import Link from "next/link";

import {
  CheckCircle2,
  CircleAlert,
  LoaderCircle,
  MailCheck,
  ShieldCheck,
} from "lucide-react";

import {
  Suspense,
  useEffect,
  useRef,
  useState,
} from "react";

import {
  useSearchParams,
} from "next/navigation";

type VerificationState =
  | "loading"
  | "success"
  | "error"
  | "missing";

/* ============================================================
   PAGE
   ============================================================ */

export default function VerifyEmailPage() {
  return (
    <Suspense
      fallback={
        <VerificationShell
          state="loading"
          message="Preparing email verification..."
        />
      }
    >
      <VerifyEmailContent />
    </Suspense>
  );
}

/* ============================================================
   CONTENT
   ============================================================ */

function VerifyEmailContent() {
  const searchParams =
    useSearchParams();

  const token =
    searchParams
      .get("token")
      ?.trim() ?? "";

  const hasSubmitted =
    useRef(false);

  const [
    state,
    setState,
  ] =
    useState<VerificationState>(
      token
        ? "loading"
        : "missing"
    );

  const [
    message,
    setMessage,
  ] =
    useState(
      token
        ? "Checking your secure verification link..."
        : "This verification link is missing its token."
    );

  useEffect(() => {
    if (!token) {
      setState("missing");

      setMessage(
        "This verification link is incomplete. Open the latest verification email from LIVE and use the Verify email button."
      );

      return;
    }

    /*
     * React Strict Mode may run effects twice in development.
     * Do not send the token twice.
     */

    if (
      hasSubmitted.current
    ) {
      return;
    }

    hasSubmitted.current =
      true;

    let cancelled =
      false;

    async function verifyEmail() {
      try {
        setState(
          "loading"
        );

        setMessage(
          "Checking your secure verification link..."
        );

        const response =
          await fetch(
            "/api/auth/verify-email",
            {
              method:
                "POST",

              headers: {
                "Content-Type":
                  "application/json",
              },

              body:
                JSON.stringify(
                  {
                    token,
                  }
                ),
            }
          );

        let result:
          | {
              ok?: boolean;
              message?: string;
            }
          | null = null;

        try {
          result =
            await response.json();
        } catch {
          result = null;
        }

        if (cancelled) {
          return;
        }

        if (
          response.ok &&
          result?.ok
        ) {
          setState(
            "success"
          );

          setMessage(
            result.message ||
              "Your email has been verified successfully."
          );

          return;
        }

        setState(
          "error"
        );

        setMessage(
          result?.message ||
            "This verification link could not be verified."
        );
      } catch (error) {
        console.error(
          "Email verification request failed:",
          error
        );

        if (cancelled) {
          return;
        }

        setState(
          "error"
        );

        setMessage(
          "LIVE could not reach the verification service. Please check your connection and try again."
        );
      }
    }

    void verifyEmail();

    return () => {
      cancelled =
        true;
    };
  }, [token]);

  return (
    <VerificationShell
      state={state}
      message={message}
    />
  );
}

/* ============================================================
   UI
   ============================================================ */

function VerificationShell({
  state,
  message,
}: {
  state: VerificationState;
  message: string;
}) {
  const success =
    state === "success";

  const loading =
    state === "loading";

  return (
    <main
      className="
        min-h-screen
        bg-[#f5f7f9]
        px-4
        py-10
        text-[#102b3f]
        sm:px-6
        lg:px-8
      "
    >
      <div
        className="
          mx-auto
          flex
          min-h-[calc(100vh-5rem)]
          w-full
          max-w-6xl
          items-center
          justify-center
        "
      >
        <div
          className="
            grid
            w-full
            overflow-hidden
            rounded-[28px]
            border
            border-[#dce5e9]
            bg-white
            shadow-[0_24px_70px_rgba(16,43,63,0.10)]
            lg:grid-cols-[0.92fr_1.08fr]
          "
        >
          {/* ================================================
              LEFT BRAND PANEL
              ================================================ */}

          <section
            className="
              relative
              overflow-hidden
              bg-[#102b3f]
              px-8
              py-10
              text-white
              sm:px-10
              sm:py-12
              lg:min-h-[620px]
              lg:px-12
              lg:py-14
            "
          >
            <div
              className="
                absolute
                -right-24
                -top-24
                h-72
                w-72
                rounded-full
                border
                border-white/10
              "
            />

            <div
              className="
                absolute
                -bottom-32
                -left-24
                h-80
                w-80
                rounded-full
                border
                border-white/10
              "
            />

            <div
              className="
                relative
                z-10
                flex
                h-full
                flex-col
              "
            >
              <Link
                href="/"
                className="
                  inline-flex
                  w-fit
                  items-center
                  gap-3
                "
              >
                <div
                  className="
                    flex
                    h-11
                    w-11
                    items-center
                    justify-center
                    rounded-xl
                    bg-[#0f6872]
                  "
                >
                  <ShieldCheck
                    className="
                      h-6
                      w-6
                    "
                  />
                </div>

                <div>
                  <div
                    className="
                      text-xl
                      font-extrabold
                      tracking-tight
                    "
                  >
                    LIVE
                  </div>

                  <div
                    className="
                      text-[10px]
                      font-bold
                      uppercase
                      tracking-[0.18em]
                      text-white/55
                    "
                  >
                    Secure access
                  </div>
                </div>
              </Link>

              <div
                className="
                  my-auto
                  py-16
                "
              >
                <div
                  className="
                    mb-6
                    inline-flex
                    items-center
                    gap-2
                    rounded-full
                    border
                    border-white/15
                    bg-white/5
                    px-4
                    py-2
                    text-xs
                    font-bold
                    uppercase
                    tracking-[0.14em]
                    text-white/75
                  "
                >
                  <MailCheck
                    className="
                      h-4
                      w-4
                    "
                  />

                  Email verification
                </div>

                <h1
                  className="
                    max-w-lg
                    text-4xl
                    font-extrabold
                    leading-[1.08]
                    tracking-tight
                    sm:text-5xl
                  "
                >
                  Confirm your
                  identity before
                  entering LIVE.
                </h1>

                <p
                  className="
                    mt-6
                    max-w-md
                    text-[15px]
                    leading-7
                    text-white/65
                  "
                >
                  Email verification
                  protects your LIVE
                  account and ensures
                  important emergency
                  information is linked
                  to the correct person.
                </p>
              </div>

              <p
                className="
                  text-xs
                  leading-5
                  text-white/45
                "
              >
                Location-aware emergency
                coordination.
              </p>
            </div>
          </section>

          {/* ================================================
              VERIFICATION CARD
              ================================================ */}

          <section
            className="
              flex
              items-center
              px-7
              py-12
              sm:px-12
              lg:px-16
            "
          >
            <div
              className="
                mx-auto
                w-full
                max-w-md
              "
            >
              <div
                className="
                  text-xs
                  font-bold
                  uppercase
                  tracking-[0.16em]
                  text-[#0f6872]
                "
              >
                LIVE account
              </div>

              <div
                className="
                  mt-7
                  flex
                  h-16
                  w-16
                  items-center
                  justify-center
                  rounded-2xl
                  border
                "
              >
                {loading ? (
                  <LoaderCircle
                    className="
                      h-8
                      w-8
                      animate-spin
                      text-[#0f6872]
                    "
                  />
                ) : success ? (
                  <CheckCircle2
                    className="
                      h-8
                      w-8
                      text-[#0f6872]
                    "
                  />
                ) : (
                  <CircleAlert
                    className="
                      h-8
                      w-8
                      text-[#c75546]
                    "
                  />
                )}
              </div>

              <h2
                className="
                  mt-7
                  text-3xl
                  font-extrabold
                  tracking-tight
                  text-[#102b3f]
                "
              >
                {loading
                  ? "Verifying your email"
                  : success
                  ? "Email verified"
                  : "Verification problem"}
              </h2>

              <p
                className="
                  mt-4
                  text-sm
                  leading-7
                  text-[#647884]
                "
              >
                {message}
              </p>

              {/* ============================================
                  LOADING
                  ============================================ */}

              {loading ? (
                <div
                  className="
                    mt-8
                    overflow-hidden
                    rounded-full
                    bg-[#e8eef1]
                  "
                >
                  <div
                    className="
                      h-1.5
                      w-1/2
                      animate-pulse
                      rounded-full
                      bg-[#0f6872]
                    "
                  />
                </div>
              ) : null}

              {/* ============================================
                  SUCCESS
                  ============================================ */}

              {success ? (
                <div
                  className="
                    mt-8
                    grid
                    gap-3
                  "
                >
                  <Link
                    href="/login"
                    className="
                      flex
                      min-h-12
                      items-center
                      justify-center
                      rounded-xl
                      bg-[#0f6872]
                      px-5
                      text-sm
                      font-bold
                      text-white
                      transition
                      hover:bg-[#0c5962]
                    "
                  >
                    Continue to sign in
                  </Link>

                  <p
                    className="
                      text-center
                      text-xs
                      leading-5
                      text-[#83939c]
                    "
                  >
                    Your account is now
                    active.
                  </p>
                </div>
              ) : null}

              {/* ============================================
                  ERROR
                  ============================================ */}

              {!loading &&
              !success ? (
                <div
                  className="
                    mt-8
                    grid
                    gap-3
                  "
                >
                  <Link
                    href="/login"
                    className="
                      flex
                      min-h-12
                      items-center
                      justify-center
                      rounded-xl
                      border
                      border-[#d6e0e5]
                      bg-white
                      px-5
                      text-sm
                      font-bold
                      text-[#102b3f]
                      transition
                      hover:bg-[#f5f7f9]
                    "
                  >
                    Back to sign in
                  </Link>

                  <p
                    className="
                      text-center
                      text-xs
                      leading-5
                      text-[#83939c]
                    "
                  >
                    If your link expired,
                    request a fresh
                    verification email
                    before signing in.
                  </p>
                </div>
              ) : null}

              <div
                className="
                  mt-10
                  border-t
                  border-[#e3e9ec]
                  pt-6
                "
              >
                <div
                  className="
                    flex
                    items-start
                    gap-3
                  "
                >
                  <ShieldCheck
                    className="
                      mt-0.5
                      h-4
                      w-4
                      shrink-0
                      text-[#0f6872]
                    "
                  />

                  <p
                    className="
                      text-xs
                      leading-5
                      text-[#83939c]
                    "
                  >
                    LIVE verification
                    links are single-use
                    and expire after one
                    hour.
                  </p>
                </div>
              </div>
            </div>
          </section>
        </div>
      </div>
    </main>
  );
}