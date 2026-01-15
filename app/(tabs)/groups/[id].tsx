import Ionicons from '@expo/vector-icons/Ionicons';
import {
  addDoc,
  collection,
  deleteDoc,
  doc,
  getDocs,
  onSnapshot,
  orderBy,
  query,
  serverTimestamp,
  setDoc,
  where,
} from 'firebase/firestore';
import { httpsCallable } from 'firebase/functions';
import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import {
  Alert,
  BackHandler,
  ActivityIndicator,
  FlatList,
  KeyboardAvoidingView,
  Image,
  Modal,
  Pressable,
  StyleSheet,
  Text,
  TextInput,
  useColorScheme,
  View,
  Platform,
} from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';
import { useLocalSearchParams, router } from 'expo-router';

import { Colors } from '@/constants/theme';
import { useAuth } from '@/hooks/use-auth';
import { useProfile } from '@/hooks/use-profile';
import { db, functions } from '@/lib/firebase';

const PRESENCE_ACTIVE_MS = 2 * 60 * 1000;
const LIVE_PRESENCE_ACTIVE_MS = 2 * 60 * 1000;

type GroupMessage = {
  id: string;
  text: string;
  senderId: string;
  senderName?: string;
  createdAt?: { toDate?: () => Date } | Date;
};

type GroupMeta = {
  title?: string;
  subtitle?: string;
  membersCount?: number;
  owner?: string;
  live?: {
    active?: boolean;
    count?: number;
    startedAt?: any;
  };
};

type GroupParticipant = {
  id: string;
  name: string;
  photo?: string;
  activeAt?: any;
};

export default function GroupChatScreen() {
  const { id: groupIdParam, title, subtitle, members } = useLocalSearchParams<{
    id: string;
    title?: string;
    subtitle?: string;
    members?: string;
  }>();
  const groupId = useMemo(() => (groupIdParam ? String(groupIdParam) : null), [groupIdParam]);

  const { user } = useAuth();
  const { profile } = useProfile(user?.uid);
  const colorScheme = useColorScheme();
  const palette = Colors[colorScheme ?? 'light'];

  const [messages, setMessages] = useState<GroupMessage[]>([]);
  const [input, setInput] = useState('');
  const [sending, setSending] = useState(false);
  const [loading, setLoading] = useState(false);
  const [joined, setJoined] = useState(false);
  const [joining, setJoining] = useState(false);
  const [leaving, setLeaving] = useState(false);
  const [membersOpen, setMembersOpen] = useState(false);
  const [groupMeta, setGroupMeta] = useState<GroupMeta | null>(null);
  const [participants, setParticipants] = useState<GroupParticipant[]>([]);
  const [liveHostIds, setLiveHostIds] = useState<string[]>([]);
  const [deleting, setDeleting] = useState(false);
  const flatListRef = useRef<FlatList<GroupMessage>>(null);

  const groupTitle = groupMeta?.title || title || 'Gruppo';
  const groupSubtitle = groupMeta?.subtitle || subtitle || 'Chat di gruppo';
  const membersCount =
    typeof groupMeta?.membersCount === 'number' ? groupMeta.membersCount : null;
  const membersText =
    typeof membersCount === 'number' ? `${membersCount} membri` : members ? `${members} membri` : '';
  const isOwner = !!user?.uid && groupMeta?.owner === user.uid;
  const participantsCount = joined ? participants.length : 0;
  const liveActive = !!groupMeta?.live?.active;
  const isWeb = Platform.OS === 'web';
  const liveHostSet = useMemo(() => new Set(liveHostIds), [liveHostIds]);

  const alertMessage = (title: string, message: string) => {
    if (isWeb && typeof window !== 'undefined') {
      window.alert(`${title}\n\n${message}`);
      return;
    }
    Alert.alert(title, message);
  };

  const confirmMessage = (title: string, message: string) => {
    if (isWeb && typeof window !== 'undefined') {
      return window.confirm(`${title}\n\n${message}`);
    }
    return null;
  };

  const startGroupLive = useMemo(
    () => httpsCallable(functions, 'startGroupLive'),
    []
  );

  useEffect(() => {
    setJoined(false);
  }, [groupId]);

  useEffect(() => {
    if (!groupId) {
      setGroupMeta(null);
      return;
    }
    const groupRef = doc(db, 'groupRooms', groupId);
    const unsub = onSnapshot(groupRef, (snap) => {
      if (snap.exists()) {
        setGroupMeta(snap.data() as GroupMeta);
      } else {
        setGroupMeta(null);
      }
    });
    return unsub;
  }, [groupId]);

  useEffect(() => {
    if (!groupId || !joined) {
      setMessages([]);
      setLoading(false);
      return;
    }
    setLoading(true);
    const q = query(collection(db, 'groupRooms', groupId, 'messages'), orderBy('createdAt', 'asc'));
    const unsub = onSnapshot(q, (snap) => {
      const items = snap.docs.map((d) => ({ id: d.id, ...(d.data() as any) }));
      setMessages(items);
      setLoading(false);
      if (items.length) {
        requestAnimationFrame(() => flatListRef.current?.scrollToEnd({ animated: true }));
      }
    });
    return unsub;
  }, [groupId, joined]);

  const toMillis = (value: any) => {
    if (!value) return 0;
    if (typeof value === 'number') return value;
    if (value.toMillis) return value.toMillis();
    if (value.toDate) return value.toDate().getTime();
    if (typeof value.seconds === 'number') return value.seconds * 1000;
    return 0;
  };

  useEffect(() => {
    if (!groupId || !joined) {
      setParticipants([]);
      return;
    }
    const q = query(collection(db, 'groupRooms', groupId, 'presence'));
    const unsub = onSnapshot(q, (snap) => {
      const now = Date.now();
      const items = snap.docs.map((d) => {
        const data = d.data() as any;
        return {
          id: d.id,
          name: data.name || 'Utente',
          photo: data.photo || '',
          activeAt: data.activeAt,
        } as GroupParticipant;
      });
      const active = items
        .filter((item) => now - toMillis(item.activeAt) <= PRESENCE_ACTIVE_MS)
        .sort((a, b) => toMillis(b.activeAt) - toMillis(a.activeAt));
      setParticipants(active);
    });
    return unsub;
  }, [groupId, joined]);

  useEffect(() => {
    if (!groupId || !joined) {
      setLiveHostIds([]);
      return;
    }
    const q = query(collection(db, 'groupRooms', groupId, 'livePresence'));
    const unsub = onSnapshot(q, (snap) => {
      const now = Date.now();
      const activeHosts = snap.docs
        .map((d) => ({ id: d.id, ...(d.data() as any) }))
        .filter((item) => now - toMillis(item.activeAt) <= LIVE_PRESENCE_ACTIVE_MS)
        .filter((item) => (item.role || 'host') === 'host')
        .map((item) => item.id);
      setLiveHostIds(activeHosts);
    });
    return unsub;
  }, [groupId, joined]);

  useEffect(() => {
    if (!groupId || !user?.uid || !joined) return;
    const presenceRef = doc(db, 'groupRooms', groupId, 'presence', user.uid);
    let active = true;

    const touchPresence = async () => {
      if (!active) return;
      const name = profile?.name || user.displayName || 'Utente';
      const photo = profile?.photo || user.photoURL || '';
      try {
        await setDoc(
          presenceRef,
          { activeAt: serverTimestamp(), name, photo },
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
  }, [groupId, user?.uid, profile?.name, user?.displayName, joined]);

  const formatTime = (value?: any) => {
    if (!value) return '';
    const date = value?.toDate ? value.toDate() : new Date(value);
    return date.toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' });
  };

  const refreshMembersCount = useCallback(async () => {
    if (!groupId) return;
    try {
      const cutoff = new Date(Date.now() - PRESENCE_ACTIVE_MS);
      const q = query(
        collection(db, 'groupRooms', groupId, 'presence'),
        where('activeAt', '>', cutoff)
      );
      const snap = await getDocs(q);
      await setDoc(
        doc(db, 'groupRooms', groupId),
        { membersCount: snap.size },
        { merge: true }
      );
    } catch {
      // best effort
    }
  }, [groupId]);

  const handleJoin = useCallback(async () => {
    if (!groupId || !user?.uid || joining) return;
    setJoining(true);
    const presenceRef = doc(db, 'groupRooms', groupId, 'presence', user.uid);
    const name = profile?.name || user.displayName || 'Utente';
    const photo = profile?.photo || user.photoURL || '';
    try {
      await setDoc(
        presenceRef,
        { activeAt: serverTimestamp(), name, photo },
        { merge: true }
      );
      await refreshMembersCount();
      setJoined(true);
    } catch (e) {
      Alert.alert('Errore', 'Non sono riuscito a entrare nel gruppo.');
    } finally {
      setJoining(false);
    }
  }, [groupId, user?.uid, joining, profile?.name, user?.displayName, refreshMembersCount]);

  const handleLeave = useCallback(async () => {
    if (!groupId || !user?.uid || leaving) {
      router.back();
      return;
    }
    setLeaving(true);
    const presenceRef = doc(db, 'groupRooms', groupId, 'presence', user.uid);
    try {
      await deleteDoc(presenceRef);
      await refreshMembersCount();
    } catch (e) {
      Alert.alert('Errore', 'Non sono riuscito a uscire correttamente dal gruppo.');
    } finally {
      setLeaving(false);
      setJoined(false);
      router.back();
    }
  }, [groupId, user?.uid, leaving, refreshMembersCount, router]);

  const handleLivePress = useCallback(() => {
    if (!groupId || !user?.uid) return;
    if (!joined) {
      alertMessage('Live', 'Entra nel gruppo per accedere alla live.');
      return;
    }

    const openHostLive = async () => {
      try {
        await startGroupLive({ groupId });
        router.push({
          pathname: '/groups/live/[id]',
          params: { id: groupId, title: groupTitle, host: '1', hostId: user.uid },
        });
      } catch (error: any) {
        const code = error?.code || '';
        if (code === 'functions/already-exists' || error?.message?.includes('live-active')) {
          router.push({
            pathname: '/groups/live/[id]',
            params: { id: groupId, title: groupTitle, host: '1', hostId: user.uid },
          });
          return;
        }
        const message =
          code === 'functions/unauthenticated'
            ? 'Devi essere loggato per avviare la live.'
            : code === 'functions/permission-denied' || error?.message?.includes('not-in-group')
            ? 'Entra nel gruppo prima di avviare la live.'
            : code === 'functions/not-found'
            ? 'Funzione live non trovata. Hai fatto il deploy?'
            : error?.message?.includes('group-not-found')
            ? 'Gruppo non trovato.'
            : 'Non sono riuscito ad avviare la live.';
        alertMessage('Errore', message);
      }
    };

    if (isWeb) {
      const confirmed = confirmMessage('Avvia live', 'Vuoi avviare la live per il gruppo?');
      if (!confirmed) return;
      void openHostLive();
      return;
    }
    Alert.alert('Avvia live', 'Vuoi avviare la live per il gruppo?', [
      { text: 'Annulla', style: 'cancel' },
      { text: 'Avvia', onPress: () => void openHostLive() },
    ]);
  }, [
    groupId,
    user?.uid,
    joined,
    groupTitle,
    startGroupLive,
    router,
    alertMessage,
    confirmMessage,
    isWeb,
  ]);

  const confirmExit = useCallback(() => {
    Alert.alert('Esci dal gruppo', 'Vuoi uscire dal gruppo?', [
      { text: 'Annulla', style: 'cancel' },
      {
        text: 'Esci',
        style: 'destructive',
        onPress: () => void handleLeave(),
      },
    ]);
  }, [handleLeave]);

  const handleBackPress = useCallback(() => {
    if (!joined) {
      router.back();
      return;
    }
    confirmExit();
  }, [joined, confirmExit, router]);

  const handleHardwareBackPress = useCallback(() => {
    if (!joined) {
      router.back();
      return true;
    }
    confirmExit();
    return true;
  }, [joined, confirmExit, router]);

  useEffect(() => {
    const sub = BackHandler.addEventListener('hardwareBackPress', handleHardwareBackPress);
    return () => sub.remove();
  }, [handleHardwareBackPress]);

  const handleSend = async () => {
    if (!groupId || !user?.uid || !joined) return;
    const trimmed = input.trim();
    if (!trimmed) return;
    setSending(true);
    setInput('');
    const senderName = profile?.name || user.displayName || 'Tu';

    try {
      await setDoc(
        doc(db, 'groupRooms', groupId),
        {
          title: groupTitle,
          subtitle: groupSubtitle,
          updatedAt: serverTimestamp(),
          lastMessage: trimmed,
          lastSender: user.uid,
        },
        { merge: true }
      );

      await addDoc(collection(db, 'groupRooms', groupId, 'messages'), {
        text: trimmed,
        senderId: user.uid,
        senderName,
        createdAt: serverTimestamp(),
      });
    } catch (e) {
      setInput(trimmed);
    } finally {
      setSending(false);
    }
  };

  const handleDeleteGroup = () => {
    if (!groupId || !isOwner || deleting) return;
    Alert.alert('Elimina gruppo', 'Vuoi eliminare questo gruppo? Azione definitiva.', [
      { text: 'Annulla', style: 'cancel' },
      {
        text: 'Elimina',
        style: 'destructive',
        onPress: async () => {
          if (!groupId) return;
          setDeleting(true);
          try {
            const threadsSnap = await getDocs(
              collection(db, 'groupRooms', groupId, 'privateThreads')
            );
            await Promise.all(threadsSnap.docs.map((thread) => deleteDoc(thread.ref)));
            await deleteDoc(doc(db, 'groupRooms', groupId));
            router.back();
          } catch (e) {
            Alert.alert('Errore', 'Non sono riuscito a eliminare il gruppo.');
          } finally {
            setDeleting(false);
          }
        },
      },
    ]);
  };

  const handleOpenPrivate = (targetId: string, targetName: string) => {
    if (!groupId || !user?.uid || !targetId) return;
    const threadId = [user.uid, targetId].sort().join('_');
    router.push({
      pathname: '/groups/private/[id]',
      params: {
        id: threadId,
        groupId,
        groupTitle: groupTitle,
        otherId: targetId,
        otherName: targetName,
      },
    });
  };

  const renderItem = ({ item }: { item: GroupMessage }) => {
    const isMine = item.senderId === user?.uid;
    const senderLabel = isMine ? 'Tu' : item.senderName || 'Utente';
    const canOpenPrivate = !!item.senderId && item.senderId !== user?.uid;
    const bubble = (
      <View
        style={[
          styles.bubble,
          {
            backgroundColor: isMine ? palette.tint : palette.card,
            borderColor: isMine ? 'transparent' : palette.border,
            alignSelf: isMine ? 'flex-end' : 'flex-start',
          },
        ]}
      >
        <Text
          style={[styles.sender, { color: isMine ? '#fff' : palette.text }]}
          numberOfLines={1}
          ellipsizeMode="tail"
        >
          {senderLabel}
        </Text>
        <Text style={[styles.text, { color: isMine ? '#fff' : palette.text }]}>{item.text}</Text>
        <View style={styles.timeRow}>
          <Text style={[styles.time, { color: isMine ? 'rgba(255,255,255,0.8)' : palette.muted }]}>
            {formatTime(item.createdAt)}
          </Text>
        </View>
      </View>
    );
    return (
      <View style={[styles.messageRow, isMine ? styles.messageRowMine : styles.messageRowOther]}>
        {canOpenPrivate ? (
          <Pressable
            onPress={() =>
              Alert.alert(senderLabel, 'Vuoi scrivere in privato?', [
                { text: 'Annulla', style: 'cancel' },
                {
                  text: 'Messaggio privato',
                  onPress: () => handleOpenPrivate(item.senderId, senderLabel),
                },
              ])
            }
          >
            {bubble}
          </Pressable>
        ) : (
          bubble
        )}
      </View>
    );
  };

  return (
    <SafeAreaView style={[styles.screen, { backgroundColor: palette.background }]} edges={['top', 'bottom']}>
      <View style={[styles.header, { borderBottomColor: palette.border, backgroundColor: palette.card }]}>
        <Pressable
          style={[styles.headerButton, { borderColor: palette.border, backgroundColor: palette.background }]}
          onPress={handleBackPress}
        >
          <Ionicons name="chevron-back" size={22} color={palette.text} />
        </Pressable>
        <View style={styles.headerInfo}>
          <Text style={[styles.headerTitle, { color: palette.text }]} numberOfLines={1}>
            {groupTitle}
          </Text>
          <View style={styles.headerSubtitleRow}>
            <Text style={[styles.headerSubtitle, { color: palette.muted }]} numberOfLines={1}>
              {groupSubtitle}
            </Text>
            {membersText ? (
              <Pressable onPress={() => setMembersOpen(true)} hitSlop={6}>
                <Text style={[styles.membersLink, { color: palette.tint }]}>{membersText}</Text>
              </Pressable>
            ) : null}
          </View>
        </View>
        <View style={styles.headerActions}>
          <Pressable
            style={[
              styles.headerButton,
              { borderColor: palette.border, backgroundColor: palette.background },
            ]}
            onPress={handleLivePress}
          >
            <Ionicons
              name={liveActive ? 'videocam' : 'videocam-outline'}
              size={20}
              color={liveActive ? palette.tint : palette.muted}
            />
            {liveActive ? (
              <View style={[styles.liveDot, { backgroundColor: '#ff3b30' }]} />
            ) : null}
          </Pressable>
          {isOwner ? (
            <Pressable
              style={[styles.headerButton, { borderColor: palette.border, backgroundColor: palette.background }]}
              onPress={handleDeleteGroup}
              disabled={deleting}
            >
              {deleting ? (
                <ActivityIndicator size="small" color={palette.muted} />
              ) : (
                <Ionicons name="trash-outline" size={20} color={palette.muted} />
              )}
            </Pressable>
          ) : null}
        </View>
      </View>

      <KeyboardAvoidingView
        style={styles.flex}
        behavior={Platform.OS === 'ios' ? 'padding' : 'height'}
        keyboardVerticalOffset={Platform.OS === 'ios' ? 90 : 0}
      >
        {joined ? (
          <>
            <FlatList
              ref={flatListRef}
              data={messages}
              keyExtractor={(item) => item.id}
              renderItem={renderItem}
              contentContainerStyle={[
                styles.listContent,
                messages.length === 0 ? styles.listContentEmpty : undefined,
              ]}
              ListEmptyComponent={
                loading ? null : (
                  <View style={styles.empty}>
                    <Ionicons name="chatbubbles-outline" size={40} color={palette.muted} />
                    <Text style={[styles.emptyText, { color: palette.muted }]}>Nessun messaggio nel gruppo</Text>
                  </View>
                )
              }
            />

            <View style={[styles.inputBar, { borderColor: palette.border, backgroundColor: palette.card }]}>
              <TextInput
                value={input}
                onChangeText={setInput}
                placeholder="Scrivi un messaggio..."
                placeholderTextColor={palette.muted}
                style={[
                  styles.input,
                  {
                    color: palette.text,
                    backgroundColor: palette.background,
                    borderColor: palette.border,
                  },
                ]}
                editable={!sending}
                multiline
              />
              <Pressable
                style={[
                  styles.sendButton,
                  {
                    backgroundColor: input.trim() ? palette.tint : palette.background,
                    borderColor: input.trim() ? palette.tint : palette.border,
                    opacity: sending ? 0.6 : 1,
                  },
                ]}
                onPress={handleSend}
                disabled={sending || !input.trim()}
              >
                {sending ? (
                  <ActivityIndicator size="small" color={input.trim() ? '#fff' : palette.muted} />
                ) : (
                  <Ionicons name="send" size={18} color={input.trim() ? '#fff' : palette.muted} />
                )}
              </Pressable>
            </View>
          </>
        ) : (
          <View style={styles.joinContainer}>
            <View
              style={[
                styles.joinCard,
                {
                  backgroundColor: palette.card,
                  borderColor: palette.border,
                },
              ]}
            >
              <Ionicons name="people-outline" size={40} color={palette.muted} />
              <Text style={[styles.joinTitle, { color: palette.text }]}>Conferma ingresso</Text>
              <Text style={[styles.joinSubtitle, { color: palette.muted }]}>
                Entra per partecipare alla chat e contare i membri presenti.
              </Text>
              <View style={styles.joinButtons}>
                <Pressable
                  style={[
                    styles.joinButton,
                    { borderColor: palette.border, backgroundColor: palette.background },
                  ]}
                  onPress={() => router.back()}
                >
                  <Text style={[styles.joinButtonText, { color: palette.text }]}>Indietro</Text>
                </Pressable>
                <Pressable
                  style={[
                    styles.joinButton,
                    { borderColor: palette.tint, backgroundColor: palette.tint },
                  ]}
                  onPress={handleJoin}
                  disabled={joining}
                >
                  {joining ? (
                    <ActivityIndicator color="#fff" />
                  ) : (
                    <Text style={[styles.joinButtonText, { color: '#fff' }]}>Entra</Text>
                  )}
                </Pressable>
              </View>
            </View>
          </View>
        )}
      </KeyboardAvoidingView>

      <Modal
        visible={membersOpen}
        transparent
        animationType="fade"
        onRequestClose={() => setMembersOpen(false)}
      >
        <View style={styles.modalBackdrop}>
          <View style={[styles.membersModal, { backgroundColor: palette.card, borderColor: palette.border }]}>
            <View style={[styles.sheetHandle, { backgroundColor: palette.border }]} />
            <View style={styles.membersModalHeader}>
              <View style={styles.membersModalTitleRow}>
                <View style={[styles.membersIcon, { backgroundColor: palette.background }]}>
                  <Ionicons name="people-outline" size={18} color={palette.tint} />
                </View>
                <View>
                  <Text style={[styles.membersModalTitle, { color: palette.text }]}>Utenti nel gruppo</Text>
                  <Text style={[styles.membersModalSubtitle, { color: palette.muted }]}>
                    {joined ? `${participantsCount} online ora` : 'Solo membri presenti'}
                  </Text>
                  {liveHostIds.length ? (
                    <Text style={[styles.membersModalHint, { color: palette.muted }]}>
                      Tocca chi e in live per partecipare.
                    </Text>
                  ) : null}
                </View>
              </View>
              <Pressable
                onPress={() => setMembersOpen(false)}
                style={[styles.closeButton, { backgroundColor: palette.background, borderColor: palette.border }]}
              >
                <Ionicons name="close" size={18} color={palette.muted} />
              </Pressable>
            </View>
            <View style={styles.membersBody}>
              {joined ? (
                participants.length === 0 ? (
                  <Text style={[styles.membersEmpty, { color: palette.muted }]}>Nessuno online</Text>
                ) : (
                  <FlatList
                    style={styles.membersListBody}
                    data={participants}
                    keyExtractor={(item) => item.id}
                    contentContainerStyle={styles.membersList}
                    renderItem={({ item }) => {
                      const initial = item.name?.trim()?.[0]?.toUpperCase() ?? '?';
                      const isLiveMember = liveHostSet.has(item.id);
                      const row = (
                        <View
                          style={[
                            styles.memberRow,
                            { backgroundColor: palette.background, borderColor: palette.border },
                          ]}
                        >
                          <View style={styles.memberRowLeft}>
                            <View
                              style={[
                                styles.memberAvatar,
                                { borderColor: palette.border, backgroundColor: palette.card },
                              ]}
                            >
                              {item.photo ? (
                                <Image
                                  source={{ uri: item.photo }}
                                  style={styles.memberAvatarImage}
                                  resizeMode="cover"
                                />
                              ) : (
                                <Text style={[styles.memberInitial, { color: palette.text }]}>{initial}</Text>
                              )}
                            </View>
                            <Text style={[styles.memberName, { color: palette.text }]} numberOfLines={1}>
                              {item.name}
                            </Text>
                          </View>
                          {isLiveMember ? (
                            <View style={styles.memberLiveBadge}>
                              <View style={styles.memberLiveDot} />
                              <Text style={styles.memberLiveText}>LIVE</Text>
                            </View>
                          ) : (
                            <View style={[styles.memberDot, { backgroundColor: palette.tint }]} />
                          )}
                        </View>
                      );
                      if (!isLiveMember) {
                        return row;
                      }
                      return (
                        <Pressable
                          onPress={() =>
                            router.push({
                              pathname: '/groups/live/[id]',
                              params: { id: groupId, title: groupTitle, hostId: item.id },
                            })
                          }
                        >
                          {row}
                        </Pressable>
                      );
                    }}
                  />
                )
              ) : (
                <Text style={[styles.membersEmpty, { color: palette.muted }]}>
                  Entra nel gruppo per vedere gli utenti presenti.
                </Text>
              )}
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
  flex: {
    flex: 1,
  },
  header: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 12,
    paddingHorizontal: 16,
    paddingVertical: 14,
    borderBottomWidth: 1,
  },
  headerActions: {
    flexDirection: 'row',
    gap: 10,
  },
  headerButton: {
    width: 42,
    height: 42,
    borderRadius: 12,
    alignItems: 'center',
    justifyContent: 'center',
    borderWidth: 1,
  },
  headerInfo: {
    flex: 1,
    gap: 2,
  },
  headerSubtitleRow: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 8,
  },
  headerTitle: {
    fontSize: 18,
    fontWeight: '800',
  },
  headerSubtitle: {
    flex: 1,
    fontSize: 13,
    fontWeight: '500',
  },
  membersLink: {
    fontSize: 13,
    fontWeight: '700',
  },
  liveDot: {
    position: 'absolute',
    top: 8,
    right: 8,
    width: 8,
    height: 8,
    borderRadius: 4,
  },
  listContent: {
    paddingHorizontal: 14,
    paddingTop: 18,
    paddingBottom: 20,
    gap: 12,
    flexGrow: 1,
  },
  listContentEmpty: {
    justifyContent: 'center',
  },
  modalBackdrop: {
    flex: 1,
    backgroundColor: 'rgba(0,0,0,0.4)',
    alignItems: 'stretch',
    justifyContent: 'flex-end',
  },
  membersModal: {
    width: '100%',
    height: '80%',
    borderTopLeftRadius: 16,
    borderTopRightRadius: 16,
    borderWidth: 1,
    padding: 16,
    shadowColor: '#000',
    shadowOffset: { width: 0, height: -4 },
    shadowOpacity: 0.08,
    shadowRadius: 16,
    elevation: 8,
  },
  sheetHandle: {
    alignSelf: 'center',
    width: 36,
    height: 4,
    borderRadius: 2,
    marginBottom: 12,
  },
  membersModalHeader: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    marginBottom: 12,
  },
  membersModalTitleRow: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 10,
  },
  membersIcon: {
    width: 36,
    height: 36,
    borderRadius: 18,
    alignItems: 'center',
    justifyContent: 'center',
  },
  membersBody: {
    flex: 1,
  },
  membersModalTitle: {
    fontSize: 16,
    fontWeight: '800',
  },
  membersModalSubtitle: {
    marginTop: 2,
    fontSize: 12,
    fontWeight: '600',
  },
  membersModalHint: {
    marginTop: 4,
    fontSize: 11,
    fontWeight: '600',
  },
  closeButton: {
    width: 34,
    height: 34,
    borderRadius: 12,
    borderWidth: 1,
    alignItems: 'center',
    justifyContent: 'center',
  },
  membersListBody: {
    flex: 1,
  },
  membersList: {
    gap: 12,
    paddingBottom: 6,
  },
  membersEmpty: {
    fontSize: 13,
    fontWeight: '600',
    textAlign: 'center',
    paddingVertical: 16,
  },
  memberRow: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    borderWidth: 1,
    borderRadius: 14,
    paddingHorizontal: 12,
    paddingVertical: 10,
  },
  memberRowLeft: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 10,
  },
  memberAvatar: {
    width: 40,
    height: 40,
    borderRadius: 20,
    borderWidth: 1,
    alignItems: 'center',
    justifyContent: 'center',
    overflow: 'hidden',
  },
  memberAvatarImage: {
    width: '100%',
    height: '100%',
  },
  memberInitial: {
    fontSize: 15,
    fontWeight: '700',
  },
  memberName: {
    flex: 1,
    fontSize: 14,
    fontWeight: '600',
  },
  memberDot: {
    width: 8,
    height: 8,
    borderRadius: 4,
  },
  memberLiveBadge: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 6,
    paddingHorizontal: 10,
    paddingVertical: 4,
    borderRadius: 999,
    backgroundColor: '#ffecec',
  },
  memberLiveDot: {
    width: 6,
    height: 6,
    borderRadius: 3,
    backgroundColor: '#ff3b30',
  },
  memberLiveText: {
    fontSize: 11,
    fontWeight: '800',
    color: '#ff3b30',
  },
  joinContainer: {
    flex: 1,
    alignItems: 'center',
    justifyContent: 'center',
    padding: 24,
  },
  joinCard: {
    width: '100%',
    borderRadius: 20,
    borderWidth: 1,
    paddingHorizontal: 20,
    paddingVertical: 24,
    gap: 12,
    alignItems: 'center',
    shadowColor: '#000',
    shadowOffset: { width: 0, height: 2 },
    shadowOpacity: 0.08,
    shadowRadius: 10,
    elevation: 3,
  },
  joinTitle: {
    fontSize: 18,
    fontWeight: '700',
    textAlign: 'center',
  },
  joinSubtitle: {
    fontSize: 14,
    lineHeight: 20,
    textAlign: 'center',
  },
  joinButtons: {
    flexDirection: 'row',
    gap: 12,
    marginTop: 8,
    width: '100%',
  },
  joinButton: {
    flex: 1,
    borderRadius: 12,
    borderWidth: 1,
    paddingVertical: 12,
    alignItems: 'center',
    justifyContent: 'center',
  },
  joinButtonText: {
    fontSize: 14,
    fontWeight: '700',
  },
  messageRow: {
    flexDirection: 'row',
    paddingHorizontal: 6,
    width: '100%',
  },
  messageRowMine: {
    justifyContent: 'flex-end',
  },
  messageRowOther: {
    justifyContent: 'flex-start',
  },
  bubble: {
    maxWidth: '85%',
    minWidth: 160,
    borderRadius: 18,
    borderWidth: 1,
    paddingHorizontal: 14,
    paddingVertical: 12,
    gap: 4,
    shadowColor: '#000',
    shadowOffset: { width: 0, height: 2 },
    shadowOpacity: 0.08,
    shadowRadius: 10,
    elevation: 3,
  },
  sender: {
    fontSize: 13,
    fontWeight: '700',
    marginBottom: 2,
  },
  timeRow: {
    width: '100%',
    alignItems: 'flex-end',
    marginTop: 6,
  },
  time: {
    fontSize: 11,
    fontWeight: '600',
    textAlign: 'right',
  },
  text: {
    fontSize: 15,
    lineHeight: 21,
  },
  empty: {
    alignItems: 'center',
    gap: 8,
    paddingVertical: 40,
  },
  emptyText: {
    fontSize: 14,
    fontWeight: '600',
  },
  inputBar: {
    flexDirection: 'row',
    alignItems: 'flex-end',
    gap: 10,
    paddingHorizontal: 14,
    paddingVertical: 12,
    borderTopWidth: 1,
    shadowColor: '#000',
    shadowOffset: { width: 0, height: -2 },
    shadowOpacity: 0.04,
    shadowRadius: 6,
    elevation: 4,
  },
  input: {
    flex: 1,
    fontSize: 15,
    minHeight: 44,
    maxHeight: 140,
    paddingHorizontal: 12,
    paddingVertical: 10,
    borderRadius: 14,
    borderWidth: 1,
  },
  sendButton: {
    width: 46,
    height: 46,
    borderRadius: 14,
    borderWidth: 1,
    alignItems: 'center',
    justifyContent: 'center',
  },
});
