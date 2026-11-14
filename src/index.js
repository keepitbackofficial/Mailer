
import { Webhook } from "svix";

function escapeHtml(value = "") {
  return String(value).replace(/[&<>"']/g, char => ({
    "&": "&amp;",
    "<": "&lt;",
    ">": "&gt;",
    '"': "&quot;",
    "'": "&#39;"
  })[char]);
}

export default {
  async fetch(request, env) {
    if (request.method !== "POST") {
      return new Response("Resend Gmail Forwarder is running", {
        status: 200
      });
    }

    let event;

    try {
      const webhook = new Webhook(env.RESEND_WEBHOOK_SECRET);

      event = webhook.verify(await request.text(), {
        "svix-id": request.headers.get("svix-id"),
        "svix-timestamp": request.headers.get("svix-timestamp"),
        "svix-signature": request.headers.get("svix-signature")
      });
    } catch (error) {
      console.error("Webhook verification failed:", error);
      return new Response("Invalid signature", { status: 401 });
    }

    if (event.type !== "email.received") {
      return Response.json({ ignored: true });
    }

    const emailId = event.data?.email_id;

    if (!emailId) {
      return Response.json({ error: "Missing email ID" }, { status: 400 });
    }

    try {
      // Fetch received email from Resend
      const response = await fetch(
        `https://api.resend.com/emails/receiving/${encodeURIComponent(emailId)}`,
        {
          headers: {
            Authorization: `Bearer ${env.RESEND_API_KEY}`
          }
        }
      );

      if (!response.ok) {
        throw new Error(`Resend API error: ${response.status}`);
      }

      const email = await response.json();

      const subject = email.subject || "Incoming email";
      const sender = email.from || "Unknown sender";
      const recipient = Array.isArray(email.to)
        ? email.to.join(", ")
        : email.to || "";

      const body = email.html ||
        `<pre>${escapeHtml(email.text || "No email content")}</pre>`;

      // Forward to Gmail using Resend
      const forwarded = await fetch("https://api.resend.com/emails", {
        method: "POST",
        headers: {
          Authorization: `Bearer ${env.RESEND_API_KEY}`,
          "Content-Type": "application/json"
        },
        body: JSON.stringify({
          from: env.RESEND_FROM,
          to: [env.GMAIL_FORWARD_TO],
          subject: `FWD: ${subject}`,
          html: `
            <div style="font-family:Arial,sans-serif">
              <h2>Forwarded Email</h2>
              <hr>
              <p><b>From:</b> ${escapeHtml(sender)}</p>
              <p><b>To:</b> ${escapeHtml(recipient)}</p>
              <p><b>Subject:</b> ${escapeHtml(subject)}</p>
              <hr>
              ${body}
            </div>
          `,
          text: [
            "Forwarded Email",
            `From: ${sender}`,
            `To: ${recipient}`,
            `Subject: ${subject}`,
            "",
            email.text || ""
          ].join("\n")
        })
      });

      if (!forwarded.ok) {
        throw new Error(`Forwarding error: ${await forwarded.text()}`);
      }

      const result = await forwarded.json();

      console.log("Successfully forwarded:", emailId);

      return Response.json({
        success: true,
        forwarded: true,
        emailId,
        forwardedId: result.id
      });

    } catch (error) {
      console.error("Email forwarding failed:", error);

      return Response.json({
        success: false,
        error: error.message
      }, { status: 500 });
    }
  }
};
