export const PROFILE_UPDATED_EVENT = "marketplace-profile-updated";

export type ProfileUpdatedUser = {
  name?: string;
  fullName?: string;
  username?: string;
  avatarUrl?: string | null;
};

export function notifyProfileUpdated(user: ProfileUpdatedUser) {
  window.dispatchEvent(new CustomEvent<ProfileUpdatedUser>(PROFILE_UPDATED_EVENT, { detail: user }));
}
