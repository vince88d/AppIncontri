import Ionicons from '@expo/vector-icons/Ionicons';
import { Audio } from 'expo-av';
import { Image } from 'expo-image';
import React from 'react';
import {
  ActivityIndicator,
  Animated,
  Linking,
  Platform,
  Pressable,
  StyleSheet,
  Text,
  View,
} from 'react-native';
import { Timestamp } from 'firebase/firestore';

// Types
type ChatMessage = {
  id: string;
  text?: string;
  senderId: string;
  createdAt?: Timestamp | Date;
  image?: string;
  imagePath?: string;
  moderationStatus?: 'pending' | 'ok' | 'flagged';
  contentWarning?: 'nudity' | null;
  audio?: string;
  audioDuration?: number;
  expiresAfterView?: boolean;
  expiresAt?: Timestamp | Date;
  location?: {
    lat: number;
    lng: number;
  };
};

type TranslationEntry = {
  text: string | null;
  target: string;
};

type ChatMessageItemProps = {
  item: ChatMessage;
  isMine: boolean;
  chatMeta: any;
  otherId: string;
  palette: any;
  translations: Record<string, TranslationEntry | undefined>;
  translatingMap: Record<string, boolean>;
  fadingMap: Record<string, boolean>;
  showParticles: Record<string, boolean>;
  fadeValuesRef: React.MutableRefObject<Record<string, Animated.Value>>;
  scaleValuesRef: React.MutableRefObject<Record<string, Animated.Value>>;
  playbackStatus: Audio.AVPlaybackStatus | null;
  playingId: string | null;
  expiryStartedRef: React.MutableRefObject<Set<string>>;
  formatTime: (timestamp: any) => string;
  getTargetLangForMessage: (message: ChatMessage) => string;
  handlePlayAudio: (item: ChatMessage) => void;
  handleOpenImageMessage: (message: ChatMessage) => void;
  translateAllEnabled: boolean;
  revealedWarnings: Record<string, boolean>;
  ParticleEffect: React.ComponentType<{ visible: boolean; color: string }>;
};

const formatAudioDuration = (ms?: number) => {
  if (ms === undefined || ms === null) return '0:00';
  const totalSeconds = Math.max(0, Math.floor(ms / 1000));
  const minutes = Math.floor(totalSeconds / 60);
  const seconds = totalSeconds % 60;
  return `${minutes}:${seconds.toString().padStart(2, '0')}`;
};

export const ChatMessageItem: React.FC<ChatMessageItemProps> = ({
  item,
  isMine,
  chatMeta,
  otherId,
  palette,
  translations,
  translatingMap,
  fadingMap,
  showParticles,
  fadeValuesRef,
  scaleValuesRef,
  playbackStatus,
  playingId,
  expiryStartedRef,
  formatTime,
  getTargetLangForMessage,
  handlePlayAudio,
  handleOpenImageMessage,
  translateAllEnabled,
  revealedWarnings,
  ParticleEffect,
}) => {
  const time = formatTime(item.createdAt);
  const isPendingImage = isMine && item.image && item.id.startsWith('local-img-');
  const isPendingAudio = isMine && item.audio && item.id.startsWith('local-audio-');
  const isPendingLocation = isMine && item.location && item.id.startsWith('local-location-');
  const loadedPlayback = playbackStatus && playbackStatus.isLoaded ? playbackStatus : null;
  const isPlayingThis = playingId === item.id && !!loadedPlayback;
  const progress =
    isPlayingThis && loadedPlayback?.durationMillis
      ? (loadedPlayback.positionMillis ?? 0) / loadedPlayback.durationMillis
      : 0;
  const isEphemeral = !!item.expiresAfterView;
  const isEphemeralImage = isEphemeral && !!item.image;
  const isLockedImage =
    isEphemeralImage && !item.expiresAt && !expiryStartedRef.current.has(item.id);
  const isModerationPending =
    item.moderationStatus === 'pending' || (!!item.imagePath && !item.moderationStatus && !isMine);
  const isFlagged = item.moderationStatus === 'flagged' && item.contentWarning === 'nudity';
  const isModerationHidden = isModerationPending || (isFlagged && !revealedWarnings[item.id]);
  const isFading = !!fadingMap[item.id];
  const createdAtMs =
    item.createdAt instanceof Date
      ? item.createdAt.getTime()
      : (item.createdAt as any)?.toDate
      ? (item.createdAt as any).toDate().getTime()
      : 0;
  const otherReadMs =
    chatMeta?.readBy?.[otherId]?.toDate?.()
      ? chatMeta.readBy[otherId].toDate().getTime()
      : chatMeta?.readBy?.[otherId] instanceof Date
      ? (chatMeta.readBy[otherId] as Date).getTime()
      : 0;
  const isReadByOther = isMine && createdAtMs && otherReadMs && otherReadMs >= createdAtMs;
  const isSendingLocal = isMine && item.id.startsWith('local-');
  const statusColor = isMine ? 'rgba(255,255,255,0.7)' : palette.muted;
  const statusIconColor = isReadByOther ? palette.accent : statusColor;
  const translation = translations[item.id];
  const desiredTarget = getTargetLangForMessage(item);
  const translatedText =
    translation && translation.target === desiredTarget ? translation.text : undefined;
  const translating = translatingMap[item.id];
  const showParticleEffect = !!showParticles[item.id];
  const displayText =
    translateAllEnabled && translatedText !== undefined
      ? translatedText || item.text || ''
      : item.text || '';
  const showTranslating = translateAllEnabled && translating && translatedText === undefined;

  const fadeAnim = fadeValuesRef.current[item.id];
  const scaleAnim = scaleValuesRef.current[item.id];

  const crumbleStyle =
    fadeAnim && scaleAnim
      ? {
          opacity: fadeAnim,
          transform: [
            { scale: scaleAnim },
            {
              translateX: fadeAnim.interpolate({
                inputRange: [0, 1],
                outputRange: [isMine ? 10 : -10, 0],
              }),
            },
          ],
        }
      : undefined;

  if (item.location) {
    return (
      <View style={{ position: 'relative' }}>
        <Animated.View
          style={[
            styles.messageRow,
            isMine ? styles.messageRowMine : styles.messageRowOther,
            crumbleStyle,
          ]}
          pointerEvents={isFading ? 'none' : 'auto'}
        >
          <Pressable
            style={[
              styles.locationMessage,
              {
                borderColor: isMine ? palette.tint : palette.border,
                backgroundColor: isMine ? `${palette.tint}20` : palette.card,
              },
            ]}
            onPress={() => {
              const { lat, lng } = item.location!;
              const url = Platform.select({
                ios: `http://maps.apple.com/?ll=${lat},${lng}`,
                android: `geo:${lat},${lng}`,
                default: `https://www.google.com/maps?q=${lat},${lng}`,
              });
              if (url) Linking.openURL(url).catch(() => {});
            }}
          >
            <View style={styles.locationRow}>
              <View style={[styles.locationIcon, { backgroundColor: `${palette.tint}18` }]}>
                <Ionicons name="location" size={16} color={palette.tint} />
              </View>
              <Text style={[styles.locationText, { color: isMine ? '#fff' : palette.text }]}>
                Posizione
              </Text>
              {isPendingLocation ? (
                <ActivityIndicator size="small" color={isMine ? '#fff' : palette.text} />
              ) : (
                <Ionicons name="chevron-forward" size={16} color={isMine ? '#fff' : palette.muted} />
              )}
            </View>
            <View style={styles.statusRow}>
              <Text style={[styles.timeInside, { color: statusColor }]}>{time}</Text>
              {isMine && !isSendingLocal ? (
                <Ionicons
                  name={isReadByOther ? 'checkmark-done' : 'checkmark'}
                  size={16}
                  color={statusIconColor}
                  style={styles.statusIcon}
                />
              ) : null}
            </View>
            {isEphemeral ? (
              <View
                style={[
                  styles.ephemeralRow,
                  {
                    borderColor: isMine ? 'rgba(255,255,255,0.3)' : palette.border,
                    marginTop: 6,
                  },
                ]}
              >
                <Ionicons
                  name="timer-outline"
                  size={14}
                  color={isMine ? 'rgba(255,255,255,0.85)' : palette.muted}
                />
                <Text
                  style={[
                    styles.ephemeralText,
                    { color: isMine ? 'rgba(255,255,255,0.85)' : palette.muted },
                  ]}
                >
                  Messaggio a tempo
                </Text>
              </View>
            ) : null}
          </Pressable>
        </Animated.View>

        {showParticleEffect && (
          <ParticleEffect visible={showParticleEffect} color={isMine ? palette.tint : palette.border} />
        )}
      </View>
    );
  }

  if (item.audio) {
    return (
      <View style={{ position: 'relative' }}>
        <Animated.View
          style={[
            styles.messageRow,
            isMine ? styles.messageRowMine : styles.messageRowOther,
            crumbleStyle,
          ]}
          pointerEvents={isFading ? 'none' : 'auto'}
        >
          <Pressable
            style={[
              styles.audioMessage,
              {
                borderColor: isMine ? palette.tint : palette.border,
                backgroundColor: isMine ? `${palette.tint}20` : palette.card,
              },
            ]}
            onPress={() => handlePlayAudio(item)}
          >
            <View style={[styles.audioIcon, { backgroundColor: `${palette.tint}18` }]}>
              {isPendingAudio ? (
                <ActivityIndicator size="small" color={palette.tint} />
              ) : (
                <Ionicons
                  name={isPlayingThis && loadedPlayback?.isPlaying ? 'pause' : 'play'}
                  size={16}
                  color={palette.tint}
                />
              )}
            </View>

            <View style={styles.audioContent}>
              <View style={styles.audioProgressRow}>
                <View
                  style={[
                    styles.audioProgressBar,
                    { backgroundColor: isMine ? 'rgba(255,255,255,0.25)' : palette.border },
                  ]}
                >
                  <View
                    style={[
                      styles.audioProgressFill,
                      {
                        width: `${Math.min(100, Math.max(0, progress * 100))}%`,
                        backgroundColor: palette.tint,
                      },
                    ]}
                  />
                </View>
                <Text
                  style={[
                    styles.audioDuration,
                    { color: isMine ? 'rgba(255,255,255,0.8)' : palette.muted },
                  ]}
                >
                  {isPlayingThis && loadedPlayback?.durationMillis
                    ? formatAudioDuration(loadedPlayback.positionMillis ?? loadedPlayback.durationMillis)
                    : formatAudioDuration(item.audioDuration)}
                </Text>
              </View>

              <View style={styles.audioMetaRow}>
                <Text style={[styles.audioLabel, { color: isMine ? '#fff' : palette.text }]}>
                  Audio
                </Text>
                <View style={styles.statusRow}>
                  <Text style={[styles.timeInside, { color: statusColor }]}>{time}</Text>
                  {isMine && !isSendingLocal ? (
                    <Ionicons
                      name={isReadByOther ? 'checkmark-done' : 'checkmark'}
                      size={16}
                      color={statusIconColor}
                      style={styles.statusIcon}
                    />
                  ) : null}
                </View>
              </View>
            </View>

            {isEphemeral ? (
              <View
                style={[
                  styles.ephemeralRow,
                  {
                    borderColor: isMine ? 'rgba(255,255,255,0.25)' : palette.border,
                    marginTop: 6,
                  },
                ]}
              >
                <Ionicons
                  name="timer-outline"
                  size={14}
                  color={isMine ? 'rgba(255,255,255,0.85)' : palette.muted}
                />
                <Text
                  style={[
                    styles.ephemeralText,
                    { color: isMine ? 'rgba(255,255,255,0.85)' : palette.muted },
                  ]}
                >
                  Messaggio a tempo
                </Text>
              </View>
            ) : null}
          </Pressable>
        </Animated.View>

        {showParticleEffect && (
          <ParticleEffect visible={showParticleEffect} color={isMine ? palette.tint : palette.border} />
        )}
      </View>
    );
  }

  return (
    <View style={{ position: 'relative' }}>
      <Animated.View
        style={[
          styles.messageRow,
          isMine ? styles.messageRowMine : styles.messageRowOther,
          crumbleStyle,
        ]}
        pointerEvents={isFading ? 'none' : 'auto'}
      >
        <View
          style={[
            styles.bubble,
            isMine ? styles.bubbleMine : styles.bubbleOther,
            {
              backgroundColor: isMine ? palette.tint : palette.card,
              borderColor: isMine ? palette.tint : palette.border,
            },
          ]}
        >
          {item.image ? (
            <Pressable
              style={styles.imageWrapper}
              onPress={() => handleOpenImageMessage(item)}
              disabled={isPendingImage}
            >
              <Image
                source={{ uri: item.image }}
                style={[styles.chatImage, isLockedImage && styles.chatImageLocked]}
                contentFit="cover"
                cachePolicy="memory-disk"
                blurRadius={isLockedImage || isModerationHidden ? 20 : 0}
              />
              {isModerationPending ? (
                <View style={styles.moderationOverlay}>
                  <View style={styles.moderationBadge}>
                    <Ionicons name="time-outline" size={18} color="#fff" />
                  </View>
                  <Text style={styles.moderationText}>Analisi in corso</Text>
                  <Text style={styles.moderationSubText}>Riprova tra poco</Text>
                </View>
              ) : isFlagged && !revealedWarnings[item.id] ? (
                <View style={styles.moderationOverlay}>
                  <View style={styles.moderationBadge}>
                    <Ionicons name="warning-outline" size={18} color="#fff" />
                  </View>
                  <Text style={styles.moderationText}>Contenuto sensibile</Text>
                  <Text style={styles.moderationSubText}>Tocca per mostrare</Text>
                </View>
              ) : isLockedImage ? (
                <View style={styles.imageLockOverlay}>
                  <View style={styles.imageLockBadge}>
                    <Ionicons name="eye-off-outline" size={18} color="#fff" />
                  </View>
                  <Text style={styles.imageLockText}>Foto a tempo - tocca per aprire</Text>
                </View>
              ) : null}
              {isPendingImage && (
                <View style={styles.pendingOverlay}>
                  <ActivityIndicator size="small" color="#fff" />
                </View>
              )}
            </Pressable>
          ) : null}

          {isEphemeral ? (
            <View
              style={[
                styles.ephemeralRow,
                { borderColor: isMine ? 'rgba(255,255,255,0.25)' : palette.border },
              ]}
            >
              <Ionicons name="timer-outline" size={14} color={isMine ? '#fff' : palette.muted} />
              <Text
                style={[
                  styles.ephemeralText,
                  { color: isMine ? 'rgba(255,255,255,0.85)' : palette.muted },
                ]}
              >
                Messaggio a tempo
              </Text>
            </View>
          ) : null}

          {item.text ? (
            <Text style={[styles.bubbleText, { color: isMine ? '#fff' : palette.text }]}>
              {displayText}
            </Text>
          ) : null}
          {showTranslating ? (
            <ActivityIndicator size="small" color={isMine ? '#fff' : palette.text} />
          ) : null}

          <View style={styles.statusRow}>
            <Text style={[styles.timeInside, { color: statusColor }]}>{time}</Text>
            {isMine && !isSendingLocal ? (
              <Ionicons
                name={isReadByOther ? 'checkmark-done' : 'checkmark'}
                size={16}
                color={statusIconColor}
                style={styles.statusIcon}
              />
            ) : null}
          </View>
        </View>
      </Animated.View>

      {showParticleEffect && (
        <ParticleEffect visible={showParticleEffect} color={isMine ? palette.tint : palette.border} />
      )}
    </View>
  );
};

const styles = StyleSheet.create({
  messageRow: {
    flexDirection: 'row',
    marginBottom: 4,
  },
  messageRowMine: {
    justifyContent: 'flex-end',
  },
  messageRowOther: {
    justifyContent: 'flex-start',
  },
  bubble: {
    maxWidth: '80%',
    borderRadius: 20,
    paddingHorizontal: 16,
    paddingVertical: 12,
    borderWidth: 1,
  },
  bubbleMine: {
    borderBottomRightRadius: 6,
  },
  bubbleOther: {
    borderBottomLeftRadius: 6,
  },
  bubbleText: {
    fontSize: 16,
    lineHeight: 22,
    fontWeight: '400',
  },
  timeInside: {
    fontSize: 11,
    fontWeight: '500',
    marginTop: 6,
    alignSelf: 'flex-end',
    opacity: 0.9,
  },
  statusRow: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 6,
    alignSelf: 'flex-end',
  },
  statusIcon: {
    marginLeft: 2,
  },
  ephemeralRow: {
    marginTop: 8,
    paddingHorizontal: 10,
    paddingVertical: 6,
    borderRadius: 10,
    borderWidth: 1,
    flexDirection: 'row',
    alignItems: 'center',
    gap: 6,
    alignSelf: 'flex-start',
  },
  ephemeralText: {
    fontSize: 12,
    fontWeight: '600',
  },
  imageWrapper: {
    marginVertical: 4,
    borderRadius: 16,
    overflow: 'hidden',
    position: 'relative',
  },
  chatImage: {
    width: 240,
    height: 240,
    borderRadius: 16,
  },
  chatImageLocked: {
    opacity: 0.2,
  },
  imageLockOverlay: {
    ...StyleSheet.absoluteFillObject,
    backgroundColor: 'rgba(0,0,0,0.55)',
    alignItems: 'center',
    justifyContent: 'center',
    paddingHorizontal: 12,
    gap: 10,
  },
  imageLockBadge: {
    width: 44,
    height: 44,
    borderRadius: 22,
    borderWidth: 1,
    borderColor: 'rgba(255,255,255,0.3)',
    alignItems: 'center',
    justifyContent: 'center',
    backgroundColor: 'rgba(255,255,255,0.12)',
  },
  imageLockText: {
    color: '#fff',
    fontSize: 13,
    fontWeight: '700',
    textAlign: 'center',
  },
  moderationOverlay: {
    ...StyleSheet.absoluteFillObject,
    backgroundColor: 'rgba(0,0,0,0.65)',
    alignItems: 'center',
    justifyContent: 'center',
    paddingHorizontal: 16,
    gap: 8,
  },
  moderationBadge: {
    width: 46,
    height: 46,
    borderRadius: 23,
    borderWidth: 1,
    borderColor: 'rgba(255,255,255,0.4)',
    alignItems: 'center',
    justifyContent: 'center',
    backgroundColor: 'rgba(255,255,255,0.18)',
  },
  moderationText: {
    color: '#fff',
    fontSize: 14,
    fontWeight: '700',
    textAlign: 'center',
  },
  moderationSubText: {
    color: 'rgba(255,255,255,0.8)',
    fontSize: 12,
    fontWeight: '600',
    textAlign: 'center',
  },
  locationMessage: {
    flexDirection: 'column',
    gap: 8,
    borderWidth: 1,
    borderRadius: 20,
    paddingHorizontal: 14,
    paddingVertical: 12,
    minWidth: 160,
    maxWidth: 240,
  },
  locationRow: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 10,
  },
  locationIcon: {
    width: 32,
    height: 32,
    borderRadius: 16,
    alignItems: 'center',
    justifyContent: 'center',
  },
  locationText: {
    flex: 1,
    fontSize: 15,
    fontWeight: '700',
  },
  audioMessage: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 12,
    borderWidth: 1,
    borderRadius: 20,
    paddingHorizontal: 14,
    paddingVertical: 12,
    minWidth: 200,
    maxWidth: 280,
  },
  audioIcon: {
    width: 36,
    height: 36,
    borderRadius: 18,
    alignItems: 'center',
    justifyContent: 'center',
  },
  audioContent: {
    flex: 1,
    gap: 6,
  },
  audioProgressRow: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 10,
  },
  audioProgressBar: {
    flex: 1,
    height: 3,
    borderRadius: 999,
    overflow: 'hidden',
  },
  audioProgressFill: {
    height: '100%',
    borderRadius: 999,
  },
  audioDuration: {
    fontSize: 12,
    fontWeight: '600',
    textAlign: 'right',
  },
  audioMetaRow: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    marginTop: 2,
  },
  audioLabel: {
    fontSize: 14,
    fontWeight: '700',
  },
  pendingOverlay: {
    ...StyleSheet.absoluteFillObject,
    backgroundColor: 'rgba(0,0,0,0.3)',
    alignItems: 'center',
    justifyContent: 'center',
    borderRadius: 16,
  },
});
