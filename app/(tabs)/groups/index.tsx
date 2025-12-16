import Ionicons from '@expo/vector-icons/Ionicons';
import { collection, doc, onSnapshot, orderBy, query, serverTimestamp, setDoc } from 'firebase/firestore';
import { useEffect, useMemo, useState } from 'react';
import {
  ActivityIndicator,
  FlatList,
  Modal,
  Pressable,
  StyleSheet,
  Text,
  TextInput,
  View,
  useColorScheme,
} from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';
import { router } from 'expo-router';

import { Colors } from '@/constants/theme';
import { useAuth } from '@/hooks/use-auth';
import { db } from '@/lib/firebase';

type Group = {
  id: string;
  title: string;
  subtitle?: string;
  members?: number;
};

export default function GroupsScreen() {
  const colorScheme = useColorScheme();
  const palette = Colors[colorScheme ?? 'light'];
  const { user } = useAuth();

  const [groups, setGroups] = useState<Group[]>([]);
  const [loading, setLoading] = useState(true);
  const [createOpen, setCreateOpen] = useState(false);
  const [groupName, setGroupName] = useState('');
  const [groupDesc, setGroupDesc] = useState('');
  const [creating, setCreating] = useState(false);

  useEffect(() => {
    const q = query(collection(db, 'groupRooms'), orderBy('updatedAt', 'desc'));
    const unsub = onSnapshot(
      q,
      (snap) => {
        const items = snap.docs.map((d) => ({ id: d.id, ...(d.data() as any) })) as Group[];
        setGroups(items);
        setLoading(false);
      },
      () => setLoading(false)
    );
    return unsub;
  }, []);

  return (
    <SafeAreaView style={[styles.screen, { backgroundColor: palette.background }]}>
      <View style={[styles.header, { borderBottomColor: palette.border }]}>
        <Text style={[styles.title, { color: palette.text }]}>Chat di gruppo</Text>
        <Text style={[styles.subtitle, { color: palette.muted }]}>
          Entra o crea una stanza in pochi secondi
        </Text>
      </View>

      <FlatList
        data={groups}
        keyExtractor={(item) => item.id}
        contentContainerStyle={styles.list}
        renderItem={({ item }) => (
          <Pressable
            style={[
              styles.card,
              {
                backgroundColor: palette.card,
                borderColor: palette.border,
                shadowColor: palette.shadow || '#000',
              },
            ]}
            onPress={() =>
              router.push({
                pathname: '/groups/[id]',
                params: {
                  id: item.id,
                  title: item.title,
                  subtitle: item.subtitle ?? '',
                  members: item.members?.toString() ?? '0',
                },
              })
            }
          >
            <View style={styles.cardIcon}>
              <Ionicons name="people" size={20} color={palette.tint} />
            </View>
            <View style={styles.cardText}>
              <Text style={[styles.cardTitle, { color: palette.text }]}>{item.title}</Text>
              <Text style={[styles.cardSubtitle, { color: palette.muted }]}>
                {item.subtitle || 'Chat di gruppo'} · {item.members ?? 0} membri
              </Text>
            </View>
            <Ionicons name="chevron-forward" size={18} color={palette.muted} />
          </Pressable>
        )}
        ListFooterComponent={
          <View style={styles.footer}>
            <Pressable
              style={[
                styles.primaryButton,
                { backgroundColor: palette.tint, shadowColor: palette.shadow || '#000' },
              ]}
              onPress={() => {
                setGroupName('');
                setGroupDesc('');
                setCreateOpen(true);
              }}
            >
              <Ionicons name="add" size={18} color="#fff" />
              <Text style={styles.primaryButtonText}>Nuovo gruppo</Text>
            </Pressable>
          </View>
        }
        ListEmptyComponent={
          loading ? null : (
            <View style={styles.empty}>
              <Ionicons name="chatbubbles-outline" size={38} color={palette.muted} />
              <Text style={[styles.emptyText, { color: palette.muted }]}>Nessun gruppo ancora</Text>
            </View>
          )
        }
      />

      <Modal visible={createOpen} transparent animationType="fade" onRequestClose={() => setCreateOpen(false)}>
        <View style={styles.modalBackdrop}>
          <View style={[styles.modalCard, { backgroundColor: palette.card, borderColor: palette.border }]}>
            <Text style={[styles.modalTitle, { color: palette.text }]}>Crea un nuovo gruppo</Text>
            <TextInput
              value={groupName}
              onChangeText={setGroupName}
              placeholder="Nome gruppo"
              placeholderTextColor={palette.muted}
              style={[styles.modalInput, { borderColor: palette.border, color: palette.text }]}
            />
            <TextInput
              value={groupDesc}
              onChangeText={setGroupDesc}
              placeholder="Descrizione (opzionale)"
              placeholderTextColor={palette.muted}
              style={[styles.modalInput, { borderColor: palette.border, color: palette.text }]}
            />
            <View style={styles.modalActions}>
              <Pressable
                style={[styles.modalButton, { borderColor: palette.border }]}
                onPress={() => setCreateOpen(false)}
                disabled={creating}
              >
                <Text style={{ color: palette.text }}>Annulla</Text>
              </Pressable>
              <Pressable
                style={[
                  styles.modalButton,
                  { backgroundColor: palette.tint, borderColor: palette.tint, opacity: creating ? 0.7 : 1 },
                ]}
                onPress={async () => {
                  const name = groupName.trim();
                  if (!name) return;
                  setCreating(true);
                  try {
                    const ref = doc(collection(db, 'groupRooms'));
                    await setDoc(ref, {
                      title: name,
                      subtitle: groupDesc.trim() || 'Chat di gruppo',
                      membersCount: 1,
                      owner: user?.uid ?? null,
                      updatedAt: serverTimestamp(),
                      createdAt: serverTimestamp(),
                    });
                    setCreateOpen(false);
                    router.push({
                      pathname: '/groups/[id]',
                      params: { id: ref.id, title: name, subtitle: groupDesc.trim(), members: '1' },
                    });
                  } finally {
                    setCreating(false);
                  }
                }}
                disabled={creating || !groupName.trim()}
              >
                {creating ? (
                  <ActivityIndicator color="#fff" />
                ) : (
                  <Text style={styles.modalButtonText}>Crea</Text>
                )}
              </Pressable>
            </View>
          </View>
        </View>
      </Modal>
    </SafeAreaView>
  );
}

const styles = StyleSheet.create({
  screen: {
    flex: 1,
  },
  header: {
    paddingHorizontal: 20,
    paddingTop: 16,
    paddingBottom: 10,
    borderBottomWidth: 1,
  },
  title: {
    fontSize: 22,
    fontWeight: '800',
  },
  subtitle: {
    marginTop: 6,
    fontSize: 14,
    fontWeight: '500',
  },
  list: {
    padding: 16,
    gap: 12,
  },
  card: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 12,
    borderWidth: 1,
    borderRadius: 16,
    paddingHorizontal: 14,
    paddingVertical: 12,
    shadowOffset: { width: 0, height: 4 },
    shadowOpacity: 0.08,
    shadowRadius: 8,
    elevation: 3,
  },
  cardIcon: {
    width: 40,
    height: 40,
    borderRadius: 20,
    alignItems: 'center',
    justifyContent: 'center',
    backgroundColor: 'rgba(0,0,0,0.04)',
  },
  cardText: {
    flex: 1,
  },
  cardTitle: {
    fontSize: 16,
    fontWeight: '700',
  },
  cardSubtitle: {
    marginTop: 2,
    fontSize: 13,
    fontWeight: '500',
  },
  footer: {
    marginTop: 16,
    paddingHorizontal: 4,
  },
  primaryButton: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'center',
    gap: 8,
    paddingVertical: 14,
    borderRadius: 14,
    shadowOffset: { width: 0, height: 4 },
    shadowOpacity: 0.25,
    shadowRadius: 10,
    elevation: 4,
  },
  primaryButtonText: {
    color: '#fff',
    fontSize: 16,
    fontWeight: '700',
  },
  empty: {
    alignItems: 'center',
    gap: 6,
    paddingVertical: 40,
  },
  emptyText: {
    fontSize: 14,
    fontWeight: '600',
  },
  modalBackdrop: {
    flex: 1,
    backgroundColor: 'rgba(0,0,0,0.4)',
    alignItems: 'center',
    justifyContent: 'center',
    padding: 20,
  },
  modalCard: {
    width: '100%',
    borderRadius: 14,
    borderWidth: 1,
    padding: 16,
    gap: 10,
  },
  modalTitle: {
    fontSize: 18,
    fontWeight: '800',
    marginBottom: 4,
  },
  modalInput: {
    borderWidth: 1,
    borderRadius: 10,
    paddingHorizontal: 12,
    paddingVertical: 10,
    fontSize: 15,
  },
  modalActions: {
    flexDirection: 'row',
    justifyContent: 'flex-end',
    gap: 10,
    marginTop: 6,
  },
  modalButton: {
    paddingHorizontal: 14,
    paddingVertical: 10,
    borderRadius: 10,
    borderWidth: 1,
    minWidth: 90,
    alignItems: 'center',
  },
  modalButtonText: {
    color: '#fff',
    fontWeight: '700',
  },
});
