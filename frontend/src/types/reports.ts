export type ReportType = "boardPack" | "flashReport" | "managementAccounts";

export type ReportStatus = "draft" | "final" | "sent";

export interface ReportHistory {
  id: string;
  name: string;
  period: string;
  type: ReportType;
  generatedAt: string;
  generatedBy: string;
  status: ReportStatus;
  pageCount: number;
  fileSize: string;
}

export interface BoardPackSection {
  id: string;
  title: string;
  included: boolean;
  order: number;
  aiGenerated: boolean;
  approved: boolean;
}

export interface AICommentary {
  section: string;
  content: string;
  wordCount: number;
  maxWords: number;
  approved: boolean;
}

export interface FlashReportData {
  headline: string;
  keyMetrics: {
    label: string;
    actual: number;
    budget: number;
    variance: number;
    variancePct: number;
  }[];
  topVariances: {
    favorable: { label: string; amount: string }[];
    unfavorable: { label: string; amount: string }[];
  };
  keyMessages: string[];
  immediateActions: string[];
}
