import Ionicons from '@expo/vector-icons/Ionicons';
import { SafeAreaView } from 'react-native-safe-area-context';
import { StyleSheet, Text, View, useColorScheme, Pressable } from 'react-native';
import { signOut } from 'firebase/auth';

import { Colors } from '@/constants/theme';
import { auth } from '@/lib/firebase';

export default function SettingsScreen() {
  const colorScheme = useColorScheme();
  const palette = Colors[colorScheme ?? 'light'];

  return (
    <SafeAreaView style={[styles.screen, { backgroundColor: palette.background }]} edges={['top']}>
      <View style={styles.header}>
        <Ionicons name="settings-sharp" size={24} color={palette.text} />
        <Text style={styles.title}>Impostazioni</Text>
      </View>
      <Text style={[styles.subtitle, { color: palette.muted }]}>
        Qui aggiungeremo le opzioni in futuro.
      </Text>

      <View style={[styles.card, { borderColor: palette.border }]}>
        <Pressable
          onPress={() => signOut(auth).catch(() => {})}
          style={[styles.logoutBtn, { backgroundColor: palette.tint }]}
        >
          <Ionicons name="log-out-outline" size={18} color="#fff" />
          <Text style={styles.logoutText}>Esci</Text>
        </Pressable>
      </View>
    </SafeAreaView>
  );
}

const styles = StyleSheet.create({
  screen: {
    flex: 1,
    padding: 16,
    gap: 8,
  },
  header: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 8,
  },
  title: {
    fontSize: 22,
    fontWeight: '800',
  },
  subtitle: {
    fontSize: 14,
  },
  card: {
    marginTop: 16,
    padding: 12,
    borderWidth: 1,
    borderRadius: 12,
    gap: 12,
  },
  logoutBtn: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'center',
    gap: 8,
    paddingVertical: 12,
    borderRadius: 10,
  },
  logoutText: {
    color: '#fff',
    fontSize: 15,
    fontWeight: '700',
  },
});
