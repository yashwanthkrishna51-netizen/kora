// @vitest-environment jsdom
import { describe, it, expect, vi } from "vitest";
import { render, screen, fireEvent } from "@testing-library/react";
import { Dialog, ConfirmDialog } from "@/components/ui/dialog";

/**
 * The first component test in the project.
 *
 * It exists as much to prove the jsdom wiring works — docblock, setup file,
 * matchers, cleanup — as to test the dialog. Everything after this can assume
 * rendering a component is possible.
 *
 * What is asserted is the part that is easy to get wrong and invisible on
 * inspection: that a dialog mid-write cannot be dismissed. v1 closed its modal
 * inside the catch of almost every failed save, discarding whatever the user
 * had typed; and its confirm-and-close paths ran while `busy` was set. A
 * dialog that vanishes during a save also leaves the user unable to tell
 * whether the write landed.
 */

describe("Dialog", () => {
  it("renders its title, body and footer", () => {
    render(
      <Dialog open onOpenChange={() => {}} title="Edit client" footer={<button>Save</button>}>
        <p>Body copy</p>
      </Dialog>,
    );

    expect(screen.getByRole("dialog")).toBeInTheDocument();
    expect(screen.getByText("Edit client")).toBeInTheDocument();
    expect(screen.getByText("Body copy")).toBeInTheDocument();
    expect(screen.getByRole("button", { name: "Save" })).toBeInTheDocument();
  });

  it("closes on Escape when idle", () => {
    const onOpenChange = vi.fn();
    render(
      <Dialog open onOpenChange={onOpenChange} title="Edit client">
        <p>Body</p>
      </Dialog>,
    );

    fireEvent.keyDown(document, { key: "Escape" });
    expect(onOpenChange).toHaveBeenCalledWith(false);
  });

  it("STAYS OPEN while a write is in flight", () => {
    // Asserts the OBSERVABLE outcome, not that a spy went uncalled. The
    // original checked `onOpenChange` was never invoked — but the component
    // passes `busy ? undefined : onOpenChange` to Radix, so when busy the spy
    // is not wired at all and the assertion was guaranteed. All three
    // onEscapeKeyDown/onPointerDownOutside/onInteractOutside guards could be
    // deleted and it still passed.
    const onOpenChange = vi.fn();
    render(
      <Dialog open busy onOpenChange={onOpenChange} title="Edit client">
        <p>Body</p>
      </Dialog>,
    );

    fireEvent.keyDown(document, { key: "Escape" });
    fireEvent.pointerDown(document.body);

    expect(screen.getByRole("dialog")).toBeInTheDocument();
    expect(screen.getByText("Body")).toBeInTheDocument();
    // The close button is disabled too, not merely ignored — an enabled
    // control that does nothing reads as a broken dialog.
    expect(screen.getByRole("button", { name: "Close" })).toBeDisabled();
  });

  it("...and the same dialog DOES close on Escape when idle", () => {
    // The contrast is the point: without this, "stays open" could be true
    // because the dialog never closes at all.
    const onOpenChange = vi.fn();
    const { rerender } = render(
      <Dialog open onOpenChange={onOpenChange} title="Edit client">
        <p>Body</p>
      </Dialog>,
    );
    fireEvent.keyDown(document, { key: "Escape" });
    expect(onOpenChange).toHaveBeenCalledWith(false);

    rerender(
      <Dialog open={false} onOpenChange={onOpenChange} title="Edit client">
        <p>Body</p>
      </Dialog>,
    );
    expect(screen.queryByRole("dialog")).toBeNull();
  });

  it("uses the title once, and a description only when given", () => {
    const { rerender } = render(
      <Dialog open onOpenChange={() => {}} title="Edit client">
        <p>Body</p>
      </Dialog>,
    );
    // No description means NO description — not the title repeated into a
    // visually-hidden one, which would have a screen reader say it twice.
    expect(screen.getAllByText("Edit client")).toHaveLength(1);
    expect(screen.getByRole("dialog")).not.toHaveAccessibleDescription();

    rerender(
      <Dialog
        open
        onOpenChange={() => {}}
        title="Edit client"
        description="Changes save immediately."
      >
        <p>Body</p>
      </Dialog>,
    );
    expect(screen.getByRole("dialog")).toHaveAccessibleDescription(
      "Changes save immediately.",
    );
  });
});

describe("ConfirmDialog", () => {
  it("fires onConfirm and can be cancelled", () => {
    const onConfirm = vi.fn();
    const onOpenChange = vi.fn();
    render(
      <ConfirmDialog
        open
        onOpenChange={onOpenChange}
        title="Delete integration?"
        body="This can be undone for 5 seconds."
        onConfirm={onConfirm}
      />,
    );

    fireEvent.click(screen.getByRole("button", { name: "Cancel" }));
    expect(onOpenChange).toHaveBeenCalledWith(false);

    fireEvent.click(screen.getByRole("button", { name: "Delete" }));
    expect(onConfirm).toHaveBeenCalledOnce();
  });

  it("disables both actions while working, so a delete cannot be double-fired", () => {
    const onConfirm = vi.fn();
    render(
      <ConfirmDialog
        open
        busy
        onOpenChange={() => {}}
        title="Delete integration?"
        body="Body"
        onConfirm={onConfirm}
      />,
    );

    expect(screen.getByRole("button", { name: "Cancel" })).toBeDisabled();
    expect(screen.getByRole("button", { name: "Working…" })).toBeDisabled();
  });
});
