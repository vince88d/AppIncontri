export type ModerationStatus = 'pending' | 'ok' | 'flagged';
export type ContentWarning = 'nudity';

export type SafeSearchSummary = {
  adult?: string;
  racy?: string;
  medical?: string;
  spoof?: string;
  violence?: string;
};

export type PhotoMeta = {
  path?: string;
  moderationStatus?: ModerationStatus;
  contentWarning?: ContentWarning | null;
  moderation?: SafeSearchSummary;
};
