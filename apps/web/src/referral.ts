// The invite promo: an invite link is playmassalia.com/?invite=CODE. The code is
// kept in localStorage until sign-up (api.register sends it, then clears it) and
// the parameter is taken off the address bar at once. A visitor who already has
// an account is never attributed. Every storage call is wrapped, as the session
// hint's are: private mode or blocked storage simply means no referral.

export const REFERRAL_KEY = "massalia.referral";
const REFERRAL_CODE = /^[0-9A-F]{10}$/;

export function captureReferralFromUrl(hasSession: boolean): void {
  const params = new URLSearchParams(window.location.search);
  if (!params.has("invite")) return;
  const code = (params.get("invite") ?? "").trim().toUpperCase();
  if (!hasSession && REFERRAL_CODE.test(code)) {
    try {
      localStorage.setItem(REFERRAL_KEY, code);
    } catch {
      // Storage unavailable: the sign-up goes through without a referral.
    }
  }
  params.delete("invite");
  const query = params.toString();
  window.history.replaceState(window.history.state, "", `${window.location.pathname}${query ? `?${query}` : ""}${window.location.hash}`);
}

export function storedReferral(): string | null {
  try {
    const value = localStorage.getItem(REFERRAL_KEY);
    return value && REFERRAL_CODE.test(value) ? value : null;
  } catch {
    return null;
  }
}

export function clearStoredReferral(): void {
  try {
    localStorage.removeItem(REFERRAL_KEY);
  } catch {
    // Nothing to clear when storage is unavailable.
  }
}
