import Ionicons from '@expo/vector-icons/Ionicons';
import { Image } from 'expo-image';
import { router } from 'expo-router';
import { useEffect, useMemo, useState } from 'react';
import {
  ActivityIndicator,
  ScrollView,
  FlatList,
  Pressable,
  RefreshControl,
  StyleSheet,
  Text,
  TextInput,
  View,
  useColorScheme,
} from 'react-native';
import { SafeAreaView, useSafeAreaInsets } from 'react-native-safe-area-context';

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
  const [actionsOpen, setActionsOpen] = useState(false);
  const insets = useSafeAreaInsets();
  const { user } = useAuth();
  const { data, loading, error, refresh, refreshing } = useProfiles();
  const [blockedIds, setBlockedIds] = useState<string[]>([]);
  const [blockedByIds, setBlockedByIds] = useState<string[]>([]);
  const [filterMinAge, setFilterMinAge] = useState('');
  const [filterMaxAge, setFilterMaxAge] = useState('');
  const [filterMaxDistance, setFilterMaxDistance] = useState('');
  const [filterCity, setFilterCity] = useState('');
  const [filterOnline, setFilterOnline] = useState(false);
  const [filterWithPhoto, setFilterWithPhoto] = useState(false);
  const [filterRole, setFilterRole] = useState<string | null>(null);
  const [filterIntent, setFilterIntent] = useState<string | null>(null);
  const [filterInterests, setFilterInterests] = useState<string[]>([]);

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
    let next = profiles;
    const minAge = Number.parseInt(filterMinAge, 10);
    const maxAge = Number.parseInt(filterMaxAge, 10);
    const maxDistance = Number.parseInt(filterMaxDistance, 10);
    const cityTerm = filterCity.trim().toLowerCase();

    if (!Number.isNaN(minAge)) {
      next = next.filter((p) => (p.age ?? 0) >= minAge);
    }
    if (!Number.isNaN(maxAge)) {
      next = next.filter((p) => (p.age ?? 0) <= maxAge);
    }
    if (!Number.isNaN(maxDistance)) {
      next = next.filter((p) => (p.distanceKm ?? 0) <= maxDistance);
    }
    if (cityTerm) {
      next = next.filter((p) => (p.city ?? '').toLowerCase().includes(cityTerm));
    }
    if (filterOnline) {
      next = next.filter((p: any) => {
        const status = (p.status ?? '').toLowerCase();
        const isOnline = p.isOnline === true || status === 'online';
        const lastActive = p.lastActiveAt ?? p.lastActive ?? null;
        if (typeof lastActive === 'number') {
          const lastActiveMs = lastActive < 1e12 ? lastActive * 1000 : lastActive;
          return Date.now() - lastActiveMs <= 10 * 60 * 1000;
        }
        if (lastActive?.toMillis) {
          return Date.now() - lastActive.toMillis() <= 10 * 60 * 1000;
        }
        if (typeof lastActive?.seconds === 'number') {
          return Date.now() - lastActive.seconds * 1000 <= 10 * 60 * 1000;
        }
        return isOnline;
      });
    }
    if (filterWithPhoto) {
      next = next.filter((p: any) => {
        const photo = p.photo;
        const photos = Array.isArray(p.photos) ? p.photos : [];
        if (photo && photo !== FALLBACK_PHOTO) return true;
        return photos.some((uri: string) => uri && uri !== FALLBACK_PHOTO);
      });
    }
    if (filterRole) {
      next = next.filter((p: any) => (p.role ?? '').toLowerCase() === filterRole);
    }
    if (filterIntent) {
      next = next.filter((p: any) => (p.intent ?? '').toLowerCase() === filterIntent);
    }
    if (filterInterests.length > 0) {
      next = next.filter((p) =>
        filterInterests.some((interest) => (p.interests ?? []).includes(interest))
      );
    }
    return next;
  }, [
    profiles,
    filterMinAge,
    filterMaxAge,
    filterMaxDistance,
    filterCity,
    filterOnline,
    filterWithPhoto,
    filterRole,
    filterIntent,
    filterInterests,
  ]);

  const roleOptions = ['Top', 'Vers', 'Bottom', 'NS'];
  const intentOptions = ['Relazione', 'Amicizia', 'Dating'];
  const interestOptions = [
    'Viaggi',
    'Sport',
    'Nightlife',
    'Cultura',
    'Tech',
    'Arte',
    'Foodie',
    'Nature',
    'Gaming',
  ];

  const toggleFilterInterest = (interest: string) => {
    setFilterInterests((prev) =>
      prev.includes(interest) ? prev.filter((item) => item !== interest) : [...prev, interest]
    );
  };

  const resetFilters = () => {
    setFilterMinAge('');
    setFilterMaxAge('');
    setFilterMaxDistance('');
    setFilterCity('');
    setFilterOnline(false);
    setFilterWithPhoto(false);
    setFilterRole(null);
    setFilterIntent(null);
    setFilterInterests([]);
  };

  return (
    <SafeAreaView style={[styles.screen, { backgroundColor: palette.background }]} edges={['top']}>
      <View style={[styles.header, { borderBottomColor: palette.border }]}>
        <View style={styles.headerTop}>
          <Text style={styles.brand}>chatIncontri</Text>
          <View style={styles.headerActions}>
            <Pressable
              style={[styles.menuBtn, { borderColor: palette.border }]}
              onPress={() => setActionsOpen((prev) => !prev)}
            >
              <Ionicons name="add" size={22} color={palette.text} />
            </Pressable>
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
        </View>
      </View>
      {actionsOpen && (
        <Pressable style={styles.backdrop} onPress={() => setActionsOpen(false)} />
      )}
      {actionsOpen && (
        <View
          style={[
            styles.actionsPanel,
            {
              borderColor: palette.border,
              backgroundColor: palette.card,
              top: insets.top + 8,
            },
          ]}
        >
          <View style={styles.panelHeader}>
            <Pressable style={styles.panelClose} onPress={() => setActionsOpen(false)}>
              <Ionicons name="close" size={20} color={palette.text} />
            </Pressable>
          </View>
          <ScrollView
            horizontal
            showsHorizontalScrollIndicator={false}
            contentContainerStyle={styles.actionsRow}
          >
            <Pressable
              style={styles.actionCard}
              onPress={() => {
                setActionsOpen(false);
                router.push('/favorites');
              }}
            >
              <View style={[styles.actionIcon, { backgroundColor: `${palette.accent}18` }]}>
                <Ionicons name="bookmark" size={22} color={palette.accent} />
              </View>
              <Text style={[styles.actionText, { color: palette.text }]}>Preferiti</Text>
            </Pressable>
          </ScrollView>

          <View style={styles.filtersHeader}>
            <Text style={[styles.filtersTitle, { color: palette.text }]}>Filtri</Text>
            <Pressable onPress={resetFilters}>
              <Text style={[styles.resetText, { color: palette.muted }]}>Reset</Text>
            </Pressable>
          </View>

          <View style={styles.chipsRow}>
            <Pressable
              style={[
                styles.chip,
                {
                  borderColor: filterOnline ? palette.accent : palette.border,
                  backgroundColor: filterOnline ? `${palette.accent}18` : palette.card,
                },
              ]}
              onPress={() => setFilterOnline((prev) => !prev)}
            >
              <Text style={[styles.chipText, { color: filterOnline ? palette.accent : palette.text }]}>
                Online
              </Text>
            </Pressable>
            <Pressable
              style={[
                styles.chip,
                {
                  borderColor: filterWithPhoto ? palette.tint : palette.border,
                  backgroundColor: filterWithPhoto ? `${palette.tint}18` : palette.card,
                },
              ]}
              onPress={() => setFilterWithPhoto((prev) => !prev)}
            >
              <Text style={[styles.chipText, { color: filterWithPhoto ? palette.tint : palette.text }]}>
                Con foto
              </Text>
            </Pressable>
          </View>

          <View style={styles.filterRow}>
            <View style={[styles.filterField, { borderColor: palette.border }]}>
              <TextInput
                placeholder="Età min"
                placeholderTextColor={palette.muted}
                keyboardType="number-pad"
                value={filterMinAge}
                onChangeText={setFilterMinAge}
                style={styles.filterInput}
              />
            </View>
            <View style={[styles.filterField, { borderColor: palette.border }]}>
              <TextInput
                placeholder="Età max"
                placeholderTextColor={palette.muted}
                keyboardType="number-pad"
                value={filterMaxAge}
                onChangeText={setFilterMaxAge}
                style={styles.filterInput}
              />
            </View>
            <View style={[styles.filterField, { borderColor: palette.border }]}>
              <TextInput
                placeholder="Km"
                placeholderTextColor={palette.muted}
                keyboardType="number-pad"
                value={filterMaxDistance}
                onChangeText={setFilterMaxDistance}
                style={styles.filterInput}
              />
            </View>
          </View>

          <View style={[styles.filterField, styles.filterFieldFull, { borderColor: palette.border }]}>
            <Ionicons name="location-outline" size={16} color={palette.muted} />
            <TextInput
              placeholder="Città"
              placeholderTextColor={palette.muted}
              value={filterCity}
              onChangeText={setFilterCity}
              style={styles.filterInput}
            />
          </View>

          <View style={styles.chipsRow}>
            {roleOptions.map((opt) => {
              const selected = filterRole === opt.toLowerCase();
              return (
                <Pressable
                  key={opt}
                  style={[
                    styles.chip,
                    {
                      borderColor: selected ? palette.tint : palette.border,
                      backgroundColor: selected ? `${palette.tint}18` : palette.card,
                    },
                  ]}
                  onPress={() => setFilterRole(selected ? null : opt.toLowerCase())}
                >
                  <Text style={[styles.chipText, { color: selected ? palette.tint : palette.text }]}>
                    {opt}
                  </Text>
                </Pressable>
              );
            })}
          </View>

          <View style={styles.chipsRow}>
            {intentOptions.map((opt) => {
              const selected = filterIntent === opt.toLowerCase();
              return (
                <Pressable
                  key={opt}
                  style={[
                    styles.chip,
                    {
                      borderColor: selected ? palette.accent : palette.border,
                      backgroundColor: selected ? `${palette.accent}18` : palette.card,
                    },
                  ]}
                  onPress={() => setFilterIntent(selected ? null : opt.toLowerCase())}
                >
                  <Text
                    style={[styles.chipText, { color: selected ? palette.accent : palette.text }]}
                  >
                    {opt}
                  </Text>
                </Pressable>
              );
            })}
          </View>

          <View style={styles.chipsRow}>
            {interestOptions.map((opt) => {
              const selected = filterInterests.includes(opt);
              return (
                <Pressable
                  key={opt}
                  style={[
                    styles.chip,
                    {
                      borderColor: selected ? palette.tint : palette.border,
                      backgroundColor: selected ? `${palette.tint}18` : palette.card,
                    },
                  ]}
                  onPress={() => toggleFilterInterest(opt)}
                >
                  <Text style={[styles.chipText, { color: selected ? palette.tint : palette.text }]}>
                    {opt}
                  </Text>
                </Pressable>
              );
            })}
          </View>
        </View>
      )}
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
          const candidatePhotos = [
            (item as any).photo,
            ...(((item as any).photos ?? []) as string[]),
          ];
          const selectedPhoto = candidatePhotos.find(
            (uri) => uri && uri !== FALLBACK_PHOTO
          );
          const hasPhoto = !!selectedPhoto;
          return (
            <Pressable
              style={[styles.card, { borderColor: palette.border }]}
              onPress={() => router.push(`/profile/${item.id}`)}
              android_ripple={{ color: '#00000010' }}>
              <View style={styles.photoWrapper}>
                {hasPhoto ? (
                  <Image
                    source={{ uri: selectedPhoto }}
                    style={styles.photo}
                    contentFit="cover"
                    transition={150}
                    cachePolicy="memory-disk"
                  />
                ) : (
                  <View style={[styles.photoPlaceholder, { backgroundColor: palette.border }]}>
                    <Ionicons name="image-outline" size={24} color={palette.muted} />
                    <Text style={[styles.photoPlaceholderText, { color: palette.muted }]}>
                      Nessuna foto
                    </Text>
                  </View>
                )}
                {hasPhoto ? <View style={styles.photoOverlay} /> : null}
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
    position: 'relative',
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
  headerActions: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 10,
  },
  menuBtn: {
    width: 36,
    height: 36,
    borderRadius: 18,
    borderWidth: 1,
    alignItems: 'center',
    justifyContent: 'center',
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
  actionsPanel: {
    position: 'absolute',
    left: 12,
    right: 12,
    borderWidth: 1,
    borderRadius: 12,
    padding: 12,
    gap: 12,
    zIndex: 20,
    elevation: 12,
    shadowColor: '#000',
    shadowOpacity: 0.12,
    shadowOffset: { width: 0, height: 6 },
    shadowRadius: 14,
  },
  backdrop: {
    ...StyleSheet.absoluteFillObject,
    backgroundColor: 'rgba(0,0,0,0.18)',
    zIndex: 10,
  },
  panelClose: {
    width: 34,
    height: 34,
    borderRadius: 17,
    alignItems: 'center',
    justifyContent: 'center',
    backgroundColor: 'rgba(0,0,0,0.06)',
  },
  panelHeader: {
    alignItems: 'flex-end',
  },
  actionsRow: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 12,
    paddingRight: 6,
  },
  actionButton: {
    flex: 1,
    flexDirection: 'row',
    alignItems: 'center',
    gap: 10,
    paddingVertical: 10,
    paddingHorizontal: 10,
    borderRadius: 12,
    backgroundColor: 'rgba(0,0,0,0.04)',
    width: '100%',
  },
  actionCard: {
    width: 96,
    alignItems: 'center',
    gap: 6,
    paddingVertical: 12,
    borderRadius: 12,
    backgroundColor: 'rgba(0,0,0,0.04)',
    paddingHorizontal: 8,
  },
  actionIcon: {
    width: 32,
    height: 32,
    borderRadius: 16,
    alignItems: 'center',
    justifyContent: 'center',
  },
  actionText: {
    fontSize: 14,
    fontWeight: '700',
  },
  filtersHeader: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
  },
  filtersTitle: {
    fontSize: 15,
    fontWeight: '800',
  },
  resetText: {
    fontSize: 12,
    fontWeight: '700',
  },
  filterRow: {
    flexDirection: 'row',
    gap: 8,
  },
  filterField: {
    flex: 1,
    borderWidth: 1,
    borderRadius: 10,
    paddingHorizontal: 10,
    paddingVertical: 8,
    flexDirection: 'row',
    alignItems: 'center',
    gap: 8,
    backgroundColor: '#fff',
  },
  filterFieldFull: {
    flex: 1,
  },
  filterInput: {
    flex: 1,
    fontSize: 14,
  },
  chipsRow: {
    flexDirection: 'row',
    flexWrap: 'wrap',
    gap: 8,
  },
  chip: {
    borderWidth: 1,
    borderRadius: 999,
    paddingHorizontal: 12,
    paddingVertical: 6,
  },
  chipText: {
    fontSize: 12,
    fontWeight: '700',
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
  photoPlaceholder: {
    flex: 1,
    alignItems: 'center',
    justifyContent: 'center',
    gap: 6,
  },
  photoPlaceholderText: {
    fontSize: 12,
    fontWeight: '600',
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
