export interface EmbeddingProvider {
  embed(texts: string[], model?: string): Promise<number[][]>;
  readonly displayName: string;
  readonly modelName: string;
  readonly dimensions: number;
}
