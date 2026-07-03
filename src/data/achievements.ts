import raw from "./achievements_data.json";
import type { AchievementsData } from "../types";

export const achievementsData = raw as AchievementsData;
export const { branches, achievements } = achievementsData;
