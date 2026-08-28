// Transactional email via Resend's HTTP API (no SDK — a plain fetch against
// POST https://api.resend.com/emails with Bearer auth). When RESEND_API_KEY or
// EMAIL_FROM is unset (local dev / tests), we log the link instead of sending so
// the flow is exercisable offline. Delivery outcome is NEVER surfaced to callers:
// the route response must stay enumeration-safe regardless of what happens here.

const RESEND_ENDPOINT = "https://api.resend.com/emails";

// One button/link, self-contained inline styling, no external assets.
function linkButton(url: string, label: string) {
  return `<p><a href="${url}" style="display:inline-block;padding:12px 20px;background:#0b0706;color:#f4e9d8;text-decoration:none;border-radius:4px;">${label}</a></p>`;
}

function wrapHtml(inner: string) {
  return `<div style="font-family:Georgia,serif;font-size:16px;line-height:1.5;color:#1a1a1a;">${inner}</div>`;
}

// Send one email. Resolves (never rejects) so callers cannot leak delivery
// success/failure. Missing env → dev-mode console log tagged with `devLabel`.
async function sendEmail(opts: {
  to: string;
  subject: string;
  text: string;
  html: string;
  devLabel: string;
  devUrl: string;
}): Promise<void> {
  const apiKey = process.env.RESEND_API_KEY;
  const from = process.env.EMAIL_FROM;

  if (!apiKey || !from) {
    console.log(`[email dev-mode] ${opts.devLabel} for ${opts.to}: ${opts.devUrl}`);
    return;
  }

  try {
    const response = await fetch(RESEND_ENDPOINT, {
      method: "POST",
      headers: {
        Authorization: `Bearer ${apiKey}`,
        "Content-Type": "application/json",
      },
      body: JSON.stringify({ from, to: opts.to, subject: opts.subject, text: opts.text, html: opts.html }),
    });

    if (!response.ok) {
      // Log server-side for diagnostics, but never throw: the route stays generic.
      const body = await response.text().catch(() => "<unreadable>");
      console.error(`Resend send failed (${response.status}): ${body}`);
    }
  } catch (error) {
    // Network/transport failure — log and swallow, same enumeration-safety reason.
    console.error(`Resend send threw: ${error instanceof Error ? error.message : String(error)}`);
  }
}

// Password-reset email. Resolves regardless of delivery outcome.
export async function sendPasswordResetEmail(to: string, resetUrl: string): Promise<void> {
  const text = [
    "You (or someone) asked to reset your MASSALIA password.",
    "",
    `Open this link to choose a new one: ${resetUrl}`,
    "",
    "This link expires in one hour.",
    "If you didn't request this, you can ignore it — your account is untouched.",
  ].join("\n");
  const html = wrapHtml(
    [
      "<p>You (or someone) asked to reset your MASSALIA password.</p>",
      linkButton(resetUrl, "Reset your password"),
      "<p>This link expires in one hour.</p>",
      "<p>If you didn't request this, you can ignore it — your account is untouched.</p>",
    ].join(""),
  );
  await sendEmail({ to, subject: "Reset your MASSALIA password", text, html, devLabel: "password reset link", devUrl: resetUrl });
}

// Email-verification email. Resolves regardless of delivery outcome.
export async function sendVerificationEmail(to: string, verifyUrl: string): Promise<void> {
  const text = [
    "Confirm your email for MASSALIA.",
    "",
    `Open this link to verify: ${verifyUrl}`,
    "",
    "Verifying confirms account recovery will work if you ever lose your password.",
    "This link expires in 24 hours.",
    "If you didn't create a MASSALIA account, you can ignore this.",
  ].join("\n");
  const html = wrapHtml(
    [
      "<p>Confirm your email for MASSALIA.</p>",
      linkButton(verifyUrl, "Verify your email"),
      "<p>Verifying confirms account recovery will work if you ever lose your password.</p>",
      "<p>This link expires in 24 hours.</p>",
      "<p>If you didn't create a MASSALIA account, you can ignore this.</p>",
    ].join(""),
  );
  await sendEmail({ to, subject: "Verify your MASSALIA email", text, html, devLabel: "verification link", devUrl: verifyUrl });
}
