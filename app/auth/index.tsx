import { useEffect, useState } from 'react';
import { Redirect, router } from 'expo-router';
import {
  ActivityIndicator,
  Pressable,
  StyleSheet,
  Text,
  TextInput,
  View,
  useColorScheme,
} from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';
import { createUserWithEmailAndPassword, signInWithEmailAndPassword } from 'firebase/auth';

import { Colors } from '@/constants/theme';
import { auth } from '@/lib/firebase';
import { useAuth } from '@/hooks/use-auth';

export default function AuthScreen() {
  const colorScheme = useColorScheme();
  const palette = Colors[colorScheme ?? 'light'];
  const [mode, setMode] = useState<'login' | 'signup'>('login');
  const [email, setEmail] = useState('');
  const [password, setPassword] = useState('');
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const { user } = useAuth();

  useEffect(() => {
    if (user) {
      router.replace('/');
    }
  }, [user]);

  if (user) {
    return <Redirect href="/" />;
  }

  const handleSubmit = async () => {
    setError(null);
    setLoading(true);
    try {
      if (mode === 'login') {
        await signInWithEmailAndPassword(auth, email.trim(), password);
      } else {
        await createUserWithEmailAndPassword(auth, email.trim(), password);
      }
      router.replace('/');
    } catch (e: any) {
      setError(e?.message ?? 'Errore');
    } finally {
      setLoading(false);
    }
  };

  return (
    <SafeAreaView style={[styles.screen, { backgroundColor: palette.background }]}>
      <View style={styles.container}>
        <Text style={styles.brand}>chatIncontri</Text>
        <Text style={[styles.subtitle, { color: palette.muted }]}>
          Accedi o crea un account con email e password.
        </Text>

        <View style={[styles.inputBox, { borderColor: palette.border }]}>
          <TextInput
            placeholder="Email"
            keyboardType="email-address"
            autoCapitalize="none"
            value={email}
            onChangeText={setEmail}
            style={styles.input}
            placeholderTextColor={palette.muted}
          />
        </View>
        <View style={[styles.inputBox, { borderColor: palette.border }]}>
          <TextInput
            placeholder="Password"
            secureTextEntry
            value={password}
            onChangeText={setPassword}
            style={styles.input}
            placeholderTextColor={palette.muted}
          />
        </View>

        {error ? <Text style={styles.error}>{error}</Text> : null}

        <Pressable
          style={[styles.primary, { backgroundColor: palette.tint }]}
          onPress={handleSubmit}
          disabled={loading}>
          {loading ? (
            <ActivityIndicator color="#fff" />
          ) : (
            <Text style={styles.primaryText}>{mode === 'login' ? 'Accedi' : 'Registrati'}</Text>
          )}
        </Pressable>

        <Pressable
          onPress={() => setMode((m) => (m === 'login' ? 'signup' : 'login'))}
          style={styles.switcher}>
          <Text style={styles.switcherText}>
            {mode === 'login' ? 'Non hai un account? Registrati' : 'Hai già un account? Accedi'}
          </Text>
        </Pressable>
      </View>
    </SafeAreaView>
  );
}

const styles = StyleSheet.create({
  screen: {
    flex: 1,
  },
  container: {
    flex: 1,
    padding: 20,
    gap: 12,
    alignItems: 'center',
  },
  brand: {
    marginTop: 20,
    fontSize: 28,
    fontWeight: '800',
    letterSpacing: 0.3,
  },
  subtitle: {
    fontSize: 14,
    textAlign: 'center',
    marginBottom: 4,
  },
  inputBox: {
    width: '100%',
    borderWidth: 1,
    borderRadius: 12,
    paddingHorizontal: 12,
    paddingVertical: 10,
  },
  input: {
    fontSize: 15,
  },
  error: {
    color: '#ef4444',
    textAlign: 'center',
  },
  primary: {
    width: '100%',
    paddingVertical: 12,
    borderRadius: 12,
    alignItems: 'center',
    justifyContent: 'center',
  },
  primaryText: {
    color: '#fff',
    fontSize: 16,
    fontWeight: '700',
  },
  switcher: {
    marginTop: 8,
  },
  switcherText: {
    fontSize: 14,
    fontWeight: '600',
  },
});
