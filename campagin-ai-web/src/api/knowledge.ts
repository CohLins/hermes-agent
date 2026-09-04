import { mockGet } from "./client";
import { collectionDocCount, knowledgeCollections, knowledgeDocs } from "@/mock/knowledge";
import type { KnowledgeCollection, KnowledgeFolder } from "@/types";

export interface KnowledgeCollectionSummary extends KnowledgeCollection {
  count: number;
}

export function listKnowledgeCollections(): Promise<KnowledgeCollectionSummary[]> {
  return mockGet(
    knowledgeCollections.map((x) => ({ ...x, count: collectionDocCount(x.id) })),
  );
}

export function getKnowledgeFolders(collectionId: string): Promise<KnowledgeFolder[]> {
  return mockGet(knowledgeDocs[collectionId] ?? []);
}

export function getKnowledgeCollection(collectionId: string): Promise<KnowledgeCollection | undefined> {
  return mockGet(knowledgeCollections.find((x) => x.id === collectionId));
}
