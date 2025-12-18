import Ionicons from '@expo/vector-icons/Ionicons';
import { Image } from 'expo-image';
import { router } from 'expo-router';
import { arrayRemove, deleteField, doc, getDoc, setDoc } from 'firebase/firestore';
import { useEffect, useState } from 'react';
import {
  ActivityIndicator,
  Alert,
  FlatList,
  Pressable,
  StyleSheet,
  Text,
  View,
  useColorScheme,
} from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';

import { Colors } from '@/constants/theme';
import { useAuth } from '@/hooks/use-auth';
import { db } from '@/lib/firebase';

type ProfilePreview = {
  id: string;
  name: string;
  photo?: string;
  age?: number;
};

const FALLBACK_PHOTO =
  'https://images.unsplash.com/photo-1524504388940-b1c1722653e1?auto=format&fit=crop&w=900&q=80';

export default function BlockedUsersScreen() {
  const colorScheme = useColorScheme();
  const palette = Colors[colorScheme ?? 'light'];
  const { user } = useAuth();
  const [blockedIds, setBlockedIds] = useState<string[]>([]);
  const [items, setItems] = useState<ProfilePreview[]>([]);
  const [loading, setLoading] = useState(true);
  const [refreshing, setRefreshing] = useState(false);
  const [unblockingId, setUnblockingId] = useState<string | null>(null);

  const loadBlocked = async (isRefresh = false) => {
    if (!user?.uid) {
      setBlockedIds([]);
      setItems([]);
      setLoading(false);
      return;
    }
    if (isRefresh) setRefreshing(true);
    else setLoading(true);
    try {
      const snap = await getDoc(doc(db, 'profiles', user.uid));
      const ids = snap.exists() && Array.isArray((snap.data() as any).blocked)
        ? ((snap.data() as any).blocked as string[])
        : [];
      setBlockedIds(ids);
      const profiles = await Promise.all(
        ids.map(async (id) => {
          const pSnap = await getDoc(doc(db, 'profiles', id));
          if (!pSnap.exists()) return null;
          const data = pSnap.data() as any;
          return {
            id: pSnap.id,
            name: data.name ?? 'Utente',
            photo: data.photo ?? data.photos?.[0] ?? FALLBACK_PHOTO,
            age: data.age,
          } as ProfilePreview;
        })
      );
      setItems(profiles.filter(Boolean) as ProfilePreview[]);
    } catch (e) {
      setItems([]);
    } finally {
      if (isRefresh) setRefreshing(false);
      else setLoading(false);
    }
  };

  useEffect(() => {
    loadBlocked();
  }, [user?.uid]);

  const handleUnblock = (targetId: string) => {
    if (!user?.uid) return;
    Alert.alert(
      'Sblocca utente',
      'Sbloccando tornerete a vedervi e potrete chattare di nuovo. Procedere?',
      [
      { text: 'Annulla', style: 'cancel' },
      {
        text: 'Sblocca',
        onPress: async () => {
          setUnblockingId(targetId);
          const chatId = [user.uid, targetId].sort().join('_');
          try {
            await Promise.all([
              setDoc(
                doc(db, 'profiles', user.uid),
                { blocked: arrayRemove(targetId) },
                { merge: true }
              ),
              setDoc(
                doc(db, 'profiles', targetId),
                { blockedBy: arrayRemove(user.uid) },
                { merge: true }
              ),
              setDoc(
                doc(db, 'chats', chatId),
                { blockedBy: { [user.uid]: deleteField() } },
                { merge: true }
              ),
            ]);
            await loadBlocked(true);
          } catch (e) {
            Alert.alert('Errore', 'Non sono riuscito a sbloccare, riprova.');
          } finally {
            setUnblockingId(null);
          }
        },
      },
    ]);
  };

  return (
    <SafeAreaView style={[styles.screen, { backgroundColor: palette.background }]}>
      <View style={[styles.header, { borderBottomColor: palette.border }]}>
        <Pressable onPress={() => router.back()} style={styles.headerBtn}>
          <Ionicons name="arrow-back" size={22} color={palette.text} />
        </Pressable>
        <Text style={[styles.title, { color: palette.text }]}>Utenti bloccati</Text>
        <View style={styles.headerPlaceholder} />
      </View>

      {loading ? (
        <View style={styles.center}>
          <ActivityIndicator size="large" color={palette.tint} />
          <Text style={[styles.muted, { color: palette.muted }]}>Carico...</Text>
        </View>
      ) : items.length === 0 ? (
        <View style={styles.center}>
          <Ionicons name="happy-outline" size={32} color={palette.muted} />
          <Text style={[styles.muted, { color: palette.muted }]}>Nessun utente bloccato</Text>
        </View>
      ) : (
        <FlatList
          data={items}
          keyExtractor={(item) => item.id}
          contentContainerStyle={styles.list}
          refreshing={refreshing}
          onRefresh={() => loadBlocked(true)}
          renderItem={({ item }) => (
            <View
              style={[
                styles.card,
                { borderColor: palette.border, backgroundColor: palette.card },
              ]}
            >
              <View style={styles.cardLeft}>
                <Image
                  source={{ uri: item.photo ?? FALLBACK_PHOTO }}
                  style={styles.avatar}
                  contentFit="cover"
                />
                <View>
                  <Text style={[styles.name, { color: palette.text }]} numberOfLines={1}>
                    {item.name}
                    {item.age ? `, ${item.age}` : ''}
                  </Text>
                </View>
              </View>
              <Pressable
                style={[
                  styles.unblockBtn,
                  { backgroundColor: palette.tint },
                  unblockingId === item.id && { opacity: 0.7 },
                ]}
                disabled={unblockingId === item.id}
                onPress={() => handleUnblock(item.id)}
              >
                {unblockingId === item.id ? (
                  <ActivityIndicator size="small" color="#fff" />
                ) : (
                  <>
                    <Ionicons name="lock-open-outline" size={16} color="#fff" />
                    <Text style={styles.unblockText}>Sblocca</Text>
                  </>
                )}
              </Pressable>
            </View>
          )}
        />
      )}
    </SafeAreaView>
  );
}

const styles = StyleSheet.create({
  screen: {
    flex: 1,
  },
  header: {
    flexDirection: 'row',
    alignItems: 'center',
    paddingHorizontal: 14,
    paddingVertical: 12,
    borderBottomWidth: 1,
  },
  headerBtn: {
    padding: 6,
  },
  headerPlaceholder: {
    width: 28,
  },
  title: {
    flex: 1,
    textAlign: 'center',
    fontSize: 18,
    fontWeight: '800',
  },
  center: {
    flex: 1,
    alignItems: 'center',
    justifyContent: 'center',
    gap: 8,
    padding: 20,
  },
  muted: {
    fontSize: 14,
  },
  list: {
    padding: 14,
    gap: 10,
  },
  card: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    borderWidth: 1,
    borderRadius: 12,
    padding: 12,
    gap: 10,
  },
  cardLeft: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 10,
    flex: 1,
  },
  avatar: {
    width: 54,
    height: 54,
    borderRadius: 27,
  },
  name: {
    fontSize: 15,
    fontWeight: '700',
  },
  unblockBtn: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 6,
    paddingHorizontal: 12,
    paddingVertical: 8,
    borderRadius: 10,
  },
  unblockText: {
    color: '#fff',
    fontWeight: '700',
  },
});
