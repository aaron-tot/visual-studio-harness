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
  uploading: boolean;
  error: string | null;

  fetchDocuments: (scope: "global" | "project" | "session") => Promise<void>;
  search: (query: string, opts?: { limit?: number; mode?: string; scope?: "global" | "project" | "session" }) => Promise<void>;
  createDocument: (body: { filename: string; content: string; tags?: string[]; scope: "global" | "project" | "session" }) => Promise<void>;
  deleteDocument: (id: string, opts: { scope: "global" | "project" | "session"; confirmed?: boolean }) => Promise<void>;
  ingest: (scope: "global" | "project" | "session") => Promise<void>;
  uploadFiles: (files: File[], scope: "global" | "project" | "session") => Promise<void>;
}

export const useKnowledgeStore = create<KnowledgeState>((set, get) => ({
  documents: [],
  searchResults: [],
  loading: false,
  searching: false,
  uploading: false,
  error: null,

  fetchDocuments: async (scope) => {
    set({ loading: true, error: null });
    try {
      const { documents } = await knowledgeListDocuments({ scope });
      set({ documents, loading: false });
    } catch (err: any) {
      set({ error: err.message, loading: false });
    }
  },

  search: async (query, opts) => {
    set({ searching: true, error: null });
    try {
      const { results } = await knowledgeSearch(query, opts);
      set({ searchResults: results, searching: false });
    } catch (err: any) {
      set({ error: err.message, searching: false });
    }
  },

  createDocument: async (body) => {
    set({ loading: true, error: null });
    try {
      await knowledgeCreateDocument(body);
      await get().fetchDocuments(body.scope);
    } catch (err: any) {
      set({ error: err.message, loading: false });
    }
  },

  deleteDocument: async (id, opts) => {
    set({ loading: true, error: null });
    try {
      await knowledgeDeleteDocument(id, opts);
      await get().fetchDocuments(opts.scope);
    } catch (err: any) {
      set({ error: err.message, loading: false });
    }
  },

  ingest: async (scope) => {
    set({ loading: true, error: null });
    try {
      await knowledgeIngest(scope);
      await get().fetchDocuments(scope);
    } catch (err: any) {
      set({ error: err.message, loading: false });
    }
  },

  uploadFiles: async (files, scope) => {
    set({ uploading: true, error: null });
    try {
      for (const file of files) {
        const content = await file.text();
        await knowledgeCreateDocument({
          filename: file.name,
          content,
          scope,
        });
      }
      await get().fetchDocuments(scope);
    } catch (err: any) {
      set({ error: err.message, uploading: false });
    } finally {
      set({ uploading: false });
    }
  },
}));
