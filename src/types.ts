export interface Branch {
  id: number;
  title: string;
}

export interface Achievement {
  id: string;
  branch_id: number;
  order: number;
  title: string;
  description: string;
  requires: string | null;
}

export interface AchievementsData {
  branches: Branch[];
  achievements: Achievement[];
}

export interface CustomAchievement {
  id: string;
  telegram_user_id: number;
  text: string;
  status: boolean;
  created_at: string;
}

export type ProgressMap = Record<string, boolean>;
