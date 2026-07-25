import { create } from "zustand";
import { persist } from "zustand/middleware";
import { v4 as uuidv4 } from "uuid";

export interface AvatarChoice {
  catalogId: string;
  colorKey: string;
}

interface IdentityState {
  deviceId: string;
  name: string;
  avatar: AvatarChoice | null;
  setName: (name: string) => void;
  setAvatar: (avatar: AvatarChoice) => void;
}

export const useIdentity = create<IdentityState>()(
  persist(
    (set) => ({
      deviceId: uuidv4(),
      name: "",
      avatar: null,
      setName: (name) => set({ name }),
      setAvatar: (avatar) => set({ avatar }),
    }),
    {
      name: "dk-identity",
      partialize: (state) => ({
        deviceId: state.deviceId,
        name: state.name,
        avatar: state.avatar,
      }),
    },
  ),
);

export function hasCompleteProfile(state: Pick<IdentityState, "name" | "avatar">): boolean {
  return state.name.trim().length > 0 && state.avatar !== null;
}
