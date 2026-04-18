// app/(tabs)/sos.tsx
// Emergency Contacts — Responsive + Enhanced UI
import { Ionicons } from '@expo/vector-icons';
import React, { useState } from 'react';
import {
  Alert,
  FlatList,
  KeyboardAvoidingView,
  Modal,
  Platform,
  StyleSheet,
  Text,
  TextInput,
  TouchableOpacity,
  View,
  useWindowDimensions,
} from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';
import { sendTestSMS } from '../../services/sms';
import { Contact, useAppStore } from '../../store/useAppStore';

// ─── Scale helper ───────────────────────────────────────────────────────────
function useScale() {
  const { width } = useWindowDimensions();
  const BASE = 375;
  const scale = Math.min(Math.max(width / BASE, 0.8), 1.3);
  const s = (size: number) => Math.round(size * scale);
  return { width, s };
}

let idCounter = Date.now();
function generateId() {
  return `contact_${idCounter++}`;
}

export default function ContactsScreen() {
  const { contacts, addContact, removeContact, updateContact, deviceId } = useAppStore();
  const { width, s } = useScale();

  const [showModal, setShowModal] = useState(false);
  const [editingContact, setEditingContact] = useState<Contact | null>(null);
  const [name, setName] = useState('');
  const [phone, setPhone] = useState('');

  function openAddModal() {
    setEditingContact(null);
    setName('');
    setPhone('');
    setShowModal(true);
  }

  function openEditModal(contact: Contact) {
    setEditingContact(contact);
    setName(contact.name);
    setPhone(contact.phone);
    setShowModal(true);
  }

  function handleSave() {
    const trimmedName = name.trim();
    const trimmedPhone = phone.trim().replace(/\s/g, '');
    if (!trimmedName) { Alert.alert('Error', 'Please enter a name'); return; }
    if (!trimmedPhone || trimmedPhone.length < 10) {
      Alert.alert('Error', 'Enter a valid phone number (10 digits)');
      return;
    }
    if (editingContact) {
      updateContact({ ...editingContact, name: trimmedName, phone: trimmedPhone });
    } else {
      addContact({ id: generateId(), name: trimmedName, phone: trimmedPhone });
    }
    setShowModal(false);
  }

  function handleDelete(contact: Contact) {
    Alert.alert(
      'Contact Delete Karein?',
      `"${contact.name}" ko emergency contacts se hatana chahte hain?`,
      [
        { text: 'Cancel', style: 'cancel' },
        { text: 'Delete', style: 'destructive', onPress: () => removeContact(contact.id) },
      ]
    );
  }

  async function handleTestSMS(contact: Contact) {
    Alert.alert('Test SMS', `Send a test message to ${contact.name} (${contact.phone})?`, [
      { text: 'Cancel', style: 'cancel' },
      {
        text: 'Send',
        onPress: async () => {
          const success = await sendTestSMS(contact);
          if (!success) Alert.alert('Error', 'SMS could not be sent. Check the SMS app on your device.');
        },
      },
    ]);
  }

  const renderContact = ({ item, index }: { item: Contact; index: number }) => {
    const colors = ['#FF3B30', '#FF9500', '#30D158', '#007AFF', '#AF52DE', '#FF2D55'];
    const avatarColor = colors[index % colors.length];

    return (
      <View style={[styles.contactCard, { padding: s(14), marginBottom: s(10), borderRadius: s(16) }]}>
        <View style={[styles.avatar, {
          width: s(46), height: s(46), borderRadius: s(23),
          backgroundColor: avatarColor,
        }]}>
          <Text style={[styles.avatarText, { fontSize: s(18) }]}>
            {item.name.charAt(0).toUpperCase()}
          </Text>
        </View>
        <View style={styles.contactInfo}>
          <Text style={[styles.contactName, { fontSize: s(15) }]}>{item.name}</Text>
          <Text style={[styles.contactPhone, { fontSize: s(13) }]}>{item.phone}</Text>
        </View>
        <View style={[styles.contactActions, { gap: s(2) }]}>
          <TouchableOpacity onPress={() => handleTestSMS(item)} style={[styles.actionIcon, { padding: s(8) }]}>
            <Ionicons name="send-outline" size={s(17)} color="#FF9500" />
          </TouchableOpacity>
          <TouchableOpacity onPress={() => openEditModal(item)} style={[styles.actionIcon, { padding: s(8) }]}>
            <Ionicons name="pencil-outline" size={s(17)} color="#666" />
          </TouchableOpacity>
          <TouchableOpacity onPress={() => handleDelete(item)} style={[styles.actionIcon, { padding: s(8) }]}>
            <Ionicons name="trash-outline" size={s(17)} color="#FF3B30" />
          </TouchableOpacity>
        </View>
      </View>
    );
  };

  return (
    <SafeAreaView style={styles.container}>
      {/* ─── Header ─── */}
      <View style={[styles.header, { padding: s(20), paddingTop: s(22) }]}>
        <View style={{ flex: 1, marginRight: s(12) }}>
          <Text style={[styles.title, { fontSize: s(24) }]}>Emergency Contacts</Text>
          <Text style={[styles.subtitle, { fontSize: s(13) }]}>
            SMS alert goes to these contacts on SOS
          </Text>
        </View>
        <TouchableOpacity
          style={[styles.addBtn, { width: s(42), height: s(42), borderRadius: s(21) }]}
          onPress={openAddModal}
        >
          <Ionicons name="add" size={s(22)} color="#fff" />
        </TouchableOpacity>
      </View>

      {/* ─── Info Bar ─── */}
      {contacts.length > 0 && (
        <View style={[styles.infoBar, {
          marginHorizontal: s(20), marginBottom: s(14),
          borderRadius: s(12), padding: s(12),
        }]}>
          <Ionicons name="shield-checkmark" size={s(16)} color="#FF9500" />
          <Text style={[styles.infoBarText, { fontSize: s(13) }]}>
            {contacts.length} contact{contacts.length > 1 ? 's' : ''} will receive SOS alert
          </Text>
        </View>
      )}

      {/* ─── Empty State ─── */}
      {contacts.length === 0 ? (
        <View style={styles.emptyState}>
          <View style={styles.emptyIconWrap}>
            <Ionicons name="people-outline" size={s(52)} color="#2a2a2a" />
          </View>
          <Text style={[styles.emptyTitle, { fontSize: s(19) }]}>No contacts yet</Text>
          <Text style={[styles.emptySubtitle, { fontSize: s(14) }]}>
            Add family or friends to receive SOS alerts
          </Text>
          <TouchableOpacity
            style={[styles.emptyAddBtn, { paddingHorizontal: s(22), paddingVertical: s(13), borderRadius: s(14) }]}
            onPress={openAddModal}
          >
            <Ionicons name="add-circle" size={s(20)} color="#FF3B30" />
            <Text style={[styles.emptyAddText, { fontSize: s(15) }]}>Add Contact</Text>
          </TouchableOpacity>
        </View>
      ) : (
        <FlatList
          data={contacts}
          keyExtractor={(item) => item.id}
          renderItem={renderContact}
          contentContainerStyle={[styles.list, { paddingHorizontal: s(20), paddingBottom: s(40) }]}
          showsVerticalScrollIndicator={false}
        />
      )}

      {/* ─── Add/Edit Modal ─── */}
      <Modal visible={showModal} animationType="slide" presentationStyle="overFullScreen" transparent>
        <KeyboardAvoidingView
          behavior={Platform.OS === 'ios' ? 'padding' : undefined}
          style={styles.modalOverlay}
        >
          <View style={[styles.modalContent, { padding: s(24), paddingBottom: s(40) }]}>
            {/* Modal handle */}
            <View style={styles.modalHandle} />

            <Text style={[styles.modalTitle, { fontSize: s(20), marginBottom: s(22) }]}>
              {editingContact ? 'Edit Contact' : 'Add Contact'}
            </Text>

            <Text style={[styles.inputLabel, { fontSize: s(12), marginBottom: s(6) }]}>Name</Text>
            <TextInput
              style={[styles.input, { fontSize: s(15), padding: s(14), marginBottom: s(16) }]}
              placeholder="E.g. Mom, Dad, John..."
              placeholderTextColor="#444"
              value={name}
              onChangeText={setName}
              autoFocus
            />

            <Text style={[styles.inputLabel, { fontSize: s(12), marginBottom: s(6) }]}>Phone Number</Text>
            <TextInput
              style={[styles.input, { fontSize: s(15), padding: s(14), marginBottom: s(22) }]}
              placeholder="+91 98765 43210"
              placeholderTextColor="#444"
              value={phone}
              onChangeText={setPhone}
              keyboardType="phone-pad"
            />

            <View style={[styles.modalButtons, { gap: s(10) }]}>
              <TouchableOpacity
                style={[styles.modalBtn, styles.cancelModalBtn, { padding: s(15), borderRadius: s(12) }]}
                onPress={() => setShowModal(false)}
              >
                <Text style={[styles.cancelBtnText, { fontSize: s(15) }]}>Cancel</Text>
              </TouchableOpacity>
              <TouchableOpacity
                style={[styles.modalBtn, styles.saveBtn, { padding: s(15), borderRadius: s(12) }]}
                onPress={handleSave}
              >
                <Text style={[styles.saveBtnText, { fontSize: s(15) }]}>
                  {editingContact ? 'Update' : 'Save'}
                </Text>
              </TouchableOpacity>
            </View>
          </View>
        </KeyboardAvoidingView>
      </Modal>
    </SafeAreaView>
  );
}

const styles = StyleSheet.create({
  container: { flex: 1, backgroundColor: '#080808' },

  header: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    alignItems: 'center',
  },
  title: { color: '#fff', fontWeight: '800' },
  subtitle: { color: '#555', marginTop: 3 },
  addBtn: {
    backgroundColor: '#FF3B30',
    alignItems: 'center',
    justifyContent: 'center',
    shadowColor: '#FF3B30',
    shadowOffset: { width: 0, height: 4 },
    shadowOpacity: 0.4,
    shadowRadius: 8,
    elevation: 8,
  },

  infoBar: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 8,
    backgroundColor: '#120d00',
    borderWidth: 1,
    borderColor: '#FF9500',
  },
  infoBarText: { color: '#FF9500', flex: 1 },

  list: {},

  contactCard: {
    backgroundColor: '#111',
    flexDirection: 'row',
    alignItems: 'center',
    gap: 12,
    borderWidth: 1,
    borderColor: '#1e1e1e',
  },
  avatar: {
    alignItems: 'center',
    justifyContent: 'center',
    shadowColor: '#000',
    shadowOffset: { width: 0, height: 2 },
    shadowOpacity: 0.3,
    shadowRadius: 4,
    elevation: 4,
  },
  avatarText: { color: '#fff', fontWeight: '800' },
  contactInfo: { flex: 1 },
  contactName: { color: '#fff', fontWeight: '600' },
  contactPhone: { color: '#666', marginTop: 2 },
  contactActions: { flexDirection: 'row' },
  actionIcon: {},

  emptyState: {
    flex: 1,
    alignItems: 'center',
    justifyContent: 'center',
    paddingHorizontal: 40,
    gap: 12,
  },
  emptyIconWrap: {
    width: 96,
    height: 96,
    borderRadius: 48,
    backgroundColor: '#111',
    alignItems: 'center',
    justifyContent: 'center',
    borderWidth: 1,
    borderColor: '#1e1e1e',
    marginBottom: 8,
  },
  emptyTitle: { color: '#333', fontWeight: '700' },
  emptySubtitle: { color: '#2a2a2a', textAlign: 'center', lineHeight: 21 },
  emptyAddBtn: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 8,
    backgroundColor: '#120404',
    borderWidth: 1,
    borderColor: '#FF3B30',
    marginTop: 8,
  },
  emptyAddText: { color: '#FF3B30', fontWeight: '700' },

  // Modal
  modalOverlay: { flex: 1, backgroundColor: 'rgba(0,0,0,0.85)', justifyContent: 'flex-end' },
  modalContent: {
    backgroundColor: '#0f0f0f',
    borderTopLeftRadius: 24,
    borderTopRightRadius: 24,
    borderTopWidth: 1,
    borderTopColor: '#222',
  },
  modalHandle: {
    width: 36, height: 4, borderRadius: 2,
    backgroundColor: '#333',
    alignSelf: 'center',
    marginBottom: 16,
  },
  modalTitle: { color: '#fff', fontWeight: '800' },
  inputLabel: { color: '#666', fontWeight: '600', textTransform: 'uppercase', letterSpacing: 0.5 },
  input: {
    backgroundColor: '#161616',
    borderRadius: 12,
    color: '#fff',
    borderWidth: 1,
    borderColor: '#2a2a2a',
  },
  modalButtons: { flexDirection: 'row' },
  modalBtn: { flex: 1, alignItems: 'center' },
  cancelModalBtn: { backgroundColor: '#161616' },
  saveBtn: { backgroundColor: '#FF3B30' },
  cancelBtnText: { color: '#666', fontWeight: '600' },
  saveBtnText: { color: '#fff', fontWeight: '700' },
});
