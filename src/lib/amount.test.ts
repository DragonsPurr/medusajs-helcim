import { describe, expect, it } from "vitest"
import { helcimCurrency, toHelcimAmount } from "./amount"

describe("toHelcimAmount", () => {
  it("converts decimal amounts as-is", () => {
    expect(toHelcimAmount(49.99)).toBe(49.99)
    expect(toHelcimAmount("10.5")).toBe(10.5)
  })

  it("handles integer amounts", () => {
    expect(toHelcimAmount(100)).toBe(100)
  })
})

describe("helcimCurrency", () => {
  it("accepts CAD and USD case-insensitively", () => {
    expect(helcimCurrency("cad")).toBe("CAD")
    expect(helcimCurrency("USD")).toBe("USD")
  })

  it("throws for unsupported currencies", () => {
    expect(() => helcimCurrency("eur")).toThrow(
      "Helcim provider supports CAD and USD only"
    )
  })
})
