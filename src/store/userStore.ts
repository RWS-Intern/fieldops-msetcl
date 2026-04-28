import { create } from 'zustand';
import type { User } from '@/types';

interface UserState {
  users:    User[];
  loading:  boolean;
  setUsers:   (users: User[]) => void;
  setLoading: (v: boolean)    => void;
}

export const useUserStore = create<UserState>((set) => ({
  users:      [],
  loading:    true,
  setUsers:   (users) => set({ users }),
  setLoading: (v)     => set({ loading: v }),
}));
