# Resend Gmail Forwarder 
 
Cloudflare Worker that forwards Resend incoming emails to Gmail. 
 
## Setup 
 
1. npm install 
2. Copy .dev.vars.example to .dev.vars and configure secrets. 
3. npm run dev 
4. npm run deploy 
 
Configure Resend webhook with event email.received and your Worker URL.
"# Mailer" 
