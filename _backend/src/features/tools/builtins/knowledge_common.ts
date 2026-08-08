import { KnowledgeBaseService } from "../../knowledge-base/knowledge-base-service";

let kbService: KnowledgeBaseService | null = null;

/** Test hook — pass `null` to reset to the pristine (uninitialized) default. */
export function setKbService(service: KnowledgeBaseService | null): void {
  kbService = service;
}

export function getKbService(): KnowledgeBaseService {
  if (!kbService) {
    throw new Error("Knowledge Base service not initialized. Ensure knowledge is enabled in config.");
  }
  return kbService;
}
