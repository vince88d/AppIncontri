import Ionicons from '@expo/vector-icons/Ionicons';
import {
  addDoc,
  collection,
  deleteDoc,
  doc,
  limit,
  onSnapshot,
  orderBy,
  query,
  serverTimestamp,
  setDoc,
} from 'firebase/firestore';
import { httpsCallable } from 'firebase/functions';
import { useEffect, useMemo, useRef, useState } from 'react';
import {
  ActivityIndicator,
  KeyboardAvoidingView,
  FlatList,
  Platform,
  Pressable,
  StyleSheet,
  Text,
  TextInput,
  View,
} from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';
import { useLocalSearchParams, router } from 'expo-router';
import { Track } from 'livekit-client';

import { useAuth } from '@/hooks/use-auth';
import { useProfile } from '@/hooks/use-profile';
import { db, functions } from '@/lib/firebase';

if (Platform.OS === 'web') {
  require('@livekit/components-styles');
}

type LiveKitTokenResponse = {
  token: string;
  url?: string;
};

type LiveRoomProps = {
  token: string;
  liveUrl: string;
  isHost: boolean;
};

type LiveRoomNativeContentProps = {
  livekit: any;
};

type LiveMessage = {
  id: string;
  text: string;
  senderId: string;
  senderName?: string;
  createdAt?: { toDate?: () => Date } | Date;
};

function LiveRoomWeb({ token, liveUrl, isHost }: LiveRoomProps) {
  const livekit = useMemo(() => {
    if (Platform.OS !== 'web') return null;
    return require('@livekit/components-react');
  }, []);

  if (!livekit) {
    return (
      <View style={styles.empty}>
        <Text style={styles.emptyText}>Live non disponibile.</Text>
      </View>
    );
  }

  const LiveKitRoom = livekit.LiveKitRoom;
  const VideoConference = livekit.VideoConference;
  const RoomAudioRenderer = livekit.RoomAudioRenderer;

  return (
    <LiveKitRoom
      token={token}
      serverUrl={liveUrl}
      connect
      video={isHost}
      audio={isHost}
      data-lk-theme="default"
      style={styles.liveRoom}
    >
      <RoomAudioRenderer />
      <VideoConference />
    </LiveKitRoom>
  );
}

function LiveRoomNativeContent({ livekit }: LiveRoomNativeContentProps) {
  const VideoTrack = livekit.VideoTrack;
  const useTracks = livekit.useTracks;

  const tracks = useTracks([Track.Source.Camera], { onlySubscribed: false });
  const gridStyle = tracks.length > 1 ? styles.nativeVideoGrid : styles.nativeVideoFull;

  return (
    <View style={styles.nativeGrid}>
      {tracks.length === 0 ? (
        <View style={styles.empty}>
          <Text style={styles.emptyText}>In attesa della live...</Text>
        </View>
      ) : (
        tracks.map((track: any) => (
          <View
            key={`${track.participant?.identity}-${track.publication?.trackSid ?? track.source}`}
            style={gridStyle}
          >
            <VideoTrack
              trackRef={track}
              style={styles.nativeVideo}
              objectFit="cover"
              mirror={!!track.participant?.isLocal}
            />
          </View>
        ))
      )}
    </View>
  );
}

function LiveRoomNative({ token, liveUrl, isHost }: LiveRoomProps) {
  const livekit = useMemo(() => {
    if (Platform.OS === 'web') return null;
    try {
      return require('@livekit/react-native');
    } catch {
      return null;
    }
  }, []);

  useEffect(() => {
    if (!livekit?.AudioSession) return;
    livekit.AudioSession.startAudioSession().catch(() => {});
    return () => {
      livekit.AudioSession.stopAudioSession().catch(() => {});
    };
  }, [livekit]);

  if (!livekit) {
    return (
      <View style={styles.empty}>
        <Text style={styles.emptyText}>Live non disponibile su questa build.</Text>
        <Text style={styles.emptyTextSmall}>Crea una dev build con i moduli LiveKit.</Text>
      </View>
    );
  }

  const LiveKitRoom = livekit.LiveKitRoom;

  return (
    <LiveKitRoom token={token} serverUrl={liveUrl} connect audio={isHost} video={isHost}>
      <LiveRoomNativeContent livekit={livekit} />
    </LiveKitRoom>
  );
}

export default function GroupLiveScreen() {
  const { id: groupIdParam, title, host, hostId } = useLocalSearchParams<{
    id: string;
    title?: string;
    host?: string;
    hostId?: string;
  }>();
  const groupId = groupIdParam ? String(groupIdParam) : '';
  const groupTitle = title || 'Live di gruppo';
  const isHost = host === '1';

  const { user } = useAuth();
  const { profile } = useProfile(user?.uid);
  const targetHostId = useMemo(() => {
    if (isHost) return user?.uid ? String(user.uid) : '';
    return hostId ? String(hostId) : '';
  }, [isHost, hostId, user?.uid]);

  const [token, setToken] = useState<string | null>(null);
  const [liveUrl, setLiveUrl] = useState<string | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [chatInput, setChatInput] = useState('');
  const [sending, setSending] = useState(false);
  const [liveMessages, setLiveMessages] = useState<LiveMessage[]>([]);
  const [chatOpen, setChatOpen] = useState(true);
  const [liveCreatorId, setLiveCreatorId] = useState<string | null>(null);
  const [unreadCount, setUnreadCount] = useState(0);
  const stopRequested = useRef(false);
  const messagesRef = useRef<any>(null);
  const autoScrollRef = useRef(true);
  const chatOpenRef = useRef(true);
  const lastMessageIdRef = useRef<string | null>(null);
  const initializedMessagesRef = useRef(false);
  const latestMessagesRef = useRef<LiveMessage[]>([]);
  const scrollToBottom = (animated = true) => {
    messagesRef.current?.scrollToEnd?.({ animated });
  };

  const livekitUrl = process.env.EXPO_PUBLIC_LIVEKIT_URL || '';
  const getGroupLiveToken = useMemo(
    () => httpsCallable(functions, 'getGroupLiveToken'),
    []
  );
  const stopGroupLive = useMemo(
    () => httpsCallable(functions, 'stopGroupLive'),
    []
  );

  useEffect(() => {
    if (!groupId) return;
    if (!targetHostId) {
      setError('Seleziona una live per entrare.');
      setLoading(false);
      return;
    }
    let active = true;
    setLoading(true);
    setError(null);
    (async () => {
      try {
        const response = await getGroupLiveToken({
          groupId,
          role: isHost ? 'host' : 'viewer',
          hostId: targetHostId,
        });
        const data = response.data as LiveKitTokenResponse;
        if (!data?.token) {
          throw new Error('token-missing');
        }
        const url = data.url || livekitUrl;
        if (!url) {
          throw new Error('url-missing');
        }
        if (!active) return;
        setToken(data.token);
        setLiveUrl(url);
      } catch (err: any) {
        if (!active) return;
        const code = err?.code || '';
        const message =
          code === 'functions/unauthenticated'
            ? 'Devi essere loggato per vedere la live.'
            : code === 'functions/permission-denied' || err?.message?.includes('not-in-group')
            ? 'Entra nel gruppo per vedere la live.'
            : code === 'functions/failed-precondition' || err?.message?.includes('live-not-active')
            ? 'Non c\'e alcuna live attiva.'
            : code === 'functions/not-found'
            ? 'Funzione live non trovata. Hai fatto il deploy?'
            : err?.message?.includes('livekit-config-missing')
            ? 'Config LiveKit mancante.'
            : 'Non sono riuscito a collegarmi alla live.';
        setError(message);
      } finally {
        if (active) setLoading(false);
      }
    })();
    return () => {
      active = false;
    };
  }, [groupId, isHost, targetHostId, getGroupLiveToken, livekitUrl]);

  useEffect(() => {
    if (!groupId || !targetHostId) {
      setLiveCreatorId(null);
      return;
    }
    setLiveCreatorId(targetHostId);
    const ref = doc(db, 'groupRooms', groupId, 'lives', targetHostId);
    const unsub = onSnapshot(ref, (snap) => {
      if (!snap.exists()) {
        setLiveCreatorId(null);
        return;
      }
      const data = snap.data() as any;
      setLiveCreatorId(data.creatorId || data.hostId || targetHostId);
    });
    return unsub;
  }, [groupId, targetHostId]);

  useEffect(() => {
    if (!groupId || !targetHostId) {
      setLiveMessages([]);
      return;
    }
    const q = query(
      collection(db, 'groupRooms', groupId, 'lives', targetHostId, 'messages'),
      orderBy('createdAt', 'asc'),
      limit(100)
    );
    const unsub = onSnapshot(q, (snap) => {
      const items = snap.docs.map((d) => ({ id: d.id, ...(d.data() as any) }));
      latestMessagesRef.current = items;
      setLiveMessages(items);
      if (items.length && autoScrollRef.current) {
        requestAnimationFrame(() => scrollToBottom(false));
      }
      if (!items.length) {
        if (!initializedMessagesRef.current) {
          initializedMessagesRef.current = true;
        }
        lastMessageIdRef.current = null;
        return;
      }
      const lastId = items[items.length - 1]?.id ?? null;
      if (!initializedMessagesRef.current) {
        initializedMessagesRef.current = true;
        lastMessageIdRef.current = lastId;
        return;
      }
      if (chatOpenRef.current) {
        lastMessageIdRef.current = lastId;
        return;
      }
      const prevId = lastMessageIdRef.current;
      if (!prevId) {
        lastMessageIdRef.current = lastId;
        return;
      }
      const prevIndex = items.findIndex((item) => item.id === prevId);
      const newCount = prevIndex === -1 ? items.length : items.length - prevIndex - 1;
      if (newCount > 0) {
        setUnreadCount((prev) => prev + newCount);
        lastMessageIdRef.current = lastId;
      }
    });
    return unsub;
  }, [groupId, targetHostId]);

  useEffect(() => {
    chatOpenRef.current = chatOpen;
    const lastId = latestMessagesRef.current.length
      ? latestMessagesRef.current[latestMessagesRef.current.length - 1].id
      : null;
    lastMessageIdRef.current = lastId;
    if (chatOpen) {
      setUnreadCount(0);
    }
    if (!chatOpen) {
      setUnreadCount(0);
    }
  }, [chatOpen]);

  useEffect(() => {
    if (!chatOpen || !liveMessages.length) return;
    if (!autoScrollRef.current) return;
    requestAnimationFrame(() => scrollToBottom(false));
    const timeoutId = setTimeout(() => scrollToBottom(false), 50);
    return () => clearTimeout(timeoutId);
  }, [chatOpen, liveMessages.length]);

  useEffect(() => {
    if (!groupId || !user?.uid || !isHost) return;
    const presenceRef = doc(db, 'groupRooms', groupId, 'livePresence', user.uid);
    let active = true;
    const touchPresence = async () => {
      if (!active) return;
      const name = profile?.name || user.displayName || 'Utente';
      const photo = profile?.photo || user.photoURL || '';
      try {
        await setDoc(
          presenceRef,
          { activeAt: serverTimestamp(), name, photo, role: 'host' },
          { merge: true }
        );
      } catch {
        // best effort
      }
    };
    void touchPresence();
    const intervalId = setInterval(touchPresence, 60 * 1000);
    return () => {
      active = false;
      clearInterval(intervalId);
      deleteDoc(presenceRef).catch(() => {});
    };
  }, [groupId, user?.uid, profile?.name, user?.displayName, profile?.photo, user?.photoURL, isHost]);

  useEffect(() => {
    return () => {
      if (!isHost || stopRequested.current || !groupId) return;
      stopRequested.current = true;
      stopGroupLive({ groupId }).catch(() => {});
    };
  }, [groupId, isHost, stopGroupLive]);

  const handleSend = async () => {
    if (!groupId || !user?.uid || !targetHostId) return;
    const trimmed = chatInput.trim();
    if (!trimmed || sending) return;
    setSending(true);
    setChatInput('');
    const senderName = profile?.name || user.displayName || 'Tu';
    try {
      await setDoc(
        doc(db, 'groupRooms', groupId),
        {
          updatedAt: serverTimestamp(),
          liveUpdatedAt: serverTimestamp(),
        },
        { merge: true }
      );
      await addDoc(
        collection(db, 'groupRooms', groupId, 'lives', targetHostId, 'messages'),
        {
        text: trimmed,
        senderId: user.uid,
        senderName,
        createdAt: serverTimestamp(),
        }
      );
    } catch {
      setChatInput(trimmed);
    } finally {
      setSending(false);
    }
  };

  return (
    <SafeAreaView style={styles.screen}>
      <View style={styles.header}>
        <Pressable style={styles.headerButton} onPress={() => router.back()}>
          <Ionicons name="chevron-back" size={22} color="#1f1f1f" />
        </Pressable>
        <View style={styles.headerText}>
          <Text style={styles.headerTitle}>{groupTitle}</Text>
          <Text style={styles.headerSubtitle}>{isHost ? 'Sei in diretta' : 'Live del gruppo'}</Text>
        </View>
        {isHost ? (
          <Pressable
            style={({ pressed }) => [
              styles.endButton,
              { backgroundColor: '#ff3b30' },
              pressed ? styles.endButtonPressed : null,
            ]}
            onPress={async () => {
              if (!groupId || stopRequested.current) return;
              stopRequested.current = true;
              try {
                await stopGroupLive({ groupId });
              } finally {
                router.back();
              }
            }}
          >
            <Text style={styles.endButtonText}>Esci</Text>
          </Pressable>
        ) : (
          <View style={styles.headerButton} />
        )}
      </View>

      <KeyboardAvoidingView
        style={styles.liveBody}
        behavior={Platform.OS === 'ios' ? 'padding' : 'height'}
        keyboardVerticalOffset={Platform.OS === 'ios' ? 90 : 0}
      >
        <View style={styles.liveStage} pointerEvents="box-none">
          {loading ? (
            <ActivityIndicator size="large" color="#999" />
          ) : error ? (
            <View style={styles.empty}>
              <Text style={styles.emptyText}>{error}</Text>
              <Pressable style={styles.secondaryButton} onPress={() => router.back()}>
                <Text style={styles.secondaryButtonText}>Torna alla chat</Text>
              </Pressable>
            </View>
          ) : token && liveUrl ? (
            Platform.OS === 'web' ? (
              <LiveRoomWeb token={token} liveUrl={liveUrl} isHost={isHost} />
            ) : (
              <LiveRoomNative token={token} liveUrl={liveUrl} isHost={isHost} />
            )
          ) : (
            <View style={styles.empty}>
              <Text style={styles.emptyText}>Live non disponibile.</Text>
            </View>
          )}
          {chatOpen && liveMessages.length ? (
            <View style={styles.liveOverlay} pointerEvents="auto">
              <View style={styles.liveOverlayHeader}>
                <Text style={styles.liveOverlayTitle}>Chat live</Text>
                <Pressable
                  style={styles.liveOverlayClose}
                  onPress={() => setChatOpen(false)}
                >
                  <Ionicons name="chevron-down" size={16} color="#fff" />
                </Pressable>
              </View>
              <View style={styles.liveOverlayBody}>
                <FlatList
                  ref={messagesRef}
                  data={liveMessages}
                  keyExtractor={(item) => item.id}
                  renderItem={({ item }) => {
                    const isCreator = !!liveCreatorId && item.senderId === liveCreatorId;
                    return (
                      <View style={styles.liveMessageRow}>
                        <Text
                          style={[
                            styles.liveMessageName,
                            isCreator ? styles.liveMessageNameCreator : null,
                          ]}
                          numberOfLines={1}
                        >
                          {item.senderName || 'Utente'}
                          {isCreator ? (
                            <Text style={styles.liveMessageCreatorTag}> (creator)</Text>
                          ) : null}
                        </Text>
                        <Text style={styles.liveMessageText}>{item.text}</Text>
                      </View>
                    );
                  }}
                  contentContainerStyle={styles.liveMessagesList}
                  style={styles.liveMessagesBody}
                  showsVerticalScrollIndicator={false}
                  onContentSizeChange={() => {
                    if (autoScrollRef.current) scrollToBottom(false);
                  }}
                  onLayout={() => {
                    if (autoScrollRef.current) scrollToBottom(false);
                  }}
                  onScroll={(event) => {
                    const { contentOffset, contentSize, layoutMeasurement } = event.nativeEvent;
                    const distanceFromBottom =
                      contentSize.height - (contentOffset.y + layoutMeasurement.height);
                    autoScrollRef.current = distanceFromBottom <= 40;
                  }}
                  scrollEventThrottle={16}
                />
              </View>
            </View>
          ) : null}
          {!chatOpen && liveMessages.length ? (
            <Pressable style={styles.chatToggle} onPress={() => setChatOpen(true)}>
              <Ionicons name="chatbubbles" size={16} color="#fff" />
              <Text style={styles.chatToggleText}>Mostra chat</Text>
              {unreadCount > 0 ? (
                <View style={styles.chatToggleBadge}>
                  <Text style={styles.chatToggleBadgeText}>
                    {unreadCount > 99 ? '99+' : unreadCount}
                  </Text>
                </View>
              ) : null}
            </Pressable>
          ) : null}
        </View>
        <View style={styles.chatBar}>
          <TextInput
            value={chatInput}
            onChangeText={setChatInput}
            placeholder="Scrivi un messaggio..."
            placeholderTextColor="#a6a6a6"
            style={styles.chatInput}
            editable={!sending}
            multiline={false}
            returnKeyType="send"
            onSubmitEditing={handleSend}
          />
          <Pressable
            style={[styles.chatSendButton, chatInput.trim() ? styles.chatSendActive : null]}
            onPress={handleSend}
            disabled={sending || !chatInput.trim()}
          >
            <Ionicons
              name="send"
              size={16}
              color={chatInput.trim() ? '#fff' : '#b0b0b0'}
            />
          </Pressable>
        </View>
      </KeyboardAvoidingView>
    </SafeAreaView>
  );
}

const styles = StyleSheet.create({
  screen: {
    flex: 1,
    backgroundColor: '#f7f7f7',
  },
  header: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 12,
    paddingHorizontal: 16,
    paddingVertical: 12,
    borderBottomWidth: 1,
    borderBottomColor: '#e5e5e5',
    backgroundColor: '#fff',
  },
  headerButton: {
    width: 40,
    height: 40,
    borderRadius: 12,
    alignItems: 'center',
    justifyContent: 'center',
    borderWidth: 1,
    borderColor: '#e5e5e5',
    backgroundColor: '#fff',
  },
  headerText: {
    flex: 1,
  },
  headerTitle: {
    fontSize: 16,
    fontWeight: '700',
    color: '#1f1f1f',
  },
  headerSubtitle: {
    marginTop: 2,
    fontSize: 12,
    fontWeight: '600',
    color: '#8b8b8b',
  },
  endButton: {
    paddingHorizontal: 14,
    paddingVertical: 8,
    borderRadius: 999,
  },
  endButtonPressed: {
    opacity: 0.7,
  },
  endButtonText: {
    color: '#fff',
    fontSize: 12,
    fontWeight: '700',
  },
  liveBody: {
    flex: 1,
    backgroundColor: '#000',
  },
  liveStage: {
    flex: 1,
    position: 'relative',
  },
  liveOverlay: {
    position: 'absolute',
    left: 12,
    right: 12,
    bottom: 16,
    height: 220,
    maxHeight: 240,
    minHeight: 160,
    borderRadius: 14,
    overflow: 'hidden',
    backgroundColor: 'rgba(0,0,0,0.45)',
    borderWidth: 1,
    borderColor: 'rgba(255,255,255,0.12)',
  },
  liveOverlayHeader: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    paddingHorizontal: 12,
    paddingVertical: 8,
    borderBottomWidth: 1,
    borderBottomColor: 'rgba(255,255,255,0.12)',
  },
  liveOverlayClose: {
    width: 28,
    height: 28,
    borderRadius: 14,
    alignItems: 'center',
    justifyContent: 'center',
    backgroundColor: 'rgba(255,255,255,0.08)',
  },
  liveOverlayTitle: {
    fontSize: 12,
    fontWeight: '700',
    letterSpacing: 0.4,
    textTransform: 'uppercase',
    color: '#fff',
  },
  liveOverlayBody: {
    flex: 1,
    paddingHorizontal: 12,
    paddingVertical: 8,
  },
  liveMessagesBody: {
    flex: 1,
  },
  liveMessagesList: {
    gap: 10,
    paddingBottom: 36,
  },
  liveMessageRow: {
    gap: 3,
  },
  liveMessageName: {
    fontSize: 12,
    fontWeight: '700',
    color: '#9fd9ff',
  },
  liveMessageNameCreator: {
    color: '#ffd166',
  },
  liveMessageCreatorTag: {
    fontSize: 11,
    fontWeight: '600',
    color: '#ffd166',
  },
  liveMessageText: {
    fontSize: 14,
    lineHeight: 20,
    fontWeight: '400',
    color: '#fff',
  },
  chatBar: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 10,
    paddingHorizontal: 14,
    paddingVertical: 10,
    borderTopWidth: 1,
    borderTopColor: 'rgba(255,255,255,0.12)',
    backgroundColor: 'rgba(0,0,0,0.7)',
  },
  chatInput: {
    flex: 1,
    height: 40,
    borderRadius: 12,
    borderWidth: 1,
    borderColor: 'rgba(255,255,255,0.2)',
    paddingHorizontal: 12,
    color: '#fff',
    backgroundColor: 'rgba(255,255,255,0.08)',
    fontSize: 14,
  },
  chatSendButton: {
    width: 40,
    height: 40,
    borderRadius: 12,
    alignItems: 'center',
    justifyContent: 'center',
    borderWidth: 1,
    borderColor: 'rgba(255,255,255,0.2)',
    backgroundColor: 'rgba(255,255,255,0.08)',
  },
  chatSendActive: {
    backgroundColor: '#ff3b30',
    borderColor: '#ff3b30',
  },
  chatToggle: {
    position: 'absolute',
    right: 12,
    bottom: 16,
    flexDirection: 'row',
    alignItems: 'center',
    gap: 8,
    paddingHorizontal: 12,
    paddingVertical: 8,
    borderRadius: 999,
    backgroundColor: 'rgba(0,0,0,0.6)',
    borderWidth: 1,
    borderColor: 'rgba(255,255,255,0.12)',
  },
  chatToggleText: {
    fontSize: 12,
    fontWeight: '700',
    color: '#fff',
  },
  chatToggleBadge: {
    minWidth: 18,
    height: 18,
    borderRadius: 9,
    paddingHorizontal: 4,
    alignItems: 'center',
    justifyContent: 'center',
    backgroundColor: '#ff3b30',
  },
  chatToggleBadgeText: {
    fontSize: 10,
    fontWeight: '700',
    color: '#fff',
  },
  liveRoom: {
    height: '100%',
    width: '100%',
  },
  nativeGrid: {
    flex: 1,
    padding: 12,
    gap: 12,
  },
  nativeVideoFull: {
    flex: 1,
    borderRadius: 16,
    overflow: 'hidden',
  },
  nativeVideoGrid: {
    height: 220,
    borderRadius: 16,
    overflow: 'hidden',
  },
  nativeVideo: {
    width: '100%',
    height: '100%',
  },
  empty: {
    flex: 1,
    alignItems: 'center',
    justifyContent: 'center',
    padding: 24,
    gap: 12,
  },
  emptyText: {
    fontSize: 14,
    fontWeight: '600',
    color: '#666',
    textAlign: 'center',
  },
  emptyTextSmall: {
    fontSize: 12,
    fontWeight: '600',
    color: '#8b8b8b',
    textAlign: 'center',
  },
  secondaryButton: {
    borderWidth: 1,
    borderColor: '#ddd',
    paddingHorizontal: 16,
    paddingVertical: 10,
    borderRadius: 10,
    backgroundColor: '#fff',
  },
  secondaryButtonText: {
    fontSize: 13,
    fontWeight: '700',
    color: '#333',
  },
});
