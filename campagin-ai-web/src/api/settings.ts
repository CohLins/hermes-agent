import { ApiError, clone, delay, mockGet } from "./client";
import { personalSettings } from "@/mock/personal";
import { projects as projectMock } from "@/mock/projects";
import { serviceBrandConfigs } from "@/mock/serviceConfigs";
import { topicBrandConfigs } from "@/mock/topics";
import type {
  BrandConfig,
  PersonalSettings,
  ProjectConfig,
  ServiceConfig,
  TopicConfig,
} from "@/types";

let personal: PersonalSettings = clone(personalSettings);
let topicConfigs: BrandConfig<TopicConfig>[] = clone(topicBrandConfigs);
let serviceConfigs: BrandConfig<ServiceConfig>[] = clone(serviceBrandConfigs);
let projects: ProjectConfig[] = clone(projectMock);

/* ---------- 个人配置 ---------- */

export function getPersonalSettings(): Promise<PersonalSettings> {
  return mockGet(personal);
}

export async function savePersonalSettings(next: PersonalSettings): Promise<void> {
  await delay();
  personal = clone(next);
}

/* ---------- Topic 配置 ---------- */

export function listTopicConfigs(): Promise<BrandConfig<TopicConfig>[]> {
  return mockGet(topicConfigs);
}

/** 校验规则与原型一致：topics 必须是数组，每项含 topic / consumer_group / threshold(number)。 */
export function parseTopicConfig(raw: string): TopicConfig {
  let parsed: unknown;
  try {
    parsed = JSON.parse(raw);
  } catch {
    throw new ApiError("JSON 格式有误，请检查 topics、topic、consumer_group 和 threshold");
  }
  const value = parsed as TopicConfig | null;
  const ok =
    !!value &&
    Array.isArray(value.topics) &&
    value.topics.every((x) => !!x && !!x.topic && !!x.consumer_group && typeof x.threshold === "number");
  if (!ok) {
    throw new ApiError("JSON 格式有误，请检查 topics、topic、consumer_group 和 threshold");
  }
  return value;
}

export async function saveTopicConfig(brand: string, config: TopicConfig): Promise<void> {
  await delay();
  topicConfigs = topicConfigs.map((x) => (x.brand === brand ? { ...x, config: clone(config) } : x));
}

/* ---------- 服务配置 ---------- */

export function listServiceConfigs(): Promise<BrandConfig<ServiceConfig>[]> {
  return mockGet(serviceConfigs);
}

export function parseServiceConfig(raw: string): ServiceConfig {
  let parsed: unknown;
  try {
    parsed = JSON.parse(raw);
  } catch {
    throw new ApiError("JSON 格式有误，service_name 必须是数组");
  }
  const value = parsed as ServiceConfig | null;
  if (!value || !Array.isArray(value.service_name) || value.service_name.some((x) => typeof x !== "string")) {
    throw new ApiError("JSON 格式有误，service_name 必须是数组");
  }
  return value;
}

export async function saveServiceConfig(brand: string, config: ServiceConfig): Promise<void> {
  await delay();
  serviceConfigs = serviceConfigs.map((x) => (x.brand === brand ? { ...x, config: clone(config) } : x));
}

/* ---------- 项目配置 ---------- */

export function listProjects(): Promise<ProjectConfig[]> {
  return mockGet(projects);
}

export function parseProjectConfig(raw: string): ProjectConfig {
  let parsed: unknown;
  try {
    parsed = JSON.parse(raw);
  } catch {
    throw new ApiError("JSON 格式有误，请检查后重试");
  }
  const value = parsed as ProjectConfig | null;
  if (!value || !value.project || !Array.isArray(value.service_name)) {
    throw new ApiError("JSON 格式有误：project 必填，service_name 必须是数组");
  }
  return value;
}

export async function saveProject(index: number | null, config: ProjectConfig): Promise<void> {
  await delay();
  if (index === null) {
    projects = [...projects, clone(config)];
    return;
  }
  projects = projects.map((x, i) => (i === index ? clone(config) : x));
}
