import Ionicons from '@expo/vector-icons/Ionicons';
import { addDoc, collection, doc, onSnapshot, orderBy, query, serverTimestamp, setDoc } from 'firebase/firestore';
import { useEffect, useMemo, useRef, useState } from 'react';
import {
  ActivityIndicator,
  FlatList,
  KeyboardAvoidingView,
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
import { db } from '@/lib/firebase';

type GroupMessage = {
  id: string;
  text: string;
  senderId: string;
  senderName?: string;
  createdAt?: { toDate?: () => Date } | Date;
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
  const [loading, setLoading] = useState(true);
  const flatListRef = useRef<FlatList<GroupMessage>>(null);

  const groupTitle = title || 'Gruppo';
  const groupSubtitle = subtitle || 'Chat di gruppo';
  const membersText = members ? `${members} membri` : '';

  useEffect(() => {
    if (!groupId) return;
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
  }, [groupId]);

  const formatTime = (value?: any) => {
    if (!value) return '';
    const date = value?.toDate ? value.toDate() : new Date(value);
    return date.toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' });
  };

  const handleSend = async () => {
    if (!groupId || !user?.uid) return;
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

  const renderItem = ({ item }: { item: GroupMessage }) => {
    const isMine = item.senderId === user?.uid;
    const senderLabel = isMine ? 'Tu' : item.senderName || 'Utente';
    return (
      <View style={[styles.messageRow, isMine ? styles.messageRowMine : styles.messageRowOther]}>
        <View
          style={[
            styles.bubble,
            {
              backgroundColor: isMine ? palette.tint : palette.card,
              borderColor: isMine ? palette.tint : palette.border,
            },
          ]}
        >
          <View style={styles.bubbleHeader}>
            <Text style={[styles.sender, { color: isMine ? '#fff' : palette.text }]}>{senderLabel}</Text>
            <Text style={[styles.time, { color: isMine ? 'rgba(255,255,255,0.8)' : palette.muted }]}>
              {formatTime(item.createdAt)}
            </Text>
          </View>
          <Text style={[styles.text, { color: isMine ? '#fff' : palette.text }]}>{item.text}</Text>
        </View>
      </View>
    );
  };

  return (
    <SafeAreaView style={[styles.screen, { backgroundColor: palette.background }]} edges={['top', 'bottom']}>
      <View style={[styles.header, { borderBottomColor: palette.border }]}>
        <Pressable style={[styles.headerButton, { borderColor: palette.border }]} onPress={() => router.back()}>
          <Ionicons name="chevron-back" size={22} color={palette.text} />
        </Pressable>
        <View style={styles.headerInfo}>
          <Text style={[styles.headerTitle, { color: palette.text }]} numberOfLines={1}>
            {groupTitle}
          </Text>
          <Text style={[styles.headerSubtitle, { color: palette.muted }]} numberOfLines={1}>
            {groupSubtitle} {membersText ? `· ${membersText}` : ''}
          </Text>
        </View>
        <View style={styles.headerButton} />
      </View>

      <KeyboardAvoidingView
        style={styles.flex}
        behavior={Platform.OS === 'ios' ? 'padding' : 'height'}
        keyboardVerticalOffset={Platform.OS === 'ios' ? 90 : 0}
      >
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
            style={[styles.input, { color: palette.text }]}
            editable={!sending}
            multiline
          />
          <Pressable
            style={[
              styles.sendButton,
              {
                backgroundColor: input.trim() ? palette.tint : 'transparent',
                borderColor: palette.border,
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
      </KeyboardAvoidingView>
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
    paddingVertical: 12,
    borderBottomWidth: 1,
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
  headerTitle: {
    fontSize: 18,
    fontWeight: '800',
  },
  headerSubtitle: {
    fontSize: 13,
    fontWeight: '500',
  },
  listContent: {
    padding: 16,
    gap: 10,
    flexGrow: 1,
  },
  listContentEmpty: {
    justifyContent: 'center',
  },
  messageRow: {
    flexDirection: 'row',
    paddingHorizontal: 4,
  },
  messageRowMine: {
    justifyContent: 'flex-end',
  },
  messageRowOther: {
    justifyContent: 'flex-start',
  },
  bubble: {
    maxWidth: '78%',
    borderRadius: 16,
    borderWidth: 1,
    paddingHorizontal: 12,
    paddingVertical: 10,
    gap: 4,
    shadowOffset: { width: 0, height: 2 },
    shadowOpacity: 0.05,
    shadowRadius: 6,
    elevation: 2,
  },
  bubbleHeader: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    alignItems: 'center',
    gap: 10,
  },
  sender: {
    fontSize: 13,
    fontWeight: '700',
  },
  time: {
    fontSize: 11,
    fontWeight: '600',
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
    paddingHorizontal: 12,
    paddingVertical: 10,
    borderTopWidth: 1,
  },
  input: {
    flex: 1,
    fontSize: 15,
    minHeight: 44,
    maxHeight: 140,
    paddingHorizontal: 12,
    paddingVertical: 8,
  },
  sendButton: {
    width: 44,
    height: 44,
    borderRadius: 12,
    borderWidth: 1,
    alignItems: 'center',
    justifyContent: 'center',
  },
});
