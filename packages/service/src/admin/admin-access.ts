export const USER_ROLE = {
  USER: "user",
  ADMIN: "admin",
} as const;

export function isAdminRole(role: string | null | undefined): boolean {
  return role === USER_ROLE.ADMIN;
}

export interface AdminViewer {
  userId: string;
  role: string | null | undefined;
}
