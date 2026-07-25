import { create } from "zustand";
import { persist } from "zustand/middleware";
import { v4 as uuidv4 } from "uuid";

export interface AvatarChoice {
  catalogId: string;
  colorKey: string;
  kind: "dicebear" | "animal";
  /** Resolved image data URI (dicebear) or emoji character (animal), cached at pick time so
   *  places that just need to *display* the avatar never have to import the render engine. */
  preview: string;
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
      version: 1,
      partialize: (state) => ({
        deviceId: state.deviceId,
        name: state.name,
        avatar: state.avatar,
      }),
      // v0 stored { catalogId, colorKey } only. Drop it so the app asks the player to
      // re-pick rather than rendering a broken avatar with no image/emoji to show.
      migrate: (persisted, version) => {
        const state = persisted as IdentityState;
        if (version < 1 && state.avatar && !("preview" in state.avatar)) {
          return { ...state, avatar: null };
        }
        return state;
      },
    },
  ),
);

export function hasCompleteProfile(state: Pick<IdentityState, "name" | "avatar">): boolean {
  return state.name.trim().length > 0 && state.avatar !== null;
}
