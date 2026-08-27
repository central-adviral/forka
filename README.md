# AB Test Tool

## Deploy

1. Create a Supabase project (production), run `npx supabase link` and `npx supabase db push` to apply migrations.
2. Create a Vercel project pointed at this repo. Set env vars: `NEXT_PUBLIC_SUPABASE_URL`,
   `NEXT_PUBLIC_SUPABASE_ANON_KEY`, `SUPABASE_SERVICE_ROLE_KEY`, `COOKIE_MAX_AGE_DAYS`,
   `NEXT_PUBLIC_REDIRECT_DOMAIN` (this last one is only the fallback domain used until a client
   configures their own — see step 3).
3. Domain and Hubla webhook token are configured **per client**, from that client's "Integrações" tab
   in the dashboard, not as global env vars:
   - Domain: the tab shows the CNAME to create at the client's DNS provider; once DNS resolves (checked
     with the tab's "Verificar" button), tell whoever operates the Vercel project so they can register
     the domain on the Vercel project itself (`vercel domains add <domain>`) — this last step is manual,
     by design, for a small number of clients.
   - Hubla: paste that client's webhook token into the tab, then register the URL shown there
     (`https://<domain>/api/webhooks/hubla/<client-slug>`) in that client's Hubla webhook settings for the
     "Pagamento da fatura realizado" (invoice.payment_succeeded) event.
4. Create your first login user via Supabase Studio (Authentication > Users > Add user).

## Thank-you page pixel (capture tests)

On any thank-you page whose test uses `conversion_method: thank_you_page`, this snippet is auto-generated
per variant with your real domain and slug already filled in — go to the test's report page (Dashboard →
client → test) and copy it from there. **Your funnel/page-builder must be configured to forward the
original URL query parameters through to the thank-you page redirect, or the pixel will never receive a
tracking id and will never fire.**
