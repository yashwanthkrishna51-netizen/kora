// @vitest-environment jsdom
import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import { render, screen } from "@testing-library/react";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import "@testing-library/jest-dom/vitest";

/**
 * The one nav item that leaves this app.
 *
 * Sales Pipeline exists only in the old Kora, so the sidebar links out to it.
 * Three things are worth pinning and none is visible from a screenshot: that
 * the item disappears when there is no legacy app configured (otherwise a
 * fresh deployment offers a dead link), that it opens in a new tab with
 * `rel="noopener"` — an `_blank` without it hands the other origin a handle on
 * this one — and that it is an `<a>` rather than a `<Link>`, since a soft
 * navigation to another origin is not a thing.
 */

vi.mock("next/navigation", () => ({
  usePathname: () => "/dashboard",
  useRouter: () => ({ replace: vi.fn(), refresh: vi.fn(), push: vi.fn() }),
}));

const user = { name: "Meera Raghavan", username: "meera", role: "admin" };

async function renderSidebar(legacyUrl?: string) {
  vi.resetModules();
  if (legacyUrl) vi.stubEnv("NEXT_PUBLIC_LEGACY_KORA_URL", legacyUrl);
  else vi.stubEnv("NEXT_PUBLIC_LEGACY_KORA_URL", "");

  const { Sidebar } = await import("@/components/sidebar");
  const qc = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  return render(
    <QueryClientProvider client={qc}>
      <Sidebar user={user} effectiveRole="admin" />
    </QueryClientProvider>,
  );
}

beforeEach(() => vi.stubGlobal("matchMedia", undefined));
afterEach(() => vi.unstubAllEnvs());

describe("the Sales Pipeline link", () => {
  it("is absent when no legacy app is configured", async () => {
    await renderSidebar();
    expect(screen.queryByText("Sales Pipeline")).not.toBeInTheDocument();
  });

  it("points at the old app's pipeline, in a new tab, safely", async () => {
    await renderSidebar("https://kora-eight-black.vercel.app");
    const link = screen.getByRole("link", { name: /Sales Pipeline/ });

    expect(link).toHaveAttribute(
      "href",
      "https://kora-eight-black.vercel.app/pipeline",
    );
    expect(link).toHaveAttribute("target", "_blank");
    // Without `noopener` the opened page gets a handle on this window.
    expect(link.getAttribute("rel")).toContain("noopener");
  });

  it("tolerates a trailing slash rather than producing a double one", async () => {
    await renderSidebar("https://kora-eight-black.vercel.app/");
    expect(
      screen.getByRole("link", { name: /Sales Pipeline/ }),
    ).toHaveAttribute("href", "https://kora-eight-black.vercel.app/pipeline");
  });

  it("never renders as the active item", async () => {
    // It is never the current route, and an external link that lit up would be
    // claiming to be a page of this app.
    await renderSidebar("https://kora-eight-black.vercel.app");
    const link = screen.getByRole("link", { name: /Sales Pipeline/ });
    expect(link).toHaveAttribute("data-active", "false");
    expect(link).not.toHaveAttribute("aria-current");
  });
});
