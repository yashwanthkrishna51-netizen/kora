import Image from "next/image";
import type { Metadata } from "next";
import { LoginForm } from "./login-form";
import { ssoErrorMessage } from "@/lib/auth/messages";
import "./login.css";

export const metadata: Metadata = { title: "Sign in · Kora" };

/**
 * Sign-in, per artboard 1a.
 *
 * The left panel is proof rather than decoration: it shows live-looking
 * delivery status so the first thing someone sees is what the tool is for.
 * Values are static here — wiring them to real data would mean exposing client
 * names on an unauthenticated page, which is not a trade worth making for a
 * background graphic.
 */

const STATUS_ROWS = [
  { label: "SAP S/4HANA rollout", pct: 100, color: "var(--k-green)" },
  { label: "Salesforce integration", pct: 62, color: "var(--k-cyan)" },
  { label: "Payroll sync", pct: 28, color: "var(--k-fill-risk)" },
  { label: "SSO configuration", pct: 10, color: "var(--k-fill-warn)" },
];

export default async function LoginPage(props: PageProps<"/login">) {
  const params = await props.searchParams;

  const first = (v: string | string[] | undefined) =>
    Array.isArray(v) ? v[0] : v;

  const ssoError = ssoErrorMessage(first(params.ssoError));
  // Only ever an internal path, so a crafted ?next= cannot bounce someone to
  // another site carrying a freshly-issued session.
  const rawNext = first(params.next);
  const next =
    rawNext && rawNext.startsWith("/") && !rawNext.startsWith("//")
      ? rawNext
      : "/dashboard";

  return (
    <main className="flex min-h-screen flex-col md:flex-row">
      {/* ---- Left: the proof panel ------------------------------------- */}
      <section className="login-panel relative hidden overflow-hidden md:flex md:w-[58%] md:flex-col md:justify-between">
        <div className="login-blob" aria-hidden="true" />

        <div className="login-in relative z-10">
          {/* The logo PNG has a baked-in white background, so it always sits
              in a white chip — never directly on the blue. */}
          <span className="inline-block rounded-k bg-white px-3.5 py-2">
            <Image
              src="/kognoz-logo.png"
              alt="Kognoz"
              width={120}
              height={36}
              priority
            />
          </span>
        </div>

        <div className="login-in relative z-10 max-w-[470px]" style={{ animationDelay: "80ms" }}>
          <h1 className="login-headline">
            Every client.
            <br />
            Every phase.
            <br />
            One view.
          </h1>
          <p className="mt-3.5 text-[14px] leading-[1.65] text-white/70">
            Integrations, implementation and support — tracked in one place, so
            nothing slips between the three.
          </p>

          <div className="login-status mt-8">
            <div className="text-[11px] uppercase tracking-[0.1em] text-white/50">
              Live portfolio status
            </div>
            <div className="mt-3.5 space-y-3.5">
              {STATUS_ROWS.map((row, i) => (
                <div key={row.label}>
                  <div className="flex items-center gap-2.5">
                    <span
                      className="h-[7px] w-[7px] rounded-full"
                      style={{ background: row.color }}
                    />
                    <span className="flex-1 text-[12.5px] text-white/90">
                      {row.label}
                    </span>
                    <span className="k-mono text-[11px] text-white/55">
                      {row.pct}%
                    </span>
                  </div>
                  <div className="mt-1.5 h-1 w-full rounded-[2px] bg-white/[0.12]">
                    <div
                      className="login-bar h-full rounded-[2px]"
                      style={
                        {
                          background: row.color,
                          "--bar-width": `${row.pct}%`,
                          animationDelay: `${200 + i * 90}ms`,
                        } as React.CSSProperties
                      }
                    />
                  </div>
                </div>
              ))}
            </div>
          </div>
        </div>

        <p className="login-in relative z-10 text-[11px] text-white/45" style={{ animationDelay: "160ms" }}>
          © 2026 Kognoz · Internal delivery platform
        </p>
      </section>

      {/* ---- Right: the form ------------------------------------------- */}
      <section className="flex flex-1 items-center justify-center bg-k-paper p-6">
        <div className="w-full max-w-[340px]">
          {/* On narrow screens the blue panel is hidden, so the mark needs to
              appear here or the page loses its identity entirely. */}
          <div className="mb-6 md:hidden">
            <Image src="/kognoz-logo.png" alt="Kognoz" width={132} height={39} priority />
          </div>

          <h2 className="k-page-title text-k-h3">Sign in to Kora</h2>
          <p className="mb-7 mt-1.5 text-k-nav text-k-mute">
            Access is provisioned by your admin.
          </p>

          {ssoError ? (
            <div
              role="alert"
              className="mb-4 rounded-k px-3 py-2.5 text-k-body leading-[1.5]"
              style={{
                background: "var(--k-tint-warn)",
                color: "var(--k-text-amber)",
              }}
            >
              {ssoError}
            </div>
          ) : null}

          <LoginForm next={next} />

          <p className="mt-6 text-center text-[11px] text-k-mute-2">
            Kognoz internal platform
          </p>
        </div>
      </section>
    </main>
  );
}
