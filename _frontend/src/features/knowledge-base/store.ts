import { create } from "zustand";
import {
  knowledgeListDocuments,
  knowledgeSearch,
  knowledgeCreateDocument,
  knowledgeDeleteDocument,
  knowledgeIngest,
} from "../../lib/api";
import type {
  KnowledgeDocumentMeta,
  KnowledgeSearchResult,
} from "../../lib/api";

interface KnowledgeState {
  documents: KnowledgeDocumentMeta[];
  searchResults: KnowledgeSearchResult[];
  loading: boolean;
  searching: boolean;
  error: string | null;
  scope: "global" | "project" | "session";

  fetchDocuments: () => Promise<void>;
  search: (query: string, opts?: { limit?: number; mode?: string }) => Promise<void>;
  createDocument: (body: { filename: string; content: string; tags?: string[] }) => Promise<void>;
  deleteDocument: (id: string, confirmed?: boolean) => Promise<void>;
  ingest: () => Promise<void>;
  setScope: (scope: "global" | "project" | "session") => void;
  uploadFiles: (files: File[]) => Promise<void>;
  uploading: boolean;
}

export const useKnowledgeStore = create<KnowledgeState>((set, get) => ({
  documents: [],
  searchResults: [],
  loading: false,
  searching: false,
  uploading: false,
  error: null,
  scope: "session",

  fetchDocuments: async () => {
    set({ loading: true, error: null });
    try {
      const { documents } = await knowledgeListDocuments({ scope: get().scope });
      set({ documents, loading: false });
    } catch (err: any) {
      set({ error: err.message, loading: false });
    }
  },

  search: async (query, opts) => {
    set({ searching: true, error: null });
    try {
      const { results } = await knowledgeSearch(query, {
        scope: get().scope,
        ...opts,
      });
      set({ searchResults: results, searching: false });
    } catch (err: any) {
      set({ error: err.message, searching: false });
    }
  },

  createDocument: async (body) => {
    set({ loading: true, error: null });
    try {
      await knowledgeCreateDocument({ ...body, scope: get().scope });
      await get().fetchDocuments();
    } catch (err: any) {
      set({ error: err.message, loading: false });
    }
  },

  deleteDocument: async (id, confirmed) => {
    set({ loading: true, error: null });
    try {
      await knowledgeDeleteDocument(id, { scope: get().scope, confirmed });
      await get().fetchDocuments();
    } catch (err: any) {
      set({ error: err.message, loading: false });
    }
  },

  ingest: async () => {
    set({ loading: true, error: null });
    try {
      await knowledgeIngest(get().scope);
      await get().fetchDocuments();
    } catch (err: any) {
      set({ error: err.message, loading: false });
    }
  },

  setScope: (scope) => {
    set({ scope });
    get().fetchDocuments();
  },

  uploadFiles: async (files) => {
    set({ uploading: true, error: null });
    try {
      const scope = get().scope;
      for (const file of files) {
        const content = await file.text();
        await knowledgeCreateDocument({
          filename: file.name,
          content,
          scope,
        });
      }
      await get().fetchDocuments();
    } catch (err: any) {
      set({ error: err.message, uploading: false });
    } finally {
      set({ uploading: false });
    }
  },
}));
