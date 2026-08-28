// Transactional email via Resend's HTTP API (no SDK — a plain fetch against
// POST https://api.resend.com/emails with Bearer auth). When RESEND_API_KEY or
// EMAIL_FROM is unset (local dev / tests), we log the link instead of sending so
// the flow is exercisable offline. Delivery outcome is NEVER surfaced to callers:
// the route response must stay enumeration-safe regardless of what happens here.

const RESEND_ENDPOINT = "https://api.resend.com/emails";

const resetSubject = "Reset your MASSALIA password";

function resetTextBody(resetUrl: string) {
  return [
    "You (or someone) asked to reset your MASSALIA password.",
    "",
    `Open this link to choose a new one: ${resetUrl}`,
    "",
    "This link expires in one hour.",
    "If you didn't request this, you can ignore it — your account is untouched.",
  ].join("\n");
}

function resetHtmlBody(resetUrl: string) {
  // Minimal, self-contained HTML: one button/link and the two required notes.
  return [
    '<div style="font-family:Georgia,serif;font-size:16px;line-height:1.5;color:#1a1a1a;">',
    "<p>You (or someone) asked to reset your MASSALIA password.</p>",
    `<p><a href="${resetUrl}" style="display:inline-block;padding:12px 20px;background:#0b0706;color:#f4e9d8;text-decoration:none;border-radius:4px;">Reset your password</a></p>`,
    "<p>This link expires in one hour.</p>",
    "<p>If you didn't request this, you can ignore it — your account is untouched.</p>",
    "</div>",
  ].join("");
}

// Send the password-reset email. Resolves (never rejects) so the calling route
// cannot leak delivery success/failure. Missing env → dev-mode console log.
export async function sendPasswordResetEmail(to: string, resetUrl: string): Promise<void> {
  const apiKey = process.env.RESEND_API_KEY;
  const from = process.env.EMAIL_FROM;

  if (!apiKey || !from) {
    console.log(`[email dev-mode] password reset link for ${to}: ${resetUrl}`);
    return;
  }

  try {
    const response = await fetch(RESEND_ENDPOINT, {
      method: "POST",
      headers: {
        Authorization: `Bearer ${apiKey}`,
        "Content-Type": "application/json",
      },
      body: JSON.stringify({
        from,
        to,
        subject: resetSubject,
        text: resetTextBody(resetUrl),
        html: resetHtmlBody(resetUrl),
      }),
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
