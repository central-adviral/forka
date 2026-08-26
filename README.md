# AB Test Tool

## Deploy

1. Create a Supabase project (production), run `npx supabase link` and `npx supabase db push` to apply migrations.
2. Create a Vercel project pointed at this repo. Set env vars: `NEXT_PUBLIC_SUPABASE_URL`,
   `NEXT_PUBLIC_SUPABASE_ANON_KEY`, `SUPABASE_SERVICE_ROLE_KEY`, `HUBLA_WEBHOOK_TOKEN`, `COOKIE_MAX_AGE_DAYS`,
   `NEXT_PUBLIC_REDIRECT_DOMAIN`.
3. In Vercel, add the custom domain used for redirects (e.g. `ir.seudominio.com`) and create the CNAME
   record your DNS provider requests.
4. In Hubla's webhook settings, register `https://ir.seudominio.com/api/webhooks/hubla` for the
   "Pagamento da fatura realizado" (invoice.payment_succeeded) event, and set the webhook token to the
   same value as `HUBLA_WEBHOOK_TOKEN`.
5. Create your first login user via Supabase Studio (Authentication > Users > Add user).

## Thank-you page pixel (capture tests)

On any thank-you page whose test uses `conversion_method: thank_you_page`, this snippet is auto-generated
per variant with your real domain and slug already filled in — go to the test's report page (Dashboard →
client → test) and copy it from there. **Your funnel/page-builder must be configured to forward the
original URL query parameters through to the thank-you page redirect, or the pixel will never receive a
tracking id and will never fire.**
