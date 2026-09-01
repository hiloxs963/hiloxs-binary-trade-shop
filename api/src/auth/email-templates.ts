import type { AuthEmail } from "./email.js";

type RenderedAuthEmail = {
  subject: string;
  text: string;
  html: string;
};

export function renderAuthEmail(message: AuthEmail): RenderedAuthEmail {
  return message.kind === "verification"
    ? verificationEmail(message.url)
    : passwordResetEmail(message.url);
}

function verificationEmail(url: string): RenderedAuthEmail {
  return renderEmail({
    subject: "Verify your HILOXS email",
    heading: "Verify your email",
    introduction: "Confirm your email address to finish setting up your HILOXS account.",
    action: "Verify Email",
    url,
    expiry: "This verification link expires in 1 hour and can be used only once.",
    safety: "If you did not register for HILOXS, you can safely ignore this message.",
  });
}

function passwordResetEmail(url: string): RenderedAuthEmail {
  return renderEmail({
    subject: "Reset your HILOXS password",
    heading: "Reset your password",
    introduction: "Use the secure link below to choose a new password for your HILOXS account.",
    action: "Reset Password",
    url,
    expiry: "This password reset link expires in 1 hour and can be used only once.",
    safety:
      "If you did not request a password reset, ignore this message. Your password remains unchanged.",
  });
}

function renderEmail(content: {
  subject: string;
  heading: string;
  introduction: string;
  action: string;
  url: string;
  expiry: string;
  safety: string;
}): RenderedAuthEmail {
  const safeUrl = escapeHtml(content.url);
  const text = [
    "HILOXS",
    "",
    content.heading,
    "",
    content.introduction,
    "",
    `${content.action}: ${content.url}`,
    "",
    content.expiry,
    "",
    content.safety,
  ].join("\n");

  const html = `<!doctype html>
<html lang="en">
  <body style="margin:0;background:#f5f7f8;color:#17202a;font-family:Arial,sans-serif">
    <div style="max-width:600px;margin:0 auto;padding:32px 20px">
      <p style="margin:0 0 24px;font-size:20px;font-weight:700">HILOXS</p>
      <div style="background:#ffffff;border:1px solid #dfe5e8;padding:32px">
        <h1 style="margin:0 0 16px;font-size:24px">${content.heading}</h1>
        <p style="margin:0 0 24px;line-height:1.6">${content.introduction}</p>
        <p style="margin:0 0 24px">
          <a href="${safeUrl}" style="display:inline-block;background:#087f5b;color:#ffffff;padding:12px 20px;text-decoration:none;font-weight:700">${content.action}</a>
        </p>
        <p style="margin:0 0 16px;line-height:1.6">${content.expiry}</p>
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
