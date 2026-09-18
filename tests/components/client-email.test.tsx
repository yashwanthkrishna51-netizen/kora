// @vitest-environment jsdom
import { describe, it, expect } from "vitest";
import { clientEmailSend } from "@/lib/validation/entities";
import { validate } from "@/components/ui/form";

/**
 * The client-email payload contract.
 *
 * Five things changed between v1's request shape and this one, and the dialog
 * builds the new shape by hand. These assert against the SERVER'S OWN SCHEMA —
 * the same object the route parses — so a drift on either side fails here
 * rather than at a client's inbox.
 *
 * This is the only path in the app whose output leaves the building: five real
 * sends are in the audit log, including a report to a client address. A payload
 * bug here is not an internal inconvenience.
 */

const valid = {
  to: "someone@client.test",
  subject: "Integration Status Report - Acme - 07 Sep 2026",
  bodyText: "Hi,\n\nPlease find attached.\n\nBest regards",
};

describe("client email payload", () => {
  it("accepts the shape the dialog builds", () => {
    const r = validate(clientEmailSend, {
      ...valid,
      cc: ["a@x.test", "b@y.test"],
      attachment: { fileName: "Acme_Integration_Report_07Sep2026.pdf", contentBase64: "JVBERi0=" },
    });
    expect(r.ok).toBe(true);
  });

  it("REJECTS v1's comma-separated cc string", () => {
    // v1 sent `cc: "a@x, b@y"`. The array is the change most likely to be
    // reintroduced by someone reading the old code.
    const r = validate(clientEmailSend, { ...valid, cc: "a@x.test, b@y.test" });
    expect(r.ok).toBe(false);
  });

  it("REJECTS more than 5 cc recipients", () => {
    const r = validate(clientEmailSend, {
      ...valid,
      cc: ["a@x.test", "b@x.test", "c@x.test", "d@x.test", "e@x.test", "f@x.test"],
    });
    expect(r.ok).toBe(false);
    if (!r.ok) expect(r.errors.cc).toMatch(/5/);
  });

  it("REJECTS v1's attachment field names", () => {
    // `.name` / `.contentBytes` became `.fileName` / `.contentBase64`. The
    // schema is .strict(), so the old names are a 400 rather than a silently
    // missing attachment — which is the only reason this is survivable.
    const r = validate(clientEmailSend, {
      ...valid,
      attachment: { name: "x.pdf", contentBytes: "JVBERi0=" },
    });
    expect(r.ok).toBe(false);
  });

  it("REJECTS clientName, which v1 always sent, but accepts clientId", () => {
    // v1 sent the NAME and it went straight into the audit row, so the record
    // of an outbound email was labelled with whatever the browser claimed. The
    // id is accepted instead and the server resolves the name itself.
    expect(validate(clientEmailSend, { ...valid, clientName: "Acme" }).ok).toBe(false);
    expect(validate(clientEmailSend, { ...valid, clientId: "c0" }).ok).toBe(true);
  });

  it("REJECTS a contentType the caller chose", () => {
    // The server forces application/pdf. Accepting a caller's type is how an
    // attachment becomes something other than a document.
    const r = validate(clientEmailSend, {
      ...valid,
      attachment: {
        fileName: "x.pdf",
        contentBase64: "JVBERi0=",
        contentType: "text/html",
      },
    });
    expect(r.ok).toBe(false);
  });

  it("allows no attachment at all", () => {
    // The dialog offers Send when generation FAILED, so this path is reachable
    // and must not be a validation error.
    expect(validate(clientEmailSend, valid).ok).toBe(true);
  });

  it("requires a recipient, a subject and a body", () => {
    for (const missing of ["to", "subject", "bodyText"] as const) {
      const payload: Record<string, unknown> = { ...valid };
      delete payload[missing];
      expect(validate(clientEmailSend, payload).ok, missing).toBe(false);
    }
  });

  it("caps the attachment at 12MB encoded", () => {
    const r = validate(clientEmailSend, {
      ...valid,
      attachment: { fileName: "big.pdf", contentBase64: "A".repeat(12 * 1024 * 1024 + 1) },
    });
    expect(r.ok).toBe(false);
  });

  it("strips CRLF from the subject, so a header cannot be injected", () => {
    const r = validate(clientEmailSend, {
      ...valid,
      subject: "Report\r\nBcc: attacker@evil.test",
    });
    expect(r.ok).toBe(true);
    if (r.ok) {
      expect(r.data.subject).not.toContain("\n");
      expect(r.data.subject).not.toContain("\r");
    }
  });
});
