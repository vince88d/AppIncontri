import { Image } from 'expo-image';
import Ionicons from '@expo/vector-icons/Ionicons';
import { Pressable, StyleSheet, Text, View, useColorScheme } from 'react-native';

import { Colors, PastelPalette } from '@/constants/theme';
import type { Profile } from '@/hooks/use-profiles';

type Props = {
  profile: Profile & { photos?: string[] };
  onLike?: (id: string) => void;
  onPass?: (id: string) => void;
};

const FALLBACK_PHOTO =
  'https://images.unsplash.com/photo-1524504388940-b1c1722653e1?auto=format&fit=crop&w=900&q=80';

export function ProfileCard({ profile, onLike, onPass }: Props) {
  const colorScheme = useColorScheme();
  const palette = Colors[colorScheme ?? 'light'];
  const candidatePhotos = [profile.photo, ...(profile.photos ?? [])].filter(Boolean);
  const selectedPhoto = candidatePhotos.find((uri) => uri && uri !== FALLBACK_PHOTO);
  const hasPhoto = !!selectedPhoto;
  const city = (profile.city ?? '').trim();
  const normalizedCity = city.replace(/[^a-z0-9]/gi, '').toLowerCase();
  const hasCity = !!city && normalizedCity !== 'nd';
  const jobTitle = (profile.jobTitle ?? '').trim();
  const hasJobTitle = !!jobTitle;
  const bio = (profile.bio ?? '').trim();
  const hasBio = !!bio;
  const interests = Array.isArray(profile.interests) ? profile.interests.filter(Boolean) : [];
  const hasInterests = interests.length > 0;

  return (
    <View
      style={[
        styles.card,
        {
          backgroundColor: palette.card,
          borderColor: palette.border,
          shadowColor: colorScheme === 'dark' ? '#000' : '#0a0a0a',
        },
      ]}>
      <View style={styles.photoWrapper}>
        <View style={[styles.distancePill, { backgroundColor: 'rgba(0,0,0,0.5)' }]}>
          <Ionicons name="location" size={14} color="#fff" />
          <Text style={styles.distanceText}>{profile.distanceKm} km</Text>
        </View>
        <View style={styles.statusDot} />
        {hasPhoto ? (
          <Image
            source={{ uri: selectedPhoto }}
            style={styles.photo}
            contentFit="cover"
            transition={200}
            cachePolicy="memory-disk"
          />
        ) : (
          <View style={[styles.photoPlaceholder, { backgroundColor: palette.border }]}>
            <Ionicons name="image-outline" size={32} color={palette.muted} />
            <Text style={[styles.photoPlaceholderText, { color: palette.muted }]}>
              Nessuna foto
            </Text>
          </View>
        )}
        <View style={styles.photoOverlay}>
          <Text style={styles.name}>
            {profile.name}, {profile.age}
          </Text>
          {hasCity && <Text style={styles.location}>{city}</Text>}
        </View>
      </View>

      <View style={styles.body}>
        {hasJobTitle && (
          <View style={styles.metaRow}>
            <Ionicons name="briefcase" size={16} color={palette.muted} />
            <Text style={styles.job} numberOfLines={1}>
              {jobTitle}
            </Text>
          </View>
        )}
        {hasBio && (
          <Text style={[styles.bio, { color: palette.muted }]} numberOfLines={3}>
            {bio}
          </Text>
        )}

        {hasInterests && (
          <View style={styles.tagsRow}>
            {interests.map((interest, index) => (
              <View
                key={interest}
                style={[
                  styles.tag,
                  {
                    backgroundColor: PastelPalette[index % PastelPalette.length],
                    borderColor: palette.border,
                  },
                ]}
              >
                <Text style={styles.tagText}>{interest}</Text>
              </View>
            ))}
          </View>
        )}

        <View style={styles.actionsRow}>
          <Pressable
            style={[styles.actionButton, styles.passButton, { borderColor: palette.border }]}
            onPress={() => onPass?.(profile.id)}>
            <Ionicons name="close" size={18} color={palette.text} />
            <Text style={[styles.actionText, { color: palette.text }]}>Passa</Text>
          </Pressable>
          <Pressable
            style={[styles.actionButton, styles.likeButton, { backgroundColor: palette.tint }]}
            onPress={() => onLike?.(profile.id)}>
            <Ionicons name="heart" size={18} color="#fff" />
            <Text style={[styles.actionText, styles.likeText]}>Mi piace</Text>
          </Pressable>
        </View>
      </View>
    </View>
  );
}

const styles = StyleSheet.create({
  card: {
    borderRadius: 18,
    overflow: 'hidden',
    borderWidth: 1,
    shadowOpacity: 0.12,
    shadowOffset: { width: 0, height: 8 },
    shadowRadius: 14,
    elevation: 6,
  },
  photoWrapper: {
    position: 'relative',
    aspectRatio: 4 / 5,
    backgroundColor: '#d9d9d9',
  },
  photo: {
    width: '100%',
    height: '100%',
  },
  photoPlaceholder: {
    width: '100%',
    height: '100%',
    alignItems: 'center',
    justifyContent: 'center',
    gap: 8,
  },
  photoPlaceholderText: {
    fontSize: 13,
    fontWeight: '600',
  },
  photoOverlay: {
    position: 'absolute',
    left: 16,
    right: 16,
    bottom: 16,
    paddingVertical: 8,
    paddingHorizontal: 12,
    borderRadius: 12,
    backgroundColor: 'rgba(0,0,0,0.35)',
  },
  name: {
    color: '#fff',
    fontSize: 22,
    fontWeight: '700',
  },
  location: {
    color: '#f7f7f7',
    marginTop: 4,
    fontSize: 14,
  },
  statusDot: {
    position: 'absolute',
    top: 12,
    right: 12,
    width: 12,
    height: 12,
    borderRadius: 6,
    backgroundColor: '#34d399',
    borderWidth: 2,
    borderColor: 'rgba(255,255,255,0.7)',
    zIndex: 2,
  },
  distancePill: {
    position: 'absolute',
    top: 12,
    left: 12,
    zIndex: 2,
    flexDirection: 'row',
    alignItems: 'center',
    gap: 6,
    paddingHorizontal: 12,
    paddingVertical: 6,
    borderRadius: 999,
    borderWidth: 1,
    borderColor: 'rgba(255,255,255,0.4)',
  },
  distanceText: {
    color: '#fff',
    fontWeight: '700',
    fontSize: 12,
    letterSpacing: 0.2,
  },
  body: {
    paddingHorizontal: 16,
    paddingTop: 14,
    paddingBottom: 16,
    gap: 10,
  },
  metaRow: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 8,
  },
  job: {
    fontSize: 15,
    fontWeight: '700',
  },
  bio: {
    fontSize: 15,
    lineHeight: 20,
  },
  tagsRow: {
    flexDirection: 'row',
    flexWrap: 'wrap',
    gap: 8,
  },
  tag: {
    borderWidth: 1,
    paddingHorizontal: 10,
    paddingVertical: 6,
    borderRadius: 999,
    shadowColor: '#000',
    shadowOpacity: 0.06,
    shadowOffset: { width: 0, height: 4 },
    shadowRadius: 6,
    elevation: 2,
  },
  tagText: {
    fontSize: 13,
    fontWeight: '600',
  },
  actionsRow: {
    flexDirection: 'row',
    gap: 12,
    marginTop: 4,
  },
  actionButton: {
    flex: 1,
    paddingVertical: 12,
    borderRadius: 12,
    alignItems: 'center',
    justifyContent: 'center',
    flexDirection: 'row',
    gap: 6,
  },
  passButton: {
    borderWidth: 1,
  },
  likeButton: {
  },
  actionText: {
    fontSize: 15,
    fontWeight: '700',
  },
  likeText: {
    color: '#fff',
  },
});
