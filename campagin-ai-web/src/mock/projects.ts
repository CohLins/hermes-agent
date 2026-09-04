import type { ProjectConfig } from "@/types";

/** 数据来自设计原型 index.html:107-110。 */
export const projects: ProjectConfig[] = [
  {
    project: "hytech-coupon",
    service_name: ["hytech-coupon-service"],
    brands: ["au"],
    aliases: ["优惠券", "coupon"],
    domains: ["coupon", "voucher", "promotion", "优惠券", "券", "营销"],
    owns: ["优惠券领取", "优惠券发放", "优惠券核销", "coupon service", "voucher service"],
    code_hints: {
      entrypoints: ["src"],
      search_terms: ["Coupon", "Voucher", "coupon", "voucher", "redeem", "issue"],
      exclude: ["node_modules", "dist", "build", "coverage"],
    },
    docs: { summary: "data/project-docs/hytech-coupon.md" },
    git: { url: "", branch: "release" },
    log_skill: "bit-log-search",
  },
  {
    project: "hytech-campaign-composite",
    service_name: [
      "hytech-campaign-composite-admin",
      "hytech-campaign-composite-client",
      "hytech-campaign-composite-job",
    ],
    brands: ["au", "vt"],
    aliases: ["活动聚合", "composite", "素材"],
    domains: ["campaign", "activity", "composite", "material", "creative", "活动", "活动聚合", "素材"],
    owns: ["活动聚合", "活动素材", "活动配置聚合", "campaign composite", "composite job"],
    code_hints: {
      entrypoints: ["src"],
      search_terms: ["Campaign", "Composite", "Material", "Creative", "Activity"],
      exclude: ["node_modules", "dist", "build", "coverage"],
    },
    docs: { summary: "data/project-docs/hytech-campaign-composite.md" },
    git: { url: "", branch: "release" },
    log_skill: "bit-log-search",
  },
];

/** 「新增项目」弹窗里的模板。 */
export const projectTemplate: ProjectConfig = {
  project: "new-project",
  service_name: ["new-project-service"],
  brands: ["au"],
  aliases: ["项目别名"],
  domains: ["domain"],
  owns: ["负责的业务能力"],
  code_hints: {
    entrypoints: ["src"],
    search_terms: ["Keyword"],
    exclude: ["node_modules", "dist", "build", "coverage"],
  },
  docs: { summary: "data/project-docs/new-project.md" },
  git: { url: "", branch: "release" },
  log_skill: "bit-log-search",
};
