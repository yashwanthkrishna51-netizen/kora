/**
 * Sign-in messages shown on the login screen.
 *
 * The SSO codes are ported from js/events.js:39-57. The callback can only pass
 * a short code through a redirect, so the wording lives here — and it matters
 * that it does, because "not_authorized" is the common one and the difference
 * between a useful message and a dead end.
 */

export const SSO_ERRORS: Record<string, string> = {
  not_configured: "Microsoft sign-in is not set up yet. Use your username and password.",
  not_authorized:
    "That Microsoft account is not registered in Kora. Ask an admin to add you first.",
  state_invalid: "That sign-in link expired. Please try again.",
  no_code: "Microsoft did not complete the sign-in. Please try again.",
  exchange_failed: "Could not complete Microsoft sign-in. Please try again.",
  graph_failed: "Could not read your Microsoft profile. Please try again.",
  no_email: "Your Microsoft account has no email address, so we cannot match it.",
  sso_ambiguous:
    "Two Kora accounts share that email address, so we cannot tell which is yours. Ask an admin to resolve the duplicate.",
  domain_not_allowed:
    "That Microsoft account is outside your organisation, so it cannot be used to sign in.",
  host_mismatch:
    "Microsoft sign-in is misconfigured for this address — KORA_APP_URL does not match the host you are on. Use your username and password.",
  lookup_failed: "Sign-in is temporarily unavailable. Please try again.",
  unexpected_error: "Something went wrong during Microsoft sign-in.",
};

export function ssoErrorMessage(code: string | null | undefined): string | null {
  if (!code) return null;
  // An unrecognised code still gets a message rather than silence — a blank
  // screen after a failed redirect is the worst version of this.
  return SSO_ERRORS[code] ?? "Microsoft sign-in failed. Please try again.";
}
