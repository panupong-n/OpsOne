// Shared types for the system-settings screens.

export interface PlatformUser {
  sub: string;
  email: string;
  name: string;
  given_name: string;
  family_name: string;
  role: string;
  user_group: string;
  visible: boolean;
}

export interface UserGroup {
  id: string;
  name: string;
  color: string | null;
  member_count: number;
}
