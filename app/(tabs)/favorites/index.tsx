import Ionicons from '@expo/vector-icons/Ionicons';
import { Image } from 'expo-image';
import { router } from 'expo-router';
import { doc, getDoc } from 'firebase/firestore';
import { useEffect, useState } from 'react';
import {
  ActivityIndicator,
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
  city?: string;
};

const FALLBACK_PHOTO =
  'https://images.unsplash.com/photo-1524504388940-b1c1722653e1?auto=format&fit=crop&w=900&q=80';

export default function FavoritesScreen() {
  const colorScheme = useColorScheme();
  const palette = Colors[colorScheme ?? 'light'];
  const { user } = useAuth();
  const [items, setItems] = useState<ProfilePreview[]>([]);
  const [loading, setLoading] = useState(true);
  const [refreshing, setRefreshing] = useState(false);

  const loadFavorites = async (isRefresh = false) => {
    if (!user?.uid) {
      setItems([]);
      setLoading(false);
      return;
    }
    if (isRefresh) setRefreshing(true);
    else setLoading(true);
    try {
      const snap = await getDoc(doc(db, 'profiles', user.uid));
      const data = snap.exists() ? (snap.data() as any) : {};
      const favorites = Array.isArray(data.favorites) ? data.favorites : [];
      const myBlocked = Array.isArray(data.blocked) ? data.blocked : [];
      const myBlockedBy = Array.isArray(data.blockedBy) ? data.blockedBy : [];

      const profiles = await Promise.all(
        favorites.map(async (id: string) => {
          const pSnap = await getDoc(doc(db, 'profiles', id));
          if (!pSnap.exists()) return null;
          const pData = pSnap.data() as any;
          const blockedByTarget = Array.isArray(pData.blocked) && pData.blocked.includes(user.uid);
          const targetSaysNo =
            Array.isArray(pData.blockedBy) && pData.blockedBy.includes(user.uid);
          const iBlocked = myBlocked.includes(pSnap.id);
          const iAmBlockedBy = myBlockedBy.includes(pSnap.id);
          if (blockedByTarget || targetSaysNo || iBlocked || iAmBlockedBy) return null;
          return {
            id: pSnap.id,
            name: pData.name ?? 'Utente',
            photo: pData.photo ?? pData.photos?.[0] ?? FALLBACK_PHOTO,
            age: pData.age,
            city: pData.city,
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
    loadFavorites();
  }, [user?.uid]);

  return (
    <SafeAreaView style={[styles.screen, { backgroundColor: palette.background }]}>
      <View style={[styles.header, { borderBottomColor: palette.border }]}>
        <Pressable onPress={() => router.back()} style={styles.headerBtn}>
          <Ionicons name="arrow-back" size={22} color={palette.text} />
        </Pressable>
        <Text style={[styles.title, { color: palette.text }]}>Preferiti</Text>
        <View style={styles.headerPlaceholder} />
      </View>

      {loading ? (
        <View style={styles.center}>
          <ActivityIndicator size="large" color={palette.tint} />
          <Text style={[styles.muted, { color: palette.muted }]}>Carico...</Text>
        </View>
      ) : items.length === 0 ? (
        <View style={styles.center}>
          <Ionicons name="bookmark-outline" size={32} color={palette.muted} />
          <Text style={[styles.muted, { color: palette.muted }]}>Nessun preferito</Text>
        </View>
      ) : (
        <FlatList
          data={items}
          keyExtractor={(item) => item.id}
          contentContainerStyle={styles.list}
          refreshing={refreshing}
          onRefresh={() => loadFavorites(true)}
          renderItem={({ item }) => {
            const hasPhoto = !!item.photo && item.photo !== FALLBACK_PHOTO;
            return (
              <Pressable
                style={[
                  styles.card,
                  { borderColor: palette.border, backgroundColor: palette.card },
                ]}
                onPress={() => router.push(`/profile/${item.id}`)}
              >
                <View style={styles.cardLeft}>
                  {hasPhoto ? (
                    <Image
                      source={{ uri: item.photo }}
                      style={styles.avatar}
                      contentFit="cover"
                    />
                  ) : (
                    <View style={[styles.avatarPlaceholder, { backgroundColor: palette.border }]}>
                      <Ionicons name="image-outline" size={22} color={palette.muted} />
                    </View>
                  )}
                  <View>
                    <Text style={[styles.name, { color: palette.text }]} numberOfLines={1}>
                      {item.name}
                      {item.age ? `, ${item.age}` : ''}
                    </Text>
                    {item.city ? (
                      <Text style={[styles.city, { color: palette.muted }]} numberOfLines={1}>
                        {item.city}
                      </Text>
                    ) : null}
                  </View>
                </View>
                <Ionicons name="chevron-forward" size={18} color={palette.muted} />
              </Pressable>
            );
          }}
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
  avatarPlaceholder: {
    width: 54,
    height: 54,
    borderRadius: 27,
    alignItems: 'center',
    justifyContent: 'center',
  },
  name: {
    fontSize: 15,
    fontWeight: '700',
  },
  city: {
    marginTop: 2,
    fontSize: 12,
    fontWeight: '600',
  },
});
