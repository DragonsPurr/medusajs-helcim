import { BigNumberInput } from "@medusajs/framework/types"
import { BigNumber } from "@medusajs/framework/utils"

/**
 * Medusa stores monetary amounts as decimals (e.g. 49.99).
 * HelcimPay initialize expects the amount in major currency units.
 */
export function toHelcimAmount(amount: BigNumberInput): number {
  return new BigNumber(amount).numeric
}

export function helcimCurrency(currencyCode: string): "CAD" | "USD" {
  const code = currencyCode.toUpperCase()
  if (code === "CAD" || code === "USD") {
    return code
  }
  throw new Error(
    `Helcim provider supports CAD and USD only. Received: ${currencyCode}`
  )
}
