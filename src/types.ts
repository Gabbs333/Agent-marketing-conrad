export type Channel = "email" | "whatsapp" | "messenger";

export interface VideoScene {
  visual: string;
  narration: string;
  durationSec: number;
}

export interface VideoScript {
  title: string;
  hook: string;
  scenes: VideoScene[];
  cta: string;
}

export interface AdCopy {
  headline: string;
  primaryText: string;
  cta: string;
}

export interface EmailContent {
  subject: string;
  body: string;
}

export interface GeneratedImage {
  id: string;
  url: string;
  localPath: string;
  provider: string;
}

export interface GeneratedVideo {
  id: string;
  url: string;
  localPath: string;
  script?: VideoScript;
}

export interface PublishResult {
  id: string;
  scheduled: boolean;
}

export interface MessageResult {
  sent: boolean;
  demo: boolean;
  messageId?: string;
}
