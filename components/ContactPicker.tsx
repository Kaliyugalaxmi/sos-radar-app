import * as Contacts from 'expo-contacts';
import React, { useMemo, useState } from 'react';
import {
    Alert,
    FlatList,
    StyleSheet,
    Text,
    TextInput,
    TouchableOpacity,
    View
} from 'react-native';
import { TrustedContact } from '../constants/storage';

interface Props {
  onSave: (contacts: TrustedContact[]) => void;
  saved: TrustedContact[];
}

export default function ContactPicker({ onSave, saved }: Props) {
  const [contacts, setContacts] = useState<Contacts.Contact[]>([]);
  const [selected, setSelected] = useState<TrustedContact[]>(saved);
  const [loaded, setLoaded] = useState(false);
  const [loading, setLoading] = useState(false);
  const [search, setSearch] = useState('');

  const loadContacts = async () => {
    const { status } = await Contacts.requestPermissionsAsync();
    if (status !== 'granted') {
      Alert.alert('Permission denied', 'Contacts access needed');
      return;
    }

    setLoading(true);
    try {
      // ✅ pageSize: 10000 fetches all contacts at once
      const { data } = await Contacts.getContactsAsync({
        fields: [Contacts.Fields.Name, Contacts.Fields.PhoneNumbers],
        pageSize: 10000,
        pageOffset: 0,
        sort: Contacts.SortTypes.FirstName,
      });

      // ✅ Filter out contacts without name or phone
      const valid = data.filter(
        c => c.name && c.phoneNumbers && c.phoneNumbers.length > 0
      );

      setContacts(valid);
      setLoaded(true);
    } catch (e) {
      Alert.alert('Error', 'Could not load contacts');
    } finally {
      setLoading(false);
    }
  };

  const toggle = (contact: Contacts.Contact) => {
    // ✅ Normalize phone number (remove spaces, dashes)
    const raw = contact.phoneNumbers![0].number!;
    const phone = raw.replace(/[\s\-().]/g, '');

    setSelected(prev =>
      prev.find(c => c.id === contact.id)
        ? prev.filter(c => c.id !== contact.id)
        : [...prev, { id: contact.id!, name: contact.name!, phone }]
    );
  };

  // ✅ Search filter
  const filtered = useMemo(() => {
    if (!search.trim()) return contacts;
    const q = search.toLowerCase();
    return contacts.filter(
      c =>
        c.name?.toLowerCase().includes(q) ||
        c.phoneNumbers?.some(p => p.number?.includes(q))
    );
  }, [contacts, search]);

  return (
    <View style={styles.container}>
      <TouchableOpacity style={styles.loadBtn} onPress={loadContacts}>
        <Text style={styles.loadBtnText}>
          {loading ? '⏳ Loading...' : loaded ? '🔄 Reload Contacts' : '📒 Load Contacts'}
        </Text>
      </TouchableOpacity>

      {loaded && (
        <>
          {/* ✅ Search bar */}
          <TextInput
            style={styles.searchInput}
            placeholder="🔍 Search by name or number..."
            value={search}
            onChangeText={setSearch}
            placeholderTextColor="#9ca3af"
          />

          <Text style={styles.countText}>
            {filtered.length} contact{filtered.length !== 1 ? 's' : ''}
            {search ? ' found' : ' total'}
          </Text>

          <FlatList
            data={filtered}
            style={{ maxHeight: 320 }}
            keyExtractor={item => item.id!}
            keyboardShouldPersistTaps="handled"
            initialNumToRender={20}       // ✅ renders more items upfront
            maxToRenderPerBatch={30}
            windowSize={10}
            renderItem={({ item }) => {
              const isSelected = !!selected.find(c => c.id === item.id);
              return (
                <TouchableOpacity
                  style={[styles.contactRow, isSelected && styles.selectedRow]}
                  onPress={() => toggle(item)}
                >
                  <View style={styles.avatar}>
                    <Text style={styles.avatarText}>
                      {item.name?.charAt(0).toUpperCase()}
                    </Text>
                  </View>
                  <View style={{ flex: 1 }}>
                    <Text style={styles.name}>{item.name}</Text>
                    <Text style={styles.phone}>
                      {item.phoneNumbers![0].number}
                    </Text>
                  </View>
                  {isSelected && <Text style={styles.tick}>✅</Text>}
                </TouchableOpacity>
              );
            }}
          />
        </>
      )}

      {selected.length > 0 && (
        <TouchableOpacity style={styles.saveBtn} onPress={() => onSave(selected)}>
          <Text style={styles.saveBtnText}>
            ✅ Save {selected.length} Contact{selected.length > 1 ? 's' : ''}
          </Text>
        </TouchableOpacity>
      )}
    </View>
  );
}

const styles = StyleSheet.create({
  container: { gap: 8 },
  loadBtn: {
    backgroundColor: '#1e40af', padding: 12,
    borderRadius: 8, alignItems: 'center'
  },
  loadBtnText: { color: '#fff', fontWeight: '600' },
  searchInput: {
    borderWidth: 1, borderColor: '#d1d5db',
    borderRadius: 8, padding: 10,
    fontSize: 14, backgroundColor: '#fff', color: '#111'
  },
  countText: { color: '#6b7280', fontSize: 12, paddingLeft: 4 },
  contactRow: {
    flexDirection: 'row', alignItems: 'center',
    padding: 10, borderBottomWidth: 1,
    borderColor: '#f3f4f6', backgroundColor: '#fff', gap: 10
  },
  selectedRow: { backgroundColor: '#dbeafe' },
  avatar: {
    width: 38, height: 38, borderRadius: 19,
    backgroundColor: '#1e40af', alignItems: 'center', justifyContent: 'center'
  },
  avatarText: { color: '#fff', fontWeight: '700', fontSize: 16 },
  name: { fontWeight: '600', fontSize: 14, color: '#111' },
  phone: { color: '#6b7280', fontSize: 12 },
  tick: { fontSize: 16 },
  saveBtn: {
    backgroundColor: '#16a34a', padding: 12,
    borderRadius: 8, alignItems: 'center'
  },
  saveBtnText: { color: '#fff', fontWeight: '700', fontSize: 15 },
});