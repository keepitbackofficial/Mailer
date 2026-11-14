
import { Webhook } from "svix";

function arrayBufferToBase64(buffer) {
  const bytes = new Uint8Array(buffer);
  let binary = "";
  const chunkSize = 0x8000;

  for (let i = 0; i < bytes.length; i += chunkSize) {
    binary += String.fromCharCode(
      ...bytes.subarray(i, i + chunkSize)
    );
  }

  return btoa(binary);
}

export default {
  async fetch(request, env) {
    if (request.method !== "POST") {
      return Response.json({
        service: "Resend Gmail Mailer",
        status: "running"
      });
    }

    // Verify webhook
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
      return Response.json(
        { success: false, error: "Invalid webhook signature" },
        { status: 401 }
      );
    }

    if (event.type !== "email.received") {
      return Response.json({ success: true, ignored: true });
    }

    if (!env.RESEND_API_KEY || !env.RESEND_FROM ||
        !env.GMAIL_FORWARD_TO) {
      return Response.json(
        { success: false, error: "Missing Worker configuration" },
        { status: 500 }
      );
    }

    const emailId = event.data?.email_id;

    try {
      const apiHeaders = {
        Authorization: `Bearer ${env.RESEND_API_KEY}`
      };

      // 1. Retrieve original email
      const emailResponse = await fetch(
        `https://api.resend.com/emails/receiving/${encodeURIComponent(emailId)}`,
        { headers: apiHeaders }
      );

      if (!emailResponse.ok) {
        throw new Error(
          `Email retrieval failed: ${await emailResponse.text()}`
        );
      }

      const email = await emailResponse.json();

      // 2. Retrieve attachment metadata
      const attachmentResponse = await fetch(
        `https://api.resend.com/emails/receiving/${encodeURIComponent(emailId)}/attachments`,
        { headers: apiHeaders }
      );

      if (!attachmentResponse.ok) {
        throw new Error(
          `Attachment listing failed: ${await attachmentResponse.text()}`
        );
      }

      const attachmentData = await attachmentResponse.json();
      const attachmentList = attachmentData.data || [];

      // 3. Download all attachments
      const attachments = await Promise.all(
        attachmentList.map(async (attachment) => {
          if (!attachment.download_url) {
            throw new Error(
              `Missing download URL: ${attachment.filename}`
            );
          }

          const fileResponse = await fetch(attachment.download_url);

          if (!fileResponse.ok) {
            throw new Error(
              `Download failed: ${attachment.filename}`
            );
          }

          const buffer = await fileResponse.arrayBuffer();

          return {
            filename: attachment.filename || "attachment",
            content: arrayBufferToBase64(buffer),
            content_type: attachment.content_type,
            ...(attachment.content_id
              ? { content_id: attachment.content_id }
              : {})
          };
        })
      );

      // 4. Preserve original email HTML and text
      const payload = {
        from: env.RESEND_FROM,
        to: [env.GMAIL_FORWARD_TO],

        // Keep original subject
        subject: email.subject || "Incoming email",

        // Original email template, without a new wrapper
        ...(email.html ? { html: email.html } : {}),
        ...(email.text ? { text: email.text } : {}),

        // Original attachments
        ...(attachments.length ? { attachments } : {})
      };

      // 5. Send to Gmail
      const sendResponse = await fetch(
        "https://api.resend.com/emails",
        {
          method: "POST",
          headers: {
            ...apiHeaders,
            "Content-Type": "application/json"
          },
          body: JSON.stringify(payload)
        }
      );

      if (!sendResponse.ok) {
        throw new Error(
          `Forwarding failed: ${await sendResponse.text()}`
        );
      }

      const result = await sendResponse.json();

      console.log("Email successfully forwarded:", emailId);

      return Response.json({
        success: true,
        forwarded: true,
        originalSubject: email.subject,
        attachments: attachments.length,
        forwardedEmailId: result.id
      });

    } catch (error) {
      console.error("Mailer error:", error);

      return Response.json({
        success: false,
        error: error.message
      }, { status: 500 });
    }
  }
};
