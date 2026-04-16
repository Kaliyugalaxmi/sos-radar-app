// app/(tabs)/sos.tsx
// Emergency Contacts Management Screen
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
} from 'react-native';
import { SafeAreaView } from "react-native-safe-area-context";
import { sendTestSMS } from '../../services/sms';
import { Contact, useAppStore } from '../../store/useAppStore';

let idCounter = Date.now();
function generateId() {
  return `contact_${idCounter++}`;
}

export default function ContactsScreen() {
  const { contacts, addContact, removeContact, updateContact, deviceId } = useAppStore();

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

    if (!trimmedName) {
      Alert.alert('Error', 'Please enter a name');
      return;
    }
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
        {
          text: 'Delete', style: 'destructive',
          onPress: () => removeContact(contact.id),
        },
      ]
    );
  }

  async function handleTestSMS(contact: Contact) {
    Alert.alert(
      'Test SMS',
      `Send a test message to ${contact.name} (${contact.phone})?`,
      [
        { text: 'Cancel', style: 'cancel' },
        {
          text: 'Send',
          onPress: async () => {
            const success = await sendTestSMS(contact);
            if (!success) {
              Alert.alert('Error', 'SMS could not be sent. Check the SMS app on your device.');
            }
          },
        },
      ]
    );
  }

  const renderContact = ({ item }: { item: Contact }) => (
    <View style={styles.contactCard}>
      <View style={styles.avatar}>
        <Text style={styles.avatarText}>{item.name.charAt(0).toUpperCase()}</Text>
      </View>
      <View style={styles.contactInfo}>
        <Text style={styles.contactName}>{item.name}</Text>
        <Text style={styles.contactPhone}>{item.phone}</Text>
      </View>
      <View style={styles.contactActions}>
        <TouchableOpacity onPress={() => handleTestSMS(item)} style={styles.actionIcon}>
          <Ionicons name="send-outline" size={18} color="#FF9500" />
        </TouchableOpacity>
        <TouchableOpacity onPress={() => openEditModal(item)} style={styles.actionIcon}>
          <Ionicons name="pencil-outline" size={18} color="#888" />
        </TouchableOpacity>
        <TouchableOpacity onPress={() => handleDelete(item)} style={styles.actionIcon}>
          <Ionicons name="trash-outline" size={18} color="#FF3B30" />
        </TouchableOpacity>
      </View>
    </View>
  );

  return (
    <SafeAreaView style={styles.container}>
      <View style={styles.header}>
        <View>
          <Text style={styles.title}>Emergency Contacts</Text>
          <Text style={styles.subtitle}>These contacts will receive an SMS when SOS is pressed</Text>
        </View>
        <TouchableOpacity style={styles.addBtn} onPress={openAddModal}>
          <Ionicons name="add" size={24} color="#fff" />
        </TouchableOpacity>
      </View>

      {contacts.length === 0 ? (
        <View style={styles.emptyState}>
          <Ionicons name="people-outline" size={64} color="#2a2a2a" />
          <Text style={styles.emptyTitle}>No contacts yet</Text>
          <Text style={styles.emptySubtitle}>
            Add family or friends phone numbers for SOS alerts
          </Text>
          <TouchableOpacity style={styles.emptyAddBtn} onPress={openAddModal}>
            <Ionicons name="add-circle" size={20} color="#FF3B30" />
            <Text style={styles.emptyAddText}>Add Contact</Text>
          </TouchableOpacity>
        </View>
      ) : (
        <>
          <View style={styles.infoBar}>
            <Ionicons name="information-circle" size={16} color="#FF9500" />
            <Text style={styles.infoBarText}>
              When SOS is pressed, {contacts.length} contact{contacts.length > 1 ? 's' : ''} will receive an SMS
            </Text>
          </View>
          <FlatList
            data={contacts}
            keyExtractor={(item) => item.id}
            renderItem={renderContact}
            contentContainerStyle={styles.list}
            showsVerticalScrollIndicator={false}
          />
        </>
      )}

      {/* Add/Edit Modal */}
      <Modal visible={showModal} animationType="slide" presentationStyle="overFullScreen" transparent>
        <KeyboardAvoidingView
          behavior={Platform.OS === 'ios' ? 'padding' : undefined}
          style={styles.modalOverlay}
        >
          <View style={styles.modalContent}>
            <Text style={styles.modalTitle}>
              {editingContact ? 'Edit Contact' : 'Add Contact'}
            </Text>

            <Text style={styles.inputLabel}>Naam</Text>
            <TextInput
              style={styles.input}
              placeholder="Jaise: Maa, Papa, Rahul..."
              placeholderTextColor="#555"
              value={name}
              onChangeText={setName}
              autoFocus
            />

            <Text style={styles.inputLabel}>Phone Number</Text>
            <TextInput
              style={styles.input}
              placeholder="+91 98765 43210"
              placeholderTextColor="#555"
              value={phone}
              onChangeText={setPhone}
              keyboardType="phone-pad"
            />

            <View style={styles.modalButtons}>
              <TouchableOpacity
                style={[styles.modalBtn, styles.cancelModalBtn]}
                onPress={() => setShowModal(false)}
              >
                <Text style={styles.cancelBtnText}>Cancel</Text>
              </TouchableOpacity>
              <TouchableOpacity style={[styles.modalBtn, styles.saveBtn]} onPress={handleSave}>
                <Text style={styles.saveBtnText}>Save</Text>
              </TouchableOpacity>
            </View>
          </View>
        </KeyboardAvoidingView>
      </Modal>
    </SafeAreaView>
  );
}

const styles = StyleSheet.create({
  container: { flex: 1, backgroundColor: '#0a0a0a' },

  header: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    alignItems: 'center',
    padding: 20,
    paddingTop: 24,
  },
  title: { color: '#fff', fontSize: 24, fontWeight: '800' },
  subtitle: { color: '#555', fontSize: 13, marginTop: 2 },
  addBtn: {
    backgroundColor: '#FF3B30',
    borderRadius: 20,
    width: 40,
    height: 40,
    alignItems: 'center',
    justifyContent: 'center',
  },

  infoBar: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 8,
    backgroundColor: '#1a1200',
    borderWidth: 1,
    borderColor: '#FF9500',
    borderRadius: 10,
    padding: 12,
    marginHorizontal: 20,
    marginBottom: 16,
  },
  infoBarText: { color: '#FF9500', fontSize: 13, flex: 1 },

  list: { paddingHorizontal: 20, paddingBottom: 40 },

  contactCard: {
    backgroundColor: '#161616',
    borderRadius: 14,
    padding: 14,
    flexDirection: 'row',
    alignItems: 'center',
    gap: 14,
    marginBottom: 10,
    borderWidth: 1,
    borderColor: '#2a2a2a',
  },
  avatar: {
    width: 44,
    height: 44,
    borderRadius: 22,
    backgroundColor: '#FF3B30',
    alignItems: 'center',
    justifyContent: 'center',
  },
  avatarText: { color: '#fff', fontSize: 18, fontWeight: '700' },
  contactInfo: { flex: 1 },
  contactName: { color: '#fff', fontSize: 15, fontWeight: '600' },
  contactPhone: { color: '#888', fontSize: 13, marginTop: 2 },
  contactActions: { flexDirection: 'row', gap: 4 },
  actionIcon: { padding: 8 },

  emptyState: {
    flex: 1,
    alignItems: 'center',
    justifyContent: 'center',
    paddingHorizontal: 40,
    gap: 12,
  },
  emptyTitle: { color: '#444', fontSize: 20, fontWeight: '700' },
  emptySubtitle: { color: '#333', fontSize: 14, textAlign: 'center', lineHeight: 20 },
  emptyAddBtn: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 8,
    backgroundColor: '#1a0505',
    borderRadius: 12,
    paddingHorizontal: 20,
    paddingVertical: 12,
    borderWidth: 1,
    borderColor: '#FF3B30',
    marginTop: 8,
  },
  emptyAddText: { color: '#FF3B30', fontWeight: '700', fontSize: 15 },

  // Modal
  modalOverlay: { flex: 1, backgroundColor: 'rgba(0,0,0,0.8)', justifyContent: 'flex-end' },
  modalContent: {
    backgroundColor: '#111',
    borderTopLeftRadius: 20,
    borderTopRightRadius: 20,
    padding: 24,
    paddingBottom: 40,
  },
  modalTitle: { color: '#fff', fontSize: 20, fontWeight: '800', marginBottom: 20 },
  inputLabel: { color: '#888', fontSize: 13, fontWeight: '600', marginBottom: 6, textTransform: 'uppercase' },
  input: {
    backgroundColor: '#1a1a1a',
    borderRadius: 10,
    padding: 14,
    color: '#fff',
    fontSize: 15,
    borderWidth: 1,
    borderColor: '#2a2a2a',
    marginBottom: 16,
  },
  modalButtons: { flexDirection: 'row', gap: 12, marginTop: 8 },
  modalBtn: { flex: 1, borderRadius: 12, padding: 15, alignItems: 'center' },
  cancelModalBtn: { backgroundColor: '#1a1a1a' },
  saveBtn: { backgroundColor: '#FF3B30' },
  cancelBtnText: { color: '#888', fontWeight: '600', fontSize: 15 },
  saveBtnText: { color: '#fff', fontWeight: '700', fontSize: 15 },
});