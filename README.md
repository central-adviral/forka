# AB Test Tool

## Deploy

1. Create a Supabase project (production), run `npx supabase link` and `npx supabase db push` to apply migrations.
2. Create a Vercel project pointed at this repo. Set env vars: `NEXT_PUBLIC_SUPABASE_URL`,
   `NEXT_PUBLIC_SUPABASE_ANON_KEY`, `SUPABASE_SERVICE_ROLE_KEY`, `HUBLA_WEBHOOK_TOKEN`, `COOKIE_MAX_AGE_DAYS`.
3. In Vercel, add the custom domain used for redirects (e.g. `ir.seudominio.com`) and create the CNAME
   record your DNS provider requests.
4. In Hubla's webhook settings, register `https://ir.seudominio.com/api/webhooks/hubla` for the
   "Pagamento da fatura realizado" (invoice.payment_succeeded) event, and set the webhook token to the
   same value as `HUBLA_WEBHOOK_TOKEN`.
5. Create your first login user via Supabase Studio (Authentication > Users > Add user).

## Thank-you page pixel (capture tests)

On any thank-you page whose test uses `conversion_method: thank_you_page`, add this snippet. It reads the
tracking id from the page's own URL query string — your funnel/page-builder must forward the original
query parameters through to this page (most tools have a "pass URL parameters on redirect" toggle):

```html
<script>
  (function () {
    var params = new URLSearchParams(window.location.search);
    var tid = params.get('utm_content') || params.get('tid');
    if (tid) {
      var img = new Image();
      img.src = 'https://ir.seudominio.com/ty/PLACEHOLDER_TEST_SLUG?tid=' + encodeURIComponent(tid);
    }
  })();
</script>
```

Replace `PLACEHOLDER_TEST_SLUG` with the test's slug shown on its report page. Also replace `ir.seudominio.com` with the domain you configured for your Vercel redirect service (step 3 in Deploy).
