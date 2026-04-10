// supabase/functions/send-email/index.ts
// Deploy: supabase functions deploy send-email
// Secret:  supabase secrets set RESEND_API_KEY=re_...

const RESEND_API_KEY = Deno.env.get("RESEND_API_KEY")!;
const ALLOWED_ORIGIN = "https://apexcoaching.app";

const corsHeaders = {
  "Access-Control-Allow-Origin": ALLOWED_ORIGIN,
  "Access-Control-Allow-Headers": "authorization, content-type",
  "Access-Control-Allow-Methods": "POST, OPTIONS",
};

const SUBJECTS: Record<string, string> = {
  "welcome":              "Welcome to APEX Coaching — your macros are ready",
  "upgrade-nudge":        "Your free macros + one upgrade option",
  "payment-confirm":      "Payment confirmed — your coaching plan is active",
  "checkin-reminder":     "Reminder: weekly check-in due",
  "coach-note":           "Message from your APEX Coach",
  "application-received": "Application received — we'll be in touch within 24h",
  "email-verify":         "Verify your APEX account",
  "coach-message-alert":  "New message from a client",
  "client-message-alert": "New message from your coach",
  "contact-form":         "New contact form submission",
};

function buildHtml(template: string, data: Record<string, string>): string {
  const appName  = data.appName  || "APEX COACHING";
  const primary  = "#C9A84C";
  const bg       = "#060608";
  const surface  = "#0D0D10";
  const text     = "#F0EDE8";
  const muted    = "#6B6B78";

  const wrap = (body: string) => `<!DOCTYPE html>
<html lang="en">
<head>
  <meta charset="UTF-8">
  <meta name="viewport" content="width=device-width, initial-scale=1.0">
  <title>${SUBJECTS[template] || appName}</title>
</head>
<body style="margin:0;padding:0;background:${bg};font-family:'Helvetica Neue',Helvetica,Arial,sans-serif;color:${text};">
  <table width="100%" cellpadding="0" cellspacing="0" style="background:${bg};padding:32px 16px;">
    <tr><td align="center">
      <table width="560" cellpadding="0" cellspacing="0" style="max-width:560px;width:100%;background:${surface};border:1px solid #1E1E24;border-radius:8px;overflow:hidden;">
        <!-- Header -->
        <tr><td style="background:linear-gradient(135deg,#0D0D10,#141418);padding:28px 32px;border-bottom:1px solid #1E1E24;">
          <span style="font-size:28px;font-weight:900;color:${primary};letter-spacing:0.15em;">${appName}</span>
        </td></tr>
        <!-- Body -->
        <tr><td style="padding:32px;">
          ${body}
        </td></tr>
        <!-- Footer -->
        <tr><td style="padding:20px 32px;border-top:1px solid #1E1E24;text-align:center;">
          <p style="margin:0;font-size:12px;color:${muted};">© ${new Date().getFullYear()} ${appName}. All rights reserved.</p>
          <p style="margin:6px 0 0;font-size:12px;color:${muted};">You received this because you signed up at apexcoaching.app.</p>
        </td></tr>
      </table>
    </td></tr>
  </table>
</body>
</html>`;

  const btn = (href: string, label: string) =>
    `<a href="${href}" style="display:inline-block;background:linear-gradient(135deg,${primary},#E8C76A);color:#060608;font-weight:700;font-size:14px;letter-spacing:0.1em;text-transform:uppercase;padding:14px 28px;border-radius:4px;text-decoration:none;">${label}</a>`;

  const h1 = (t: string) =>
    `<h1 style="margin:0 0 16px;font-size:26px;font-weight:900;color:${primary};letter-spacing:0.04em;">${t}</h1>`;

  const p = (t: string) =>
    `<p style="margin:0 0 16px;font-size:15px;line-height:1.7;color:rgba(240,237,232,0.85);">${t}</p>`;

  switch (template) {
    case "welcome":
      return wrap(`
        ${h1(`Welcome, ${data.firstName || ""}!`)}
        ${p("Your transformation starts now. Here are your personalized daily macro targets:")}
        <table cellpadding="0" cellspacing="0" style="width:100%;margin:20px 0;border-collapse:collapse;">
          ${[
            ["Calories", data.calories, "#C9A84C"],
            ["Protein",  `${data.protein}g`, "#4ACA78"],
            ["Carbs",    `${data.carbs}g`,   "#4E8FE0"],
            ["Fat",      `${data.fat}g`,     "#E08052"],
          ].map(([label, val, color]) => `
          <tr>
            <td style="padding:10px 14px;border-bottom:1px solid #1E1E24;font-size:13px;color:#6B6B78;font-weight:700;letter-spacing:0.1em;text-transform:uppercase;">${label}</td>
            <td style="padding:10px 14px;border-bottom:1px solid #1E1E24;font-size:22px;font-weight:900;color:${color};font-family:'Georgia',serif;">${val}</td>
          </tr>`).join("")}
        </table>
        ${p("Log your first meal, check off today's habits, and let's get to work.")}
        <p style="margin:24px 0 0;text-align:center;">${btn(data.loginUrl || "https://apexcoaching.app", "Open My Dashboard →")}</p>
      `);

    case "upgrade-nudge":
      return wrap(`
        ${h1("Still thinking about coaching?")}
        ${p(`You signed up ${data.firstName ? "as " + data.firstName : ""} and your free macro calculator has been running. Here's what you're missing with a coach in your corner:`)}
        <ul style="margin:16px 0;padding-left:20px;color:rgba(240,237,232,0.85);line-height:2;font-size:14px;">
          <li>Weekly log reviews — your coach sees exactly what you're doing</li>
          <li>Macro adjustments when progress stalls</li>
          <li>Custom workout overrides for your equipment</li>
          <li>Direct messaging — ask anything, get a real answer</li>
        </ul>
        ${p(`Core coaching starts at <strong style="color:${primary};">$${data.corePrice || "97"}/month</strong>. Cancel anytime.`)}
        <p style="margin:24px 0 0;text-align:center;">${btn("https://apexcoaching.app/#pricing", "See Coaching Plans →")}</p>
      `);

    case "payment-confirm":
      return wrap(`
        ${h1("Payment Confirmed ✓")}
        ${p(`Your <strong style="color:${primary};">${data.plan || ""} plan</strong> is now active. ${data.amount ? "Amount: $" + data.amount + (data.interval === "month" ? "/mo" : " one-time") + "." : ""}`)}
        ${p("Your dashboard is fully unlocked. Your coach has been notified and will reach out within 24 hours.")}
        <p style="margin:24px 0 0;text-align:center;">${btn(data.loginUrl || "https://apexcoaching.app", "Open My Dashboard →")}</p>
      `);

    case "email-verify":
      return wrap(`
        ${h1("Verify your email")}
        ${p(`Hi${data.firstName ? " " + data.firstName : ""},`)}
        ${p("Click the button below to verify your APEX account. This link expires in 24 hours.")}
        <p style="margin:24px 0;text-align:center;">${btn(data.verifyUrl || "#", "Verify My Email →")}</p>
        ${p(`If you didn't create an account, you can safely ignore this email.`)}
      `);

    case "coach-note":
      return wrap(`
        ${h1(`Message from ${data.coachName || "Your Coach"}`)}
        <blockquote style="margin:0 0 20px;padding:16px 20px;background:rgba(201,168,76,0.06);border-left:3px solid ${primary};border-radius:0 4px 4px 0;font-size:15px;line-height:1.7;color:rgba(240,237,232,0.9);">
          ${data.note || ""}
        </blockquote>
        <p style="margin:24px 0 0;text-align:center;">${btn(data.loginUrl || "https://apexcoaching.app", "Reply in App →")}</p>
      `);

    case "application-received":
      return wrap(`
        ${h1("Application Received")}
        ${p(`Hi ${data.firstName || ""},`)}
        ${p(`Your application for <strong style="color:${primary};">${data.plan || "coaching"}</strong> has been received. <strong style="color:${primary};">We'll review it and reach out within 24 hours.</strong>`)}
        ${p("In the meantime, create a free account to get your personalized macro targets and explore the platform.")}
        <p style="margin:24px 0 0;text-align:center;">${btn("https://apexcoaching.app", "Explore the Platform →")}</p>
      `);

    case "coach-message-alert":
      return wrap(`
        ${h1("New client message")}
        ${p(`<strong>${data.fromName || "A client"}</strong> (${data.fromEmail || ""}) sent you a message:`)}
        <blockquote style="margin:0 0 20px;padding:16px 20px;background:rgba(255,255,255,0.03);border-left:3px solid #4E8FE0;font-size:14px;line-height:1.7;color:rgba(240,237,232,0.8);">
          ${data.preview || ""}...
        </blockquote>
        <p style="margin:24px 0 0;text-align:center;">${btn(data.loginUrl || "https://apexcoaching.app", "Reply in Dashboard →")}</p>
      `);

    case "client-message-alert":
      return wrap(`
        ${h1("New message from your coach")}
        ${p(`${data.coachName || "Your coach"} sent you a message:`)}
        <blockquote style="margin:0 0 20px;padding:16px 20px;background:rgba(201,168,76,0.06);border-left:3px solid ${primary};font-size:14px;line-height:1.7;color:rgba(240,237,232,0.8);">
          ${data.preview || ""}...
        </blockquote>
        <p style="margin:24px 0 0;text-align:center;">${btn(data.loginUrl || "https://apexcoaching.app", "Read & Reply →")}</p>
      `);

    default:
      return wrap(`
        ${h1(SUBJECTS[template] || appName)}
        ${p(JSON.stringify(data))}
      `);
  }
}

Deno.serve(async (req) => {
  if (req.method === "OPTIONS") {
    return new Response("ok", { headers: corsHeaders });
  }

  let payload: Record<string, unknown>;
  try {
    payload = await req.json();
  } catch {
    return new Response(JSON.stringify({ error: "Invalid JSON" }), {
      status: 400,
      headers: { ...corsHeaders, "Content-Type": "application/json" },
    });
  }

  const { template, to, toName, from, fromName, replyTo, data } = payload as {
    template: string;
    to: string;
    toName?: string;
    from: string;
    fromName?: string;
    replyTo?: string;
    data: Record<string, string>;
  };

  if (!to || !from || !template) {
    return new Response(JSON.stringify({ error: "Missing required fields: to, from, template" }), {
      status: 400,
      headers: { ...corsHeaders, "Content-Type": "application/json" },
    });
  }

  const subject = SUBJECTS[template] || `Message from ${fromName || "APEX Coaching"}`;
  const html = buildHtml(template, data || {});

  const emailPayload: Record<string, unknown> = {
    from: fromName ? `${fromName} <${from}>` : from,
    to: toName ? [`${toName} <${to}>`] : [to],
    subject,
    html,
  };
  if (replyTo) emailPayload.reply_to = replyTo;

  const res = await fetch("https://api.resend.com/emails", {
    method: "POST",
    headers: {
      Authorization: `Bearer ${RESEND_API_KEY}`,
      "Content-Type": "application/json",
    },
    body: JSON.stringify(emailPayload),
  });

  const result = await res.json();

  return new Response(JSON.stringify(result), {
    status: res.ok ? 200 : res.status,
    headers: { ...corsHeaders, "Content-Type": "application/json" },
  });
});
