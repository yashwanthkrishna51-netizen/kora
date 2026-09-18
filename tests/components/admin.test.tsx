// @vitest-environment jsdom
import { describe, it, expect, beforeEach, afterEach } from "vitest";
import { render, screen, fireEvent } from "@testing-library/react";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import "@testing-library/jest-dom/vitest";
import { isLockedNow, isAdminView } from "@/lib/query/admin";
import { ViewAsCard } from "@/components/admin/view-as-card";
import { useUi } from "@/lib/store/ui";
import type { UserAdminView } from "@/lib/db/queries/users";

/**
 * The admin screen's load-bearing logic.
 *
 * Scoped to the things that are WRONG IF I GOT THEM WRONG and silent about it:
 * the lockout predicate, the role narrowing, and view-as activation. Layout is
 * not tested — a snapshot of a table would fail on every design tweak and
 * catch nothing.
 */

const user = (over: Partial<UserAdminView> = {}): UserAdminView => ({
  id: "u1",
  username: "sam.p",
  name: "Sam Patel",
  role: "editor",
  email: "sam@example.com",
  createdAt: "2026-01-01T00:00:00.000Z",
  lockedUntil: null,
  failedAttempts: 0,
  lockoutLevel: 0,
  lastActive: null,
  _v: "2026-01-01T00:00:00.000000Z",
  ...over,
});

describe("isLockedNow", () => {
  const NOW = Date.parse("2026-09-07T12:00:00.000Z");

  it("is false when lockedUntil is null", () => {
    expect(isLockedNow(user(), NOW)).toBe(false);
  });

  it("is TRUE only while the lock is in the future", () => {
    const locked = user({ lockedUntil: "2026-09-07T12:30:00.000Z" });
    expect(isLockedNow(locked, NOW)).toBe(true);
  });

  it("is FALSE for an expired lock whose column is still populated", () => {
    // The trap. `checkLocked` clears nothing when a lock expires — the column
    // keeps its value — so testing lockedUntil for truthiness shows a
    // permanent padlock on anyone who was ever locked out once. This assertion
    // is the whole reason the helper exists instead of `Boolean(u.lockedUntil)`.
    const stale = user({ lockedUntil: "2026-09-06T12:00:00.000Z" });
    expect(stale.lockedUntil).toBeTruthy();
    expect(isLockedNow(stale, NOW)).toBe(false);
  });

  it("is false at exactly the expiry instant, matching checkLocked's <=", () => {
    const boundary = user({ lockedUntil: "2026-09-07T12:00:00.000Z" });
    expect(isLockedNow(boundary, NOW)).toBe(false);
  });

  it("does not treat an unparseable timestamp as locked", () => {
    expect(isLockedNow(user({ lockedUntil: "not a date" }), NOW)).toBe(false);
  });

  it("failedAttempts alone never means locked", () => {
    // Someone who has fumbled their password four times is not locked out;
    // showing them as locked would send an admin unlocking a working account.
    expect(isLockedNow(user({ failedAttempts: 4 }), NOW)).toBe(false);
  });
});

describe("isAdminView", () => {
  it("separates the two shapes the server actually sends", () => {
    expect(isAdminView(user())).toBe(true);
    expect(
      isAdminView({ id: "u2", username: "a.b", name: "A B", role: "viewer" }),
    ).toBe(false);
  });

  it("keeps a viewer-shaped row out of the admin table", () => {
    // The table renders only rows that pass this filter. If the predicate were
    // wrong the table would render `undefined` into the lockout column rather
    // than failing, which is the failure mode the union type exists to prevent.
    const mixed = [
      user({ id: "a" }),
      { id: "b", username: "x.y", name: "X Y", role: "viewer" },
    ];
    expect(mixed.filter(isAdminView).map((u) => u.id)).toEqual(["a"]);
  });
});

describe("ViewAsCard — the activation that was missing", () => {
  beforeEach(() => useUi.getState().setViewAsRole(null));
  afterEach(() => useUi.getState().setViewAsRole(null));

  const renderCard = () => {
    const qc = new QueryClient({ defaultOptions: { queries: { retry: false } } });
    return render(
      <QueryClientProvider client={qc}>
        <ViewAsCard />
      </QueryClientProvider>,
    );
  };

  it("calls setViewAsRole with a ROLE, which nothing in the app did before", () => {
    // Before this screen existed `setViewAsRole` was only ever called with
    // null — the exit path — so the entire preview feature was unreachable.
    renderCard();
    expect(useUi.getState().viewAsRole).toBeNull();

    fireEvent.click(screen.getByRole("button", { name: /viewer/i }));
    expect(useUi.getState().viewAsRole).toBe("viewer");
  });

  it("switches directly between roles without passing through null", () => {
    renderCard();
    fireEvent.click(screen.getByRole("button", { name: /editor/i }));
    expect(useUi.getState().viewAsRole).toBe("editor");
    fireEvent.click(screen.getByRole("button", { name: /viewer/i }));
    expect(useUi.getState().viewAsRole).toBe("viewer");
  });

  it("the active button exits the preview, so the card is never a trap", () => {
    renderCard();
    fireEvent.click(screen.getByRole("button", { name: /editor/i }));
    fireEvent.click(screen.getByRole("button", { name: /previewing as editor/i }));
    expect(useUi.getState().viewAsRole).toBeNull();
  });

  it("marks the active role with aria-pressed, not colour alone", () => {
    renderCard();
    fireEvent.click(screen.getByRole("button", { name: /viewer/i }));
    expect(
      screen.getByRole("button", { name: /previewing as viewer/i }),
    ).toHaveAttribute("aria-pressed", "true");
    expect(screen.getByRole("button", { name: /^editor$/i })).toHaveAttribute(
      "aria-pressed",
      "false",
    );
  });

  it("is memory-only — nothing about the preview reaches localStorage", () => {
    // partialize deliberately excludes it, so a reload always returns a real
    // admin to real admin. An admin who forgets they are previewing must not
    // come back tomorrow apparently unable to use their own tools.
    renderCard();
    fireEvent.click(screen.getByRole("button", { name: /viewer/i }));
    expect(window.localStorage.getItem("itk_ui") ?? "").not.toContain("viewAsRole");
  });
});

/**
 * Read-only mode, on the client side.
 *
 * This is the COURTESY half — the boundary is `assertWritable` in withAuth,
 * which does not trust the browser. What this buys is that write controls
 * disappear instead of appearing and then failing, which is the difference
 * between "read-only for now" and "this app is broken".
 *
 * Routed through `useCanEdit` because every write control in the app already
 * asks it, so there is no list of components to keep in step.
 */
describe("read-only build flag", () => {
  const set = (on: boolean) => {
    if (on) process.env.NEXT_PUBLIC_KORA_READ_ONLY = "1";
    else delete process.env.NEXT_PUBLIC_KORA_READ_ONLY;
  };
  afterEach(() => set(false));

  it("is off unless explicitly set to 1", async () => {
    const { isReadOnlyBuild } = await import("@/lib/query/permissions");
    set(false);
    expect(isReadOnlyBuild()).toBe(false);
    process.env.NEXT_PUBLIC_KORA_READ_ONLY = "0";
    expect(isReadOnlyBuild()).toBe(false);
    set(true);
    expect(isReadOnlyBuild()).toBe(true);
  });

  it("makes useCanEdit false for an ADMIN, not just for lesser roles", async () => {
    // The one that matters. A flag that stops editors but lets admins through
    // would leave exactly the people most likely to change something able to.
    const { useCanEdit, SessionProvider } = await import("@/lib/query/permissions");
    const { renderHook } = await import("@testing-library/react");

    const wrap = (children: React.ReactNode) => (
      <SessionProvider value={{ name: "A", username: "a", role: "admin" }}>
        {children}
      </SessionProvider>
    );

    set(false);
    const on = renderHook(() => useCanEdit(), { wrapper: ({ children }) => wrap(children) });
    expect(on.result.current).toBe(true);

    set(true);
    const off = renderHook(() => useCanEdit(), { wrapper: ({ children }) => wrap(children) });
    expect(off.result.current).toBe(false);
  });
});
