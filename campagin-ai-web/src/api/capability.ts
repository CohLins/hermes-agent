import { mockGet } from "./client";
import { mcps } from "@/mock/mcps";
import { skills } from "@/mock/skills";
import type { McpServer, Skill } from "@/types";

export function listSkills(): Promise<Skill[]> {
  return mockGet(skills);
}

export function listMcps(): Promise<McpServer[]> {
  return mockGet(mcps);
}
