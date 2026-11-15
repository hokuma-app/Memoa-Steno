export type SummaryDetail = 'brief' | 'balanced' | 'detailed';
export type FoldLevel = 'full' | 'brief' | 'key' | 'takeaway' | 'topic';
/** TextFold token: `t` text, `s` 1 when whitespace followed, `m` source token it slides from, `k` takeaway token. */
export interface FoldToken { t: string; s?: 1; m?: number; k?: number }
export interface FoldLadder {
  role: string;
  /** Evidence sentences (indices into the unit's `sents`): the Beknopt level, verbatim. */
  ev: number[];
  /** The written line (Kern): takeaway + reason; `m` ties a word to a source token of an evidence sentence. */
  brief: FoldToken[];
  /** The first `tn` tokens of `brief` are the takeaway (Kernzin). */
  tn: number;
  /** The topic (Onderwerpen); `k` ties a word to a takeaway token. */
  topic: FoldToken[];
  model: 'ai' | 'local';
}
export interface FoldUnit {
  kind: 'paragraph' | 'item' | 'heading';
  marker?: string;
  src: string;
  full: string;
  toks: FoldToken[];
  sents?: [number, number][];
  lad?: FoldLadder;
}
export interface FoldSection {
  id: string;
  title: string;
  full: string;
  /** The section's own line for the Onderwerpen cards, when it has several units. */
  lad: { take: FoldToken[]; topic: number[] } | null;
  units: FoldUnit[];
}
export interface FoldDocument {
  schemaVersion: 2;
  sourceHash: string;
  /** 'local': TextFold's local mode (author's first sentences, no AI); 'ai': written by the configured provider. */
  provenance: 'ai' | 'local';
  sections: FoldSection[];
}
export interface FoldingSourceSection { id: string; title: string; full: string }
export interface FoldProgress { done: number; total: number }
/** Content-free reason from the host; never model or source text. */
export type FoldFailureReason =
  | 'invalid_structure'
  | 'too_long'
  | 'provider_unavailable'
  | 'invalid_request'
  | 'timeout'
  | 'busy'
  | 'failed';
