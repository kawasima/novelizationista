/** フレームの役割 */
export type FrameRole = "idle" | "blink" | "talk";

/** メタJSON内の1フレーム */
export interface FrameMeta {
  index: number;
  name: string;
  role: FrameRole;
  x: number;
  y: number;
  width: number;
  height: number;
  /** フレームの描画X補正（px）。正で右、負で左にずらす */
  offsetX?: number;
}

/** メタJSONトップレベル */
export interface SpriteMeta {
  frameWidth: number;
  frameHeight: number;
  frames: FrameMeta[];
}

/** キャラクター定義 */
export interface CharacterDef {
  id: string;
  name: string;
  spriteImage: string;
  spriteMeta: string;
}

/** role別フレーム索引 */
export interface RoleFrameIndex {
  idle: FrameMeta[];
  blink: FrameMeta[];
  talk: FrameMeta[];
}

/** ロード済みスプライト */
export interface LoadedSprite {
  image: HTMLImageElement;
  meta: SpriteMeta;
  roles: RoleFrameIndex;
  defaultIdleFrame: FrameMeta;
  blinkFrame: FrameMeta;
}

/** セリフ / ナレーション */
export interface DialogueLine {
  id?: string;            // 原文から作る行の ID。翻訳の対応付けに使う（txt2scenario.py が付ける）
  characterId: string | null;
  text: string;
  reading?: string;        // 読み上げ用テキスト（省略時は text を使用）
  audio?: string;
  slide?: string | null;  // 表示開始: パス, 非表示: null, 省略: 前行を維持
  spans?: TextSpan[];     // text の中で印を付ける区間
  translated?: boolean;   // 訳文に差し替えた行。実行時に付く。文字送りを音声の長さに合わせる
}

/** 用語集の項目。リンク・説明・見た目のどれか、または組み合わせ */
export interface Term {
  href?: string;
  help?: string;
  style?: "em" | "code";
}

/** text の [start, end) に付ける印。term は Scenario.terms のキー。直接書いた項目が term より優先する */
export interface TextSpan extends Term {
  start: number;
  end: number;
  term?: string;
}

/** 通常シーン（背景＋キャラクター＋セリフ群） */
export interface DialogueScene {
  type?: "dialogue";      // 省略時もdialogue扱い
  title?: string;
  background: string;
  bgm?: string | null;    // 再生開始: パス, 停止: null, 省略: 前シーンを維持
  dialogue: DialogueLine[];
}

/** トランジションシーン（暗転ナレーション） */
export interface TransitionScene {
  type: "transition";
  title?: string;
  background?: string;    // 省略時は黒
  bgm?: string | null;
  dialogue: DialogueLine[];
}

export type Scene = DialogueScene | TransitionScene;

/** クレジット（エンドロール） */
export interface Credits {
  bgm?: string | null;
  lines: (string | CreditLine)[];
}

/** リンク付きのクレジット行 */
export interface CreditLine {
  text: string;
  href?: string;
}

/** シナリオ（キャラクター定義＋シーン群） */
export interface Scenario {
  title: string;
  characters: CharacterDef[];
  scenes: Scene[];
  terms?: Record<string, Term>;
}

/** タイトル画面（クリックで開始） */
export interface OpeningScreen {
  title?: string;         // 背景の上部に重ねる題。題を描き込んだ画像なら省略
  background: string;
  bgm?: string | null;
}

/** 作品ごとの設定。パスは public/ からのルート相対（"/scenarios/episode1.json" など） */
export interface NovelConfig {
  scenario: string;
  credits?: string;
  opening: OpeningScreen;
  /** シナリオの原文の言語。既定は "ja" */
  language?: string;
  /** 言語コード → 翻訳ファイル。音声は原文のまま流し、文字だけ差し替える */
  translations?: Record<string, TranslationFiles>;
}

export interface TranslationFiles {
  scenario: string;       // tools/translate.py が出力する翻訳 JSON
  credits?: string;       // 省略時は原文のクレジット
}

/** シナリオの翻訳。原文のシナリオに重ねて使う。ない項目は原文のまま */
export interface ScenarioTranslation {
  language: string;
  title?: string;
  characters?: Record<string, string>;   // キャラクター ID → 名前
  scenes?: Record<string, string>;       // 原文のシーン名 → 訳
  lines: Record<string, { text: string; spans?: TextSpan[] }>;  // 行の ID → 訳文
  terms?: Record<string, Term>;          // 用語集の上書き（help など）
  slides?: Record<string, string>;       // 原文のスライドのパス → 訳文用のパス
}
