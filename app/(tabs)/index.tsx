import Ionicons from '@expo/vector-icons/Ionicons';
import { Image } from 'expo-image';
import { router } from 'expo-router';
import { useEffect, useMemo, useState } from 'react';
import {
  ActivityIndicator,
  FlatList,
  Pressable,
  RefreshControl,
  StyleSheet,
  Text,
  TextInput,
  View,
  useColorScheme,
} from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';

import { Colors } from '@/constants/theme';
import { useAuth } from '@/hooks/use-auth';
import { useProfiles } from '@/hooks/use-profiles';
import { doc, getDoc } from 'firebase/firestore';
import { db } from '@/lib/firebase';

const FALLBACK_PHOTO =
  'https://images.unsplash.com/photo-1524504388940-b1c1722653e1?auto=format&fit=crop&w=900&q=80';

export default function CompactGridScreen() {
  const colorScheme = useColorScheme();
  const palette = Colors[colorScheme ?? 'light'];
  const [search, setSearch] = useState('');
  const { user } = useAuth();
  const { data, loading, error, refresh, refreshing } = useProfiles();
  const [blockedIds, setBlockedIds] = useState<string[]>([]);
  const [blockedByIds, setBlockedByIds] = useState<string[]>([]);

  useEffect(() => {
    let active = true;
    (async () => {
      if (!user?.uid) {
        setBlockedIds([]);
        setBlockedByIds([]);
        return;
      }
      try {
        const snap = await getDoc(doc(db, 'profiles', user.uid));
        if (!active) return;
        if (snap.exists()) {
          const data = snap.data() as any;
          setBlockedIds(Array.isArray(data.blocked) ? data.blocked : []);
          setBlockedByIds(Array.isArray(data.blockedBy) ? data.blockedBy : []);
        } else {
          setBlockedIds([]);
          setBlockedByIds([]);
        }
      } catch (e) {
        if (!active) return;
        setBlockedIds([]);
        setBlockedByIds([]);
      }
    })();
    return () => {
      active = false;
    };
  }, [user?.uid]);

  const profiles = useMemo(() => {
    const base = data;
    if (!user?.uid) return base;
    return base.filter((p) => {
      if (p.id === user.uid) return false;
      const targetBlockedBy = Array.isArray((p as any).blockedBy) ? (p as any).blockedBy : [];
      const targetBlocked = Array.isArray((p as any).blocked) ? (p as any).blocked : [];
      if (blockedIds.includes(p.id)) return false;
      if (blockedByIds.includes(p.id)) return false;
      if (targetBlocked.includes(user.uid)) return false;
      if (targetBlockedBy.includes(user.uid)) return false;
      return true;
    });
  }, [data, user?.uid, blockedIds, blockedByIds]);
  const filtered = useMemo(() => {
    const term = search.trim().toLowerCase();
    if (!term) return profiles;
    return profiles.filter((p) => p.name.toLowerCase().includes(term));
  }, [profiles, search]);

  return (
    <SafeAreaView style={[styles.screen, { backgroundColor: palette.background }]} edges={['top']}>
      <View style={[styles.header, { borderBottomColor: palette.border }]}>
        <View style={styles.headerTop}>
          <Text style={styles.brand}>chatIncontri</Text>
          <Pressable
            style={styles.profileBtn}
            onPress={() => {
              if (user?.uid) {
                router.push(`/profile/${user.uid}`);
              } else {
                router.push('/profile/setup');
              }
            }}>
            <Ionicons name="person-circle-outline" size={26} color={palette.text} />
          </Pressable>
        </View>
        <View
          style={[
            styles.searchBox,
            { borderColor: palette.border, backgroundColor: palette.card },
          ]}>
          <TextInput
            placeholder="Cerca per nickname"
            placeholderTextColor={palette.muted}
            value={search}
            onChangeText={setSearch}
            style={styles.searchInput}
          />
        </View>
      </View>
      {loading ? (
        <View style={styles.loading}>
          <ActivityIndicator color={palette.tint} />
          <Text style={styles.loadingText}>Carico profili...</Text>
        </View>
      ) : error ? (
        <View style={styles.loading}>
          <Text style={styles.loadingText}>Errore nel caricamento, uso dati fittizi.</Text>
        </View>
      ) : null}
      <FlatList
        data={filtered}
        numColumns={3}
        keyExtractor={(item) => item.id}
        contentContainerStyle={styles.listContent}
        columnWrapperStyle={styles.row}
        showsVerticalScrollIndicator={false}
        refreshControl={
          <RefreshControl
            refreshing={refreshing}
            onRefresh={refresh}
            tintColor={palette.tint}
            colors={[palette.tint]}
          />
        }
        ListEmptyComponent={
          !loading && !refreshing ? (
            <View style={styles.emptyState}>
              <Text style={styles.emptyTitle}>Nessun profilo disponibile</Text>
              <Text style={[styles.emptySubtitle, { color: palette.muted }]}>
                Aggiungi nuovi profili o aggiorna la pagina.
              </Text>
            </View>
          ) : null
        }
        renderItem={({ item }) => {
          const photoUri = (item as any).photo || (item as any).photos?.[0] || FALLBACK_PHOTO;
          return (
            <Pressable
              style={[styles.card, { borderColor: palette.border }]}
              onPress={() => router.push(`/profile/${item.id}`)}
              android_ripple={{ color: '#00000010' }}>
              <View style={styles.photoWrapper}>
                <Image
                  source={{ uri: photoUri }}
                  style={styles.photo}
                  contentFit="cover"
                  transition={150}
                  cachePolicy="memory-disk"
                />
                <View style={styles.photoOverlay} />
                <View style={styles.photoFooter}>
                  <Text style={styles.name} numberOfLines={1}>
                    {item.name}, {item.age}
                  </Text>
                  <View style={styles.metaRow}>
                    <Ionicons name="location" size={12} color="#f3f4f6" />
                    <Text style={styles.meta} numberOfLines={1}>
                      {item.city ?? ''}
                    </Text>
                  </View>
                </View>
              </View>
            </Pressable>
          );
        }}
      />
    </SafeAreaView>
  );
}

const styles = StyleSheet.create({
  screen: {
    flex: 1,
  },
  header: {
    paddingHorizontal: 16,
    paddingTop: 10,
    paddingBottom: 12,
    gap: 12,
    borderBottomWidth: 1,
  },
  headerTop: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
  },
  profileBtn: {
    padding: 6,
  },
  brand: {
    fontSize: 22,
    fontWeight: '800',
    letterSpacing: 0.2,
  },
  loading: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 8,
    paddingHorizontal: 16,
    paddingVertical: 6,
  },
  loadingText: {
    fontSize: 14,
  },
  searchBox: {
    borderWidth: 1,
    borderRadius: 12,
    paddingHorizontal: 12,
    paddingVertical: 10,
  },
  searchInput: {
    fontSize: 15,
  },
  loading: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 8,
    paddingHorizontal: 16,
    paddingVertical: 6,
  },
  loadingText: {
    fontSize: 14,
  },
  listContent: {
    paddingHorizontal: 12,
    paddingVertical: 16,
    gap: 12,
  },
  row: {
    gap: 12,
    justifyContent: 'space-between',
  },
  card: {
    flex: 1,
    minWidth: 0,
    borderRadius: 10,
    borderWidth: 1,
    backgroundColor: '#f9fafb',
    shadowColor: '#000',
    shadowOpacity: 0.05,
    shadowOffset: { width: 0, height: 2 },
    shadowRadius: 8,
    elevation: 2,
    overflow: 'hidden',
  },
  photoWrapper: {
    width: '100%',
    aspectRatio: 1,
    backgroundColor: '#e5e7eb',
  },
  photo: {
    width: '100%',
    height: '100%',
  },
  name: {
    color: '#fff',
    fontSize: 13,
    fontWeight: '800',
  },
  meta: {
    color: '#f3f4f6',
    fontSize: 10,
  },
  photoOverlay: {
    ...StyleSheet.absoluteFillObject,
    backgroundColor: 'rgba(0,0,0,0.25)',
  },
  photoFooter: {
    position: 'absolute',
    left: 8,
    right: 8,
    bottom: 8,
    paddingVertical: 6,
    paddingHorizontal: 8,
    borderRadius: 10,
    backgroundColor: 'rgba(0,0,0,0.35)',
    gap: 4,
  },
  metaRow: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 4,
  },
  emptyState: {
    paddingVertical: 40,
    alignItems: 'center',
    gap: 6,
  },
  emptyTitle: {
    fontSize: 16,
    fontWeight: '700',
  },
  emptySubtitle: {
    fontSize: 13,
    textAlign: 'center',
  },
});
