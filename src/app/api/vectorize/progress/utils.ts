// progress/utils.ts for vectorize

export type ProgressData = {
  userId: string;
  totalFiles: number;
  processedFiles: number;
  currentFile: string;
  lastUpdate: number;
};

export const progressStore: Record<string, ProgressData> = {};

export function updateProgress(userId: string, data: Partial<ProgressData>) {
  if (!progressStore[userId]) {
    progressStore[userId] = {
      userId,
      totalFiles: 0,
      processedFiles: 0,
      currentFile: "",
      lastUpdate: Date.now(),
    };
  }

  progressStore[userId] = {
    ...progressStore[userId],
    ...data,
    lastUpdate: Date.now(),
  };
}
