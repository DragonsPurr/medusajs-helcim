# @boxingoctopus/medusajs-helcim

Medusa v2 payment provider for [Helcim](https://www.helcim.com/) using [HelcimPay.js](https://devdocs.helcim.com/docs/overview-of-helcimpayjs). Card data stays in Helcim’s hosted modal, which keeps your PCI scope lower than handling card numbers on your server.

## Requirements

- Medusa **v2.3+**
- Node **20+**
- Helcim merchant account with an [API Access Configuration](https://devdocs.helcim.com/docs/creating-an-api-access-configuration)

## Install

```bash
npm install @boxingoctopus/medusajs-helcim
# or
yarn add @boxingoctopus/medusajs-helcim
```

## Configure Medusa

Register the provider on the Payment module in `medusa-config.ts`:

```ts
import { defineConfig, loadEnv } from "@medusajs/framework/utils"

loadEnv(process.env.NODE_ENV || "development", process.cwd())

module.exports = defineConfig({
  modules: [
    {
      resolve: "@medusajs/medusa/payment",
      options: {
        providers: [
          {
            resolve: "@boxingoctopus/medusajs-helcim/providers/helcim",
            id: "helcim",
            options: {
              apiToken: process.env.HELCIM_API_TOKEN!,
              testMode: process.env.HELCIM_TEST_MODE === "true",
              paymentType: "purchase", // purchase | preauth | verify
              paymentMethod: "cc", // cc | ach | cc-ach
              webhookVerifierToken: process.env.HELCIM_WEBHOOK_VERIFIER_TOKEN,
            },
          },
        ],
      },
    },
  ],
})
```

Enable the provider for a region in **Medusa Admin → Settings → Regions**. The stored provider id is `pp_helcim_helcim` (`pp_{identifier}_{id}`).

### Environment variables

| Variable | Description |
|----------|-------------|
| `HELCIM_API_TOKEN` | API token from Helcim (required) |
| `HELCIM_TEST_MODE` | Set to `true` to use `api.helcim.test` |
| `HELCIM_WEBHOOK_VERIFIER_TOKEN` | Base64 verifier token from Helcim webhook settings (optional) |

## Checkout flow (storefront)

1. Customer selects Helcim at checkout → Medusa creates a payment session.
2. Session `data` includes `checkoutToken` (and `secretToken` for server-side hash checks).
3. Load [HelcimPay.js](https://devdocs.helcim.com/docs/render-helcimpayjs) and call `appendHelcimPayIframe(checkoutToken)`.
4. On `SUCCESS`, post the event message to Medusa by updating the payment session:

```ts
await sdk.store.payment.updatePaymentSession(cart.payment_collection.id, sessionId, {
  data: {
    helcimPayResponse: event.data.eventMessage, // { hash, data: { transactionId, status, ... } }
  },
})
```

5. Complete the cart; Medusa calls `authorizePayment`, which verifies the transaction (hash when possible, Helcim API otherwise).

Example listener (browser):

```js
const checkoutToken = paymentSession.data.checkoutToken

window.addEventListener("message", async (event) => {
  const key = `helcim-pay-js-${checkoutToken}`
  if (event.data?.eventName !== key) return

  if (event.data.eventStatus === "SUCCESS") {
    await updatePaymentSession({
      helcimPayResponse: event.data.eventMessage,
    })
    removeHelcimPayIframe()
  }
})
```

See Helcim’s guides: [Initialize](https://devdocs.helcim.com/docs/initialize-helcimpayjs), [Render](https://devdocs.helcim.com/docs/render-helcimpayjs), [Validate](https://devdocs.helcim.com/docs/validate-helcimpayjs).

## Payment types

| `paymentType` | Behavior |
|---------------|----------|
| `purchase` (default) | Charge on approval; `capturePayment` is a no-op |
| `preauth` | Authorize at checkout; capture via Medusa admin / API |
| `verify` | Card verification only (HelcimPay “Save” flow) |

Supported currencies: **CAD**, **USD** (Helcim limitation).

## Webhooks

Configure [Helcim webhooks](https://devdocs.helcim.com/docs/webhooks) with your Medusa payment webhook URL (e.g. `https://your-store.com/hooks/payment/pp_helcim_helcim`). Enable `cardTransaction` events. Set `webhookVerifierToken` in plugin options to verify signatures.

## Local development

```bash
yarn install
yarn build
```

Link into a Medusa app:

```bash
yarn link
cd ../your-medusa-app && yarn link @boxingoctopus/medusajs-helcim
```

## License

MIT — see [LICENSE](LICENSE).
