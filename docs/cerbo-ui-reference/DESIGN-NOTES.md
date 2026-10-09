# Cerbo UI design language (from the public Storylane demo)

Source: https://app.storylane.io/demo/ynov8xlyqfo6 (linked from https://www.cer.bo/try-cerbo/).
Screenshots in this folder are captures of that public demo, kept as a style reference so our
supplement-store screens feel native to Cerbo. We are not copying their code or branding beyond
what's needed for the "lives inside the EHR" illusion in a take-home exercise.

## Overall chrome
- Slate gray-blue page background (#7a8797, sampled from the captures — earlier drafts of these notes
  said "dark charcoal", which was wrong); content lives in dense white panels ("blocks") with 1px borders.
- Top nav on the same slate as the page (no separate bar), white text, yellow/amber active underlines: Scheduling · Admin · Reporting ·
  Tasks (badge) · Generate · My Links · Pt Portal · Settings, user initials, patient search box right.
- Left rail on chart view: patient photo, name + alias ("Zeus King ('Jupiter') #21 - 54 Years"),
  Patient Information block, status strips (red "Opted Out of AC", black "Cash Pay", gray "Hormone").

## Panel headers (each block has a colored title bar, white bold text)
- Green: Encounters, My System Tasks, Facilities/Specialists
- Maroon/dark red: Medications, Allergy, Key Documents, Appointment Requests header variants
- Navy/dark blue: Admin Notes, Social/Family Notes, Need to Know
- Black: Patient Vitals, Cash Pay strip
- Purple: Health Maintenance, Patient Portal Queue (magenta/plum)
- Orange: Past Med Hx
- Yellow/amber: Billing header ("Billing (Subscription: 12 month subscription)")
- Dark gray: Open Orders, Calendar Options

## Details that sell the look
- Tabs inside panels, small and rectangular: "Medications | Supplements | Pellets | IVs" (supplements
  are a first-class tab in the chart) and document tabs "Unreviewed 10 | Labs 1 | Imaging | ... | Invoices 6"
  with italic counts.
- Billing block = dated ledger rows: `07/05/24  (D) 3 Month Cycle Package  -$885.00`; charges in red
  with minus sign, payments as `Credit / Payment (+)  ($150.00)` in parens/green-ish, bold red
  `BALANCE: -$3337.93` centered at top, footer "Last Manual Transaction: July 3, 2024".
- Rows zebra-striped light gray; links are muted blue; lots of small caps/bold labels; tiny
  gray footer lines on every panel ("Last Updated by Dr. Marcus Welby - 07/02/2024").
- Font looks like a plain web sans (Lato/Helvetica-ish), small sizes, high density, minimal whitespace.
- Patient Portal Queue items are timestamped orange-chip rows, e.g. "Zeus King would like to add a
  supplement refill" — supplements already flow through their portal queue today.
- Demo patients are Greek gods (Zeus King, Hera Elaine Queen) with Dr. Marcus Welby — fun seed-data idea.

## Logo

`web/public/cerbo-logo.svg` is Cerbo's own wordmark (https://www.cer.bo/wp-content/themes/cerbo2025/images/logo.svg),
shown on a white tile at the top-left of the header exactly as their chart does. Used solely to
sell the "lives inside Cerbo" illusion in a take-home for Cerbo; it is their trademark.

## What we'll build with it
Provider-facing screens (order builder, dashboard) styled as Cerbo chart blocks: colored panel
headers, dense tables, a "Supplement Store" block that could sit next to Medications. The
patient-facing checkout should instead look like a clean patient-portal page (their portal is a
separate, simpler surface). Old-school idiom, but implemented in Vue + TS like their real stack.
