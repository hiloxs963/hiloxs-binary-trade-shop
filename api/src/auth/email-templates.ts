import type { AuthEmail } from "./email.js";

type RenderedAuthEmail = {
  subject: string;
  text: string;
  html: string;
};

type EmailContent = {
  subject: string;
  heading: string;
  introduction: string;
  action?: { label: string; url: string };
  code?: string;
  expiry?: string;
  safety: string;
};

export function renderAuthEmail(message: AuthEmail): RenderedAuthEmail {
  switch (message.kind) {
    case "verification":
      return verificationEmail(message.url);
    case "password-reset":
      return passwordResetEmail(message.url);
    case "email-otp":
      return emailOtpEmail(message.code, message.expiresInMinutes);
    case "email-otp-enabled":
      return renderEmail({
        subject: "Email sign-in codes turned on",
        heading: "Email codes are now on",
        introduction:
          "Email sign-in codes were turned on for your HILOXS account. You can now choose to receive a code by email when you sign in. Your authenticator app still works.",
        safety:
          "If you did not do this, sign in, turn email codes off, and change your password immediately.",
      });
    case "email-otp-disabled":
      return renderEmail({
        subject: "Email sign-in codes turned off",
        heading: "Email codes are now off",
        introduction:
          "Email sign-in codes were turned off for your HILOXS account. You will use your authenticator app or a backup code to sign in.",
        safety:
          "If you did not do this, change your password immediately and check your authenticator app and backup codes.",
      });
    case "password-reset-notice":
      return renderEmail({
        subject: "Your HILOXS password was reset",
        heading: "Your password was reset",
        introduction:
          "The password for your HILOXS account was just reset. For your security, your next sign-in must use your authenticator app or a backup code, not an emailed code.",
        safety:
          "If you did not reset your password, contact HILOXS support immediately and do not share any codes.",
      });
  }
}

function verificationEmail(url: string): RenderedAuthEmail {
  return renderEmail({
    subject: "Verify your HILOXS email",
    heading: "Verify your email",
    introduction: "Confirm your email address to finish setting up your HILOXS account.",
    action: { label: "Verify Email", url },
    expiry: "This verification link expires in 1 hour and can be used only once.",
    safety: "If you did not register for HILOXS, you can safely ignore this message.",
  });
}

function passwordResetEmail(url: string): RenderedAuthEmail {
  return renderEmail({
    subject: "Reset your HILOXS password",
    heading: "Reset your password",
    introduction: "Use the secure link below to choose a new password for your HILOXS account.",
    action: { label: "Reset Password", url },
    expiry: "This password reset link expires in 1 hour and can be used only once.",
    safety:
      "If you did not request a password reset, ignore this message. Your password remains unchanged.",
  });
}

// The code is deliberately absent from the subject (lock screens and notification previews show
// subjects) and there is no link: the code is typed into the page that is already open.
function emailOtpEmail(code: string, expiresInMinutes: number): RenderedAuthEmail {
  return renderEmail({
    subject: "Your HILOXS sign-in code",
    heading: "Your sign-in code",
    introduction: "Enter this code on the HILOXS sign-in page to finish signing in.",
    code,
    expiry: `This code expires in ${expiresInMinutes} minutes and can be used only once.`,
    safety:
      "If this wasn't you, do not share this code and change your password now. HILOXS staff will never ask you for it.",
  });
}

function renderEmail(content: EmailContent): RenderedAuthEmail {
  const text = [
    "HILOXS",
    "",
    content.heading,
    "",
    content.introduction,
    ...(content.code ? ["", content.code] : []),
    ...(content.action ? ["", `${content.action.label}: ${content.action.url}`] : []),
    ...(content.expiry ? ["", content.expiry] : []),
    "",
    content.safety,
  ].join("\n");

  const codeBlock = content.code
    ? `
        <p style="margin:0 0 24px;font-size:32px;font-weight:700;letter-spacing:8px;font-family:'Courier New',monospace">${escapeHtml(content.code)}</p>`
    : "";
  const actionBlock = content.action
    ? `
        <p style="margin:0 0 24px">
          <a href="${escapeHtml(content.action.url)}" style="display:inline-block;background:#087f5b;color:#ffffff;padding:12px 20px;text-decoration:none;font-weight:700">${content.action.label}</a>
        </p>`
    : "";
  const expiryBlock = content.expiry
    ? `
        <p style="margin:0 0 16px;line-height:1.6">${content.expiry}</p>`
    : "";

  const html = `<!doctype html>
<html lang="en">
  <body style="margin:0;background:#f5f7f8;color:#17202a;font-family:Arial,sans-serif">
    <div style="max-width:600px;margin:0 auto;padding:32px 20px">
      <p style="margin:0 0 24px;font-size:20px;font-weight:700">HILOXS</p>
      <div style="background:#ffffff;border:1px solid #dfe5e8;padding:32px">
        <h1 style="margin:0 0 16px;font-size:24px">${content.heading}</h1>
        <p style="margin:0 0 24px;line-height:1.6">${content.introduction}</p>${codeBlock}${actionBlock}${expiryBlock}
        <p style="margin:0;color:#52616b;line-height:1.6">${content.safety}</p>
      </div>
    </div>
  </body>
</html>`;

  return { subject: content.subject, text, html };
}

function escapeHtml(value: string): string {
  return value.replace(/[&<>'"]/g, (character) => {
    const entities: Record<string, string> = {
      "&": "&amp;",
      "<": "&lt;",
      ">": "&gt;",
      "'": "&#39;",
      '"': "&quot;",
    };
    return entities[character] ?? character;
  });
}
