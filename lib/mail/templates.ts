/**
 * Email HTML. Pure — no environment, no network, no database.
 *
 * Inline-styled throughout, because Outlook strips and mangles `<style>`
 * blocks unpredictably. That also means no CSS variables: every colour is a
 * literal, so the Kognoz palette has to be duplicated here. A test asserts
 * these literals still equal what `app/globals.css` defines, which is the only
 * thing stopping the emails drifting off-brand the next time a token moves.
 *
 * Re-themed from the old app's teal `#0e7490`. Two of its colours were not
 * just off-brand but unreadable: `#be123c` for overdue text, and `#94a3b8`
 * used as body text — `app/globals.css` documents that nothing lighter than
 * `#71717A` reaches AA on white, so `#A1A1AA` is non-text only.
 */

export const BRAND = {
  /** --k-primary. Header bands and links. */
  primary: "#005184",
  /** --k-text-red. The AA-safe red; the fill red is not readable as text. */
  danger: "#b42318",
  /** --k-ink. Body text. */
  ink: "#212121",
  /** --k-mute. The lightest text that passes AA on white. */
  mute: "#71717a",
  /** --k-line. Hairlines. */
  line: "#e4e4e7",
  /** --k-surface. Page ground. */
  surface: "#fafafa",
  /** --k-paper. Card ground. */
  paper: "#ffffff",
} as const;

/**
 * Only two radii exist in this design system: 4px and 9999px. The old
 * templates used 16px, which is off-system.
 */
const RADIUS = "4px";

const FONT =
  "-apple-system,BlinkMacSystemFont,'Segoe UI',Helvetica,Arial,sans-serif";

export function escHtml(s: unknown = ""): string {
  return String(s ?? "")
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;");
}

export interface DigestItem {
  name: string;
  client: string;
  domain: string;
  status: string;
  link: string;
  dueLabel?: string;
  nextAction?: string;
  description?: string;
  overdue?: boolean;
  notStarted?: boolean;
}

export interface DigestSection {
  heading: string;
  muted?: boolean;
  items: DigestItem[];
}

function itemRow(item: DigestItem, muted = false): string {
  // Muted rows are still real text someone has to read, so they use --k-mute
  // rather than anything lighter.
  const nameColor = muted ? BRAND.mute : BRAND.ink;
  const metaColor = BRAND.mute;
  const linkColor = muted ? BRAND.mute : BRAND.primary;
  const dueStyle = muted
    ? `color:${BRAND.mute};`
    : item.overdue
      ? `color:${BRAND.danger};font-weight:600;`
      : `color:${BRAND.mute};`;

  return `
  <tr>
    <td style="padding:14px 16px;border-bottom:1px solid ${BRAND.line};">
      <div style="font-size:14px;font-weight:600;color:${nameColor};">${escHtml(item.name)}${
        muted
          ? ` <span style="font-size:11px;font-weight:500;color:${BRAND.mute};">&middot; not started yet</span>`
          : ""
      }</div>
      <div style="font-size:12px;color:${metaColor};margin-top:2px;">${escHtml(item.client)} &middot; ${escHtml(item.domain)} &middot; ${escHtml(item.status)}</div>
      ${item.dueLabel ? `<div style="font-size:12px;${dueStyle}margin-top:4px;">${escHtml(item.dueLabel)}</div>` : ""}
      ${item.nextAction ? `<div style="font-size:13px;color:${muted ? BRAND.mute : BRAND.ink};margin-top:6px;"><span style="color:${metaColor};">Next action:</span> ${escHtml(item.nextAction)}</div>` : ""}
      ${item.description ? `<div style="font-size:12px;color:${metaColor};margin-top:4px;">${escHtml(item.description)}</div>` : ""}
      <div style="margin-top:8px;"><a href="${escHtml(item.link)}" style="font-size:12px;color:${linkColor};text-decoration:none;font-weight:600;">Open in Kora &rarr;</a></div>
    </td>
  </tr>`;
}

/**
 * The digest.
 *
 * Sections let one email hold several logically distinct groups — a person's
 * own items, per-client "as master assignee" groups, and the fallback list's
 * active/not-started split — rather than firing one email per grouping.
 * Empty sections are dropped entirely so a heading never appears over nothing.
 */
export function digestEmailHtml({
  greeting,
  intro,
  sections,
}: {
  greeting: string;
  intro: string;
  sections: DigestSection[];
}): string {
  const sectionsHtml = sections
    .filter((s) => s.items?.length)
    .map(
      (s) => `
    <tr><td style="padding:18px 16px 6px 16px;">
      <div style="font-size:11px;font-weight:700;text-transform:uppercase;letter-spacing:0.06em;color:${s.muted ? BRAND.mute : BRAND.primary};">${escHtml(s.heading)}</div>
    </td></tr>
    <tr><td style="padding:0 16px 8px 16px;">
      <table role="presentation" width="100%" cellpadding="0" cellspacing="0" style="border-collapse:collapse;">
        ${s.items.map((item) => itemRow(item, !!s.muted)).join("")}
      </table>
    </td></tr>`,
    )
    .join("");

  return `<!DOCTYPE html>
<html><body style="margin:0;padding:0;background:${BRAND.surface};font-family:${FONT};">
  <table role="presentation" width="100%" cellpadding="0" cellspacing="0" style="background:${BRAND.surface};padding:24px 0;">
    <tr><td align="center">
      <table role="presentation" width="600" cellpadding="0" cellspacing="0" style="background:${BRAND.paper};border-radius:${RADIUS};overflow:hidden;border:1px solid ${BRAND.line};">
        <tr><td style="background:${BRAND.primary};padding:20px 24px;">
          <div style="font-size:18px;font-weight:700;color:#ffffff;">Kora &mdash; Daily Reminder</div>
        </td></tr>
        <tr><td style="padding:20px 24px 8px 24px;">
          <div style="font-size:15px;color:${BRAND.ink};">${escHtml(greeting)}</div>
          <div style="font-size:13px;color:${BRAND.mute};margin-top:6px;">${escHtml(intro)}</div>
        </td></tr>
        <tr><td style="padding:8px 0 20px 0;">
          <table role="presentation" width="100%" cellpadding="0" cellspacing="0" style="border-collapse:collapse;">
            ${sectionsHtml}
          </table>
        </td></tr>
        <tr><td style="padding:16px 24px;background:${BRAND.surface};border-top:1px solid ${BRAND.line};">
          <div style="font-size:11px;color:${BRAND.mute};">Automated daily reminder from Kora. Update an item's status or next action in the app to keep this list accurate.</div>
        </td></tr>
      </table>
    </td></tr>
  </table>
</body></html>`;
}

/**
 * A manually composed client email — the person writes the body, this wraps it.
 *
 * THE LOGO SITS ON WHITE, not on the Deep Blue band the old template used.
 * `kognoz-logo.png` is a raster asset with a baked-in white ground, so placing
 * it on a coloured header renders a white rectangle around it. The handoff is
 * explicit that it must always sit on white or in a white chip; here the whole
 * header band is white with a Deep Blue rule beneath it.
 *
 * Remote images are blocked by default in most clients, Outlook included, so
 * this degrades to the text wordmark and the branded PDF is attached either
 * way. The URL must be absolute — a client's inbox cannot resolve a relative
 * path. (The old app referenced `/kognoz_Iogo.png`, capital I; this repo ships
 * `/kognoz-logo.png`.)
 */
export function clientEmailHtml({
  bodyText,
  appUrl,
}: {
  bodyText: string;
  appUrl?: string;
}): string {
  const safeBody = escHtml(bodyText).replace(/\r?\n/g, "<br>");
  const base = (appUrl ?? "").replace(/\/+$/, "");
  const header = base
    ? `<img src="${escHtml(`${base}/kognoz-logo.png`)}" alt="Kognoz" height="28" style="height:28px;width:auto;display:block;" />`
    : `<div style="font-size:16px;font-weight:700;color:${BRAND.primary};">Kognoz Consulting</div>`;

  return `<!DOCTYPE html>
<html><body style="margin:0;padding:0;background:${BRAND.surface};font-family:${FONT};">
  <table role="presentation" width="100%" cellpadding="0" cellspacing="0" style="background:${BRAND.surface};padding:24px 0;">
    <tr><td align="center">
      <table role="presentation" width="600" cellpadding="0" cellspacing="0" style="background:${BRAND.paper};border-radius:${RADIUS};overflow:hidden;border:1px solid ${BRAND.line};">
        <tr><td style="background:#ffffff;padding:18px 24px;border-bottom:3px solid ${BRAND.primary};">
          ${header}
        </td></tr>
        <tr><td style="padding:24px;">
          <div style="font-size:14px;color:${BRAND.ink};line-height:1.7;">${safeBody}</div>
        </td></tr>
        <tr><td style="padding:14px 24px;background:${BRAND.surface};border-top:1px solid ${BRAND.line};">
          <div style="font-size:11px;color:${BRAND.mute};">Sent from Kora &middot; Kognoz HR Transformation &amp; Consulting</div>
        </td></tr>
      </table>
    </td></tr>
  </table>
</body></html>`;
}
