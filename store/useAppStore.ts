// store/useAppStore.ts
import AsyncStorage from '@react-native-async-storage/async-storage';
import { create } from 'zustand';

export interface Contact {
  id: string;
  name: string;
  phone: string;
}

export interface Friend {
  deviceId: string;
  nickname: string;
  isInEmergency?: boolean;
  lastLocation?: { latitude: number; longitude: number };
}

// When I'm helping a friend
export interface HelpingState {
  sessionId: string;
  friendDeviceId: string;
  friendNickname: string;
  friendAddress: string;
}

interface AppState {
  // Device Identity
  deviceId: string | null;
  nickname: string;

  // Contacts (SMS ke liye)
  contacts: Contact[];

  // Emergency State (my own SOS)
  isSOSActive: boolean;
  activeSessionId: string | null;

  // Friends
  friends: Friend[];
  pendingRequests: string[];
  outgoingRequests: string[];

  // Helper state: I'm helping a friend
  helpingState: HelpingState | null;

  // App initialized?
  isInitialized: boolean;

  // Actions
  setDeviceId: (id: string) => void;
  setNickname: (name: string) => void;
  addContact: (contact: Contact) => void;
  removeContact: (id: string) => void;
  updateContact: (contact: Contact) => void;
  setSOSActive: (active: boolean, sessionId?: string) => void;
  setFriends: (friends: Friend[]) => void;
  setPendingRequests: (requests: string[]) => void;
  setOutgoingRequests: (requests: string[]) => void;
  setHelpingState: (state: HelpingState | null) => void;
  setInitialized: (val: boolean) => void;
  loadContactsFromStorage: () => Promise<void>;
  saveContactsToStorage: (contacts: Contact[]) => Promise<void>;
}

const CONTACTS_STORAGE_KEY = 'sos_emergency_contacts';

export const useAppStore = create<AppState>((set, get) => ({
  deviceId: null,
  nickname: '',
  contacts: [],
  isSOSActive: false,
  activeSessionId: null,
  friends: [],
  pendingRequests: [],
  outgoingRequests: [],
  helpingState: null,
  isInitialized: false,

  setDeviceId: (id) => set({ deviceId: id }),
  setNickname: (name) => set({ nickname: name }),

  addContact: async (contact) => {
    const updated = [...get().contacts, contact];
    set({ contacts: updated });
    await get().saveContactsToStorage(updated);
  },

  removeContact: async (id) => {
    const updated = get().contacts.filter((c) => c.id !== id);
    set({ contacts: updated });
    await get().saveContactsToStorage(updated);
  },

  updateContact: async (contact) => {
    const updated = get().contacts.map((c) =>
      c.id === contact.id ? contact : c
    );
    set({ contacts: updated });
    await get().saveContactsToStorage(updated);
  },

  setSOSActive: (active, sessionId) =>
    set({ isSOSActive: active, activeSessionId: sessionId ?? null }),

  setFriends: (friends) => set({ friends }),
  setPendingRequests: (requests) => set({ pendingRequests: requests }),
  setOutgoingRequests: (requests) => set({ outgoingRequests: requests }),
  setHelpingState: (state) => set({ helpingState: state }),
  setInitialized: (val) => set({ isInitialized: val }),

  loadContactsFromStorage: async () => {
    try {
      const stored = await AsyncStorage.getItem(CONTACTS_STORAGE_KEY);
      if (stored) {
        set({ contacts: JSON.parse(stored) });
      }
    } catch (error) {
      console.error('Contacts load error:', error);
    }
  },

  saveContactsToStorage: async (contacts) => {
    try {
      await AsyncStorage.setItem(CONTACTS_STORAGE_KEY, JSON.stringify(contacts));
    } catch (error) {
      console.error('Contacts save error:', error);
    }
  },
}));