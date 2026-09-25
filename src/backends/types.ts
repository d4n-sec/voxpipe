export type BackendRequest = {
  file: string;
  language?: string;
  prompt?: string;
  model?: string;
  signal?: AbortSignal;
};

export interface Backend {
  readonly name: string;
  transcribe(req: BackendRequest): Promise<string>;
}
