/**
 * Filenames, and getting bytes out of the browser.
 *
 * Ported from `kora/js/export.js:8-18` and `:481-491`. Both are small enough to
 * look like they could be rewritten from memory, and both have a reason to be
 * exactly what they are.
 */

const MONTHS = [
  "Jan", "Feb", "Mar", "Apr", "May", "Jun",
  "Jul", "Aug", "Sep", "Oct", "Nov", "Dec",
];

/**
 * `07Sep2026`.
 *
 * LOCAL date parts, deliberately — unlike `todayStr()` in lib/utils/dates.ts,
 * which is UTC. A report generated at 6am IST would otherwise be stamped with
 * yesterday's date, and the person who generated it is the one who has to
 * explain that to a client.
 */
export function exportFileStamp(d = new Date()): string {
  return `${String(d.getDate()).padStart(2, "0")}${MONTHS[d.getMonth()]}${d.getFullYear()}`;
}

/** Strips what a filesystem refuses. Client names contain slashes and colons. */
export function sanitizeFilePart(s: unknown): string {
  return String(s ?? "").replace(/[/\\:*?"<>|]/g, "-").trim();
}

/**
 * `ClientName_ReportType_DDMonYYYY.ext`
 *
 * Handoff §13 names this format explicitly and says to keep it, so it survives
 * the reskin unchanged. People sort downloads folders by name.
 */
export function exportFilename(
  clientName: string,
  reportType: string,
  ext: string,
): string {
  return `${sanitizeFilePart(clientName)}_${reportType}_${exportFileStamp()}.${ext}`;
}

/**
 * Base64 from a Blob, via FileReader.
 *
 * NOT `doc.output('datauristring')`, which is the obvious one-liner and is
 * broken here. That path calls `btoa()` internally, and `btoa` throws
 * "characters outside the Latin1 range" on any jsPDF document containing a
 * raster image — which every report in this app does, because of the Kognoz
 * logo and the canvas donut. The old repo's most recent commit is that bug
 * being fixed exactly this way, after it had been shipping broken.
 *
 * Returns raw base64 with no `data:` prefix, which is what
 * `clientEmailSend.attachment.contentBase64` wants.
 */
export function blobToBase64(blob: Blob): Promise<string> {
  return new Promise((resolve, reject) => {
    const reader = new FileReader();
    reader.onloadend = () => {
      const dataUrl = String(reader.result);
      resolve(dataUrl.slice(dataUrl.indexOf(",") + 1));
    };
    reader.onerror = () => reject(new Error("Could not read the generated file"));
    reader.readAsDataURL(blob);
  });
}

/**
 * Hands a Blob to the browser as a download.
 *
 * The object URL is revoked on the next tick rather than immediately: Safari
 * has historically cancelled the download if the URL dies in the same frame as
 * the click. A leaked object URL lives until the tab closes, so the cost of
 * being late is nothing and the cost of being early is a download that silently
 * does not happen.
 */
export function downloadBlob(blob: Blob, filename: string): void {
  const url = URL.createObjectURL(blob);
  const a = document.createElement("a");
  a.href = url;
  a.download = filename;
  a.rel = "noopener";
  document.body.appendChild(a);
  a.click();
  a.remove();
  setTimeout(() => URL.revokeObjectURL(url), 0);
}
