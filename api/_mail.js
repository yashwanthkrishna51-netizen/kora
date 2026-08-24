// api/_mail.js — shared Microsoft Graph mail-sending helper.
//
// Reuses the SAME Azure App Registration already set up for SSO
// (AZURE_CLIENT_ID / AZURE_CLIENT_SECRET / AZURE_TENANT_ID) but via a
// DIFFERENT OAuth flow. SSO login (api/auth-microsoft.js) uses the
// user-interactive Authorization Code flow with DELEGATED permissions
// ('openid profile email User.Read') — that only proves who's logging in
// right now, through a browser. It cannot be used by a cron job with no
// user in the loop.
//
// Sending mail from a cron job instead uses the Client Credentials flow
// (an app-only token, the app authenticating as itself). This requires
// ONE new thing added to the SAME app registration in Azure Portal:
//   API permissions -> Add -> Microsoft Graph -> Application permissions
//   -> Mail.Send -> then an admin must click "Grant admin consent."
//
// Required env vars (Vercel):
//   AZURE_CLIENT_ID, AZURE_CLIENT_SECRET, AZURE_TENANT_ID  — already set, reused as-is
//   AZURE_MAIL_SENDER   — NEW. The mailbox Graph sends "as" (a UPN or object id).
//                         Must be a real mailbox in the tenant.
//                         Recommended: a dedicated shared mailbox (e.g.
//                         kora-notifications@yourdomain.com) with an Exchange
//                         Application Access Policy scoping THIS app's
//                         Mail.Send to only that mailbox — app-only Mail.Send
//                         otherwise defaults to "any mailbox in the tenant,"
//                         which is broader than this feature needs.
//                         (Exchange Admin Center / PowerShell:
//                         New-ApplicationAccessPolicy -AppId <AZURE_CLIENT_ID>
//                         -PolicyScopeGroupId <mail-enabled-security-group>
//                         -AccessRight RestrictAccess)
//
// Token is cached in module scope for the life of one function
// invocation/container — avoids a token fetch per email when a digest run
// sends to many people back to back.

let _cachedToken = null; // { token, expiresAt }

async function getGraphToken(env) {
  const { AZURE_CLIENT_ID, AZURE_CLIENT_SECRET, AZURE_TENANT_ID } = env;
  if (!AZURE_CLIENT_ID || !AZURE_CLIENT_SECRET || !AZURE_TENANT_ID) {
    throw new Error('Azure env vars missing (AZURE_CLIENT_ID/AZURE_CLIENT_SECRET/AZURE_TENANT_ID)');
  }
  const now = Date.now();
  if (_cachedToken && _cachedToken.expiresAt > now + 60000) {
    return _cachedToken.token;
  }
  const r = await fetch(`https://login.microsoftonline.com/${encodeURIComponent(AZURE_TENANT_ID)}/oauth2/v2.0/token`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
    body: new URLSearchParams({
      client_id: AZURE_CLIENT_ID,
      client_secret: AZURE_CLIENT_SECRET,
      scope: 'https://graph.microsoft.com/.default', // app-only: scope is fixed to .default, actual permissions come from what's granted in the portal
      grant_type: 'client_credentials',
    }),
  });
  const d = await r.json().catch(() => ({}));
  if (!r.ok) {
    throw new Error(`Graph token request failed: ${d.error || r.status} ${d.error_description || ''}`);
  }
  _cachedToken = { token: d.access_token, expiresAt: now + (d.expires_in || 3600) * 1000 };
  return _cachedToken.token;
}

function sleep(ms) { return new Promise(resolve => setTimeout(resolve, ms)); }

// Sends one email. `to`/`cc` are string or array of strings. `attachments`
// is an optional array of { name, contentType, contentBytes } where
// contentBytes is base64 (no data: prefix) — Graph's fileAttachment shape.
async function sendMail(env, { to, cc, subject, html, attachments }, attempt = 1) {
  const { AZURE_MAIL_SENDER } = env;
  if (!AZURE_MAIL_SENDER) throw new Error('AZURE_MAIL_SENDER env var not set — no mailbox configured to send from');
  const toList = (Array.isArray(to) ? to : [to]).filter(Boolean);
  if (!toList.length) throw new Error('No recipients');
  const ccList = (Array.isArray(cc) ? cc : (cc ? [cc] : [])).filter(Boolean);

  const message = {
    subject,
    body: { contentType: 'HTML', content: html },
    toRecipients: toList.map(email => ({ emailAddress: { address: email } })),
  };
  if (ccList.length) message.ccRecipients = ccList.map(email => ({ emailAddress: { address: email } }));
  if (attachments && attachments.length) {
    message.attachments = attachments.map(a => ({
      '@odata.type': '#microsoft.graph.fileAttachment',
      name: a.name,
      contentType: a.contentType || 'application/octet-stream',
      contentBytes: a.contentBytes,
    }));
  }

  const token = await getGraphToken(env);
  const r = await fetch(`https://graph.microsoft.com/v1.0/users/${encodeURIComponent(AZURE_MAIL_SENDER)}/sendMail`, {
    method: 'POST',
    headers: { Authorization: `Bearer ${token}`, 'Content-Type': 'application/json' },
    body: JSON.stringify({ message, saveToSentItems: true }), // client-facing mail: keep a copy in Sent, unlike the automated digest
  });

  if (r.status === 429 && attempt <= 3) {
    const retryAfterHeader = r.headers.get('retry-after');
    const waitMs = retryAfterHeader ? parseInt(retryAfterHeader, 10) * 1000 : 1000 * attempt;
    await sleep(waitMs);
    return sendMail(env, { to, cc, subject, html, attachments }, attempt + 1);
  }

  if (!r.ok) {
    const body = await r.text().catch(() => '');
    throw new Error(`Graph sendMail failed: ${r.status} ${body}`);
  }
}

// ─── Branded HTML template ───────────────────────────────────────────
// Inline-styled throughout — email clients (Outlook especially) strip or
// mangle <style> blocks unpredictably, so every rule lives on the element.
// Colors match the app's real brand teal (--teal: #0e7490).

function escHtml(s = '') {
  return String(s).replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;');
}

function itemRowHtml(item, muted = false) {
  const dueStyle = muted ? 'color:#94a3b8;' : (item.overdue ? 'color:#be123c;font-weight:600;' : 'color:#64748b;');
  const nameColor = muted ? '#64748b' : '#0f172a';
  const metaColor = muted ? '#94a3b8' : '#64748b';
  const linkColor = muted ? '#94a3b8' : '#0e7490';
  return `
  <tr>
    <td style="padding:14px 16px;border-bottom:1px solid #e5e7eb;">
      <div style="font-size:14px;font-weight:600;color:${nameColor};">${escHtml(item.name)}${muted ? ' <span style="font-size:11px;font-weight:500;color:#94a3b8;">&middot; not started yet</span>' : ''}</div>
      <div style="font-size:12px;color:${metaColor};margin-top:2px;">${escHtml(item.client)} &middot; ${escHtml(item.domain)} &middot; ${escHtml(item.status)}</div>
      ${item.dueLabel ? `<div style="font-size:12px;${dueStyle}margin-top:4px;">${escHtml(item.dueLabel)}</div>` : ''}
      ${item.nextAction ? `<div style="font-size:13px;color:${muted ? '#94a3b8' : '#0f172a'};margin-top:6px;"><span style="color:${metaColor};">Next action:</span> ${escHtml(item.nextAction)}</div>` : ''}
      ${item.description ? `<div style="font-size:12px;color:${metaColor};margin-top:4px;">${escHtml(item.description)}</div>` : ''}
      <div style="margin-top:8px;"><a href="${escHtml(item.link)}" style="font-size:12px;color:${linkColor};text-decoration:none;font-weight:600;">Open in Kora &rarr;</a></div>
    </td>
  </tr>`;
}

// { greeting, intro, sections: [{ heading, muted?, items }] } -> full HTML document string.
// Sections let one email hold multiple logically-distinct groups — a
// person's own items, per-client "as Master Assignee" groups, and the
// fallback's active-vs-not-started split — all in one coherent digest email
// instead of firing separate emails per grouping.
function buildDigestEmailHtml({ greeting, intro, sections }) {
  const sectionsHtml = sections.filter(s => s.items && s.items.length).map(s => `
    <tr><td style="padding:18px 16px 6px 16px;">
      <div style="font-size:11px;font-weight:700;text-transform:uppercase;letter-spacing:0.04em;color:${s.muted ? '#94a3b8' : '#0e7490'};">${escHtml(s.heading)}</div>
    </td></tr>
    <tr><td style="padding:0 16px 8px 16px;">
      <table role="presentation" width="100%" cellpadding="0" cellspacing="0" style="border-collapse:collapse;">
        ${s.items.map(item => itemRowHtml(item, !!s.muted)).join('')}
      </table>
    </td></tr>`).join('');
  return `<!DOCTYPE html>
<html><body style="margin:0;padding:0;background:#f8fafc;font-family:-apple-system,BlinkMacSystemFont,'Segoe UI',Roboto,Helvetica,Arial,sans-serif;">
  <table role="presentation" width="100%" cellpadding="0" cellspacing="0" style="background:#f8fafc;padding:24px 0;">
    <tr><td align="center">
      <table role="presentation" width="600" cellpadding="0" cellspacing="0" style="background:#ffffff;border-radius:16px;overflow:hidden;border:1px solid #e5e7eb;">
        <tr><td style="background:#0e7490;padding:20px 24px;">
          <div style="font-size:18px;font-weight:700;color:#ffffff;">Kora &mdash; Daily Reminder</div>
        </td></tr>
        <tr><td style="padding:20px 24px 8px 24px;">
          <div style="font-size:15px;color:#0f172a;">${escHtml(greeting)}</div>
          <div style="font-size:13px;color:#64748b;margin-top:6px;">${escHtml(intro)}</div>
        </td></tr>
        <tr><td style="padding:8px 0 20px 0;">
          <table role="presentation" width="100%" cellpadding="0" cellspacing="0" style="border-collapse:collapse;">
            ${sectionsHtml}
          </table>
        </td></tr>
        <tr><td style="padding:16px 24px;background:#f8fafc;border-top:1px solid #e5e7eb;">
          <div style="font-size:11px;color:#94a3b8;">Automated daily reminder from Kora. Update an item's status or next action in the app to keep this list accurate.</div>
        </td></tr>
      </table>
    </td></tr>
  </table>
</body></html>`;
}

// Simple branded wrapper for a manually-composed client email (not the
// digest). The person writes the body text; this just wraps it in the same
// teal-header shell so it looks consistent and professional. `bodyText` is
// plain text from a textarea — newlines become <br>, and it's escaped so a
// stray < or & can't break the markup or inject anything.
function buildClientEmailHtml({ bodyText }) {
  const safeBody = escHtml(bodyText || '').replace(/\r?\n/g, '<br>');
  return `<!DOCTYPE html>
<html><body style="margin:0;padding:0;background:#f8fafc;font-family:-apple-system,BlinkMacSystemFont,'Segoe UI',Roboto,Helvetica,Arial,sans-serif;">
  <table role="presentation" width="100%" cellpadding="0" cellspacing="0" style="background:#f8fafc;padding:24px 0;">
    <tr><td align="center">
      <table role="presentation" width="600" cellpadding="0" cellspacing="0" style="background:#ffffff;border-radius:16px;overflow:hidden;border:1px solid #e5e7eb;">
        <tr><td style="background:#0e7490;padding:18px 24px;">
          <div style="font-size:16px;font-weight:700;color:#ffffff;">Kognoz Consulting</div>
        </td></tr>
        <tr><td style="padding:24px;">
          <div style="font-size:14px;color:#0f172a;line-height:1.7;">${safeBody}</div>
        </td></tr>
        <tr><td style="padding:14px 24px;background:#f8fafc;border-top:1px solid #e5e7eb;">
          <div style="font-size:11px;color:#94a3b8;">Sent from Kora · Kognoz HR Transformation &amp; Consulting</div>
        </td></tr>
      </table>
    </td></tr>
  </table>
</body></html>`;
}

module.exports = { getGraphToken, sendMail, buildDigestEmailHtml, buildClientEmailHtml, escHtml, sleep };