import type { BrandConfig, ServiceConfig } from "@/types";

/** 数据来自设计原型 index.html:137-138。 */
export const serviceBrandConfigs: BrandConfig<ServiceConfig>[] = [
  {
    brand: "au",
    label: "AU · 澳大利亚",
    config: { service_name: ["hytech-coupon-service", "hytech-campaign-composite-admin"] },
  },
  {
    brand: "vt",
    label: "VT · 越南",
    config: { service_name: ["hytech-campaign-composite-client", "hytech-campaign-composite-job"] },
  },
];
