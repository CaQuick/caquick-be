export interface CompleteOnboardingInput {
  name?: string | null;
  nickname: string;
  birthDate?: Date | null;
  phoneNumber?: string | null;
}

export interface UpdateMyProfileInput {
  nickname?: string | null;
  birthDate?: Date | null;
  phoneNumber?: string | null;
}

export interface UpdateMyProfileImageInput {
  profileImageUrl: string;
}

export interface MyNotificationsInput {
  unreadOnly?: boolean | null;
  offset?: number | null;
  limit?: number | null;
}

export interface MySearchHistoriesInput {
  offset?: number | null;
  limit?: number | null;
}
