# Email deliverability — what the domain needs

The transport is wired and tested. What remains is DNS, and it is the step
most often skipped. A contact form that delivers into spam fails silently:
nobody reports it, and the business concludes the website does not work.

## Why the From address matters

The site always sends **from an address on our own domain** (`MAIL_FROM`) and
sets **Reply-To to the enquirer**. It never sends *as* the enquirer.

This is deliberate. Sending `From: visitor@theircompany.com` through our mail
server is a textbook DMARC failure: their domain's policy says our server is
not authorised to send as them, so receiving servers reject or spam-folder it.
The enquiry then disappears without an error anyone sees.

## The three records

Replace `solutionmines.example` with the real domain, and the host/selector
values with whatever the mail provider gives you.

| Record | Type | Host | Value |
|---|---|---|---|
| SPF | TXT | `@` | `v=spf1 include:<provider-spf-host> -all` |
| DKIM | TXT | `<selector>._domainkey` | provided by the mail host |
| DMARC | TXT | `_dmarc` | `v=DMARC1; p=none; rua=mailto:dmarc@solutionmines.example; pct=100` |

Notes that matter:

- **SPF: use `-all`, not `~all`,** once you are confident the list of senders
  is complete. A soft fail is widely ignored.
- **Only one SPF record per domain.** Two TXT records both beginning `v=spf1`
  is a permanent error, not a merge. If one already exists, add the provider
  to it rather than creating a second.
- **Start DMARC at `p=none`** and read the aggregate reports for a fortnight
  before tightening to `quarantine` and then `reject`. Going straight to
  `reject` with a misconfigured SPF silently destroys mail.

## Verifying before launch

1. Submit a real enquiry through `/contact`.
2. Open the received message and **view the full headers**. Look for
   `spf=pass`, `dkim=pass` and `dmarc=pass` in `Authentication-Results`.
   Anything else means it is not finished.
3. Check the acknowledgement arrived at the enquirer's address too, and that
   it landed in the inbox rather than spam.
4. Reply to the notification and confirm it reaches the enquirer — that is
   what `Reply-To` is for, and it is worth proving once.
5. Test from a different provider than your own (a Gmail address and an
   Outlook address behave differently).

## Keep it working

A fresh VPS IP has no sending reputation, and some providers treat that
harshly regardless of correct DNS. If deliverability is poor after the records
are right, set `RESEND_API_KEY` — the transport switches with no code change,
and you gain per-message delivery logs.

Add a **synthetic check** that submits a test enquiry on a schedule and alerts
if it does not arrive. The form is the only conversion mechanism on the site
and its failure mode is invisible; monitoring it is proportionate.
