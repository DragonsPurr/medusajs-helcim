import { ModuleProvider, Modules } from "@medusajs/framework/utils"
import HelcimPaymentProviderService from "./service"

export default ModuleProvider(Modules.PAYMENT, {
  services: [HelcimPaymentProviderService],
})
